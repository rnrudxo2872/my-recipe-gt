// 링크(유튜브, 인스타그램, 웹페이지)나 붙여넣은 글을 레시피로 정리한다.
// 진행 단계를 한 줄씩(NDJSON) 흘려보내서 화면이 실제 진행 상황을 보여 줄 수 있게 한다.

import { Hono } from "hono";
import type { ImportEvent, ImportStage } from "../../shared/api";
import { detectSource, type DetectedSource } from "../../shared/links";
import { isUsableRecipe, normalizeRecipe, type RecipeContent, type SourceType } from "../../shared/recipe";
import { extractTextTask, extractVideoTask } from "../ai/prompts";
import { runAi, videoReady } from "../ai/providers";
import { requireVerified } from "../auth";
import { ApiError, readJson, type AppEnv, type HonoEnv, type SessionUser } from "../env";
import { fetchInstagram } from "../extract/instagram";
import { looksLikeRecipe } from "../extract/text";
import { fetchWebPage } from "../extract/web";
import { fetchCreatorComment, fetchYouTubeMeta } from "../extract/youtube";
import { copyRemoteImage, keyFromImageUrl } from "../images";
import { addUsage, assertRecipeRoom, canUseVideo, isUnlimited, useQuota } from "../quota";
import { createRecipe } from "../recipes-db";

interface ImportInput {
  /** 링크나 링크가 들어 있는 공유 텍스트 */
  link?: string;
  /** 레시피 글 자체 (링크가 없을 때) */
  text?: string;
  /** 링크와 함께 사용자가 붙여넣은 설명란·캡션 */
  caption?: string;
  /** 사용자가 올린 사진 (/img/...) */
  image?: string;
  /** 이미 저장한 링크여도 새로 저장 */
  force?: boolean;
}

type Send = (event: ImportEvent) => Promise<void>;

/** 사용자가 캡션을 붙여넣으면 이어서 진행할 수 있는 상황 */
class NeedCaption extends Error {}

/** 이번 가져오기에서 AI를 실제로 불렀는지 센다. 불렀으면 실패해도 횟수를 돌려주지 않는다. */
interface Job {
  aiCalls: number;
}

// 레시피 정리 규칙(프롬프트)을 바꾸면 이 시각을 올린다. 그 전에 정리해 둔 공용 캐시는 쓰지 않고 새로 정리한다.
const CACHE_SINCE = Date.UTC(2026, 10, 1, 8, 35); // 2026-11-01 17:35 KST: 분량 추정·초보자용 단계·한국어 단위

function callAi(job: Job, env: AppEnv, task: Parameters<typeof runAi>[1]) {
  job.aiCalls++;
  return runAi(env, task);
}

function fromAi(data: unknown): RecipeContent | null {
  if (data && typeof data === "object" && (data as Record<string, unknown>).is_recipe === false) return null;
  const content = normalizeRecipe(data);
  return isUsableRecipe(content) ? content : null;
}

async function stage(send: Send, s: ImportStage, label: string) {
  await send({ type: "stage", stage: s, label });
}

interface Extracted {
  content: RecipeContent;
  image: string | null;
  method: string;
}

async function extractYouTube(
  job: Job,
  env: AppEnv,
  user: SessionUser,
  source: Extract<DetectedSource, { type: "youtube" }>,
  input: ImportInput,
  send: Send,
): Promise<Extracted> {
  await stage(send, "meta", "영상 정보를 확인하고 있어요");
  const meta = await fetchYouTubeMeta(env, source.id, source.shorts);
  if (!meta) throw new ApiError(404, "video_unavailable", "영상을 찾을 수 없어요. 공개된 영상인지 확인해 주세요.");

  const text = input.caption?.trim() || meta.description;
  if (text && (input.caption || looksLikeRecipe(text))) {
    await stage(send, "description", input.caption ? "붙여넣은 글에서 레시피를 찾고 있어요" : "설명란에서 레시피를 찾고 있어요");
    const { data } = await callAi(job, env, extractTextTask({ sourceLabel: input.caption ? "사용자가 붙여넣은 영상 설명" : "유튜브 영상 설명란", title: meta.title, text }));
    const content = fromAi(data);
    if (content) return { content, image: meta.thumbnail, method: "description" };
  }

  // 설명란에 없으면 작성자 댓글(보통 고정 댓글)을 본다. 영상 분석보다 훨씬 빠르고 영상 한도를 쓰지 않는다.
  if (!input.caption) {
    const comment = await fetchCreatorComment(env, source.id, meta.channelId);
    if (comment) {
      await stage(send, "comment", "고정 댓글에서 레시피를 찾고 있어요");
      const { data } = await callAi(job, env, extractTextTask({ sourceLabel: "유튜브 작성자의 고정 댓글", title: meta.title, text: comment }));
      const content = fromAi(data);
      if (content) return { content, image: meta.thumbnail, method: "comment" };
    }
  }

  if (!videoReady(env)) throw new NeedCaption("영상을 직접 분석하려면 Gemini 키가 필요해요. 설명란이나 고정 댓글의 레시피를 붙여넣어 주세요.");
  if (!(await canUseVideo(env, user))) {
    throw new NeedCaption("오늘 영상 분석 횟수를 다 썼어요. 설명란이나 고정 댓글의 레시피를 붙여넣으면 바로 정리해 드려요.");
  }
  // 길이를 모르면 일반 계정은 분석하지 않는다(긴 영상으로 무료 영상 예산을 다 쓰는 것을 막으려고).
  if (!meta.durationSec && !isUnlimited(user)) {
    throw new NeedCaption("영상 길이를 확인하지 못해서 영상 분석은 건너뛰었어요. 설명란이나 자막을 붙여넣어 주세요.");
  }
  const minutes = meta.durationSec ? Math.max(1, Math.ceil(meta.durationSec / 60)) : 10;
  try {
    await useQuota(env, user, "video", { videoMinutes: minutes });
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) throw new NeedCaption(e.message);
    throw e;
  }
  await stage(send, "video", minutes > 3 ? "영상을 보면서 레시피를 정리하고 있어요. 1~2분 걸려요" : "영상을 보면서 레시피를 정리하고 있어요");
  const { data } = await callAi(job, env, extractVideoTask({ url: source.url, title: meta.title, description: meta.description }));
  const content = fromAi(data);
  if (!content) throw new NeedCaption("이 영상에서 레시피를 찾지 못했어요. 요리 영상이 맞다면 설명란이나 자막을 붙여넣어 주세요.");
  return { content, image: meta.thumbnail, method: "video" };
}

async function extractInstagram(
  job: Job,
  env: AppEnv,
  user: SessionUser,
  source: Extract<DetectedSource, { type: "instagram" }>,
  input: ImportInput,
  send: Send,
): Promise<Extracted> {
  let caption = input.caption?.trim() ?? "";
  let remoteImage: string | null = null;
  if (!caption) {
    await stage(send, "meta", "게시물 정보를 확인하고 있어요");
    const meta = await fetchInstagram(env, source.url);
    caption = meta?.caption?.trim() ?? "";
    remoteImage = meta?.image ?? null;
  }
  if (caption.length < 20) {
    throw new NeedCaption("인스타그램 캡션을 가져오지 못했어요. 인스타그램 앱에서 캡션을 복사해 붙여넣어 주세요.");
  }
  await stage(send, "caption", "캡션에서 레시피를 찾고 있어요");
  const { data } = await callAi(job, env, extractTextTask({ sourceLabel: "인스타그램 게시물 캡션", text: caption }));
  const content = fromAi(data);
  if (!content) throw new NeedCaption("캡션에 레시피가 없어요. 레시피가 댓글이나 영상 속에 있다면 그 내용을 붙여넣어 주세요.");
  let image: string | null = null;
  if (remoteImage && !input.image) {
    await stage(send, "image", "사진을 저장하고 있어요");
    // 인스타 사진 주소는 며칠 뒤 만료되므로 내 저장소로 옮긴다.
    image = await copyRemoteImage(env, user.id, remoteImage);
  }
  return { content, image, method: input.caption ? "caption-pasted" : "caption" };
}

async function extractWeb(job: Job, env: AppEnv, source: Extract<DetectedSource, { type: "web" }>, input: ImportInput, send: Send): Promise<Extracted> {
  await stage(send, "page", "페이지를 읽고 있어요");
  const page = input.caption ? null : await fetchWebPage(source.url);
  if (page?.recipe && isUsableRecipe(page.recipe)) return { content: page.recipe, image: page.image, method: "jsonld" };
  const text = input.caption?.trim() || page?.text || "";
  if (text.length < 50) throw new NeedCaption("페이지 내용을 읽지 못했어요. 레시피 부분을 복사해 붙여넣어 주세요.");
  await stage(send, "text", "글에서 레시피를 정리하고 있어요");
  const { data } = await callAi(job, env, extractTextTask({ sourceLabel: "레시피 웹페이지", title: page?.title, text }));
  const content = fromAi(data);
  if (!content) throw new NeedCaption("이 페이지에서 레시피를 찾지 못했어요. 레시피 부분만 복사해 붙여넣어 주세요.");
  return { content, image: page?.image ?? null, method: "page" };
}

async function runImport(env: AppEnv, user: SessionUser, input: ImportInput, send: Send) {
  const source = detectSource(input.link ?? input.text ?? "");
  const text = (input.text ?? "").trim();
  if (!source && text.length < 20) throw new ApiError(400, "empty", "링크나 레시피 글을 넣어 주세요.");
  await assertRecipeRoom(env, user);

  if (source && !input.force) {
    const existing = await env.DB.prepare("SELECT id FROM recipes WHERE user_id = ?1 AND source_key = ?2 LIMIT 1").bind(user.id, source.key).first<{ id: string }>();
    if (existing) {
      await send({ type: "exists", recipeId: existing.id });
      return;
    }
  }

  const userImage = keyFromImageUrl(input.image) ? input.image! : null;

  // 다른 사람이 이미 정리한 링크면 AI를 다시 부르지 않는다(정리 규칙을 바꾸기 전 결과는 빼고).
  if (source && !input.caption) {
    const cached = await env.DB.prepare("SELECT content, image FROM extraction_cache WHERE source_key = ?1 AND created_at >= ?2")
      .bind(source.key, CACHE_SINCE)
      .first<{ content: string; image: string | null }>();
    if (cached) {
      await useQuota(env, user, "import", { aiCost: false });
      await stage(send, "cache", "이미 정리된 레시피를 불러오고 있어요");
      let image = cached.image;
      const key = keyFromImageUrl(image);
      if (key && !(await env.DB.prepare("SELECT 1 FROM images WHERE key = ?1").bind(key).first())) image = null;
      const id = await createRecipe(env, user.id, normalizeRecipe(JSON.parse(cached.content)), {
        image: userImage ?? image,
        sourceType: source.type,
        sourceUrl: source.url,
        sourceKey: source.key,
      });
      await send({ type: "done", recipeId: id, cached: true });
      return;
    }
  }

  await useQuota(env, user, "import");
  await stage(send, "start", "가져오기를 시작했어요");
  const job: Job = { aiCalls: 0 };
  let result: Extracted;
  let sourceType: SourceType;
  try {
    if (!source) {
      await stage(send, "text", "글에서 레시피를 정리하고 있어요");
      const { data } = await callAi(job, env, extractTextTask({ sourceLabel: "사용자가 붙여넣은 글", text }));
      const content = fromAi(data);
      if (!content) throw new ApiError(422, "not_recipe", "레시피를 찾지 못했어요. 재료와 만드는 법이 들어 있는 글인지 확인해 주세요.");
      result = { content, image: null, method: "text" };
      sourceType = "text";
    } else if (source.type === "youtube") {
      result = await extractYouTube(job, env, user, source, input, send);
      sourceType = "youtube";
    } else if (source.type === "instagram") {
      result = await extractInstagram(job, env, user, source, input, send);
      sourceType = "instagram";
    } else {
      result = await extractWeb(job, env, source, input, send);
      sourceType = "web";
    }
  } catch (e) {
    // AI를 부르기 전에 멈췄으면(캡션을 못 읽음 등) 가져오기 횟수를 돌려준다.
    // AI를 이미 불렀다면 돌려주지 않는다 — 돌려주면 레시피가 아닌 글로 무료 AI를 끝없이 쓸 수 있다.
    if (job.aiCalls === 0) await addUsage(env.DB, user.id, "import", -1).catch(() => {});
    throw e;
  }

  await stage(send, "save", "레시피를 저장하고 있어요");
  const id = await createRecipe(env, user.id, result.content, {
    image: userImage ?? result.image,
    sourceType,
    sourceUrl: source?.url ?? null,
    sourceKey: source?.key ?? null,
  });
  // 사용자가 붙여넣은 글로 만든 결과는 캐시에 넣지 않는다. 남이 아무 글이나 붙여 인기 링크의 결과를 바꿔치기할 수 있어서다.
  // 이미 있는 캐시도 덮어쓰지 않는다. 다만 정리 규칙을 바꾸기 전에 만든 낡은 결과는 새 결과로 바꾼다.
  if (source && !input.caption) {
    await env.DB.prepare(
      `INSERT INTO extraction_cache (source_key, content, image, source_url, method, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(source_key) DO UPDATE SET content = excluded.content, image = excluded.image, source_url = excluded.source_url,
         method = excluded.method, created_at = excluded.created_at
       WHERE extraction_cache.created_at < ?7`,
    )
      .bind(source.key, JSON.stringify(result.content), result.image, source.url, result.method, Date.now(), CACHE_SINCE)
      .run();
  }
  await send({ type: "done", recipeId: id, cached: false });
}

export const importer = new Hono<HonoEnv>();
importer.use("*", requireVerified);

importer.post("/", async (c) => {
  const input = await readJson<ImportInput>(c);
  const user = c.get("user");
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  // 사용자가 화면을 떠나도 저장까지는 끝내도록 쓰기 오류는 무시한다.
  const send: Send = async (event) => {
    await writer.write(encoder.encode(JSON.stringify(event) + "\n")).catch(() => {});
  };
  const job = (async () => {
    try {
      await runImport(c.env, user, input, send);
    } catch (e) {
      if (e instanceof NeedCaption) await send({ type: "need_caption", message: e.message });
      else if (e instanceof ApiError) await send({ type: "error", code: e.code, message: e.message });
      else {
        console.error("가져오기 실패", e);
        await send({ type: "error", code: "internal", message: "가져오는 중에 문제가 생겼어요. 다시 시도해 주세요." });
      }
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  c.executionCtx.waitUntil(job);
  return new Response(readable, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
});

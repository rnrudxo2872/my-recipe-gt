// 유튜브 영상 정보(제목, 설명란, 길이, 썸네일)와 작성자 댓글 가져오기.
// YouTube Data API 키가 있으면 그걸 쓰고(하루 1만 건 무료), 없으면 공개 페이지와 oEmbed를 읽는다.

import { youTubeThumbCandidates } from "../../shared/links";
import type { AppEnv } from "../env";
import { looksLikeRecipe, readLimited } from "./text";

export interface YouTubeMeta {
  id: string;
  title: string;
  description: string;
  channel: string;
  /** 채널 ID. 작성자 댓글을 가려낼 때 쓴다. 모르면 빈 문자열 */
  channelId: string;
  durationSec: number | null;
  thumbnail: string | null;
}

export function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

async function fromDataApi(env: AppEnv, id: string): Promise<YouTubeMeta | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: {
      snippet?: { title?: string; description?: string; channelTitle?: string; channelId?: string; thumbnails?: Record<string, { url?: string }> };
      contentDetails?: { duration?: string };
    }[];
  };
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    channel: item.snippet?.channelTitle ?? "",
    channelId: item.snippet?.channelId ?? "",
    durationSec: item.contentDetails?.duration ? parseIsoDuration(item.contentDetails.duration) : null,
    thumbnail: thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? null,
  };
}

function jsonString(html: string, key: string): string | null {
  const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

async function fromWatchPage(id: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, {
      headers: { "accept-language": "ko-KR,ko;q=0.9" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    // videoDetails는 페이지 앞부분에 있다. 뒤쪽은 읽지 않는다.
    const html = await readLimited(res, 900_000);
    const at = html.indexOf('"videoDetails"');
    if (at < 0) return null;
    const part = html.slice(at, at + 60_000);
    const length = part.match(/"lengthSeconds":"(\d+)"/)?.[1];
    return {
      title: jsonString(part, "title") ?? undefined,
      description: jsonString(part, "shortDescription") ?? "",
      channel: jsonString(part, "author") ?? "",
      channelId: jsonString(part, "channelId") ?? "",
      durationSec: length ? Number(length) : null,
    };
  } catch {
    return null;
  }
}

async function fromOEmbed(id: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title, channel: data.author_name };
  } catch {
    return null;
  }
}

async function bestThumbnail(id: string): Promise<string> {
  const candidates = youTubeThumbCandidates(id);
  for (const url of candidates.slice(0, -1)) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      if (res.ok) return url;
    } catch {
      // 다음 후보로
    }
  }
  return candidates[candidates.length - 1];
}

export async function fetchYouTubeMeta(env: AppEnv, id: string, isShorts: boolean): Promise<YouTubeMeta | null> {
  if (env.YOUTUBE_API_KEY) {
    const viaApi = await fromDataApi(env, id).catch(() => null);
    if (viaApi) {
      if (!viaApi.thumbnail) viaApi.thumbnail = await bestThumbnail(id);
      return viaApi;
    }
  }
  const [page, oembed, thumbnail] = await Promise.all([fromWatchPage(id), fromOEmbed(id), bestThumbnail(id)]);
  // oEmbed가 실패하면 비공개·삭제된 영상일 가능성이 높다.
  if (!page?.title && !oembed?.title) return null;
  return {
    id,
    title: page?.title || oembed?.title || "",
    description: page?.description ?? "",
    channel: page?.channel || oembed?.channel || "",
    channelId: page?.channelId ?? "",
    // 쇼츠는 최대 3분이다. 그 밖에 길이를 모르면 null (일반 계정은 영상 분석을 하지 않는다)
    durationSec: page?.durationSec ?? (isShorts ? 180 : null),
    thumbnail,
  };
}

/**
 * 작성자(채널 주인)가 단 댓글 중 레시피처럼 보이는 것. 한국 요리 채널은 레시피를 고정 댓글에 많이 적는다.
 * 고정 댓글은 '관련성' 순서에서 보통 맨 앞에 온다. Data API 키가 있을 때만(1건에 할당량 1단위).
 * 댓글을 막아 둔 영상이거나 찾지 못하면 null.
 */
export async function fetchCreatorComment(env: AppEnv, id: string, channelId: string): Promise<string | null> {
  if (!env.YOUTUBE_API_KEY || !channelId) return null;
  try {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${id}&order=relevance&maxResults=20&textFormat=plainText&key=${env.YOUTUBE_API_KEY}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      items?: { snippet?: { topLevelComment?: { snippet?: { textDisplay?: string; textOriginal?: string; authorChannelId?: { value?: string } } } } }[];
    };
    for (const item of data.items ?? []) {
      const s = item.snippet?.topLevelComment?.snippet;
      const text = (s?.textDisplay || s?.textOriginal || "").trim();
      if (s?.authorChannelId?.value === channelId && looksLikeRecipe(text)) return text.slice(0, 8000);
    }
  } catch {
    // 댓글을 못 읽어도 영상 분석으로 넘어간다
  }
  return null;
}

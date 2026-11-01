// 내 레시피: 목록, 보기, 수정(버전 저장), AI 대체 재료·맛 조정

import { Hono } from "hono";
import type { SubstituteResult } from "../../shared/api";
import { normalizeRecipe, parseQty, type RecipeVersion, type SourceType } from "../../shared/recipe";
import { substituteTask, tweakTask } from "../ai/prompts";
import { runAi } from "../ai/providers";
import { requireVerified } from "../auth";
import { ApiError, readJson, type HonoEnv } from "../env";
import { deleteImageIfUnused, keyFromImageUrl } from "../images";
import { assertRecipeRoom, useQuota } from "../quota";
import { createRecipe, getOwnedRecipe, listVersions, saveVersion, SUMMARY_COLUMNS, toDetail, toSummary, type RecipeRow } from "../recipes-db";

export const recipes = new Hono<HonoEnv>();
recipes.use("*", requireVerified);

/** 사진 값으로 받을 수 있는 것: 내가 올린 사진(/img/..)이나 https 주소 */
function cleanImage(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (keyFromImageUrl(value)) return value;
  if (/^https:\/\/[^\s]+$/.test(value) && value.length < 1000) return value;
  return null;
}

recipes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${SUMMARY_COLUMNS} FROM recipes WHERE user_id = ?1 ORDER BY updated_at DESC`)
    .bind(c.get("user").id)
    .all<RecipeRow>();
  return c.json({ recipes: results.map(toSummary) });
});

recipes.post("/", async (c) => {
  const user = c.get("user");
  const body = await readJson<{ content?: unknown; image?: unknown; sourceType?: SourceType; note?: string }>(c);
  await assertRecipeRoom(c.env, user);
  const content = normalizeRecipe(body.content);
  if (!content.ingredients.length && !content.steps.length) {
    throw new ApiError(400, "empty_recipe", "재료나 만드는 법을 하나 이상 적어 주세요.");
  }
  await useQuota(c.env, user, "save");
  const sourceType: SourceType = body.sourceType === "ai" ? "ai" : "manual";
  const id = await createRecipe(c.env, user.id, content, {
    image: cleanImage(body.image),
    sourceType,
    note: sourceType === "ai" ? "AI 추천" : "직접 작성",
  });
  return c.json({ id });
});

recipes.get("/:id", async (c) => {
  const row = await getOwnedRecipe(c.env, c.get("user").id, c.req.param("id"));
  return c.json({ recipe: toDetail(row) });
});

recipes.put("/:id", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  const body = await readJson<{ content?: unknown; note?: string; kind?: RecipeVersion["kind"] }>(c);
  const content = normalizeRecipe(body.content);
  const kind: RecipeVersion["kind"] = body.kind === "ai" || body.kind === "substitute" ? body.kind : "edit";
  const note = String(body.note ?? "").trim().slice(0, 80) || (kind === "edit" ? "직접 수정" : kind === "ai" ? "AI로 맛 조정" : "재료 바꿈");
  await useQuota(c.env, user, "save");
  await saveVersion(c.env, row, content, note, kind);
  return c.json({ recipe: toDetail(await getOwnedRecipe(c.env, user.id, row.id)) });
});

recipes.patch("/:id", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  const body = await readJson<{ favorite?: boolean; image?: string | null }>(c);
  if (typeof body.favorite === "boolean") {
    await c.env.DB.prepare("UPDATE recipes SET favorite = ?1 WHERE id = ?2").bind(body.favorite ? 1 : 0, row.id).run();
  }
  if (body.image !== undefined) {
    const image = cleanImage(body.image);
    await c.env.DB.prepare("UPDATE recipes SET image = ?1, updated_at = ?2 WHERE id = ?3").bind(image, Date.now(), row.id).run();
    if (row.image !== image) await deleteImageIfUnused(c.env, row.image, user.id);
  }
  return c.json({ recipe: toDetail(await getOwnedRecipe(c.env, user.id, row.id)) });
});

recipes.delete("/:id", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM recipe_versions WHERE recipe_id = ?1").bind(row.id),
    c.env.DB.prepare("DELETE FROM recipes WHERE id = ?1").bind(row.id),
    // 식단에 올려 둔 것은 제목만 남긴다.
    c.env.DB.prepare("UPDATE meal_plans SET recipe_id = NULL WHERE recipe_id = ?1 AND user_id = ?2").bind(row.id, user.id),
  ]);
  await deleteImageIfUnused(c.env, row.image, user.id);
  return c.json({ ok: true });
});

recipes.get("/:id/versions", async (c) => {
  const row = await getOwnedRecipe(c.env, c.get("user").id, c.req.param("id"));
  return c.json({ versions: await listVersions(c.env, row.id) });
});

recipes.get("/:id/versions/:vid", async (c) => {
  const row = await getOwnedRecipe(c.env, c.get("user").id, c.req.param("id"));
  const v = await c.env.DB.prepare("SELECT id, content, note, kind, created_at FROM recipe_versions WHERE id = ?1 AND recipe_id = ?2")
    .bind(Number(c.req.param("vid")), row.id)
    .first<{ id: number; content: string; note: string; kind: RecipeVersion["kind"]; created_at: number }>();
  if (!v) throw new ApiError(404, "not_found", "그 버전을 찾을 수 없어요.");
  return c.json({ version: { id: v.id, note: v.note, kind: v.kind, createdAt: v.created_at, content: normalizeRecipe(JSON.parse(v.content)) } });
});

recipes.post("/:id/versions/:vid/restore", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  const v = await c.env.DB.prepare("SELECT content, note, created_at FROM recipe_versions WHERE id = ?1 AND recipe_id = ?2")
    .bind(Number(c.req.param("vid")), row.id)
    .first<{ content: string; note: string; created_at: number }>();
  if (!v) throw new ApiError(404, "not_found", "그 버전을 찾을 수 없어요.");
  await useQuota(c.env, user, "save");
  await saveVersion(c.env, row, normalizeRecipe(JSON.parse(v.content)), `'${v.note}'(으)로 되돌림`.slice(0, 80), "restore");
  return c.json({ recipe: toDetail(await getOwnedRecipe(c.env, user.id, row.id)) });
});

recipes.post("/:id/substitutes", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  const body = await readJson<{ missing?: unknown }>(c);
  const missing = (Array.isArray(body.missing) ? body.missing : [])
    .map((m) => String(m).trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 10);
  if (!missing.length) throw new ApiError(400, "no_missing", "없는 재료를 하나 이상 골라 주세요.");
  await useQuota(c.env, user, "ai");
  const { data } = await runAi(c.env, substituteTask(toDetail(row).content, missing));
  return c.json({ result: normalizeSubstitutes(data, missing) });
});

recipes.post("/:id/tweak", async (c) => {
  const user = c.get("user");
  const row = await getOwnedRecipe(c.env, user.id, c.req.param("id"));
  const body = await readJson<{ instruction?: string }>(c);
  const instruction = String(body.instruction ?? "").trim().slice(0, 200);
  if (!instruction) throw new ApiError(400, "no_instruction", "어떻게 바꿀지 적어 주세요.");
  await useQuota(c.env, user, "ai");
  const { data } = await runAi(c.env, tweakTask(toDetail(row).content, instruction));
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const changes = (Array.isArray(raw.changes) ? raw.changes : [])
    .map((x) => String(x).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 12);
  const content = normalizeRecipe(raw);
  if (!content.ingredients.length || !content.steps.length) throw new ApiError(502, "ai_bad_output", "AI가 레시피를 제대로 고치지 못했어요. 다시 시도해 주세요.");
  return c.json({ content, changes });
});

export function normalizeSubstitutes(data: unknown, missing: string[]): SubstituteResult {
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const items = (Array.isArray(raw.items) ? raw.items : []).slice(0, missing.length + 2).map((it) => {
    const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
    const options = (Array.isArray(o.options) ? o.options : []).slice(0, 3).map((op) => {
      const p = (op && typeof op === "object" ? op : {}) as Record<string, unknown>;
      return {
        name: String(p.name ?? "").trim().slice(0, 40),
        qty: parseQty(p.qty).qty,
        unit: String(p.unit ?? "").trim().slice(0, 20),
        note: String(p.note ?? "").trim().slice(0, 160),
      };
    });
    return {
      missing: String(o.missing ?? "").trim().slice(0, 40),
      options: options.filter((op) => op.name),
      canSkip: o.can_skip === true || o.canSkip === true,
      skipNote: String(o.skip_note ?? o.skipNote ?? "").trim().slice(0, 160),
    };
  });
  return { items: items.filter((i) => i.missing), tip: String(raw.tip ?? "").trim().slice(0, 200) };
}

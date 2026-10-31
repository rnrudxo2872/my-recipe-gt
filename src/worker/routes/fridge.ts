// 냉장고(남은 재료): 내 레시피에서 먼저 찾고, 원하면 AI가 새 레시피를 추천한다.

import { Hono } from "hono";
import { matchPantry } from "../../shared/ingredients";
import { isUsableRecipe, normalizeRecipe } from "../../shared/recipe";
import { recommendTask } from "../ai/prompts";
import { runAi } from "../ai/providers";
import { requireVerified } from "../auth";
import { ApiError, readJson, type HonoEnv } from "../env";
import { useQuota } from "../quota";
import { toSummary, type RecipeRow } from "../recipes-db";

export const fridge = new Hono<HonoEnv>();
fridge.use("*", requireVerified);

function cleanItems(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const v of list) {
    const s = String(v).trim().slice(0, 30);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 40) break;
  }
  return out;
}

fridge.get("/pantry", async (c) => {
  const row = await c.env.DB.prepare("SELECT items FROM pantry WHERE user_id = ?1").bind(c.get("user").id).first<{ items: string }>();
  let data: { items: string[]; staples: boolean } = { items: [], staples: true };
  try {
    if (row) data = { staples: true, ...JSON.parse(row.items) };
  } catch {
    // 기본값
  }
  return c.json(data);
});

fridge.put("/pantry", async (c) => {
  const body = await readJson<{ items?: unknown; staples?: boolean }>(c);
  const data = { items: cleanItems(body.items), staples: body.staples !== false };
  await c.env.DB.prepare(
    "INSERT INTO pantry (user_id, items, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at",
  )
    .bind(c.get("user").id, JSON.stringify(data), Date.now())
    .run();
  return c.json(data);
});

fridge.post("/match", async (c) => {
  const body = await readJson<{ items?: unknown; staples?: boolean }>(c);
  const items = cleanItems(body.items);
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, image, source_type, favorite, time_minutes, servings, tags, created_at, updated_at, ingredient_names FROM recipes WHERE user_id = ?1",
  )
    .bind(c.get("user").id)
    .all<RecipeRow>();
  const byId = new Map(results.map((r) => [r.id, r]));
  const matches = matchPantry(
    items,
    results.map((r) => ({
      id: r.id,
      content: { ingredients: r.ingredient_names.split("\n").filter(Boolean).map((name) => ({ name, qty: null, unit: "", note: "", group: "" })) },
    })),
    body.staples !== false,
  ).slice(0, 40);
  return c.json({
    matches: matches.map((m) => ({ recipe: toSummary(byId.get(m.id)!), have: m.have, missing: m.missing, ratio: m.ratio })),
  });
});

fridge.post("/ai", async (c) => {
  const body = await readJson<{ items?: unknown; note?: string; staples?: boolean }>(c);
  const items = cleanItems(body.items);
  if (!items.length) throw new ApiError(400, "no_items", "냉장고 재료를 하나 이상 넣어 주세요.");
  const user = c.get("user");
  await useQuota(c.env, user, "ai");
  const { data } = await runAi(c.env, recommendTask(items, String(body.note ?? "").trim().slice(0, 100), body.staples !== false));
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const recipes = (Array.isArray(raw.recipes) ? raw.recipes : [])
    .map((r) => normalizeRecipe(r))
    .filter(isUsableRecipe)
    .slice(0, 3);
  if (!recipes.length) throw new ApiError(502, "ai_bad_output", "추천을 만들지 못했어요. 다시 시도해 주세요.");
  return c.json({ recipes });
});

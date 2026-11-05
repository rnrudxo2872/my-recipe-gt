// 냉장고: 여러 냉장고에 재료와 양을 저장하고, 요리하면 쓴 만큼 뺀다.
// 레시피 찾기는 모든 냉장고(또는 고른 냉장고)의 재료 이름을 합쳐서 한다.

import { Hono } from "hono";
import {
  afterUse,
  cleanItemName,
  cleanQty,
  cleanUnit,
  findSameItem,
  FRIDGE_KINDS,
  LIMITS,
  mergeStock,
  type Fridge,
  type FridgeItem,
  type FridgeKind,
  type FridgeState,
  type ItemDraft,
} from "../../shared/fridge";
import { matchPantry } from "../../shared/ingredients";
import { isUsableRecipe, normalizeRecipe } from "../../shared/recipe";
import { recommendTask } from "../ai/prompts";
import { runAi } from "../ai/providers";
import { requireVerified } from "../auth";
import { ApiError, randomId, readJson, type AppEnv, type Ctx, type HonoEnv } from "../env";
import { limitAttempts, useQuota } from "../quota";
import { toSummary, type RecipeRow } from "../recipes-db";

export const fridge = new Hono<HonoEnv>();
fridge.use("*", requireVerified);

interface ItemRow {
  id: string;
  fridge_id: string;
  name: string;
  qty: number | null;
  unit: string;
  added_at: number;
  updated_at: number;
}

const toItem = (r: ItemRow): FridgeItem => ({
  id: r.id,
  fridgeId: r.fridge_id,
  name: r.name,
  qty: r.qty,
  unit: r.unit,
  addedAt: r.added_at,
  updatedAt: r.updated_at,
});

const ITEM_COLUMNS = "id, fridge_id, name, qty, unit, added_at, updated_at";

function cleanKind(value: unknown): FridgeKind {
  return FRIDGE_KINDS.some((k) => k.kind === value) ? (value as FridgeKind) : "fridge";
}

function cleanFridgeName(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
}

/** 사람이 손으로 고치는 속도를 넘는 요청은 막는다(무료 D1 쓰기 한도 보호) */
async function writeGuard(c: Ctx) {
  await limitAttempts(c.env.DB, `fridge-w:${c.get("user").id}`, 60 * 1000, 90, "냉장고를 너무 빠르게 고치고 있어요. 잠시 뒤에 다시 해 주세요.");
}

export async function loadFridgeState(env: AppEnv, userId: number): Promise<FridgeState> {
  const [fr, it, pan] = await env.DB.batch([
    env.DB.prepare("SELECT id, name, kind, position FROM fridges WHERE user_id = ?1 ORDER BY position, created_at").bind(userId),
    env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM fridge_items WHERE user_id = ?1 ORDER BY added_at, id`).bind(userId),
    env.DB.prepare("SELECT items FROM pantry WHERE user_id = ?1").bind(userId),
  ]);
  let fridges = fr.results as unknown as Fridge[];
  if (!fridges.length) {
    // 처음 오면 '냉장고' 하나를 만들어 둔다.
    const main: Fridge = { id: `main-${userId}`, name: "냉장고", kind: "fridge", position: 0 };
    await env.DB.prepare("INSERT OR IGNORE INTO fridges (id, user_id, name, kind, position, created_at) VALUES (?1, ?2, ?3, ?4, 0, ?5)")
      .bind(main.id, userId, main.name, main.kind, Date.now())
      .run();
    fridges = [main];
  }
  let staples = true;
  const row = pan.results[0] as { items?: string } | undefined;
  if (row?.items) {
    try {
      staples = (JSON.parse(row.items) as { staples?: boolean }).staples !== false;
    } catch {
      // 기본값
    }
  }
  return { fridges: fridges.map((f) => ({ ...f, kind: cleanKind(f.kind) })), items: (it.results as unknown as ItemRow[]).map(toItem), staples };
}

async function ownedFridge(c: Ctx, id: unknown): Promise<string> {
  const row = await c.env.DB.prepare("SELECT id FROM fridges WHERE id = ?1 AND user_id = ?2").bind(String(id ?? ""), c.get("user").id).first<{ id: string }>();
  if (!row) throw new ApiError(404, "fridge_not_found", "냉장고를 찾을 수 없어요.");
  return row.id;
}

async function ownedItem(c: Ctx, id: string): Promise<ItemRow> {
  const row = await c.env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM fridge_items WHERE id = ?1 AND user_id = ?2`).bind(id, c.get("user").id).first<ItemRow>();
  if (!row) throw new ApiError(404, "item_not_found", "재료를 찾을 수 없어요. 이미 빠졌을 수 있어요.");
  return row;
}

fridge.get("/", async (c) => c.json(await loadFridgeState(c.env, c.get("user").id)));

fridge.put("/settings", async (c) => {
  const body = await readJson<{ staples?: boolean }>(c);
  await writeGuard(c);
  await c.env.DB.prepare(
    "INSERT INTO pantry (user_id, items, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, updated_at = excluded.updated_at",
  )
    .bind(c.get("user").id, JSON.stringify({ items: [], staples: body.staples !== false }), Date.now())
    .run();
  return c.json(await loadFridgeState(c.env, c.get("user").id));
});

/* ───────── 냉장고 ───────── */

fridge.post("/fridges", async (c) => {
  const body = await readJson<{ name?: string; kind?: string }>(c);
  const name = cleanFridgeName(body.name);
  if (!name) throw new ApiError(400, "bad_name", "냉장고 이름을 적어 주세요.");
  await writeGuard(c);
  const userId = c.get("user").id;
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS p FROM fridges WHERE user_id = ?1").bind(userId).first<{ n: number; p: number }>();
  if ((count?.n ?? 0) >= LIMITS.fridges) throw new ApiError(400, "too_many_fridges", `냉장고는 ${LIMITS.fridges}개까지 둘 수 있어요.`);
  const id = randomId(9);
  await c.env.DB.prepare("INSERT INTO fridges (id, user_id, name, kind, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(id, userId, name, cleanKind(body.kind), (count?.p ?? 0) + 1, Date.now())
    .run();
  return c.json({ id, state: await loadFridgeState(c.env, userId) });
});

fridge.patch("/fridges/:id", async (c) => {
  const id = await ownedFridge(c, c.req.param("id"));
  const body = await readJson<{ name?: string; kind?: string }>(c);
  await writeGuard(c);
  const name = body.name === undefined ? null : cleanFridgeName(body.name);
  if (name === "") throw new ApiError(400, "bad_name", "냉장고 이름을 적어 주세요.");
  await c.env.DB.prepare("UPDATE fridges SET name = COALESCE(?1, name), kind = COALESCE(?2, kind) WHERE id = ?3")
    .bind(name, body.kind === undefined ? null : cleanKind(body.kind), id)
    .run();
  return c.json(await loadFridgeState(c.env, c.get("user").id));
});

fridge.delete("/fridges/:id", async (c) => {
  const userId = c.get("user").id;
  const id = await ownedFridge(c, c.req.param("id"));
  await writeGuard(c);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM fridges WHERE user_id = ?1").bind(userId).first<{ n: number }>();
  if ((count?.n ?? 0) <= 1) throw new ApiError(400, "last_fridge", "냉장고는 하나 이상 있어야 해요.");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM fridge_items WHERE fridge_id = ?1 AND user_id = ?2").bind(id, userId),
    c.env.DB.prepare("DELETE FROM fridges WHERE id = ?1 AND user_id = ?2").bind(id, userId),
  ]);
  return c.json(await loadFridgeState(c.env, userId));
});

/* ───────── 재료 ───────── */

/** 재료 넣기. 같은 냉장고에 같은 재료가 있으면 양을 더한다. */
fridge.post("/items", async (c) => {
  const userId = c.get("user").id;
  const body = await readJson<{ fridgeId?: string; items?: unknown }>(c);
  const fridgeId = await ownedFridge(c, body.fridgeId);
  const drafts: ItemDraft[] = (Array.isArray(body.items) ? body.items : [])
    .slice(0, 40)
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const qty = cleanQty(r.qty);
      return { name: cleanItemName(r.name), qty, unit: qty == null ? "" : cleanUnit(r.unit) };
    })
    .filter((d) => d.name);
  if (!drafts.length) throw new ApiError(400, "no_items", "넣을 재료를 적어 주세요.");
  await writeGuard(c);
  const state = await loadFridgeState(c.env, userId);
  const now = Date.now();
  const writes: D1PreparedStatement[] = [];
  const working = state.items.map((i) => ({ ...i }));
  let created = 0;
  for (const d of drafts) {
    const same = findSameItem(working, fridgeId, d.name);
    const merged = same ? mergeStock(same, d) : null;
    if (same && merged) {
      same.qty = merged.qty;
      same.unit = merged.unit;
      writes.push(c.env.DB.prepare("UPDATE fridge_items SET qty = ?1, unit = ?2, updated_at = ?3 WHERE id = ?4").bind(merged.qty, merged.unit, now, same.id));
      continue;
    }
    const id = randomId(9);
    working.push({ id, fridgeId, name: d.name, qty: d.qty, unit: d.unit, addedAt: now, updatedAt: now });
    created++;
    writes.push(
      c.env.DB.prepare("INSERT INTO fridge_items (id, user_id, fridge_id, name, qty, unit, added_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)").bind(
        id,
        userId,
        fridgeId,
        d.name,
        d.qty,
        d.unit,
        now,
      ),
    );
  }
  if (state.items.length + created > LIMITS.items) throw new ApiError(400, "too_many_items", `재료는 모두 ${LIMITS.items}개까지 넣을 수 있어요.`);
  if (writes.length) await c.env.DB.batch(writes);
  return c.json(await loadFridgeState(c.env, userId));
});

fridge.patch("/items/:id", async (c) => {
  const userId = c.get("user").id;
  const row = await ownedItem(c, c.req.param("id"));
  const body = await readJson<{ name?: string; qty?: number | null; unit?: string; fridgeId?: string }>(c);
  await writeGuard(c);
  const name = body.name === undefined ? row.name : cleanItemName(body.name) || row.name;
  const qty = body.qty === undefined ? row.qty : cleanQty(body.qty);
  const unit = qty == null ? "" : body.unit === undefined ? row.unit : cleanUnit(body.unit);
  const fridgeId = body.fridgeId === undefined ? row.fridge_id : await ownedFridge(c, body.fridgeId);
  await c.env.DB.prepare("UPDATE fridge_items SET name = ?1, qty = ?2, unit = ?3, fridge_id = ?4, updated_at = ?5 WHERE id = ?6")
    .bind(name, qty, unit, fridgeId, Date.now(), row.id)
    .run();
  return c.json(await loadFridgeState(c.env, userId));
});

fridge.delete("/items/:id", async (c) => {
  const row = await ownedItem(c, c.req.param("id"));
  await writeGuard(c);
  await c.env.DB.prepare("DELETE FROM fridge_items WHERE id = ?1").bind(row.id).run();
  return c.json({ removed: toItem(row), state: await loadFridgeState(c.env, c.get("user").id) });
});

/** 되돌리기: 빼기 전 재료를 그대로 다시 넣는다. 그 사이 냉장고가 지워졌으면 첫 냉장고로. */
fridge.post("/items/restore", async (c) => {
  const userId = c.get("user").id;
  const body = await readJson<{ items?: unknown }>(c);
  await writeGuard(c);
  const state = await loadFridgeState(c.env, userId);
  const fridgeIds = new Set(state.fridges.map((f) => f.id));
  const list = (Array.isArray(body.items) ? body.items : []).slice(0, 60) as Partial<FridgeItem>[];
  const writes = list
    .filter((i) => typeof i.id === "string" && i.id.length <= 40 && cleanItemName(i.name))
    .map((i) => {
      const qty = cleanQty(i.qty);
      return c.env.DB.prepare(
        `INSERT INTO fridge_items (id, user_id, fridge_id, name, qty, unit, added_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(id) DO UPDATE SET fridge_id = excluded.fridge_id, name = excluded.name, qty = excluded.qty, unit = excluded.unit, updated_at = excluded.updated_at
         WHERE fridge_items.user_id = excluded.user_id`,
      ).bind(
        i.id,
        userId,
        fridgeIds.has(String(i.fridgeId)) ? String(i.fridgeId) : state.fridges[0].id,
        cleanItemName(i.name),
        qty,
        qty == null ? "" : cleanUnit(i.unit),
        Number(i.addedAt) || Date.now(),
        Date.now(),
      );
    });
  if (writes.length) await c.env.DB.batch(writes);
  return c.json(await loadFridgeState(c.env, userId));
});

/**
 * 요리했어요: 쓴 만큼 빼고, 다 쓴 재료는 냉장고에서 뺀다.
 * 식단에서 왔으면 그 끼니를 '만들었음'으로 표시한다. 되돌리기용으로 빼기 전 재료를 돌려준다.
 */
fridge.post("/cook", async (c) => {
  const userId = c.get("user").id;
  const body = await readJson<{ uses?: unknown; planId?: string }>(c);
  await writeGuard(c);
  const uses = (Array.isArray(body.uses) ? body.uses : []).slice(0, 60) as { itemId?: string; use?: number | null; all?: boolean }[];
  const ids = [...new Set(uses.map((u) => String(u.itemId ?? "")).filter(Boolean))].slice(0, 60);
  const before: FridgeItem[] = [];
  const writes: D1PreparedStatement[] = [];
  if (ids.length) {
    const { results } = await c.env.DB.prepare(`SELECT ${ITEM_COLUMNS} FROM fridge_items WHERE user_id = ?1 AND id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`)
      .bind(userId, ...ids)
      .all<ItemRow>();
    const now = Date.now();
    for (const row of results) {
      const u = uses.find((x) => x.itemId === row.id)!;
      const use = cleanQty(u.use);
      let left: number | null | "keep" = "keep";
      if (u.all) left = null;
      else if (use != null && row.qty != null) left = afterUse(row.qty, use);
      if (left === "keep") continue;
      before.push(toItem(row));
      writes.push(
        left === null
          ? c.env.DB.prepare("DELETE FROM fridge_items WHERE id = ?1").bind(row.id)
          : c.env.DB.prepare("UPDATE fridge_items SET qty = ?1, updated_at = ?2 WHERE id = ?3").bind(left, now, row.id),
      );
    }
  }
  if (body.planId) {
    writes.push(c.env.DB.prepare("UPDATE meal_plans SET done_at = COALESCE(done_at, ?1) WHERE id = ?2 AND user_id = ?3").bind(Date.now(), String(body.planId), userId));
  }
  if (writes.length) await c.env.DB.batch(writes);
  return c.json({ before, state: await loadFridgeState(c.env, userId) });
});

/* ───────── 레시피 찾기 ───────── */

function cleanNames(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const v of list) {
    const s = cleanItemName(v);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= 120) break;
  }
  return out;
}

fridge.post("/match", async (c) => {
  const body = await readJson<{ items?: unknown; staples?: boolean }>(c);
  const items = cleanNames(body.items);
  const { results } = await c.env.DB.prepare(
    "SELECT id, title, image, source_type, categories, favorite, time_minutes, servings, tags, created_at, updated_at, ingredient_names FROM recipes WHERE user_id = ?1",
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
  // AI에 보내는 재료는 40개까지(프롬프트 길이)
  const items = cleanNames(body.items).slice(0, 40);
  if (!items.length) throw new ApiError(400, "no_items", "냉장고 재료를 하나 이상 넣어 주세요.");
  const user = c.get("user");
  await useQuota(c.env, user, "ai");
  const { data } = await runAi(c.env, recommendTask(items, String(body.note ?? "").trim().slice(0, 100), body.staples !== false));
  const raw = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const recipes = (Array.isArray(raw.recipes) ? raw.recipes : [])
    .map((r) => normalizeRecipe(r))
    // 추천은 AI가 직접 짠 레시피라 '추정' 표시가 의미 없다
    .map((r) => ({
      ...r,
      ingredients: r.ingredients.map((i) => ({ ...i, note: i.note.split(/\s*,\s*/).filter((x) => x && x !== "추정").join(", ") })),
    }))
    .filter(isUsableRecipe)
    .slice(0, 3);
  if (!recipes.length) throw new ApiError(502, "ai_bad_output", "추천을 만들지 못했어요. 다시 시도해 주세요.");
  return c.json({ recipes });
});

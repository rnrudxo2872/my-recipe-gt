// 식단표: 날짜·끼니마다 레시피나 직접 적은 메뉴를 올린다.
// 올린 레시피에 필요한데 냉장고에 없는 재료(장보기)도 여기서 계산한다.

import { Hono } from "hono";
import { collectNeeds, DAY_RE, MEAL_SLOTS, type MealEntry, type MealSlot } from "../../shared/fridge";
import { normalizeRecipe, type Ingredient } from "../../shared/recipe";
import { requireVerified } from "../auth";
import { ApiError, randomId, readJson, type Ctx, type HonoEnv } from "../env";
import { limitAttempts } from "../quota";
import { loadFridgeState } from "./fridge";

export const plan = new Hono<HonoEnv>();
plan.use("*", requireVerified);

const MAX_ENTRIES = 2000;
const MAX_PER_DAY = 12;
const MAX_RANGE_DAYS = 62;

interface PlanRow {
  id: string;
  day: string;
  slot: MealSlot;
  recipe_id: string | null;
  title: string;
  servings: number | null;
  done_at: number | null;
  image: string | null;
}

const toEntry = (r: PlanRow): MealEntry => ({
  id: r.id,
  day: r.day,
  slot: r.slot,
  recipeId: r.recipe_id,
  title: r.title,
  image: r.image,
  servings: r.servings,
  done: r.done_at != null,
});

function cleanDay(value: unknown): string {
  const s = String(value ?? "");
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new ApiError(400, "bad_day", "날짜를 확인해 주세요.");
  return s;
}

function cleanSlot(value: unknown): MealSlot {
  if (!MEAL_SLOTS.some((s) => s.slot === value)) throw new ApiError(400, "bad_slot", "끼니를 골라 주세요.");
  return value as MealSlot;
}

function cleanServings(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

function cleanRange(c: Ctx): { from: string; to: string } {
  const from = cleanDay(c.req.query("from"));
  const to = cleanDay(c.req.query("to"));
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (days < 0 || days > MAX_RANGE_DAYS) throw new ApiError(400, "bad_range", "날짜 범위를 확인해 주세요.");
  return { from, to };
}

async function writeGuard(c: Ctx) {
  await limitAttempts(c.env.DB, `plan-w:${c.get("user").id}`, 60 * 1000, 90, "식단을 너무 빠르게 고치고 있어요. 잠시 뒤에 다시 해 주세요.");
}

const SELECT = `SELECT p.id, p.day, p.slot, p.recipe_id, p.title, p.servings, p.done_at, r.image
  FROM meal_plans p LEFT JOIN recipes r ON r.id = p.recipe_id AND r.user_id = p.user_id`;
const ORDER = `ORDER BY p.day, CASE p.slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, p.created_at`;

plan.get("/", async (c) => {
  const { from, to } = cleanRange(c);
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE p.user_id = ?1 AND p.day BETWEEN ?2 AND ?3 ${ORDER}`)
    .bind(c.get("user").id, from, to)
    .all<PlanRow>();
  return c.json({ entries: results.map(toEntry) });
});

async function getEntry(c: Ctx, id: string): Promise<MealEntry> {
  const row = await c.env.DB.prepare(`${SELECT} WHERE p.id = ?1 AND p.user_id = ?2`).bind(id, c.get("user").id).first<PlanRow>();
  if (!row) throw new ApiError(404, "plan_not_found", "식단을 찾을 수 없어요.");
  return toEntry(row);
}

plan.post("/", async (c) => {
  const userId = c.get("user").id;
  const body = await readJson<{ day?: string; slot?: string; recipeId?: string; title?: string; servings?: number }>(c);
  const day = cleanDay(body.day);
  const slot = cleanSlot(body.slot);
  let title = String(body.title ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  let recipeId: string | null = null;
  let servings = cleanServings(body.servings);
  if (body.recipeId) {
    const recipe = await c.env.DB.prepare("SELECT id, title, servings FROM recipes WHERE id = ?1 AND user_id = ?2")
      .bind(String(body.recipeId), userId)
      .first<{ id: string; title: string; servings: number | null }>();
    if (!recipe) throw new ApiError(404, "recipe_not_found", "레시피를 찾을 수 없어요.");
    recipeId = recipe.id;
    title = recipe.title;
    servings ??= recipe.servings;
  }
  if (!title) throw new ApiError(400, "bad_title", "메뉴를 고르거나 적어 주세요.");
  await writeGuard(c);
  const counts = await c.env.DB.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN day = ?2 THEN 1 ELSE 0 END) AS today FROM meal_plans WHERE user_id = ?1")
    .bind(userId, day)
    .first<{ total: number; today: number | null }>();
  if ((counts?.total ?? 0) >= MAX_ENTRIES) throw new ApiError(400, "too_many_plans", "식단이 너무 많아요. 지난 식단을 조금 지워 주세요.");
  if ((counts?.today ?? 0) >= MAX_PER_DAY) throw new ApiError(400, "too_many_today", `하루에 ${MAX_PER_DAY}개까지 올릴 수 있어요.`);
  const id = randomId(9);
  await c.env.DB.prepare("INSERT INTO meal_plans (id, user_id, day, slot, recipe_id, title, servings, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(id, userId, day, slot, recipeId, title, servings, Date.now())
    .run();
  return c.json({ entry: await getEntry(c, id) });
});

plan.patch("/:id", async (c) => {
  const userId = c.get("user").id;
  const current = await getEntry(c, c.req.param("id"));
  const body = await readJson<{ day?: string; slot?: string; servings?: number | null; done?: boolean; title?: string }>(c);
  await writeGuard(c);
  const day = body.day === undefined ? current.day : cleanDay(body.day);
  const slot = body.slot === undefined ? current.slot : cleanSlot(body.slot);
  const servings = body.servings === undefined ? current.servings : cleanServings(body.servings);
  const title = current.recipeId || body.title === undefined ? current.title : String(body.title).replace(/\s+/g, " ").trim().slice(0, 40) || current.title;
  const sets = ["day = ?1", "slot = ?2", "servings = ?3", "title = ?4"];
  const binds: unknown[] = [day, slot, servings, title];
  if (body.done === true) {
    binds.push(Date.now());
    sets.push(`done_at = COALESCE(done_at, ?${binds.length})`);
  } else if (body.done === false) {
    sets.push("done_at = NULL");
  }
  binds.push(current.id, userId);
  await c.env.DB.prepare(`UPDATE meal_plans SET ${sets.join(", ")} WHERE id = ?${binds.length - 1} AND user_id = ?${binds.length}`)
    .bind(...binds)
    .run();
  return c.json({ entry: await getEntry(c, current.id) });
});

plan.delete("/:id", async (c) => {
  const entry = await getEntry(c, c.req.param("id"));
  await writeGuard(c);
  await c.env.DB.prepare("DELETE FROM meal_plans WHERE id = ?1 AND user_id = ?2").bind(entry.id, c.get("user").id).run();
  return c.json({ ok: true });
});

/** 장보기: 아직 안 만든 식단 레시피에 필요한데 냉장고에 없거나 모자란 재료 */
plan.get("/needs", async (c) => {
  const userId = c.get("user").id;
  const { from, to } = cleanRange(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.servings AS planned, r.title, r.servings, r.content FROM meal_plans p JOIN recipes r ON r.id = p.recipe_id AND r.user_id = p.user_id
     WHERE p.user_id = ?1 AND p.day BETWEEN ?2 AND ?3 AND p.done_at IS NULL ORDER BY p.day LIMIT 40`,
  )
    .bind(userId, from, to)
    .all<{ planned: number | null; title: string; servings: number | null; content: string }>();
  const meals = results.map((r) => {
    let ingredients: Ingredient[] = [];
    try {
      ingredients = normalizeRecipe(JSON.parse(r.content)).ingredients;
    } catch {
      // 깨진 레시피는 건너뛴다
    }
    const factor = r.planned && r.servings ? r.planned / r.servings : 1;
    return { title: r.title, ingredients, factor };
  });
  const state = await loadFridgeState(c.env, userId);
  return c.json({ needs: collectNeeds(meals, state.items, state.staples), meals: meals.length });
});

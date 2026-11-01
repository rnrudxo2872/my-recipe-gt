// 냉장고 재고와 식단: 분량 단위 맞추기, 요리한 만큼 빼기, 식단에 필요한 재료 모으기.
// 브라우저와 Worker가 함께 쓴다.

import { ingredientMatches, isStaple, normalizeName } from "./ingredients";
import { COUNT_UNITS, formatQty, parseIngredientLine, scaleQty, type Ingredient } from "./recipe";

/* ───────── 냉장고 ───────── */

export type FridgeKind = "fridge" | "freezer" | "kimchi" | "pantry" | "other";

export const FRIDGE_KINDS: { kind: FridgeKind; label: string }[] = [
  { kind: "fridge", label: "냉장고" },
  { kind: "freezer", label: "냉동실" },
  { kind: "kimchi", label: "김치냉장고" },
  { kind: "pantry", label: "실온 보관" },
  { kind: "other", label: "기타" },
];

export interface Fridge {
  id: string;
  name: string;
  kind: FridgeKind;
  position: number;
}

export interface FridgeItem {
  id: string;
  fridgeId: string;
  name: string;
  /** 남은 양. 모르면 null(있기만 하다고 본다) */
  qty: number | null;
  unit: string;
  addedAt: number;
  updatedAt: number;
}

export interface FridgeState {
  fridges: Fridge[];
  items: FridgeItem[];
  /** 소금·간장 같은 기본 양념은 있다고 볼지 */
  staples: boolean;
}

export const LIMITS = { fridges: 8, items: 400, name: 30, unit: 8, maxQty: 100000 };

/** 재료 이름 정리: 앞뒤 공백, 줄바꿈 없이 30자까지 */
export function cleanItemName(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, LIMITS.name);
}

export function cleanQty(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(LIMITS.maxQty, Math.round(n * 1000) / 1000);
}

export function cleanUnit(value: unknown): string {
  return String(value ?? "").trim().slice(0, LIMITS.unit);
}

/* ───────── 단위 ─────────
   같은 묶음(무게, 부피, 같은 세는 단위)끼리만 더하고 뺀다. 묶음이 다르면 양을 모르는 것으로 본다. */

const MASS: Record<string, number> = { g: 1, 그램: 1, kg: 1000, 킬로: 1000, 근: 600 };
const VOLUME: Record<string, number> = {
  ml: 1,
  mL: 1,
  cc: 1,
  l: 1000,
  L: 1000,
  리터: 1000,
  컵: 200,
  큰술: 15,
  스푼: 15,
  숟가락: 15,
  T: 15,
  작은술: 5,
  티스푼: 5,
  t: 5,
};
// 같은 뜻의 세는 단위. 단위 없이 숫자만 적으면 '개'로 본다.
const COUNT_ALIAS: Record<string, string> = { "": "개", 알: "개", 봉지: "봉" };

interface Measure {
  family: string;
  /** 무게는 g, 부피는 ml, 세는 단위는 그 개수 */
  base: number;
}

export function measure(qty: number | null, unit: string): Measure | null {
  if (qty == null || !(qty > 0)) return null;
  const u = unit.trim();
  if (u in MASS) return { family: "mass", base: qty * MASS[u] };
  if (u in VOLUME) return { family: "volume", base: qty * VOLUME[u] };
  const count = COUNT_ALIAS[u] ?? u;
  if (u && !COUNT_UNITS.has(count)) return { family: `other:${u}`, base: qty };
  return { family: `count:${count}`, base: qty };
}

/** base 값을 이 단위의 수로 바꾼다 */
function fromBase(base: number, unit: string): number {
  const u = unit.trim();
  if (u in MASS) return base / MASS[u];
  if (u in VOLUME) return base / VOLUME[u];
  return base;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 냉장고에 남은 양 표시. 양을 모르면 빈 문자열 */
export function formatStock(item: Pick<FridgeItem, "qty" | "unit">): string {
  if (item.qty == null) return "";
  return `${formatQty(item.qty) || "0"}${item.unit}`;
}

/** 조절 버튼 한 번에 늘리고 줄일 양 */
export function stepFor(unit: string, qty: number | null): number {
  const u = unit.trim();
  if (u === "kg" || u === "L" || u === "l" || u === "리터") return 0.1;
  if (u in MASS || u in VOLUME) {
    if (u === "컵") return 0.5;
    if (u === "큰술" || u === "작은술" || u === "스푼" || u === "숟가락" || u === "티스푼") return 1;
    const v = qty ?? 0;
    return v >= 500 ? 50 : v >= 100 ? 10 : 5;
  }
  return qty != null && qty % 1 !== 0 ? 0.5 : 1;
}

/* ───────── 빠르게 넣기 ───────── */

export interface ItemDraft {
  name: string;
  qty: number | null;
  unit: string;
}

/** '달걀 10개, 우유 1L\n대파' → 재료 여러 개. 양을 안 적으면 양 모름. '1,000ml'의 쉼표는 나누지 않는다. */
export function parseQuickAdd(text: string): ItemDraft[] {
  return text
    .split(/\n|、|,(?!\d{3}(?!\d))/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const ing = parseIngredientLine(line.replace(/(\d),(\d{3})(?!\d)/g, "$1$2"));
      return { name: cleanItemName(ing.name), qty: ing.qty, unit: ing.qty == null ? "" : cleanUnit(ing.unit) };
    })
    .filter((d) => d.name);
}

/**
 * 이미 있는 재료에 더 넣을 때의 결과. 합칠 수 없으면(단위 묶음이 다름) null → 따로 한 줄 만든다.
 * 있던 쪽 양을 모르면 새로 적은 양으로 바꾼다.
 */
export function mergeStock(current: Pick<FridgeItem, "qty" | "unit">, add: ItemDraft): { qty: number | null; unit: string } | null {
  if (add.qty == null) return { qty: current.qty, unit: current.unit };
  if (current.qty == null) return { qty: add.qty, unit: add.unit };
  const a = measure(current.qty, current.unit);
  const b = measure(add.qty, add.unit);
  if (!a || !b || a.family !== b.family) return null;
  return { qty: round(current.qty + fromBase(b.base, current.unit)), unit: current.unit };
}

/** 같은 냉장고에서 이름이 같은 재료 */
export function findSameItem<T extends Pick<FridgeItem, "fridgeId" | "name">>(items: T[], fridgeId: string, name: string): T | undefined {
  const key = normalizeName(name);
  return items.find((i) => i.fridgeId === fridgeId && normalizeName(i.name) === key);
}

/* ───────── 요리하면 빼기 ───────── */

export interface UsePlan {
  itemId: string;
  itemName: string;
  fridgeId: string;
  /** 이 냉장고 재료를 쓰는 레시피 재료 이름들 */
  for: string[];
  /** 레시피에 적힌 양(인분 반영). 없으면 빈 문자열 */
  need: string;
  /** 냉장고에 있던 양(재료 단위). 모르면 null */
  before: number | null;
  unit: string;
  /** 뺄 양(재료 단위). 단위가 달라 계산할 수 없으면 null */
  use: number | null;
}

/**
 * 레시피 재료와 냉장고 재료를 짝지어 얼마나 뺄지 계산한다.
 * 같은 단위 묶음이고 양이 있는 냉장고 재료를 먼저 고른다. 한 냉장고 재료를 여러 레시피 재료가 쓰면 더한다.
 */
export function planCooking(ingredients: Ingredient[], factor: number, items: FridgeItem[]): UsePlan[] {
  const plans = new Map<string, UsePlan>();
  for (const ing of ingredients) {
    const candidates = items.filter((it) => ingredientMatches(it.name, ing.name));
    if (!candidates.length) continue;
    const needQty = ing.qty == null ? null : factor === 1 ? ing.qty : scaleQty(ing.qty, factor, ing.unit);
    const need = measure(needQty, ing.unit);
    const pick =
      candidates.find((it) => need && measure(it.qty, it.unit)?.family === need.family) ?? candidates.find((it) => it.qty != null) ?? candidates[0];
    const have = measure(pick.qty, pick.unit);
    const use = need && have && have.family === need.family ? round(fromBase(need.base, pick.unit)) : null;
    const needText = needQty != null ? `${formatQty(needQty)}${ing.unit}` : ing.unit;
    const prev = plans.get(pick.id);
    if (prev) {
      prev.for.push(ing.name);
      prev.need = [prev.need, needText].filter(Boolean).join(" + ");
      prev.use = prev.use != null && use != null ? round(prev.use + use) : (prev.use ?? use);
      continue;
    }
    plans.set(pick.id, {
      itemId: pick.id,
      itemName: pick.name,
      fridgeId: pick.fridgeId,
      for: [ing.name],
      need: needText,
      before: pick.qty,
      unit: pick.unit,
      use,
    });
  }
  // 있는 양보다 많이 뺄 수는 없다
  return [...plans.values()].map((p) => (p.use != null && p.before != null ? { ...p, use: Math.min(p.use, p.before) } : p));
}

/** 빼고 남는 양. 거의 다 쓰면(2% 이하) 다 쓴 것으로 본다 → null */
export function afterUse(before: number, use: number): number | null {
  const left = round(before - use);
  return left <= before * 0.02 || left <= 0.001 ? null : left;
}

/* ───────── 식단 ───────── */

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

export const MEAL_SLOTS: { slot: MealSlot; label: string }[] = [
  { slot: "breakfast", label: "아침" },
  { slot: "lunch", label: "점심" },
  { slot: "dinner", label: "저녁" },
  { slot: "snack", label: "간식" },
];

export function slotLabel(slot: MealSlot): string {
  return MEAL_SLOTS.find((s) => s.slot === slot)?.label ?? "";
}

export interface MealEntry {
  id: string;
  day: string;
  slot: MealSlot;
  recipeId: string | null;
  title: string;
  image: string | null;
  servings: number | null;
  done: boolean;
}

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface NeedLine {
  name: string;
  /** 필요한(또는 모자란) 양. 모르면 빈 문자열 */
  amount: string;
  /** 냉장고에 있긴 한데 모자람 */
  short: boolean;
  recipes: string[];
}

/**
 * 식단에 올린 레시피들에 필요한데 냉장고에 없거나 모자란 재료를 모은다.
 * 양을 모르는 냉장고 재료는 충분하다고 본다. 단위 묶음이 달라 비교할 수 없어도 있다고 본다.
 */
export function collectNeeds(
  meals: { title: string; ingredients: Ingredient[]; factor: number }[],
  items: Pick<FridgeItem, "name" | "qty" | "unit">[],
  assumeStaples: boolean,
): NeedLine[] {
  interface Acc {
    name: string;
    sums: Map<string, { base: number; unit: string }>;
    plain: string;
    recipes: Set<string>;
  }
  const acc = new Map<string, Acc>();
  for (const meal of meals) {
    for (const ing of meal.ingredients) {
      if (assumeStaples && isStaple(ing.name)) continue;
      const key = normalizeName(ing.name);
      if (!key) continue;
      let a = acc.get(key);
      if (!a) {
        a = { name: ing.name, sums: new Map(), plain: "", recipes: new Set() };
        acc.set(key, a);
      }
      a.recipes.add(meal.title);
      const qty = ing.qty == null ? null : meal.factor === 1 ? ing.qty : scaleQty(ing.qty, meal.factor, ing.unit);
      const m = measure(qty, ing.unit);
      if (m) {
        const s = a.sums.get(m.family);
        if (s) s.base += m.base;
        else a.sums.set(m.family, { base: m.base, unit: ing.unit });
      } else if (!a.plain && ing.unit) {
        a.plain = ing.unit;
      }
    }
  }
  const out: NeedLine[] = [];
  for (const a of acc.values()) {
    const matching = items.filter((it) => ingredientMatches(it.name, a.name));
    const recipes = [...a.recipes];
    if (!matching.length) {
      const amount = [...a.sums.values()].map((s) => `${formatQty(round(fromBase(s.base, s.unit)))}${s.unit}`).join(" + ") || a.plain;
      out.push({ name: a.name, amount, short: false, recipes });
      continue;
    }
    if (matching.some((it) => it.qty == null)) continue;
    // 같은 단위 묶음으로 있는 양을 더해 모자란 만큼만 적는다
    const shortParts: string[] = [];
    for (const [family, s] of a.sums) {
      const have = matching.reduce((sum, it) => {
        const m = measure(it.qty, it.unit);
        return m && m.family === family ? sum + m.base : sum;
      }, 0);
      const comparable = matching.some((it) => measure(it.qty, it.unit)?.family === family);
      if (comparable && have < s.base * 0.98) shortParts.push(`${formatQty(round(fromBase(s.base - have, s.unit)))}${s.unit}`);
    }
    if (shortParts.length) out.push({ name: a.name, amount: shortParts.join(" + "), short: true, recipes });
  }
  return out.sort((x, y) => y.recipes.length - x.recipes.length || x.name.localeCompare(y.name, "ko"));
}

/* ───────── 날짜(브라우저 시간 기준) ───────── */

export function toDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function fromDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = fromDay(day);
  d.setDate(d.getDate() + n);
  return toDay(d);
}

/** 그 주 월요일 */
export function weekStart(day: string): string {
  const d = fromDay(day);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toDay(d);
}

export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

export function weekdayOf(day: string): string {
  return WEEKDAYS[(fromDay(day).getDay() + 6) % 7];
}

/** 지금 시각에 맞는 끼니: 10시 전 아침, 15시 전 점심, 그 뒤 저녁 */
export function slotForNow(now = new Date()): MealSlot {
  const h = now.getHours();
  return h < 10 ? "breakfast" : h < 15 ? "lunch" : "dinner";
}

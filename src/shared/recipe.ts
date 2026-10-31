// 레시피 데이터 형식과, AI·사용자 입력을 안전한 형태로 정리하는 함수들.
// 브라우저와 Worker가 함께 쓴다.

export type Difficulty = "쉬움" | "보통" | "어려움";
export const DIFFICULTIES: Difficulty[] = ["쉬움", "보통", "어려움"];

export interface Ingredient {
  name: string;
  /** 분량 숫자. '약간', '적당량'처럼 숫자가 없으면 null */
  qty: number | null;
  /** 단위 또는 숫자 없는 분량 표현 ('큰술', 'g', '약간') */
  unit: string;
  /** 손질법·대체 메모 ('송송 썬', '없으면 양파') */
  note: string;
  /** 묶음 이름 ('양념장'). 기본 재료는 빈 문자열 */
  group: string;
}

export interface RecipeContent {
  title: string;
  description: string;
  servings: number | null;
  timeMinutes: number | null;
  difficulty: Difficulty | null;
  ingredients: Ingredient[];
  steps: string[];
  tips: string[];
  tags: string[];
}

export type SourceType = "youtube" | "instagram" | "web" | "text" | "manual" | "ai";

export interface RecipeSummary {
  id: string;
  title: string;
  image: string | null;
  sourceType: SourceType;
  favorite: boolean;
  timeMinutes: number | null;
  servings: number | null;
  tags: string[];
  updatedAt: number;
  createdAt: number;
}

export interface RecipeDetail extends RecipeSummary {
  content: RecipeContent;
  sourceUrl: string | null;
  versionCount: number;
}

export interface RecipeVersion {
  id: number;
  note: string;
  kind: "original" | "edit" | "ai" | "substitute" | "restore";
  createdAt: number;
}

// 레시피 한 개(버전 한 개)가 DB에서 차지하는 크기를 묶어 두는 상한. 무료 D1은 DB 하나에 500MB까지다.
const LIMITS = {
  title: 80,
  description: 500,
  name: 40,
  unit: 20,
  note: 80,
  group: 30,
  step: 500,
  tip: 300,
  tag: 20,
  ingredients: 60,
  steps: 40,
  tips: 15,
  tags: 10,
};

function str(value: unknown, max: number): string {
  if (typeof value === "number" && Number.isFinite(value)) value = String(value);
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function multiline(value: unknown, max: number): string {
  if (typeof value !== "string") return str(value, max);
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const FRACTION_GLYPHS: Record<string, number> = {
  "½": 0.5,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 0.25,
  "¾": 0.75,
  "⅛": 0.125,
};

const KOREAN_NUMBERS: Record<string, number> = { 반: 0.5, 한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5 };

/**
 * '1/2', '1 1/2', '1과 1/2', '½', '1.5', '2~3', '반' 같은 분량 표현을 숫자로 바꾼다.
 * 범위는 앞 숫자를 쓰고 range에 원문을 돌려준다.
 */
export function parseQty(input: unknown): { qty: number | null; range: string | null } {
  if (typeof input === "number") return { qty: Number.isFinite(input) && input > 0 ? input : null, range: null };
  if (typeof input !== "string") return { qty: null, range: null };
  let s = input.trim();
  if (!s) return { qty: null, range: null };
  if (s in KOREAN_NUMBERS) return { qty: KOREAN_NUMBERS[s], range: null };
  for (const [glyph, value] of Object.entries(FRACTION_GLYPHS)) {
    s = s.replace(new RegExp(`(\\d+)?\\s*${glyph}`), (_, whole) => String((whole ? Number(whole) : 0) + value));
  }
  const rangeMatch = s.match(/^(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)\s*[~\-–]\s*(\d+(?:\.\d+)?(?:\s*\/\s*\d+)?)$/);
  if (rangeMatch) {
    const first = parseQty(rangeMatch[1]).qty;
    return { qty: first, range: `${rangeMatch[1].replace(/\s+/g, "")}~${rangeMatch[2].replace(/\s+/g, "")}` };
  }
  const mixed = s.match(/^(\d+)\s*(?:과|와|\s)\s*(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const value = Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
    return { qty: Number.isFinite(value) && value > 0 ? value : null, range: null };
  }
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const value = Number(frac[1]) / Number(frac[2]);
    return { qty: Number.isFinite(value) && value > 0 ? value : null, range: null };
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const value = Number(s);
    return { qty: value > 0 ? value : null, range: null };
  }
  return { qty: null, range: null };
}

const COUNT_UNITS = new Set(["개", "알", "장", "쪽", "대", "줄기", "마리", "모", "봉", "봉지", "팩", "캔", "토막", "덩이", "통", "송이", "포기", "단"]);

const FRACTIONS: [number, string][] = [
  [0.125, "⅛"],
  [0.25, "¼"],
  [1 / 3, "⅓"],
  [0.5, "½"],
  [2 / 3, "⅔"],
  [0.75, "¾"],
];

/** 편집 칸에 넣을 분량. 반올림하지 않아서 저장해도 값이 바뀌지 않는다. 1.5 → '1½', 2.45 → '2.45' */
export function formatQtyExact(qty: number): string {
  const whole = Math.floor(qty);
  const rest = qty - whole;
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(rest - value) < 0.001) return `${whole > 0 ? whole : ""}${glyph}`;
  }
  return String(Math.round(qty * 1000) / 1000);
}

/** 0.5 → '½', 1.5 → '1½', 0.3333 → '⅓', 2.4 → '2.4' */
export function formatQty(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return "";
  const whole = Math.floor(qty);
  const rest = qty - whole;
  if (rest < 0.02) return String(whole);
  if (whole < 20) {
    for (const [value, glyph] of FRACTIONS) {
      if (Math.abs(rest - value) < 0.03) return `${whole > 0 ? whole : ""}${glyph}`;
    }
  }
  if (qty >= 20) return String(Math.round(qty));
  return String(Math.round(qty * 10) / 10);
}

/** 인분 조절 시 분량을 단위에 맞게 보기 좋은 값으로 반올림한다. */
export function scaleQty(qty: number, factor: number, unit: string): number {
  const raw = qty * factor;
  if (COUNT_UNITS.has(unit)) return Math.max(0.5, Math.round(raw * 2) / 2);
  if (raw >= 100) return Math.round(raw / 5) * 5;
  if (raw >= 10) return Math.round(raw);
  return Math.max(0.125, Math.round(raw * 4) / 4);
}

/** 재료 한 줄의 분량 문자열. '2큰술', '200g', '약간' */
export function formatAmount(ingredient: Pick<Ingredient, "qty" | "unit">, factor = 1): string {
  const { qty, unit } = ingredient;
  if (qty == null) return unit;
  const value = factor === 1 ? qty : scaleQty(qty, factor, unit);
  return `${formatQty(value)}${unit}`;
}

/**
 * '2큰술', '200 g', '1/2개', '약간' 같은 분량 입력을 qty/unit으로 나눈다.
 * 편집 화면에서 분량을 한 칸으로 입력받을 때 쓴다.
 */
export function parseAmount(input: string): { qty: number | null; unit: string; range: string | null } {
  const s = input.trim();
  if (!s) return { qty: null, unit: "", range: null };
  const match = s.match(/^([\d.\/\s½⅓⅔¼¾⅛~\-–과와]+|반|한|두|세|네|다섯)\s*(.*)$/);
  if (match) {
    const { qty, range } = parseQty(match[1].trim());
    if (qty != null) return { qty, unit: match[2].trim().slice(0, LIMITS.unit), range };
  }
  return { qty: null, unit: s.slice(0, LIMITS.unit), range: null };
}

const AMOUNT_TAIL =
  /\s*((?:\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|[½⅓⅔¼¾⅛])(?:\s*[~\-–]\s*\d+(?:\.\d+)?)?\s*(?:kg|g|mg|ml|mL|L|l|cc|컵|큰술|작은술|스푼|숟가락|티스푼|T|t|개|알|장|쪽|대|줄기|마리|모|봉지|봉|팩|캔|토막|덩이|통|송이|포기|단|줌|꼬집|인분|근|돈|공기|조각|방울)?|약간|적당량|조금|적당히|한 ?줌|한 ?꼬집)\s*$/;

/** '양파 1개', '간장 2큰술', '소금 약간', '돼지고기(앞다리살) 300g' 같은 한 줄을 재료로 바꾼다. */
export function parseIngredientLine(line: string): Ingredient {
  let text = line.replace(/^[\s\-•·*▶►✔✅☑️◦]+/, "").trim();
  let note = "";
  const paren = text.match(/\(([^)]*)\)/);
  if (paren) {
    note = paren[1].trim();
    text = text.replace(paren[0], " ").replace(/\s+/g, " ").trim();
  }
  const tail = text.match(AMOUNT_TAIL);
  if (tail && tail.index !== undefined && tail.index > 0) {
    const name = text.slice(0, tail.index).replace(/[:：]$/, "").trim();
    const amount = parseAmount(tail[1]);
    return {
      name: str(name, LIMITS.name),
      qty: amount.qty,
      unit: amount.unit,
      note: str([note, amount.range ? `${amount.range}${amount.unit}` : ""].filter(Boolean).join(", "), LIMITS.note),
      group: "",
    };
  }
  return { name: str(text, LIMITS.name), qty: null, unit: "", note: str(note, LIMITS.note), group: "" };
}

function toPositiveInt(value: unknown, max: number): number | null {
  if (typeof value === "string") {
    const m = value.match(/\d+/);
    value = m ? Number(m[0]) : NaN;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(max, Math.round(value));
}

function normalizeIngredient(raw: unknown): Ingredient | null {
  if (typeof raw === "string") {
    const parsed = parseIngredientLine(raw);
    return parsed.name ? parsed : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name ?? r.item ?? r.ingredient, LIMITS.name);
  if (!name) return null;
  let qty: number | null = null;
  let unit = str(r.unit, LIMITS.unit);
  const notes = [str(r.note ?? r.notes ?? r.prep, LIMITS.note)];
  const parsed = parseQty(r.qty ?? r.quantity ?? r.amount);
  if (parsed.qty != null) {
    qty = Math.round(parsed.qty * 1000) / 1000;
    if (parsed.range) notes.push(`${parsed.range}${unit}`);
  } else if (typeof (r.qty ?? r.amount) === "string" && !unit) {
    // '2큰술'처럼 숫자와 단위가 붙어서 온 경우
    const amount = parseAmount(String(r.qty ?? r.amount));
    qty = amount.qty;
    unit = amount.unit;
  }
  if (qty == null && !unit) unit = "";
  return {
    name,
    qty,
    unit,
    note: str(notes.filter(Boolean).join(", "), LIMITS.note),
    group: str(r.group, LIMITS.group),
  };
}

function stringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (typeof value === "string") value = value.split(/\n+/);
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    let text: string;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      text = multiline(o.text ?? o.step ?? o.description ?? o.name ?? "", maxLen);
    } else {
      text = multiline(item, maxLen);
    }
    // AI가 붙이는 '1.', 'Step 2:' 같은 번호를 뗀다 — 화면에서 번호를 다시 붙인다.
    // 뒤에 숫자가 이어지면('2:1 비율', '1.5컵') 번호가 아니라 내용이므로 그대로 둔다.
    text = text
      .replace(/^(?:step\s*)?\d{1,2}\s*[.)\]:](?!\d)\s*/i, "")
      .replace(/^\d{1,2}\s*단계\s*[.:)]?\s*/, "")
      .trim();
    if (text) out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

/**
 * 같은 묶음의 재료를 붙여 놓는다. 묶음 없는 재료를 먼저, 묶음은 처음 나온 순서대로.
 * 화면과 편집기는 '묶음 이름이 바뀌는 곳'에 제목을 달기 때문에, 섞여 있으면 묶음이 잘못 보인다.
 */
function groupTogether(list: Ingredient[]): Ingredient[] {
  const order: string[] = [""];
  for (const i of list) if (!order.includes(i.group)) order.push(i.group);
  return order.flatMap((g) => list.filter((i) => i.group === g));
}

/** 어떤 형태의 입력이 와도 화면과 DB가 믿을 수 있는 RecipeContent로 정리한다. */
export function normalizeRecipe(raw: unknown): RecipeContent {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const ingredients: Ingredient[] = [];
  const rawIngredients = Array.isArray(r.ingredients) ? r.ingredients : [];
  for (const item of rawIngredients) {
    const ing = normalizeIngredient(item);
    if (ing) ingredients.push(ing);
    if (ingredients.length >= LIMITS.ingredients) break;
  }
  const difficulty = DIFFICULTIES.find((d) => d === r.difficulty) ?? null;
  const tags = stringList(r.tags, LIMITS.tags, LIMITS.tag).map((t) => t.replace(/^#/, ""));
  return {
    title: str(r.title, LIMITS.title) || "이름 없는 레시피",
    description: multiline(r.description, LIMITS.description),
    servings: toPositiveInt(r.servings, 100),
    timeMinutes: toPositiveInt(r.timeMinutes ?? r.time_minutes, 24 * 60),
    difficulty,
    ingredients: groupTogether(ingredients),
    steps: stringList(r.steps, LIMITS.steps, LIMITS.step),
    tips: stringList(r.tips, LIMITS.tips, LIMITS.tip),
    tags: [...new Set(tags)],
  };
}

/** 레시피로 쓸 만한 최소 조건: 재료 2개 이상, 조리 단계 1개 이상 */
export function isUsableRecipe(content: RecipeContent): boolean {
  return content.ingredients.length >= 2 && content.steps.length >= 1;
}

/** 검색용 텍스트: 제목, 재료명, 태그 */
export function searchTextOf(content: RecipeContent): string {
  return [content.title, ...content.ingredients.map((i) => i.name), ...content.tags].join(" ").toLowerCase();
}

/** 조리 단계에서 '5분', '10~15분', '1시간' 같은 시간을 찾아 분 단위로 돌려준다. 여러 개면 첫 번째. */
export function detectStepMinutes(step: string): number | null {
  const hour = step.match(/(\d+(?:\.\d+)?)\s*시간(?:\s*(\d+)\s*분)?/);
  if (hour) return Math.round(Number(hour[1]) * 60 + (hour[2] ? Number(hour[2]) : 0));
  const range = step.match(/(\d+)\s*[~\-–]\s*(\d+)\s*분/);
  if (range) return Number(range[2]);
  const minute = step.match(/(\d+)\s*분/);
  if (minute) {
    const n = Number(minute[1]);
    return n > 0 && n <= 600 ? n : null;
  }
  return null;
}

/** 레시피를 메신저로 보내기 좋은 일반 텍스트로 */
export function recipeToText(content: RecipeContent, sourceUrl?: string | null): string {
  const lines: string[] = [content.title];
  if (content.description) lines.push("", content.description);
  const meta = [content.servings ? `${content.servings}인분` : "", content.timeMinutes ? `${content.timeMinutes}분` : ""].filter(Boolean);
  if (meta.length) lines.push("", meta.join(", "));
  lines.push("", "[재료]");
  let group = "";
  for (const ing of content.ingredients) {
    if (ing.group !== group) {
      group = ing.group;
      if (group) lines.push(`- ${group}`);
    }
    lines.push(`${group ? "  " : ""}• ${ing.name} ${formatAmount(ing)}${ing.note ? ` (${ing.note})` : ""}`.trimEnd());
  }
  lines.push("", "[만드는 법]");
  content.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  if (content.tips.length) {
    lines.push("", "[팁]");
    content.tips.forEach((tip) => lines.push(`• ${tip}`));
  }
  if (sourceUrl) lines.push("", `원본: ${sourceUrl}`);
  return lines.join("\n");
}

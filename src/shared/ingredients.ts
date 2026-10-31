// 남은 재료로 만들 수 있는 레시피를 찾기 위한 재료 이름 비교.
// AI를 쓰지 않고 내 레시피 안에서 먼저 찾는다.

import type { RecipeContent } from "./recipe";

/** 집에 늘 있다고 볼 수 있는 기본 양념 */
export const STAPLES = ["물", "소금", "후추", "설탕", "간장", "식용유", "참기름", "깨", "식초", "맛술", "얼음"];

const SYNONYMS: Record<string, string> = {
  계란: "달걀",
  달걀노른자: "달걀",
  달걀흰자: "달걀",
  진간장: "간장",
  양조간장: "간장",
  국간장: "간장",
  조선간장: "간장",
  통깨: "깨",
  참깨: "깨",
  깨소금: "깨",
  후춧가루: "후추",
  통후추: "후추",
  꽃소금: "소금",
  천일염: "소금",
  굵은소금: "소금",
  백설탕: "설탕",
  황설탕: "설탕",
  흑설탕: "설탕",
  미림: "맛술",
  포도씨유: "식용유",
  카놀라유: "식용유",
  콩기름: "식용유",
  다진마늘: "마늘",
  편마늘: "마늘",
  통마늘: "마늘",
  다진생강: "생강",
  쌀밥: "밥",
  흰밥: "밥",
  공깃밥: "밥",
  찬밥: "밥",
};

// 재료 이름 앞에 붙는 손질·상태 표현. 이름 비교 전에 뗀다.
const PREFIXES = ["다진", "채썬", "채 썬", "송송썬", "송송 썬", "깍둑썬", "어슷썬", "얇게썬", "썬", "삶은", "데친", "볶은", "깐", "손질한", "냉동", "생", "신선한", "잘익은", "익은", "불린", "마른", "건"];

export function normalizeName(name: string): string {
  let s = name.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "");
  for (const p of PREFIXES) {
    if (s.startsWith(p + " ") || (s.startsWith(p) && s.length > p.length + 1)) {
      s = s.slice(p.length);
      break;
    }
  }
  s = s.replace(/[\s·,./]+/g, "");
  return SYNONYMS[s] ?? s;
}

/** 냉장고 재료 하나(have)가 레시피 재료(need)를 채우는지 */
export function ingredientMatches(have: string, need: string): boolean {
  const h = normalizeName(have);
  const n = normalizeName(need);
  if (!h || !n) return false;
  if (h === n) return true;
  // '파'가 '양파'에 걸리는 것처럼 한 글자 재료는 부분 일치를 허용하지 않는다.
  if (h.length < 2 || n.length < 2) return false;
  // '돼지고기' ↔ '돼지고기앞다리살', '김치' ↔ '신김치'
  return n.startsWith(h) || n.endsWith(h) || h.startsWith(n) || h.endsWith(n);
}

export function isStaple(name: string): boolean {
  const n = normalizeName(name);
  return STAPLES.some((s) => normalizeName(s) === n);
}

export interface PantryMatch {
  id: string;
  have: string[];
  missing: string[];
  /** 기본 양념을 빼고 계산한 재료 충족 비율 0~1 */
  ratio: number;
}

/**
 * 냉장고 재료로 각 레시피를 얼마나 만들 수 있는지 계산한다.
 * 냉장고 재료를 하나도 쓰지 않는 레시피는 빠진다.
 */
export function matchPantry(
  pantry: string[],
  recipes: { id: string; content: Pick<RecipeContent, "ingredients"> }[],
  assumeStaples: boolean,
): PantryMatch[] {
  const items = pantry.map((p) => p.trim()).filter(Boolean);
  if (!items.length) return [];
  const out: PantryMatch[] = [];
  for (const recipe of recipes) {
    const have: string[] = [];
    const missing: string[] = [];
    let usesPantry = false;
    const seen = new Set<string>();
    for (const ing of recipe.content.ingredients) {
      const key = normalizeName(ing.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const fromPantry = items.some((p) => ingredientMatches(p, ing.name));
      if (fromPantry) {
        usesPantry = true;
        have.push(ing.name);
      } else if (assumeStaples && isStaple(ing.name)) {
        continue;
      } else {
        missing.push(ing.name);
      }
    }
    if (!usesPantry) continue;
    const total = have.length + missing.length;
    out.push({ id: recipe.id, have, missing, ratio: total ? have.length / total : 0 });
  }
  return out.sort((a, b) => a.missing.length - b.missing.length || b.ratio - a.ratio || b.have.length - a.have.length);
}

/** 냉장고 입력 칸 자동완성용 자주 쓰는 재료 */
export const COMMON_INGREDIENTS = [
  "달걀", "양파", "대파", "마늘", "감자", "당근", "애호박", "두부", "김치", "돼지고기", "소고기", "닭고기",
  "스팸", "참치캔", "베이컨", "소시지", "어묵", "버섯", "팽이버섯", "표고버섯", "양배추", "배추", "무", "콩나물",
  "숙주", "시금치", "깻잎", "청양고추", "고추", "파프리카", "브로콜리", "토마토", "오이", "가지", "고구마",
  "밥", "라면", "국수", "떡", "우유", "치즈", "버터", "생크림", "밀가루", "부침가루", "전분", "고추장", "된장",
  "고춧가루", "굴소스", "케첩", "마요네즈", "새우", "오징어", "고등어", "멸치", "연어", "명란", "바지락", "베이컨",
  "식빵", "파스타면", "카레가루", "올리고당", "꿀", "레몬", "사과", "바나나",
].filter((v, i, arr) => arr.indexOf(v) === i);

import { describe, expect, it } from "vitest";
import {
  detectStepMinutes,
  formatAmount,
  formatQty,
  normalizeRecipe,
  parseAmount,
  parseIngredientLine,
  parseQty,
  scaleQty,
} from "../src/shared/recipe";
import { detectSource, findUrl } from "../src/shared/links";
import { ingredientMatches, matchPantry, normalizeName } from "../src/shared/ingredients";
import { kstDay, nextKstMidnight } from "../src/shared/time";

describe("parseQty", () => {
  it("reads fractions, mixed numbers and glyphs", () => {
    expect(parseQty("1/2").qty).toBe(0.5);
    expect(parseQty("1 1/2").qty).toBe(1.5);
    expect(parseQty("1과 1/2").qty).toBe(1.5);
    expect(parseQty("½").qty).toBe(0.5);
    expect(parseQty("1½").qty).toBe(1.5);
    expect(parseQty("반").qty).toBe(0.5);
    expect(parseQty(2).qty).toBe(2);
  });
  it("keeps the lower bound of a range and reports the range", () => {
    expect(parseQty("2~3")).toEqual({ qty: 2, range: "2~3" });
  });
  it("returns null for words", () => {
    expect(parseQty("약간").qty).toBeNull();
    expect(parseQty("").qty).toBeNull();
    expect(parseQty(0).qty).toBeNull();
  });
});

describe("formatQty / scaleQty / formatAmount", () => {
  it("shows common fractions as glyphs", () => {
    expect(formatQty(0.5)).toBe("½");
    expect(formatQty(1.5)).toBe("1½");
    expect(formatQty(1 / 3)).toBe("⅓");
    expect(formatQty(2)).toBe("2");
    expect(formatQty(2.4)).toBe("2.4");
    expect(formatQty(150)).toBe("150");
  });
  it("rounds countable units to halves and big weights to 5", () => {
    expect(scaleQty(1, 1.5, "개")).toBe(1.5);
    expect(scaleQty(1, 1.3, "개")).toBe(1.5);
    expect(scaleQty(300, 1.5, "g")).toBe(450);
    expect(scaleQty(130, 1.5, "g")).toBe(195);
    expect(scaleQty(1, 0.5, "큰술")).toBe(0.5);
  });
  it("formats amounts with and without a number", () => {
    expect(formatAmount({ qty: 2, unit: "큰술" })).toBe("2큰술");
    expect(formatAmount({ qty: null, unit: "약간" })).toBe("약간");
    expect(formatAmount({ qty: 1, unit: "개" }, 2)).toBe("2개");
  });
});

describe("parseAmount / parseIngredientLine", () => {
  it("splits an amount field", () => {
    expect(parseAmount("2큰술")).toEqual({ qty: 2, unit: "큰술", range: null });
    expect(parseAmount("200 g")).toEqual({ qty: 200, unit: "g", range: null });
    expect(parseAmount("1/2개")).toEqual({ qty: 0.5, unit: "개", range: null });
    expect(parseAmount("약간")).toEqual({ qty: null, unit: "약간", range: null });
  });
  it("splits a recipe line into name and amount", () => {
    expect(parseIngredientLine("양파 1개")).toMatchObject({ name: "양파", qty: 1, unit: "개" });
    expect(parseIngredientLine("- 간장 2큰술")).toMatchObject({ name: "간장", qty: 2, unit: "큰술" });
    expect(parseIngredientLine("소금 약간")).toMatchObject({ name: "소금", qty: null, unit: "약간" });
    expect(parseIngredientLine("돼지고기(앞다리살) 300g")).toMatchObject({ name: "돼지고기", qty: 300, unit: "g", note: "앞다리살" });
    expect(parseIngredientLine("대파")).toMatchObject({ name: "대파", qty: null, unit: "" });
  });
});

describe("normalizeRecipe", () => {
  it("accepts loose AI output", () => {
    const r = normalizeRecipe({
      title: "  김치볶음밥 ",
      servings: "2인분",
      time_minutes: 15,
      difficulty: "쉬움",
      ingredients: [
        { name: "김치", qty: "1", unit: "컵", note: "", group: "" },
        { name: "밥", qty: 2, unit: "공기" },
        "참기름 1/2큰술",
        { name: "" },
      ],
      steps: ["1. 김치를 썬다", { text: "Step 2: 볶는다" }, ""],
      tags: ["#자취요리", "자취요리"],
    });
    expect(r.title).toBe("김치볶음밥");
    expect(r.servings).toBe(2);
    expect(r.timeMinutes).toBe(15);
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[2]).toMatchObject({ name: "참기름", qty: 0.5, unit: "큰술" });
    expect(r.steps).toEqual(["김치를 썬다", "볶는다"]);
    expect(r.tags).toEqual(["자취요리"]);
  });
  it("never throws on garbage", () => {
    expect(normalizeRecipe(null).title).toBe("이름 없는 레시피");
    expect(normalizeRecipe({ ingredients: "nope", steps: 3 }).ingredients).toEqual([]);
  });
});

describe("detectStepMinutes", () => {
  it("finds the time in a step", () => {
    expect(detectStepMinutes("중불에서 5분간 볶아요")).toBe(5);
    expect(detectStepMinutes("10~15분 끓인다")).toBe(15);
    expect(detectStepMinutes("1시간 30분 재운다")).toBe(90);
    expect(detectStepMinutes("간을 본다")).toBeNull();
  });
});

describe("links", () => {
  it("finds a url inside shared text", () => {
    expect(findUrl("이거 맛있어 보임 https://youtu.be/dQw4w9WgXcQ?si=abc 꼭 해보자")).toBe("https://youtu.be/dQw4w9WgXcQ?si=abc");
    expect(findUrl("youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://youtube.com/shorts/dQw4w9WgXcQ");
  });
  it("detects youtube forms", () => {
    for (const u of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share",
    ]) {
      expect(detectSource(u)).toMatchObject({ type: "youtube", id: "dQw4w9WgXcQ", key: "yt:dQw4w9WgXcQ" });
    }
  });
  it("detects instagram reels and posts", () => {
    expect(detectSource("https://www.instagram.com/reel/C8abc_12/?igsh=xyz")).toMatchObject({ type: "instagram", code: "C8abc_12" });
    expect(detectSource("https://instagram.com/p/XYZ123/")).toMatchObject({ type: "instagram", code: "XYZ123" });
    expect(detectSource("https://www.instagram.com/someone/reel/ABC/")).toMatchObject({ type: "instagram", code: "ABC" });
  });
  it("strips tracking params from web links", () => {
    expect(detectSource("https://www.10000recipe.com/recipe/123?utm_source=x#top")).toMatchObject({
      type: "web",
      url: "https://www.10000recipe.com/recipe/123",
      key: "web:www.10000recipe.com/recipe/123",
    });
  });
  it("returns null without a link", () => {
    expect(detectSource("김치찌개 레시피")).toBeNull();
  });
});

describe("pantry matching", () => {
  it("normalizes prep words and synonyms", () => {
    expect(normalizeName("다진 마늘")).toBe("마늘");
    expect(normalizeName("계란")).toBe("달걀");
    expect(normalizeName("대파(흰 부분)")).toBe("대파");
  });
  it("does not let one-letter items match inside other words", () => {
    expect(ingredientMatches("파", "양파")).toBe(false);
    expect(ingredientMatches("돼지고기", "돼지고기 앞다리살")).toBe(true);
    expect(ingredientMatches("김치", "신김치")).toBe(true);
    expect(ingredientMatches("계란", "달걀")).toBe(true);
  });
  it("ranks recipes by fewest missing ingredients", () => {
    const recipes = [
      { id: "a", content: { ingredients: [ing("김치"), ing("밥"), ing("참기름"), ing("스팸")] } },
      { id: "b", content: { ingredients: [ing("김치"), ing("두부"), ing("돼지고기"), ing("대파")] } },
      { id: "c", content: { ingredients: [ing("우유"), ing("밀가루")] } },
    ];
    const result = matchPantry(["김치", "찬밥"], recipes, true);
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result[0].missing).toEqual(["스팸"]);
    expect(matchPantry(["김치", "밥"], recipes, false)[0].missing).toEqual(["참기름", "스팸"]);
  });
});

describe("time", () => {
  it("uses Korean dates", () => {
    // 2026-10-31 15:30 UTC = 2026-11-01 00:30 KST
    expect(kstDay(Date.UTC(2026, 9, 31, 15, 30))).toBe("2026-11-01");
    expect(kstDay(Date.UTC(2026, 9, 31, 14, 59))).toBe("2026-10-31");
    expect(new Date(nextKstMidnight(Date.UTC(2026, 9, 31, 3, 0))).toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });
});

function ing(name: string) {
  return { name, qty: null, unit: "", note: "", group: "" };
}

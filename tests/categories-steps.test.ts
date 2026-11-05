import { describe, expect, it } from "vitest";
import { CATEGORIES, normalizeCategories, normalizeRecipe, scaleStepText } from "../src/shared/recipe";
import { classifyTask, parseClassified } from "../src/worker/ai/prompts";

describe("scaleStepText", () => {
  it("leaves the text alone at the original amount", () => {
    expect(scaleStepText("간장 2큰술을 넣어요.", 1)).toBe("간장 2큰술을 넣어요.");
  });

  it("scales amounts with units", () => {
    expect(scaleStepText("간장 2큰술과 설탕 1작은술을 넣어요.", 2)).toBe("간장 4큰술과 설탕 2작은술을 넣어요.");
    expect(scaleStepText("물 500ml를 붓고 돼지고기 300g을 넣어요.", 2)).toBe("물 1000ml를 붓고 돼지고기 600g을 넣어요.");
    expect(scaleStepText("달걀 2개를 풀어요.", 1.5)).toBe("달걀 3개를 풀어요.");
    expect(scaleStepText("물 2 컵을 부어요.", 0.5)).toBe("물 1 컵을 부어요.");
  });

  it("scales fractions, glyphs and ranges", () => {
    expect(scaleStepText("고춧가루 1/2큰술", 2)).toBe("고춧가루 1큰술");
    expect(scaleStepText("버터 ½큰술", 2)).toBe("버터 1큰술");
    expect(scaleStepText("설탕 1½큰술", 2)).toBe("설탕 3큰술");
    expect(scaleStepText("물 1 1/2컵", 2)).toBe("물 3컵");
    expect(scaleStepText("소금 2~3꼬집", 2)).toBe("소금 4~6꼬집");
  });

  it("reads '1컵 반' as one and a half", () => {
    expect(scaleStepText("물 1컵 반을 부어요.", 2)).toBe("물 3컵을 부어요.");
    expect(scaleStepText("물 한 컵 반", 2)).toBe("물 3컵");
    expect(scaleStepText("양파 1개를 반으로 갈라요.", 2)).toBe("양파 2개를 반으로 갈라요.");
    expect(scaleStepText("물 1컵 반과 간장 1큰술", 2)).toBe("물 3컵과 간장 2큰술");
    expect(scaleStepText("밀가루 1컵 반죽에", 2)).toBe("밀가루 2컵 반죽에");
  });

  it("scales number words with piece units, but not '한쪽' or '모서리'", () => {
    expect(scaleStepText("두부 반 모와 대파 반 대를 넣어요.", 2)).toBe("두부 1모와 대파 1대를 넣어요.");
    expect(scaleStepText("깻잎 두 장을 깔아요.", 2)).toBe("깻잎 4장을 깔아요.");
    expect(scaleStepText("팬 한쪽에 밀어 두고 한 모금 맛봐요.", 2)).toBe("팬 한쪽에 밀어 두고 한 모금 맛봐요.");
  });

  it("scales simple Korean number words", () => {
    expect(scaleStepText("설탕 한 숟가락을 넣어요.", 2)).toBe("설탕 2숟가락을 넣어요.");
    expect(scaleStepText("양파 반 개를 썰어요.", 2)).toBe("양파 1개를 썰어요.");
  });

  it("does not touch time, heat, size or counts of actions", () => {
    const step = "180도로 예열한 오븐에서 10~15분 굽고, 2cm 두께로 썰어 3등분해요. 2번 뒤집어요. 1시간 재워요.";
    expect(scaleStepText(step, 2)).toBe(step);
  });

  it("does not touch per-piece amounts, ordinals and ratios", () => {
    // '1장에 1큰술씩'은 한 장당 양이라 둘 다 그대로 둔다. '씩'이 없는 '물 1L에 소금 1큰술'은 비율이 같도록 둘 다 바꾼다.
    expect(scaleStepText("만두피 1장에 소를 1큰술씩 올려요.", 2)).toBe("만두피 1장에 소를 1큰술씩 올려요.");
    expect(scaleStepText("물 1L에 소금 1큰술을 넣어요.", 2)).toBe("물 2L에 소금 2큰술을 넣어요.");
    expect(scaleStepText("2단계에서 3개월 숙성한 장을 써요.", 2)).toBe("2단계에서 3개월 숙성한 장을 써요.");
    expect(scaleStepText("간장과 설탕을 1대1로 섞어요.", 2)).toBe("간장과 설탕을 1대1로 섞어요.");
    expect(scaleStepText("두부 네 모서리를 잘라요.", 2)).toBe("두부 네 모서리를 잘라요.");
  });
});

describe("categories", () => {
  it("keeps only known categories, in a fixed order, once", () => {
    expect(normalizeCategories(["브런치", "양식", "양식", "타이", 3])).toEqual(["양식", "브런치"]);
    expect(normalizeCategories("한식")).toEqual(["한식"]);
    expect(normalizeCategories(undefined)).toEqual([]);
  });

  it("is part of a normalized recipe", () => {
    expect(normalizeRecipe({ title: "프렌치토스트", categories: ["브런치", "양식"] }).categories).toEqual(["양식", "브런치"]);
    expect(normalizeRecipe({ title: "팟타이" }).categories).toEqual([]);
  });

  it("asks the AI with short numbers and reads answers back by recipe", () => {
    const task = classifyTask([
      { title: "김치찌개", ingredients: ["김치", "돼지고기"] },
      { title: "프렌치토스트", ingredients: ["식빵", "달걀", "우유"] },
    ]);
    expect(task.name).toBe("classify");
    expect(task.parts[0]).toEqual({ text: "1. 김치찌개 (재료: 김치, 돼지고기)\n2. 프렌치토스트 (재료: 식빵, 달걀, 우유)" });
    for (const c of CATEGORIES) expect(task.system).toContain(c);

    const answer = { items: [{ n: 2, categories: ["브런치", "양식"] }, { n: 1, categories: ["한식"] }, { n: 9, categories: ["일식"] }, { n: "x" }] };
    expect(parseClassified(answer, 2)).toEqual(new Map([[2, ["양식", "브런치"]], [1, ["한식"]]]));
    expect(parseClassified(null, 2)).toEqual(new Map());
  });
});

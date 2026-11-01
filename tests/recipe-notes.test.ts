import { describe, expect, it } from "vitest";
import { normalizeRecipe } from "../src/shared/recipe";
import { extractTextTask, FILLED_TIP, placeFilledTip } from "../src/worker/ai/prompts";
import { changeNotesOf } from "../src/worker/recipes-db";

describe("changeNotesOf", () => {
  it("shows notes written since the original, newest first", () => {
    const notes = changeNotesOf([
      { note: "고춧가루 1.5 고추장 2.5 올리고당2 다시다 생략", kind: "edit" },
      { note: "물엿 → 올리고당", kind: "substitute" },
      { note: "원본", kind: "original" },
    ]);
    expect(notes).toEqual(["고춧가루 1.5 고추장 2.5 올리고당2 다시다 생략", "물엿 → 올리고당"]);
  });
  it("skips default labels and repeats", () => {
    const notes = changeNotesOf([
      { note: "직접 수정", kind: "edit" },
      { note: "덜 맵게", kind: "ai" },
      { note: "AI로 맛 조정", kind: "ai" },
      { note: "덜 맵게", kind: "edit" },
      { note: "원본", kind: "original" },
    ]);
    expect(notes).toEqual(["덜 맵게"]);
  });
  it("stops at a restore so old notes don't describe restored content", () => {
    expect(changeNotesOf([{ note: "'원본'(으)로 되돌림", kind: "restore" }, { note: "다시다 생략", kind: "edit" }, { note: "원본", kind: "original" }])).toEqual([]);
    expect(changeNotesOf([{ note: "원본", kind: "original" }])).toEqual([]);
    expect(changeNotesOf([])).toEqual([]);
  });
});

describe("instagram captions with only part of a recipe", () => {
  it("asks the model to fill gaps only when told to", () => {
    expect(extractTextTask({ sourceLabel: "인스타그램 게시물 캡션", text: "양념:고추장2", fillGaps: true }).system).toContain("흔한 순서로 steps를 채워요");
    const strict = extractTextTask({ sourceLabel: "유튜브 영상 설명란", text: "양념:고추장2" }).system;
    expect(strict).not.toContain("흔한 순서로 steps를 채워요");
    expect(strict).toContain("재료·순서를 알 수 없으면 is_recipe를 false");
  });
  it("moves the filled-in notice out of the steps", () => {
    const content = normalizeRecipe({
      title: "떡볶이",
      ingredients: [{ name: "쌀떡", qty: 300, unit: "g", note: "추정" }, { name: "고추장", qty: 2, unit: "큰술" }],
      steps: [FILLED_TIP, "냄비에 물과 양념을 풀어요.", "떡을 넣고 5분 끓여요."],
      tips: ["자주 저어요."],
    });
    const fixed = placeFilledTip(content);
    expect(fixed.steps).toEqual(["냄비에 물과 양념을 풀어요.", "떡을 넣고 5분 끓여요."]);
    expect(fixed.tips).toEqual([FILLED_TIP, "자주 저어요."]);
  });
  it("leaves complete recipes alone", () => {
    const content = normalizeRecipe({ title: "계란말이", ingredients: [{ name: "계란", qty: 4, unit: "개" }, { name: "소금", qty: null, unit: "약간" }], steps: ["풀어요.", "말아요."], tips: [] });
    expect(placeFilledTip(content)).toBe(content);
  });
});

import { describe, expect, it } from "vitest";
import {
  addDays,
  afterUse,
  collectNeeds,
  findSameItem,
  formatStock,
  measure,
  mergeStock,
  parseQuickAdd,
  planCooking,
  weekStart,
  type FridgeItem,
} from "../src/shared/fridge";
import type { Ingredient } from "../src/shared/recipe";

const ing = (name: string, qty: number | null, unit = ""): Ingredient => ({ name, qty, unit, note: "", group: "" });
const item = (id: string, name: string, qty: number | null, unit = "", fridgeId = "f1"): FridgeItem => ({ id, fridgeId, name, qty, unit, addedAt: 0, updatedAt: 0 });

describe("parseQuickAdd", () => {
  it("splits several items with amounts", () => {
    expect(parseQuickAdd("달걀 10개, 우유 1L\n대파")).toEqual([
      { name: "달걀", qty: 10, unit: "개" },
      { name: "우유", qty: 1, unit: "L" },
      { name: "대파", qty: null, unit: "" },
    ]);
  });
  it("keeps thousands separators together", () => {
    expect(parseQuickAdd("우유 1,000ml, 두부 1모")).toEqual([
      { name: "우유", qty: 1000, unit: "ml" },
      { name: "두부", qty: 1, unit: "모" },
    ]);
  });
  it("treats vague amounts as unknown", () => {
    expect(parseQuickAdd("고추장 약간")).toEqual([{ name: "고추장", qty: null, unit: "" }]);
  });
});

describe("measure and merge", () => {
  it("converts within a family", () => {
    expect(measure(1, "kg")).toEqual({ family: "mass", base: 1000 });
    expect(measure(2, "큰술")).toEqual({ family: "volume", base: 30 });
    expect(measure(3, "")).toEqual({ family: "count:개", base: 3 });
    expect(measure(3, "알")?.family).toBe("count:개");
  });
  it("adds amounts of the same family in the current unit", () => {
    expect(mergeStock({ qty: 600, unit: "g" }, { name: "돼지고기", qty: 0.3, unit: "kg" })).toEqual({ qty: 900, unit: "g" });
    expect(mergeStock({ qty: null, unit: "" }, { name: "달걀", qty: 10, unit: "개" })).toEqual({ qty: 10, unit: "개" });
    expect(mergeStock({ qty: 2, unit: "개" }, { name: "달걀", qty: null, unit: "" })).toEqual({ qty: 2, unit: "개" });
  });
  it("refuses to merge different families", () => {
    expect(mergeStock({ qty: 1, unit: "단" }, { name: "대파", qty: 2, unit: "대" })).toBeNull();
  });
  it("finds the same item by normalized name", () => {
    const items = [item("a", "계란", 5, "개"), item("b", "양파", 2, "개", "f2")];
    expect(findSameItem(items, "f1", "달걀")?.id).toBe("a");
    expect(findSameItem(items, "f1", "양파")).toBeUndefined();
  });
  it("formats stock", () => {
    expect(formatStock({ qty: 1.5, unit: "개" })).toBe("1½개");
    expect(formatStock({ qty: null, unit: "" })).toBe("");
  });
});

describe("planCooking", () => {
  const items = [
    item("egg", "달걀", 10, "개"),
    item("pork", "돼지고기", 0.6, "kg"),
    item("kimchi", "신김치", null),
    item("soy", "간장", 500, "ml"),
    item("onion", "양파", 1, "망"),
  ];
  it("subtracts converted amounts scaled by servings", () => {
    const plans = planCooking([ing("달걀", 2, "개"), ing("돼지고기", 200, "g"), ing("김치", 1, "컵"), ing("간장", 1, "큰술"), ing("양파", 1, "개")], 2, items);
    const by = Object.fromEntries(plans.map((p) => [p.itemId, p]));
    expect(by.egg.use).toBe(4);
    expect(by.pork.use).toBe(0.4);
    expect(by.kimchi.use).toBeNull(); // 양을 모름
    expect(by.soy.use).toBe(30);
    expect(by.onion.use).toBeNull(); // 망과 개는 비교할 수 없음
    expect(by.egg.need).toBe("4개");
  });
  it("adds up when two recipe lines use the same item and never exceeds stock", () => {
    const plans = planCooking([ing("달걀", 6, "개"), ing("달걀노른자", 6, "개")], 1, items);
    expect(plans).toHaveLength(1);
    expect(plans[0].use).toBe(10);
    expect(plans[0].for).toEqual(["달걀", "달걀노른자"]);
  });
  it("ignores ingredients that are not in the fridge", () => {
    expect(planCooking([ing("스팸", 1, "캔")], 1, items)).toEqual([]);
  });
  it("treats almost-empty as used up", () => {
    expect(afterUse(10, 4)).toBe(6);
    expect(afterUse(10, 10)).toBeNull();
    expect(afterUse(500, 495)).toBeNull();
  });
});

describe("collectNeeds", () => {
  it("lists missing and short ingredients for planned meals", () => {
    const needs = collectNeeds(
      [
        { title: "김치볶음밥", ingredients: [ing("달걀", 2, "개"), ing("김치", 1, "컵"), ing("소금", null, "약간"), ing("스팸", 1, "캔")], factor: 1 },
        { title: "달걀말이", ingredients: [ing("계란", 4, "개"), ing("대파", 0.5, "대")], factor: 1 },
      ],
      [item("e", "달걀", 3, "개"), item("k", "김치", null)],
      true,
    );
    expect(needs).toEqual([
      { name: "달걀", amount: "3개", short: true, recipes: ["김치볶음밥", "달걀말이"] },
      { name: "대파", amount: "½대", short: false, recipes: ["달걀말이"] },
      { name: "스팸", amount: "1캔", short: false, recipes: ["김치볶음밥"] },
    ]);
  });
});

describe("dates", () => {
  it("finds monday and moves days", () => {
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // 일요일 → 그 주 월요일
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("cooking terms", () => {
  it("finds terms once each, preferring longer patterns", async () => {
    const { splitTerms } = await import("../src/shared/glossary");
    const parts = splitTerms("중약불에서 송송 썬 김치를 볶아 투명해질 때까지 볶고, 다시 약불로 줄여요.");
    const terms = parts.filter((p) => p.term).map((p) => [p.text, p.term!.term]);
    expect(terms).toEqual([
      ["중약불", "약불"],
      ["송송 썬", "송송 썰기"],
      ["투명해질", "투명해질 때까지"],
    ]);
    expect(parts.map((p) => p.text).join("")).toBe("중약불에서 송송 썬 김치를 볶아 투명해질 때까지 볶고, 다시 약불로 줄여요.");
  });
});

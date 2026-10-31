import { describe, expect, it } from "vitest";
import { josa, relativeTime, replaceIngredientName } from "../src/app/lib/text";

describe("josa", () => {
  it("picks particles by final consonant", () => {
    expect(josa("소시지", "을")).toBe("를");
    expect(josa("참치캔", "를")).toBe("을");
    expect(josa("양파", "이")).toBe("가");
    expect(josa("두부", "은")).toBe("는");
    expect(josa("버섯", "와")).toBe("과");
    expect(josa("소금", "로")).toBe("으로");
    expect(josa("물", "으로")).toBe("로");
    expect(josa("우유", "으로")).toBe("로");
  });
});

describe("replaceIngredientName", () => {
  it("swaps the name and fixes the particle", () => {
    expect(replaceIngredientName("스팸을 넣고 3분 볶아요. 스팸이 노릇해지면", "스팸", "소시지")).toBe("소시지를 넣고 3분 볶아요. 소시지가 노릇해지면");
    expect(replaceIngredientName("대파와 양파를 볶아요", "대파", "쪽파")).toBe("쪽파와 양파를 볶아요");
    expect(replaceIngredientName("버터로 볶아요", "버터", "식용유")).toBe("식용유로 볶아요");
    expect(replaceIngredientName("간을 봐요", "스팸", "소시지")).toBe("간을 봐요");
    expect(replaceIngredientName("양파와 파를 볶아요", "파", "쪽파")).toBe("양파와 쪽파를 볶아요");
  });
});

describe("relativeTime", () => {
  it("reads naturally", () => {
    const now = Date.UTC(2026, 9, 31, 12);
    expect(relativeTime(now - 30_000, now)).toBe("방금");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5분 전");
    expect(relativeTime(now - 3 * 3600_000, now)).toBe("3시간 전");
    expect(relativeTime(now - 2 * 86400_000, now)).toBe("2일 전");
  });
});

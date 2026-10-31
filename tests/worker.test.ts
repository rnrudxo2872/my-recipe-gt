import { describe, expect, it } from "vitest";
import { parseJsonLoose } from "../src/worker/ai/providers";
import { captionFromOgDescription } from "../src/worker/extract/instagram";
import { htmlToText, looksLikeRecipe } from "../src/worker/extract/text";
import { parseRecipePage } from "../src/worker/extract/web";
import { parseIsoDuration } from "../src/worker/extract/youtube";
import { DEFAULT_POLICY, mergePolicy } from "../src/worker/quota";
import { normalizeSubstitutes } from "../src/worker/routes/recipes";

describe("looksLikeRecipe", () => {
  it("spots ingredient lists in a description", () => {
    const desc = `오늘은 김치찌개!\n\n[재료]\n김치 1/4포기\n돼지고기 200g\n두부 반 모\n대파 1대\n고춧가루 1큰술\n\n#김치찌개`;
    expect(looksLikeRecipe(desc)).toBe(true);
  });
  it("ignores plain channel descriptions", () => {
    expect(looksLikeRecipe("구독과 좋아요 부탁드려요! 인스타그램 @cook 비즈니스 문의 cook@example.com")).toBe(false);
    expect(looksLikeRecipe("")).toBe(false);
  });
});

describe("parseRecipePage", () => {
  it("reads JSON-LD recipes without AI", () => {
    const html = `<html><head><title>x</title>
      <meta property="og:image" content="/og.jpg">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":"Recipe","name":"된장찌개",
      "recipeYield":"2인분","totalTime":"PT25M","image":["https://x.com/a.jpg"],
      "recipeIngredient":["된장 2큰술","애호박 1/2개","두부 1/2모","물 500ml"],
      "recipeInstructions":[{"@type":"HowToStep","text":"물에 된장을 풀어요."},{"@type":"HowToStep","text":"채소를 넣고 10분 끓여요."}]}]}</script>
      </head><body></body></html>`;
    const page = parseRecipePage(html, "https://x.com/r/1");
    expect(page.recipe?.title).toBe("된장찌개");
    expect(page.recipe?.servings).toBe(2);
    expect(page.recipe?.timeMinutes).toBe(25);
    expect(page.recipe?.ingredients[1]).toMatchObject({ name: "애호박", qty: 0.5, unit: "개" });
    expect(page.recipe?.steps).toEqual(["물에 된장을 풀어요.", "채소를 넣고 10분 끓여요."]);
    expect(page.image).toBe("https://x.com/a.jpg");
  });
  it("falls back to page text and og:image", () => {
    const page = parseRecipePage(`<meta property="og:image" content="/og.jpg"><script>var a=1</script><p>재료: 양파 1개</p>`, "https://x.com/r/1");
    expect(page.recipe).toBeNull();
    expect(page.image).toBe("https://x.com/og.jpg");
    expect(page.text).toContain("양파 1개");
    expect(page.text).not.toContain("var a");
  });
});

describe("misc extractors", () => {
  it("parses ISO durations", () => {
    expect(parseIsoDuration("PT1M30S")).toBe(90);
    expect(parseIsoDuration("PT1H2M")).toBe(3720);
  });
  it("pulls the caption out of instagram og:description", () => {
    expect(captionFromOgDescription('1,234 likes, 12 comments - cook on May 1, 2026: "초간단 계란말이\n달걀 3개".')).toBe("초간단 계란말이\n달걀 3개");
  });
  it("strips markup", () => {
    expect(htmlToText("<div>안녕<br>하세요</div><style>.a{}</style>")).toBe("안녕\n하세요");
  });
  it("parses JSON wrapped in fences or prose", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('결과입니다: {"a":2} 끝')).toEqual({ a: 2 });
  });
});

describe("policy", () => {
  it("keeps defaults and ignores bad values", () => {
    const p = mergePolicy({ member: { ai: 30, video: -1, import: "x" }, global: { memberShare: 0.3 } });
    expect(p.member.ai).toBe(30);
    expect(p.member.video).toBe(DEFAULT_POLICY.member.video);
    expect(p.member.import).toBe(DEFAULT_POLICY.member.import);
    expect(p.global.memberShare).toBe(0.3);
    expect(mergePolicy(null)).toEqual(DEFAULT_POLICY);
  });
});

describe("normalizeSubstitutes", () => {
  it("cleans AI output", () => {
    const r = normalizeSubstitutes(
      { items: [{ missing: "스팸", options: [{ name: "소시지", qty: "100", unit: "g", note: "짠맛이 덜해요" }, { name: "" }], can_skip: false }], tip: "맛보며 조절" },
      ["스팸"],
    );
    expect(r.items[0]).toEqual({ missing: "스팸", options: [{ name: "소시지", qty: 100, unit: "g", note: "짠맛이 덜해요" }], canSkip: false, skipNote: "" });
    expect(r.tip).toBe("맛보며 조절");
  });
});

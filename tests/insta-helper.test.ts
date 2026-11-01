import { describe, expect, it } from "vitest";
// @ts-expect-error 폰에서 그대로 돌리는 .mjs라 타입 선언이 없다
import { parsePost, postUrl } from "../helper/insta-helper.mjs";
import type { AppEnv } from "../src/worker/env";
import { HELPER_FRESH_MS, helperUrl, parseHelperUrl, sameSecret, saveAnnouncedHelper } from "../src/worker/insta-helper";

/** settings 표 하나만 흉내 내는 D1 */
function fakeDb() {
  const rows = new Map<string, string>();
  let writes = 0;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              const v = rows.get(String(args[0]));
              return v === undefined ? null : { value: v };
            },
            async run() {
              if (!sql.startsWith("INSERT INTO settings")) throw new Error(sql);
              writes++;
              rows.set(String(args[0]), String(args[1]));
              return {};
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, rows, writes: () => writes };
}

function env(extra: Partial<AppEnv>, db = fakeDb().db): AppEnv {
  return { DB: db, INSTA_HELPER_URL: "", ...extra } as AppEnv;
}

describe("도우미 주소 받기", () => {
  it("임시 터널 주소만 받고 경로는 버린다", () => {
    expect(parseHelperUrl("https://abc-def-123.trycloudflare.com")).toBe("https://abc-def-123.trycloudflare.com");
    expect(parseHelperUrl("https://abc-def.trycloudflare.com/x?y=1")).toBe("https://abc-def.trycloudflare.com");
  });

  it("다른 곳·http·포트·계정 정보가 붙은 주소는 거절한다", () => {
    for (const bad of [
      "http://abc.trycloudflare.com",
      "https://evil.com",
      "https://abc.trycloudflare.com.evil.com",
      "https://a.b.trycloudflare.com",
      "https://abc.trycloudflare.com:8443",
      "https://u:p@abc.trycloudflare.com",
      "not a url",
      42,
      "https://" + "a".repeat(250) + ".trycloudflare.com",
    ]) {
      expect(parseHelperUrl(bad)).toBeNull();
    }
  });

  it("고정 주소가 있으면 그 호스트도 받는다", () => {
    expect(parseHelperUrl("https://insta.example.com", "https://insta.example.com/")).toBe("https://insta.example.com");
  });

  it("알려 온 주소는 30분 동안만 쓴다", async () => {
    const t = 1_800_000_000_000;
    const e = env({ INSTA_HELPER_TOKEN: "x".repeat(32) });
    await saveAnnouncedHelper(e, "https://abc.trycloudflare.com", t);
    expect(await helperUrl(e, t + 60_000)).toBe("https://abc.trycloudflare.com");
    expect(await helperUrl(e, t + HELPER_FRESH_MS + 1)).toBeNull();
  });

  it("토큰이 없으면 알려 온 주소를 쓰지 않고, 고정 주소가 있으면 그게 먼저다", async () => {
    const f = fakeDb();
    const e = env({ INSTA_HELPER_TOKEN: "x".repeat(32) }, f.db);
    await saveAnnouncedHelper(e, "https://abc.trycloudflare.com");
    expect(await helperUrl(env({}, f.db))).toBeNull();
    expect(await helperUrl(env({ INSTA_HELPER_URL: "https://fixed.example.com/", INSTA_HELPER_TOKEN: "x" }, f.db))).toBe("https://fixed.example.com");
  });

  it("같은 주소를 자주 알려 와도 DB에는 5분에 한 번만 쓴다", async () => {
    const f = fakeDb();
    const e = env({ INSTA_HELPER_TOKEN: "x".repeat(32) }, f.db);
    const t = 1_800_000_000_000;
    await saveAnnouncedHelper(e, "https://abc.trycloudflare.com", t);
    await saveAnnouncedHelper(e, "https://abc.trycloudflare.com", t + 60_000);
    expect(f.writes()).toBe(1);
    await saveAnnouncedHelper(e, "https://new.trycloudflare.com", t + 61_000);
    await saveAnnouncedHelper(e, "https://new.trycloudflare.com", t + 61_000 + 6 * 60_000);
    expect(f.writes()).toBe(3);
  });

  it("토큰 비교", async () => {
    expect(await sameSecret("Bearer abc", "Bearer abc")).toBe(true);
    expect(await sameSecret("Bearer abd", "Bearer abc")).toBe(false);
    expect(await sameSecret("", "Bearer abc")).toBe(false);
  });
});

describe("폰 도우미의 게시물 읽기", () => {
  it("인스타 게시물 주소만 받아 한 가지 꼴로 바꾼다", () => {
    expect(postUrl("https://www.instagram.com/reel/DX8LcThvTIT/?mdxt=abc")).toBe("https://www.instagram.com/reel/DX8LcThvTIT/");
    expect(postUrl("https://instagram.com/p/fA9uwTtkSN/")).toBe("https://www.instagram.com/reel/fA9uwTtkSN/");
    expect(postUrl("https://www.instagram.com/someone/reel/ABC_def-1/")).toBe("https://www.instagram.com/reel/ABC_def-1/");
    expect(postUrl("http://www.instagram.com/reel/ABC/")).toBeNull();
    expect(postUrl("https://evil.com/reel/ABC/")).toBeNull();
    expect(postUrl("https://www.instagram.com/accounts/login/")).toBeNull();
  });

  it("og 태그에서 캡션·썸네일·작성자를 뽑는다", () => {
    const html =
      '<meta property="og:image" content="https://scontent.cdninstagram.com/a.jpg?x=1&amp;y=2" />' +
      '<meta property="og:description" content="993 likes, 58 comments - yeobii_home - May 4, 2026: &quot;&#xc81c;&#xc721;&#xbcf6;&#xc74c;\n1. &#xac04;&#xc7a5; 2&quot;. " />';
    expect(parsePost(html, "https://www.instagram.com/reel/X/")).toEqual({
      caption: "제육볶음\n1. 간장 2",
      thumbnail: "https://scontent.cdninstagram.com/a.jpg?x=1&y=2",
      uploader: "yeobii_home",
    });
  });

  it("페이스북 안내 화면이나 미리보기 없는 화면은 캡션으로 쓰지 않는다", () => {
    expect(() => parsePost('<meta name="description" content="Facebook에 로그인하세요">', "https://www.facebook.com/unsupportedbrowser")).toThrow();
    expect(() => parsePost("<html><title>Instagram</title></html>", "https://www.instagram.com/accounts/login/")).toThrow();
  });
});

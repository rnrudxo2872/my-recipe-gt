// 인스타그램 게시물의 캡션과 사진 가져오기.
// 1) 폰서버 도우미(yt-dlp)가 설정돼 있으면 그쪽에 묻는다. 집 IP라 막힐 일이 적다.
// 2) 아니면 공개 페이지의 미리보기 정보(og 태그)를 읽어 본다.
// 둘 다 안 되면 사용자에게 캡션을 붙여넣어 달라고 한다.

import type { AppEnv } from "../env";
import { metaContent, readLimited } from "./text";

export interface InstagramMeta {
  caption: string;
  image: string | null;
  author: string;
}

async function fromHelper(env: AppEnv, url: string): Promise<InstagramMeta | null> {
  if (!env.INSTA_HELPER_URL) return null;
  try {
    const res = await fetch(`${env.INSTA_HELPER_URL.replace(/\/$/, "")}/extract?url=${encodeURIComponent(url)}`, {
      headers: env.INSTA_HELPER_TOKEN ? { authorization: `Bearer ${env.INSTA_HELPER_TOKEN}` } : {},
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { caption?: string; thumbnail?: string; uploader?: string };
    if (!data.caption && !data.thumbnail) return null;
    return { caption: data.caption ?? "", image: data.thumbnail ?? null, author: data.uploader ?? "" };
  } catch {
    return null;
  }
}

/** og:description은 '좋아요 12개, 댓글 3개 - 아이디님, 날짜: "캡션"' 꼴이다. 따옴표 안만 뽑는다. */
export function captionFromOgDescription(desc: string): string {
  const quoted = desc.match(/[:：]\s*["“]([\s\S]*)["”]\s*\.?\s*$/);
  return (quoted ? quoted[1] : desc).trim();
}

async function fromPublicPage(url: string): Promise<InstagramMeta | null> {
  try {
    const res = await fetch(url, { headers: { "accept-language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const html = await readLimited(res, 400_000);
    const desc = metaContent(html, "og:description") ?? metaContent(html, "description");
    const image = metaContent(html, "og:image");
    if (!desc && !image) return null;
    const title = metaContent(html, "og:title") ?? "";
    return { caption: desc ? captionFromOgDescription(desc) : "", image, author: title.split(/\s+(?:on|님)/)[0] ?? "" };
  } catch {
    return null;
  }
}

export async function fetchInstagram(env: AppEnv, url: string): Promise<InstagramMeta | null> {
  return (await fromHelper(env, url)) ?? (await fromPublicPage(url));
}

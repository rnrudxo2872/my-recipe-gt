// 인스타그램 게시물의 캡션과 사진 가져오기.
// 1) 폰서버 도우미가 켜져 있으면 그쪽에 묻는다. 집 인터넷에서 공개 페이지를 읽으므로 막히지 않는다.
// 2) 아니면 직접 공개 페이지의 미리보기 정보(og 태그)를 읽어 본다.
//    (Cloudflare 서버에서 열면 인스타가 facebook.com/unsupportedbrowser로 돌려보내서 보통 실패한다)
// 둘 다 안 되면 사용자에게 캡션을 붙여넣어 달라고 한다.

import type { AppEnv } from "../env";
import { helperUrl } from "../insta-helper";
import { metaContent, readLimited } from "./text";

export interface InstagramMeta {
  caption: string;
  image: string | null;
  author: string;
}

async function fromHelper(env: AppEnv, url: string): Promise<InstagramMeta | null> {
  const base = await helperUrl(env);
  if (!base) return null;
  try {
    const res = await fetch(`${base}/extract?url=${encodeURIComponent(url)}`, {
      headers: env.INSTA_HELPER_TOKEN ? { authorization: `Bearer ${env.INSTA_HELPER_TOKEN}` } : {},
      signal: AbortSignal.timeout(20_000),
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
    // 인스타가 다른 곳(페이스북 안내 화면, 로그인 화면)으로 보냈으면 그 화면 글을 캡션으로 착각하지 않는다.
    if (res.url && !/(^|\.)instagram\.com$/.test(new URL(res.url).hostname)) return null;
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

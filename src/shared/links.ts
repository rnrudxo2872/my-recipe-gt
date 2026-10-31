// 붙여넣은 글이나 공유하기로 들어온 텍스트에서 레시피 출처 링크를 찾아낸다.

export type DetectedSource =
  | { type: "youtube"; id: string; url: string; key: string }
  | { type: "instagram"; code: string; url: string; key: string }
  | { type: "web"; url: string; key: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/i;

/** 텍스트 안의 첫 번째 URL. 'youtu.be/abc'처럼 스킴이 빠진 것도 잡는다. */
export function findUrl(text: string): string | null {
  const direct = text.match(URL_PATTERN);
  if (direct) return direct[0].replace(/[),.。」』]+$/, "");
  const bare = text.match(/(?:^|\s)((?:www\.|m\.)?(?:youtube\.com|youtu\.be|instagram\.com)\/[^\s<>"'`]+)/i);
  return bare ? `https://${bare[1]}` : null;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return YT_ID.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = url.searchParams.get("v");
    if (v && YT_ID.test(v)) return v;
    const m = url.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  return null;
}

export function parseInstagramCode(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host !== "instagram.com") return null;
  const m = url.pathname.match(/^\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function detectSource(text: string): DetectedSource | null {
  const raw = findUrl(text);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const yt = parseYouTubeId(url);
  if (yt) return { type: "youtube", id: yt, url: `https://www.youtube.com/watch?v=${yt}`, key: `yt:${yt}` };
  const ig = parseInstagramCode(url);
  if (ig) return { type: "instagram", code: ig, url: `https://www.instagram.com/reel/${ig}/`, key: `ig:${ig}` };
  // 추적용 파라미터를 지워서 같은 글이 같은 키를 갖게 한다.
  for (const p of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|igsh|si$|ref$|share)/i.test(p)) url.searchParams.delete(p);
  }
  url.hash = "";
  const clean = url.toString();
  return { type: "web", url: clean, key: `web:${clean.replace(/^https?:\/\//, "").replace(/\/$/, "")}` };
}

export function youTubeThumbCandidates(id: string): string[] {
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ];
}

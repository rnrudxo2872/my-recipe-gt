// 유튜브 영상 정보(제목, 설명란, 길이, 썸네일) 가져오기.
// YouTube Data API 키가 있으면 그걸 쓰고(하루 1만 건 무료), 없으면 공개 페이지와 oEmbed를 읽는다.

import { youTubeThumbCandidates } from "../../shared/links";
import type { AppEnv } from "../env";
import { readLimited } from "./text";

export interface YouTubeMeta {
  id: string;
  title: string;
  description: string;
  channel: string;
  durationSec: number | null;
  thumbnail: string | null;
}

export function parseIsoDuration(iso: string): number | null {
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const [, d, h, min, s] = m.map((v) => (v ? Number(v) : 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

async function fromDataApi(env: AppEnv, id: string): Promise<YouTubeMeta | null> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${id}&key=${env.YOUTUBE_API_KEY}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: {
      snippet?: { title?: string; description?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> };
      contentDetails?: { duration?: string };
    }[];
  };
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    channel: item.snippet?.channelTitle ?? "",
    durationSec: item.contentDetails?.duration ? parseIsoDuration(item.contentDetails.duration) : null,
    thumbnail: thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? null,
  };
}

function jsonString(html: string, key: string): string | null {
  const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return null;
  }
}

async function fromWatchPage(id: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=ko`, {
      headers: { "accept-language": "ko-KR,ko;q=0.9" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    // videoDetails는 페이지 앞부분에 있다. 뒤쪽은 읽지 않는다.
    const html = await readLimited(res, 900_000);
    const at = html.indexOf('"videoDetails"');
    if (at < 0) return null;
    const part = html.slice(at, at + 60_000);
    const length = part.match(/"lengthSeconds":"(\d+)"/)?.[1];
    return {
      title: jsonString(part, "title") ?? undefined,
      description: jsonString(part, "shortDescription") ?? "",
      channel: jsonString(part, "author") ?? "",
      durationSec: length ? Number(length) : null,
    };
  } catch {
    return null;
  }
}

async function fromOEmbed(id: string): Promise<Partial<YouTubeMeta> | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string; author_name?: string };
    return { title: data.title, channel: data.author_name };
  } catch {
    return null;
  }
}

async function bestThumbnail(id: string): Promise<string> {
  const candidates = youTubeThumbCandidates(id);
  for (const url of candidates.slice(0, -1)) {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      if (res.ok) return url;
    } catch {
      // 다음 후보로
    }
  }
  return candidates[candidates.length - 1];
}

export async function fetchYouTubeMeta(env: AppEnv, id: string, isShorts: boolean): Promise<YouTubeMeta | null> {
  if (env.YOUTUBE_API_KEY) {
    const viaApi = await fromDataApi(env, id).catch(() => null);
    if (viaApi) {
      if (!viaApi.thumbnail) viaApi.thumbnail = await bestThumbnail(id);
      return viaApi;
    }
  }
  const [page, oembed, thumbnail] = await Promise.all([fromWatchPage(id), fromOEmbed(id), bestThumbnail(id)]);
  // oEmbed가 실패하면 비공개·삭제된 영상일 가능성이 높다.
  if (!page?.title && !oembed?.title) return null;
  return {
    id,
    title: page?.title || oembed?.title || "",
    description: page?.description ?? "",
    channel: page?.channel || oembed?.channel || "",
    durationSec: page?.durationSec ?? (isShorts ? 60 : null),
    thumbnail,
  };
}

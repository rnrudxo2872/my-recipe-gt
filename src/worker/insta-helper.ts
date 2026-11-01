// 폰서버 인스타 도우미의 주소.
// 고정 주소(INSTA_HELPER_URL)가 있으면 그걸 쓴다. 없으면 도우미가 임시 터널(trycloudflare)을 열 때마다
// 알려 온 주소를 쓴다. 임시 터널 주소는 폰이 재시작할 때마다 바뀌므로, 재배포 없이 따라가려고 DB에 둔다.

import type { AppEnv } from "./env";

const KEY = "insta_helper";
/** 도우미는 10분마다 소식을 보낸다. 30분 넘게 소식이 없으면 꺼진 것으로 본다 */
export const HELPER_FRESH_MS = 30 * 60 * 1000;
/** 같은 주소로 다시 알려 오면 이 간격이 지났을 때만 DB에 쓴다 */
const REWRITE_MS = 5 * 60 * 1000;

interface Announced {
  url: string;
  seenAt: number;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** 도우미가 알려 온 주소가 받아도 되는 주소인지. 임시 터널 주소나 고정 주소와 같은 호스트만 받는다 */
export function parseHelperUrl(raw: unknown, fixed?: string): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const fixedHost = fixed ? hostOf(fixed) : null;
  if (!/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname) && url.hostname !== fixedHost) return null;
  return url.origin;
}

async function readAnnounced(env: AppEnv): Promise<Announced | null> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(KEY).first<{ value: string }>();
    if (!row) return null;
    const data = JSON.parse(row.value) as Partial<Announced>;
    return typeof data.url === "string" && typeof data.seenAt === "number" ? { url: data.url, seenAt: data.seenAt } : null;
  } catch {
    return null;
  }
}

/** 지금 쓸 도우미 주소(끝의 / 없이). 도우미가 없거나 꺼져 있으면 null */
export async function helperUrl(env: AppEnv, now = Date.now()): Promise<string | null> {
  if (env.INSTA_HELPER_URL) return env.INSTA_HELPER_URL.replace(/\/+$/, "");
  if (!env.INSTA_HELPER_TOKEN) return null;
  const announced = await readAnnounced(env);
  return announced && now - announced.seenAt <= HELPER_FRESH_MS ? announced.url : null;
}

export async function saveAnnouncedHelper(env: AppEnv, url: string, now = Date.now()): Promise<void> {
  const prev = await readAnnounced(env);
  if (prev && prev.url === url && now - prev.seenAt < REWRITE_MS) return;
  const value = JSON.stringify({ url, seenAt: now } satisfies Announced);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(KEY, value).run();
}

/** 토큰 비교. 길이와 내용이 어디서 달라지는지 시간으로 드러나지 않게 해시끼리 비교한다 */
export async function sameSecret(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

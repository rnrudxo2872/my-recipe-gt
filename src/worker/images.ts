// 사진 저장. R2가 연결돼 있으면 R2에, 아니면 D1에 base64로 넣는다(R2는 카드 등록이 필요해서 기본은 D1).

import { ApiError, randomId, type AppEnv } from "./env";

export const MAX_IMAGE_BYTES = 1_200_000;
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);

function toBase64(bytes: Uint8Array): string {
  const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof native === "function") return native(b64);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function imageUrl(key: string): string {
  return `/img/${key}`;
}

export function keyFromImageUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^\/img\/([A-Za-z0-9_-]+\.[a-z]+)$/);
  return m ? m[1] : null;
}

export async function putImage(env: AppEnv, userId: number, bytes: Uint8Array, mime: string): Promise<string> {
  if (!ALLOWED.has(mime)) throw new ApiError(400, "bad_image", "사진은 JPG, PNG, WebP 형식만 올릴 수 있어요.");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new ApiError(413, "image_too_large", "사진이 너무 커요. 1MB 이하로 줄여 주세요.");
  const ext = mime.split("/")[1].replace("jpeg", "jpg");
  const key = `${randomId(12)}.${ext}`;
  if (env.IMAGES) {
    await env.IMAGES.put(key, bytes, { httpMetadata: { contentType: mime } });
    await env.DB.prepare("INSERT INTO images (key, user_id, mime, store, data, size, created_at) VALUES (?1, ?2, ?3, 'r2', NULL, ?4, ?5)")
      .bind(key, userId, mime, bytes.byteLength, Date.now())
      .run();
  } else {
    await env.DB.prepare("INSERT INTO images (key, user_id, mime, store, data, size, created_at) VALUES (?1, ?2, ?3, 'd1', ?4, ?5, ?6)")
      .bind(key, userId, mime, toBase64(bytes), bytes.byteLength, Date.now())
      .run();
  }
  return key;
}

export async function getImage(env: AppEnv, key: string): Promise<{ body: BodyInit; mime: string } | null> {
  const row = await env.DB.prepare("SELECT mime, store, data FROM images WHERE key = ?1")
    .bind(key)
    .first<{ mime: string; store: string; data: string | null }>();
  if (!row) return null;
  if (row.store === "r2") {
    const obj = await env.IMAGES?.get(key);
    return obj ? { body: obj.body, mime: row.mime } : null;
  }
  return row.data ? { body: fromBase64(row.data), mime: row.mime } : null;
}

/** 내가 올린 사진이고 다른 레시피에서 쓰지 않으면 지운다. */
export async function deleteImageIfUnused(env: AppEnv, url: string | null | undefined, userId: number) {
  const key = keyFromImageUrl(url);
  if (!key) return;
  const used = await env.DB.prepare("SELECT 1 FROM recipes WHERE image = ?1 LIMIT 1").bind(imageUrl(key)).first();
  if (used) return;
  const row = await env.DB.prepare("SELECT store FROM images WHERE key = ?1 AND user_id = ?2").bind(key, userId).first<{ store: string }>();
  if (!row) return;
  if (row.store === "r2") await env.IMAGES?.delete(key);
  await env.DB.prepare("DELETE FROM images WHERE key = ?1").bind(key).run();
}

/** 외부 사진(인스타 썸네일처럼 주소가 곧 만료되는 것)을 내 저장소로 옮긴다. 실패하면 null */
export async function copyRemoteImage(env: AppEnv, userId: number, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED.has(mime)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return imageUrl(await putImage(env, userId, bytes, mime));
  } catch {
    return null;
  }
}

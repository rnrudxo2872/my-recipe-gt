// 사진 저장.
// - 기본: Workers KV (카드 등록 없이 1GB 무료, 바이너리 그대로 저장)
// - R2를 연결하면 R2 (10GB 무료지만 활성화할 때 카드 등록 필요)
// - 둘 다 없으면 D1에 base64 (무료 D1은 DB 하나에 500MB라 비상용)
// 어느 곳에 두든 images 표에 주인과 크기를 적어 둔다.

import { ApiError, randomId, type AppEnv } from "./env";

export const MAX_IMAGE_BYTES = 1_200_000;
const ALLOWED = new Set(["image/webp", "image/jpeg", "image/png", "image/avif"]);

type Store = "r2" | "kv" | "d1";

function storeOf(env: AppEnv): Store {
  if (env.IMAGES) return "r2";
  if (env.IMAGES_KV) return "kv";
  return "d1";
}

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
  const store = storeOf(env);
  if (store === "r2") await env.IMAGES!.put(key, bytes, { httpMetadata: { contentType: mime } });
  if (store === "kv") await env.IMAGES_KV!.put(key, bytes);
  await env.DB.prepare("INSERT INTO images (key, user_id, mime, store, data, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(key, userId, mime, store, store === "d1" ? toBase64(bytes) : null, bytes.byteLength, Date.now())
    .run();
  return key;
}

export async function getImage(env: AppEnv, key: string): Promise<{ body: BodyInit; mime: string } | null> {
  const row = await env.DB.prepare("SELECT mime, store, data FROM images WHERE key = ?1")
    .bind(key)
    .first<{ mime: string; store: Store; data: string | null }>();
  if (!row) return null;
  if (row.store === "r2") {
    const obj = await env.IMAGES?.get(key);
    return obj ? { body: obj.body, mime: row.mime } : null;
  }
  if (row.store === "kv") {
    const stream = await env.IMAGES_KV?.get(key, "stream");
    return stream ? { body: stream, mime: row.mime } : null;
  }
  return row.data ? { body: fromBase64(row.data), mime: row.mime } : null;
}

type StoredRow = { key: string; store: Store };

/** 저장소에서 지우고 표에서도 지운다. D1은 쿼리 하나에 값 100개까지라 40개씩 나눠 부른다. */
async function purge(env: AppEnv, rows: StoredRow[]) {
  if (!rows.length) return;
  const r2 = rows.filter((r) => r.store === "r2").map((r) => r.key);
  if (r2.length && env.IMAGES) await env.IMAGES.delete(r2);
  for (const r of rows) if (r.store === "kv") await env.IMAGES_KV?.delete(r.key);
  const keys = rows.map((r) => r.key);
  const marks = keys.map((_, i) => `?${i + 1}`).join(",");
  await env.DB.prepare(`DELETE FROM images WHERE key IN (${marks})`)
    .bind(...keys)
    .run();
}

const BATCH = 40;

/** 사진을 아무도 쓰지 않는지: 어떤 레시피도, 공용 분석 캐시도 이 사진을 가리키지 않는지 */
const UNUSED = `NOT EXISTS (SELECT 1 FROM recipes r WHERE r.image = '/img/' || images.key)
  AND NOT EXISTS (SELECT 1 FROM extraction_cache c WHERE c.image = '/img/' || images.key)`;

/** 내가 올린 사진이고 아무도 쓰지 않으면 지운다. */
export async function deleteImageIfUnused(env: AppEnv, url: string | null | undefined, userId: number) {
  const key = keyFromImageUrl(url);
  if (!key) return;
  const row = await env.DB.prepare(`SELECT key, store FROM images WHERE key = ?1 AND user_id = ?2 AND ${UNUSED}`)
    .bind(key, userId)
    .first<StoredRow>();
  if (row) await purge(env, [row]);
}

/** 이 사용자의 사진 중 아무도 쓰지 않는 것을 지운다(계정 삭제용). 남은 것은 매일 정리에서 마저 지운다. */
export async function deleteUnusedImagesOf(env: AppEnv, userId: number) {
  const { results } = await env.DB.prepare(`SELECT key, store FROM images WHERE user_id = ?1 AND ${UNUSED} LIMIT ${BATCH}`)
    .bind(userId)
    .all<StoredRow>();
  await purge(env, results);
}

/** 올렸지만 아무도 쓰지 않는(편집 취소, 지운 계정 등) 하루 지난 사진을 정리한다. 매일 cron에서 부른다. */
export async function cleanOrphanImages(env: AppEnv) {
  for (let round = 0; round < 5; round++) {
    const { results } = await env.DB.prepare(`SELECT key, store FROM images WHERE created_at < ?1 AND ${UNUSED} LIMIT ${BATCH}`)
      .bind(Date.now() - 24 * 60 * 60 * 1000)
      .all<StoredRow>();
    await purge(env, results);
    if (results.length < BATCH) break;
  }
}

/** 외부 사진(인스타 썸네일처럼 주소가 곧 만료되는 것)을 내 저장소로 옮긴다. 실패하면 null */
export async function copyRemoteImage(env: AppEnv, userId: number, url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!ALLOWED.has(mime)) return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return null;
    return imageUrl(await putImage(env, userId, bytes, mime));
  } catch {
    return null;
  }
}

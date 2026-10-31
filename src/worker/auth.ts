// 비밀번호 해시, 세션 쿠키, 로그인 확인 미들웨어

import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { PublicUser, Role, UserStatus } from "../shared/api";
import { ApiError, base64url, randomId, sha256Hex, type AppEnv, type Ctx, type HonoEnv, type SessionUser } from "./env";
import { verificationRequired } from "./mail";

const COOKIE = "rgt_sid";
const SESSION_DAYS = 60;
const DAY = 24 * 60 * 60 * 1000;
// Workers 무료 플랜의 요청당 CPU 10ms 안에 들어오도록 정한 반복 횟수(약 4ms).
// 서버 비밀값(AUTH_PEPPER)을 함께 섞어서 DB만 새어 나가도 대입 공격이 어렵게 한다.
const PBKDF2_ITERATIONS = 20_000;

function pepperBytes(env: AppEnv): Uint8Array {
  return new TextEncoder().encode(env.AUTH_PEPPER || "recipong-dev-pepper");
}

async function derive(password: string, salt: Uint8Array, iterations: number, env: AppEnv): Promise<Uint8Array> {
  const pepper = pepperBytes(env);
  const fullSalt = new Uint8Array(salt.length + pepper.length);
  fullSalt.set(salt);
  fullSalt.set(pepper, salt.length);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fullSalt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, env: AppEnv): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS, env);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function verifyPassword(password: string, stored: string, env: AppEnv): Promise<boolean> {
  const [scheme, iter, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !saltB64 || !hashB64) return false;
  const expected = fromBase64url(hashB64);
  const actual = await derive(password, fromBase64url(saltB64), Number(iter), env);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  status_reason: string | null;
  created_at: number;
  last_seen_at: number | null;
  email_verified_at: number | null;
}

export function toPublicUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    statusReason: row.status_reason,
    emailVerified: row.email_verified_at != null,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

export function publicOnly(user: SessionUser): PublicUser {
  const { lastSeenAt: _ignored, ...rest } = user;
  return rest;
}

function isSecure(c: Ctx): boolean {
  return new URL(c.req.url).protocol === "https:";
}

export async function createSession(c: Ctx, userId: number) {
  const token = randomId(32);
  const now = Date.now();
  await c.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * DAY)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: isSecure(c),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function destroySession(c: Ctx) {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: "/", secure: isSecure(c) });
}

export async function currentUser(c: Ctx): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.status, u.status_reason, u.created_at, u.last_seen_at, u.email_verified_at, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`,
  )
    .bind(tokenHash, now)
    .first<UserRow & { expires_at: number }>();
  if (!row) return null;
  if (row.status === "blocked") {
    throw new ApiError(403, "blocked", `이용이 차단된 계정이에요.${row.status_reason ? ` (${row.status_reason})` : ""}`);
  }
  const writes: D1PreparedStatement[] = [];
  // 오래 쓰는 사람은 로그인이 풀리지 않도록 만료를 뒤로 민다.
  if (row.expires_at - now < (SESSION_DAYS - 30) * DAY) {
    writes.push(c.env.DB.prepare("UPDATE sessions SET expires_at = ?1 WHERE token_hash = ?2").bind(now + SESSION_DAYS * DAY, tokenHash));
    setCookie(c, COOKIE, token, { httpOnly: true, secure: isSecure(c), sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 24 * 60 * 60 });
  }
  if (!row.last_seen_at || now - row.last_seen_at > 10 * 60 * 1000) {
    writes.push(c.env.DB.prepare("UPDATE users SET last_seen_at = ?1 WHERE id = ?2").bind(now, row.id));
  }
  if (writes.length) c.executionCtx.waitUntil(c.env.DB.batch(writes));
  return toPublicUser(row);
}

export const requireUser: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) throw new ApiError(401, "unauthorized", "로그인이 필요해요.");
  c.set("user", user);
  await next();
};

/** 로그인 + 이메일 인증까지 마친 사용자만. 앱 기능(레시피, 가져오기, AI, 관리)에 쓴다. */
export const requireVerified: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const user = await currentUser(c);
  if (!user) throw new ApiError(401, "unauthorized", "로그인이 필요해요.");
  if (!user.emailVerified && verificationRequired(c.env)) {
    throw new ApiError(403, "unverified", "이메일 인증을 마쳐야 쓸 수 있어요. 메일함을 확인해 주세요.");
  }
  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<HonoEnv> = async (c, next) => {
  if (c.get("user")?.role !== "admin") throw new ApiError(403, "forbidden", "관리자만 쓸 수 있어요.");
  await next();
};

export function adminEmails(env: AppEnv): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function verifyTurnstile(env: AppEnv, token: string | undefined, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip !== "local") body.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * 관리자가 이 이메일에 미리 정해 둔 권한이 있으면 적용한다.
 * 이메일 인증을 마친 뒤(또는 인증을 쓰지 않을 때 가입 직후)에만 부른다. 남이 그 주소로 먼저 가입해 권한을 가로채지 못하게.
 */
export async function applyRoleGrant(db: D1Database, userId: number, email: string) {
  const grant = await db.prepare("SELECT role FROM role_grants WHERE email = ?1").bind(email).first<{ role: string }>();
  if (!grant) return;
  await db.batch([
    db.prepare("UPDATE users SET role = ?1 WHERE id = ?2").bind(grant.role, userId),
    db.prepare("DELETE FROM role_grants WHERE email = ?1").bind(email),
    db.prepare("INSERT INTO events (user_id, kind, detail, created_at) VALUES (?1, 'role', ?2, ?3)").bind(userId, `미리 정해 둔 권한(${grant.role}) 적용`, Date.now()),
  ]);
}

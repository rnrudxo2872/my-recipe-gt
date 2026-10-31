// 가입, 로그인, 내 정보

import { Hono } from "hono";
import type { MeResponse, QuotaKind } from "../../shared/api";
import { nextKstMidnight } from "../../shared/time";
import {
  adminEmails,
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  publicOnly,
  redeemInvite,
  requireUser,
  verifyPassword,
  verifyTurnstile,
} from "../auth";
import { ApiError, clientIp, readJson, type HonoEnv, type SessionUser } from "../env";
import { deleteImageIfUnused } from "../images";
import { getPolicy, getUsage, limitAttempts, limitsFor, isUnlimited } from "../quota";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCredentials(email: unknown, password: unknown) {
  if (typeof email !== "string" || !EMAIL.test(email.trim()) || email.length > 120) {
    throw new ApiError(400, "bad_email", "이메일 주소를 확인해 주세요.");
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    throw new ApiError(400, "bad_password", "비밀번호는 8자 이상이어야 해요.");
  }
}

export async function buildMe(c: { env: HonoEnv["Bindings"] }, user: SessionUser): Promise<MeResponse> {
  const policy = await getPolicy(c.env.DB);
  const usage = await getUsage(c.env.DB, user.id);
  const kinds: QuotaKind[] = ["ai", "import", "video", "upload"];
  return {
    user: publicOnly(user),
    unlimited: isUnlimited(user),
    limits: limitsFor(user, policy),
    usage: Object.fromEntries(kinds.map((k) => [k, usage[k] ?? 0])) as Record<QuotaKind, number>,
    resetAt: nextKstMidnight(),
  };
}

export const account = new Hono<HonoEnv>();

account.post("/auth/signup", async (c) => {
  const body = await readJson<{ email?: string; password?: string; name?: string; invite?: string; turnstile?: string; website?: string }>(c);
  const ip = clientIp(c);
  // 사람 눈에 안 보이는 칸. 채워져 있으면 자동 가입 봇이다.
  if (body.website) throw new ApiError(400, "bad_request", "가입할 수 없어요.");
  validateCredentials(body.email, body.password);
  const email = body.email!.trim().toLowerCase();
  const name = (body.name ?? "").trim().slice(0, 20) || email.split("@")[0].slice(0, 20);
  await limitAttempts(c.env.DB, `signup:${ip}`, 24 * 60 * 60 * 1000, 5, "가입 시도가 너무 많아요. 내일 다시 시도해 주세요.");
  if (!(await verifyTurnstile(c.env, body.turnstile, ip))) {
    throw new ApiError(400, "turnstile", "자동 가입 방지 확인에 실패했어요. 다시 시도해 주세요.");
  }
  const exists = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?1").bind(email).first();
  if (exists) throw new ApiError(409, "email_taken", "이미 가입된 이메일이에요. 로그인해 주세요.");

  const admins = adminEmails(c.env);
  let role: "admin" | "member" = "member";
  if (admins.includes(email)) role = "admin";
  else if (!admins.length) {
    const anyAdmin = await c.env.DB.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").first();
    if (!anyAdmin) role = "admin"; // 관리자 이메일을 정하지 않았으면 첫 가입자가 관리자
  }
  const hash = await hashPassword(body.password!, c.env);
  const now = Date.now();
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, name, password_hash, role, signup_ip, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id",
  )
    .bind(email, name, hash, role, ip, now)
    .first<{ id: number }>();
  const userId = res!.id;
  let inviteAccepted = false;
  if (body.invite && role === "member") inviteAccepted = await redeemInvite(c.env.DB, body.invite, userId);
  await createSession(c, userId);
  return c.json({ ok: true, inviteAccepted, inviteRejected: Boolean(body.invite) && role === "member" && !inviteAccepted });
});

account.post("/auth/login", async (c) => {
  const body = await readJson<{ email?: string; password?: string }>(c);
  const ip = clientIp(c);
  const email = String(body.email ?? "").trim().toLowerCase();
  await limitAttempts(c.env.DB, `login-ip:${ip}`, 15 * 60 * 1000, 30, "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
  await limitAttempts(c.env.DB, `login:${email}`, 15 * 60 * 1000, 10, "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
  const row = await c.env.DB.prepare("SELECT id, password_hash, status, status_reason, role FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: number; password_hash: string; status: string; status_reason: string | null; role: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash, c.env))) {
    throw new ApiError(401, "bad_credentials", "이메일 또는 비밀번호가 맞지 않아요.");
  }
  if (row.status === "blocked") {
    throw new ApiError(403, "blocked", `이용이 차단된 계정이에요.${row.status_reason ? ` (${row.status_reason})` : ""}`);
  }
  if (row.role !== "admin" && adminEmails(c.env).includes(email)) {
    await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(row.id).run();
  }
  await createSession(c, row.id);
  return c.json({ ok: true });
});

account.post("/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

// 로그인하지 않았으면 me: null (앱 첫 화면에서 401 오류를 내지 않으려고)
account.get("/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ me: user ? await buildMe(c, user) : null });
});

account.patch("/me", requireUser, async (c) => {
  const body = await readJson<{ name?: string }>(c);
  const name = String(body.name ?? "").trim().slice(0, 20);
  if (!name) throw new ApiError(400, "bad_name", "이름을 입력해 주세요.");
  await c.env.DB.prepare("UPDATE users SET name = ?1 WHERE id = ?2").bind(name, c.get("user").id).run();
  return c.json({ ok: true });
});

account.post("/me/password", requireUser, async (c) => {
  const body = await readJson<{ current?: string; next?: string }>(c);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(body.current ?? ""), row.password_hash, c.env))) {
    throw new ApiError(400, "bad_credentials", "지금 비밀번호가 맞지 않아요.");
  }
  validateCredentials(user.email, body.next);
  await c.env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(body.next!, c.env), user.id).run();
  return c.json({ ok: true });
});

account.post("/me/invite", requireUser, async (c) => {
  const body = await readJson<{ code?: string }>(c);
  const user = c.get("user");
  if (isUnlimited(user)) return c.json({ ok: true, already: true });
  await limitAttempts(c.env.DB, `invite:${user.id}`, 60 * 60 * 1000, 10, "초대 코드 입력이 너무 많아요. 1시간 뒤에 다시 시도해 주세요.");
  if (!(await redeemInvite(c.env.DB, String(body.code ?? ""), user.id))) {
    throw new ApiError(400, "bad_invite", "쓸 수 없는 초대 코드예요. 코드를 다시 확인하거나 새 코드를 받아 주세요.");
  }
  return c.json({ ok: true });
});

account.delete("/me", requireUser, async (c) => {
  const body = await readJson<{ password?: string }>(c);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash, c.env))) {
    throw new ApiError(400, "bad_credentials", "비밀번호가 맞지 않아요.");
  }
  await deleteUserData(c.env, user.id);
  await destroySession(c);
  return c.json({ ok: true });
});

export async function deleteUserData(env: HonoEnv["Bindings"], userId: number) {
  const { results } = await env.DB.prepare("SELECT image FROM recipes WHERE user_id = ?1 AND image LIKE '/img/%'").bind(userId).all<{ image: string }>();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recipe_versions WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = ?1)").bind(userId),
    env.DB.prepare("DELETE FROM recipes WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM pantry WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?1").bind(userId),
  ]);
  for (const r of results) await deleteImageIfUnused(env, r.image, userId);
  if (env.IMAGES) {
    const { results: left } = await env.DB.prepare("SELECT key FROM images WHERE user_id = ?1 AND store = 'r2'").bind(userId).all<{ key: string }>();
    for (const r of left) await env.IMAGES.delete(r.key);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM images WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
  ]);
}

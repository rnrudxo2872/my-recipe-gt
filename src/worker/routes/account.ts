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
  applyRoleGrant,
  requireUser,
  verifyPassword,
  verifyTurnstile,
} from "../auth";
import { ApiError, clientIp, readJson, type HonoEnv, type SessionUser } from "../env";
import { deleteUnusedImagesOf } from "../images";
import { consumeEmailToken, mailMode, sendReset, sendVerification, verificationRequired } from "../mail";
import { bump, getPolicy, getUsage, limitAttempts, limitsFor, isUnlimited } from "../quota";

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
  const kinds: QuotaKind[] = ["ai", "import", "video", "upload", "save"];
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
  const body = await readJson<{ email?: string; password?: string; name?: string; turnstile?: string; website?: string }>(c);
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

  const verify = verificationRequired(c.env);
  const admins = adminEmails(c.env);
  let role: "admin" | "member" = "member";
  // 관리자 이메일은 인증을 마친 뒤에 관리자가 된다(남이 먼저 그 주소로 가입해도 관리자가 되지 않게).
  if (admins.includes(email) && !verify) role = "admin";
  else if (!admins.length) {
    // 관리자 이메일을 정하지 않았으면 이 앱의 맨 첫 가입자만 관리자가 된다(관리자가 없어져도 다음 가입자가 되지 않게).
    const anyUser = await c.env.DB.prepare("SELECT 1 FROM users LIMIT 1").first();
    if (!anyUser) role = "admin";
  }
  const hash = await hashPassword(body.password!, c.env);
  const now = Date.now();
  const res = await c.env.DB.prepare(
    "INSERT INTO users (email, name, password_hash, role, signup_ip, created_at, last_seen_at, email_verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, NULL) RETURNING id",
  )
    .bind(email, name, hash, role, ip, now)
    .first<{ id: number }>();
  const userId = res!.id;
  // 이메일 인증을 쓰지 않을 때만 가입 즉시 적용한다. 인증을 쓰면 인증을 마칠 때 적용한다.
  if (!verify && role === "member") await applyRoleGrant(c.env.DB, userId, email);
  await createSession(c, userId);

  // 인증 메일. 못 보내도 가입은 끝난 것이고, 인증 화면에서 다시 보낼 수 있다.
  let devLink: string | undefined;
  let mailError: string | undefined;
  if (verify) {
    try {
      devLink = await sendVerification(c, { id: userId, email, name });
    } catch (e) {
      mailError = e instanceof ApiError ? e.message : "인증 메일을 보내지 못했어요. 잠시 뒤에 다시 보내 주세요.";
    }
  }
  return c.json({ ok: true, verifyRequired: verify, devLink, mailError });
});

/** 메일의 인증 링크를 눌렀을 때 */
account.post("/auth/verify", async (c) => {
  const body = await readJson<{ token?: string }>(c);
  await limitAttempts(c.env.DB, `verify-ip:${clientIp(c)}`, 15 * 60 * 1000, 30, "시도가 너무 많아요. 잠시 뒤에 다시 시도해 주세요.");
  const userId = await consumeEmailToken(c.env.DB, String(body.token ?? ""), "verify");
  if (!userId) throw new ApiError(400, "bad_token", "인증 링크가 만료됐거나 이미 쓴 링크예요. 앱에서 인증 메일을 다시 보내 주세요.");
  const user = await c.env.DB.prepare("SELECT email, role FROM users WHERE id = ?1").bind(userId).first<{ email: string; role: string }>();
  await c.env.DB.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?1) WHERE id = ?2").bind(Date.now(), userId).run();
  if (user) {
    // 관리자가 이 이메일에 미리 정해 둔 권한(예: 지인)을 이제 적용한다.
    await applyRoleGrant(c.env.DB, userId, user.email);
    if (user.role !== "admin" && adminEmails(c.env).includes(user.email)) {
      await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(userId).run();
    }
  }
  return c.json({ ok: true });
});

/** 인증 메일 다시 보내기 */
account.post("/auth/verify/resend", requireUser, async (c) => {
  const user = c.get("user");
  if (user.emailVerified || !verificationRequired(c.env)) return c.json({ ok: true, already: true });
  const devLink = await sendVerification(c, user);
  return c.json({ ok: true, devLink });
});

/** 가입할 때 이메일을 잘못 적었으면 인증 전에 고칠 수 있다 */
account.post("/me/email", requireUser, async (c) => {
  const user = c.get("user");
  if (user.emailVerified) throw new ApiError(400, "already_verified", "인증을 마친 이메일은 여기서 바꿀 수 없어요.");
  const body = await readJson<{ email?: string }>(c);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 120) throw new ApiError(400, "bad_email", "이메일 주소를 확인해 주세요.");
  await limitAttempts(c.env.DB, `email-change:${user.id}`, 24 * 60 * 60 * 1000, 5, "오늘은 이메일을 더 바꿀 수 없어요. 내일 다시 시도해 주세요.");
  const taken = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ?1 AND id != ?2").bind(email, user.id).first();
  if (taken) throw new ApiError(409, "email_taken", "이미 가입된 이메일이에요.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET email = ?1 WHERE id = ?2").bind(email, user.id),
    // 예전 주소로 간 인증 링크는 더 쓰지 못하게
    c.env.DB.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND kind = 'verify'").bind(user.id),
  ]);
  const devLink = await sendVerification(c, { ...user, email });
  return c.json({ ok: true, devLink });
});

/** 비밀번호 찾기: 가입 여부와 상관없이 같은 응답을 준다(가입된 이메일을 알아내지 못하게). */
account.post("/auth/forgot", async (c) => {
  if (mailMode(c.env) === "off") {
    throw new ApiError(503, "mail_off", "지금은 비밀번호 찾기 메일을 보낼 수 없어요. 관리자에게 임시 비밀번호를 받아 주세요.");
  }
  const body = await readJson<{ email?: string }>(c);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ApiError(400, "bad_email", "이메일 주소를 확인해 주세요.");
  await limitAttempts(c.env.DB, `forgot-ip:${clientIp(c)}`, 60 * 60 * 1000, 10, "요청이 너무 많아요. 1시간 뒤에 다시 시도해 주세요.");
  const user = await c.env.DB.prepare("SELECT id, email, name, status FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: number; email: string; name: string; status: string }>();
  let devLink: string | undefined;
  if (user && user.status !== "blocked") {
    // 같은 주소로는 1시간에 3통까지. 넘으면 조용히 보내지 않는다.
    const { count } = await bump(c.env.DB, `forgot:${email}`, 60 * 60 * 1000);
    if (count <= 3) devLink = await sendReset(c, user);
  }
  return c.json({ ok: true, devLink });
});

/** 메일의 재설정 링크에서 새 비밀번호를 정한다. 다른 기기의 로그인은 모두 풀린다. */
account.post("/auth/reset", async (c) => {
  const body = await readJson<{ token?: string; password?: string }>(c);
  const password = String(body.password ?? "");
  if (password.length < 8 || password.length > 200) throw new ApiError(400, "bad_password", "비밀번호는 8자 이상이어야 해요.");
  await limitAttempts(c.env.DB, `reset-ip:${clientIp(c)}`, 15 * 60 * 1000, 20, "시도가 너무 많아요. 잠시 뒤에 다시 시도해 주세요.");
  const userId = await consumeEmailToken(c.env.DB, String(body.token ?? ""), "reset");
  if (!userId) throw new ApiError(400, "bad_token", "링크가 만료됐거나 이미 쓴 링크예요. 비밀번호 찾기를 다시 해 주세요.");
  const user = await c.env.DB.prepare("SELECT status, email FROM users WHERE id = ?1").bind(userId).first<{ status: string; email: string }>();
  if (!user || user.status === "blocked") throw new ApiError(403, "blocked", "이용이 차단된 계정이에요.");
  // 재설정 메일을 받았으니 이메일 주인이 확인된 셈이다. 미리 정해 둔 권한이 있으면 적용한다.
  await applyRoleGrant(c.env.DB, userId, user.email);
  await c.env.DB.batch([
    // 메일을 받았으니 이메일 주인인 것도 확인된 셈이다.
    c.env.DB.prepare("UPDATE users SET password_hash = ?1, email_verified_at = COALESCE(email_verified_at, ?2) WHERE id = ?3").bind(
      await hashPassword(password, c.env),
      Date.now(),
      userId,
    ),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId),
  ]);
  await createSession(c, userId);
  return c.json({ ok: true });
});

account.post("/auth/login", async (c) => {
  const body = await readJson<{ email?: string; password?: string }>(c);
  const ip = clientIp(c);
  const email = String(body.email ?? "").trim().toLowerCase();
  await limitAttempts(c.env.DB, `login-ip:${ip}`, 15 * 60 * 1000, 30, "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
  await limitAttempts(c.env.DB, `login:${email}`, 15 * 60 * 1000, 10, "로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.");
  const row = await c.env.DB.prepare("SELECT id, password_hash, status, status_reason, role, email_verified_at FROM users WHERE email = ?1")
    .bind(email)
    .first<{ id: number; password_hash: string; status: string; status_reason: string | null; role: string; email_verified_at: number | null }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash, c.env))) {
    throw new ApiError(401, "bad_credentials", "이메일 또는 비밀번호가 맞지 않아요.");
  }
  if (row.status === "blocked") {
    throw new ApiError(403, "blocked", `이용이 차단된 계정이에요.${row.status_reason ? ` (${row.status_reason})` : ""}`);
  }
  // 관리자 이메일이라도 인증을 마쳐야 관리자가 된다.
  const verified = row.email_verified_at != null || !verificationRequired(c.env);
  if (row.role !== "admin" && verified && adminEmails(c.env).includes(email)) {
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

account.delete("/me", requireUser, async (c) => {
  const body = await readJson<{ password?: string }>(c);
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(String(body.password ?? ""), row.password_hash, c.env))) {
    throw new ApiError(400, "bad_credentials", "비밀번호가 맞지 않아요.");
  }
  if (user.role === "admin") {
    const admins = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>();
    if ((admins?.n ?? 0) <= 1) {
      throw new ApiError(400, "last_admin", "마지막 관리자는 계정을 지울 수 없어요. 다른 사람을 관리자로 지정한 뒤 지워 주세요.");
    }
  }
  await deleteUserData(c.env, user.id);
  await destroySession(c);
  return c.json({ ok: true });
});

/** 사용자와 그 데이터를 지운다. 쿼리 수가 레시피 수와 상관없이 일정하다(무료 플랜은 요청당 D1 쿼리 50개까지). */
export async function deleteUserData(env: HonoEnv["Bindings"], userId: number) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM recipe_versions WHERE recipe_id IN (SELECT id FROM recipes WHERE user_id = ?1)").bind(userId),
    env.DB.prepare("DELETE FROM recipes WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM pantry WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?1").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
  ]);
  // 아무도 안 쓰는 사진은 지금 지우고, 남은 것은 매일 정리에서 지운다.
  // 다른 사람이 같은 링크를 가져와 공용 캐시로 쓰는 사진은 남겨 둔다.
  await deleteUnusedImagesOf(env, userId);
}

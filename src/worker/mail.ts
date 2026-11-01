// 메일 발송과 메일 링크용 일회용 토큰.
// - gmail:  GMAIL_APP_PASSWORD와 MAIL_FROM(Gmail 주소)이 있으면 Gmail로 보낸다. 도메인이 없어도 된다(하루 약 500통).
// - resend: RESEND_API_KEY와 MAIL_FROM(Resend에서 인증한 도메인 주소)이 있으면 Resend로 보낸다(무료 하루 100통).
// - mock:   로컬 시험용. 보내지 않고 링크를 응답에 담아 화면에 보여 준다.
// - off:    아무것도 없으면 이메일 인증을 하지 않는다(키를 넣기 전에도 앱은 그대로 돌아가게).

import { ApiError, randomId, sha256Hex, type AppEnv, type Ctx } from "./env";
import { addUsage, getUsage, limitAttempts } from "./quota";
import { parseAddress, sendSmtp } from "./smtp";

export type MailMode = "gmail" | "resend" | "mock" | "off";

export function mailMode(env: AppEnv): MailMode {
  if (env.GMAIL_APP_PASSWORD && env.MAIL_FROM) return "gmail";
  if (env.RESEND_API_KEY && env.MAIL_FROM) return "resend";
  if (env.MAIL_MOCK === "1" || env.MAIL_MOCK === "true") return "mock";
  return "off";
}

/** 실제로 보내는 주소(이름 없이). 시험 모드나 꺼져 있으면 "" */
export function mailSender(env: AppEnv): string {
  const mode = mailMode(env);
  return mode === "gmail" || mode === "resend" ? parseAddress(env.MAIL_FROM!).address : "";
}

export function verificationRequired(env: AppEnv): boolean {
  return mailMode(env) !== "off";
}

// Resend 무료는 하루 100통(Gmail은 약 500통). 작은 쪽에 맞춰 넘기 전에 멈춘다.
const DAILY_MAIL_BUDGET = 90;

interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendMail(env: AppEnv, mail: Mail, host: string): Promise<void> {
  const mode = mailMode(env);
  if (mode === "off") throw new ApiError(503, "mail_off", "메일 발송이 설정되지 않았어요. 관리자에게 알려 주세요.");
  const usage = await getUsage(env.DB, 0);
  if ((usage.mail ?? 0) >= DAILY_MAIL_BUDGET) {
    throw new ApiError(429, "mail_budget", "오늘 보낼 수 있는 메일을 모두 보냈어요. 내일 다시 시도해 주세요.");
  }
  await addUsage(env.DB, 0, "mail");
  if (mode === "mock") {
    console.log(`[메일 시험 모드] ${mail.to} — ${mail.subject}`);
    return;
  }
  if (mode === "gmail") {
    const from = parseAddress(env.MAIL_FROM!);
    from.name ||= env.APP_NAME;
    const { connect } = await import("cloudflare:sockets");
    const socket = connect({ hostname: "smtp.gmail.com", port: 465 }, { secureTransport: "on", allowHalfOpen: false });
    try {
      // 구글은 앱 비밀번호를 4자리씩 띄어서 보여 준다. 띄어쓰기는 빼고 쓴다.
      await sendSmtp(socket, { user: from.address, password: env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "") }, { from, ...mail }, { heloHost: host });
    } catch (e) {
      console.error("메일 발송 실패(Gmail)", e instanceof Error ? e.message : String(e));
      throw new ApiError(502, "mail_failed", "메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
    }
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error("메일 발송 실패", res.status, (await res.text()).slice(0, 300));
    throw new ApiError(502, "mail_failed", "메일을 보내지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
  }
}

export function appUrl(c: Ctx): string {
  return (c.env.APP_URL || new URL(c.req.url).origin).replace(/\/$/, "");
}

/* ───────── 일회용 토큰 ───────── */

export type TokenKind = "verify" | "reset";

export async function createEmailToken(db: D1Database, userId: number, kind: TokenKind, ttlMs: number): Promise<string> {
  const token = randomId(32);
  const now = Date.now();
  const writes = [
    db
      .prepare("INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(await sha256Hex(token), userId, kind, now + ttlMs, now),
  ];
  // 비밀번호 재설정은 마지막에 보낸 링크만 쓸 수 있게 한다.
  if (kind === "reset") writes.unshift(db.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND kind = 'reset'").bind(userId));
  await db.batch(writes);
  return token;
}

/** 토큰을 쓰고(지우고) 주인 id를 돌려준다. 없거나 만료됐으면 null */
export async function consumeEmailToken(db: D1Database, token: string, kind: TokenKind): Promise<number | null> {
  if (!token || token.length > 100) return null;
  const row = await db
    .prepare("DELETE FROM email_tokens WHERE token_hash = ?1 AND kind = ?2 AND expires_at > ?3 RETURNING user_id")
    .bind(await sha256Hex(token), kind, Date.now())
    .first<{ user_id: number }>();
  if (row) await db.prepare("DELETE FROM email_tokens WHERE user_id = ?1 AND kind = ?2").bind(row.user_id, kind).run();
  return row?.user_id ?? null;
}

/* ───────── 메일 내용 ───────── */
// 사람이 쓴 메일처럼 짧은 글과 링크만 둔다. 로고 이미지와 큰 버튼은 피싱 메일과 닮아 스팸으로 가기 쉬워서 뺐다.
// 링크는 주소를 그대로 보여 준다(보이는 글자와 실제 주소가 다르면 의심받는다).

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

function compose(subject: string, intro: string[], link: string, outro: string[]): Omit<Mail, "to"> {
  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;
  const href = escapeHtml(link);
  return {
    subject,
    html: `<!doctype html><html lang="ko"><body style="font-size:15px;line-height:1.6">${intro.map(p).join("")}<p><a href="${href}">${href}</a></p>${outro.map(p).join("")}</body></html>`,
    text: [...intro, "", link, "", ...outro].join("\n"),
  };
}

export function verifyMail(name: string, link: string): Omit<Mail, "to"> {
  return compose(
    "[레시퐁] 이메일 인증",
    [`${name}님, 레시퐁에 가입해 주셔서 고마워요.`, "아래 링크를 열면 가입이 끝나요. 링크는 24시간 동안 쓸 수 있어요."],
    link,
    ["직접 가입하지 않았다면 이 메일은 무시해 주세요.", "레시퐁 드림"],
  );
}

export function resetMail(name: string, link: string): Omit<Mail, "to"> {
  return compose(
    "[레시퐁] 비밀번호 재설정",
    [
      `${name}님, 비밀번호를 새로 정하는 링크예요.`,
      "링크를 열어 새 비밀번호를 정하면 다른 기기에서 로그인한 것은 모두 풀려요. 링크는 1시간 동안 쓸 수 있어요.",
    ],
    link,
    ["요청하지 않았다면 이 메일은 무시해 주세요. 비밀번호는 바뀌지 않아요.", "레시퐁 드림"],
  );
}

/* ───────── 보내기 ───────── */

/** 인증 메일을 보낸다. 시험 모드면 링크를 돌려준다. 1분에 1통, 하루 5통까지 */
export async function sendVerification(c: Ctx, user: { id: number; email: string; name: string }): Promise<string | undefined> {
  await limitAttempts(c.env.DB, `mail-verify:${user.id}`, 60 * 1000, 1, "인증 메일은 1분에 한 번 보낼 수 있어요. 잠시 뒤에 다시 눌러 주세요.");
  await limitAttempts(c.env.DB, `mail-verify-day:${user.id}`, 24 * 60 * 60 * 1000, 5, "오늘은 인증 메일을 더 보낼 수 없어요. 내일 다시 시도해 주세요.");
  const token = await createEmailToken(c.env.DB, user.id, "verify", 24 * 60 * 60 * 1000);
  const base = appUrl(c);
  const link = `${base}/verify?token=${token}`;
  await sendMail(c.env, { to: user.email, ...verifyMail(user.name, link) }, new URL(base).hostname);
  return mailMode(c.env) === "mock" ? link : undefined;
}

export async function sendReset(c: Ctx, user: { id: number; email: string; name: string }): Promise<string | undefined> {
  const token = await createEmailToken(c.env.DB, user.id, "reset", 60 * 60 * 1000);
  const base = appUrl(c);
  const link = `${base}/reset?token=${token}`;
  await sendMail(c.env, { to: user.email, ...resetMail(user.name, link) }, new URL(base).hostname);
  return mailMode(c.env) === "mock" ? link : undefined;
}

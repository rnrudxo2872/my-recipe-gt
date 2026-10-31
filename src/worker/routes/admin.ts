// 관리자: 사용자 역할·상태 관리, 초대 코드, 사용량 한도 설정

import { Hono } from "hono";
import type { AdminOverview, AdminUserRow, Role, UserStatus } from "../../shared/api";
import { kstDay } from "../../shared/time";
import { providerStatus } from "../ai/providers";
import { hashPassword, requireAdmin, requireUser, toPublicUser } from "../auth";
import { ApiError, isMock, randomId, readJson, type HonoEnv } from "../env";
import { clearPolicyCache, getPolicy, mergePolicy, setStatus } from "../quota";
import { deleteUserData } from "./account";

export const admin = new Hono<HonoEnv>();
admin.use("*", requireUser, requireAdmin);

admin.get("/overview", async (c) => {
  const db = c.env.DB;
  const day = kstDay();
  const [users, usage, global, events, invites, policy] = await Promise.all([
    db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.status, u.status_reason, u.created_at, u.last_seen_at,
           (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) AS recipe_count
         FROM users u ORDER BY u.last_seen_at DESC NULLS LAST LIMIT 500`,
      )
      .all<Parameters<typeof toPublicUser>[0] & { recipe_count: number }>(),
    db.prepare("SELECT user_id, kind, count FROM usage_daily WHERE day = ?1 AND user_id != 0").bind(day).all<{ user_id: number; kind: string; count: number }>(),
    db.prepare("SELECT kind, count FROM usage_daily WHERE day = ?1 AND user_id = 0").bind(day).all<{ kind: string; count: number }>(),
    db
      .prepare(
        "SELECT e.id, e.user_id, u.name AS user_name, e.kind, e.detail, e.created_at FROM events e LEFT JOIN users u ON u.id = e.user_id ORDER BY e.id DESC LIMIT 50",
      )
      .all<{ id: number; user_id: number | null; user_name: string | null; kind: string; detail: string; created_at: number }>(),
    db
      .prepare("SELECT code, note, max_uses, uses, created_at, expires_at FROM invites ORDER BY created_at DESC LIMIT 50")
      .all<{ code: string; note: string; max_uses: number; uses: number; created_at: number; expires_at: number | null }>(),
    getPolicy(db),
  ]);
  const todayByUser = new Map<number, AdminUserRow["today"]>();
  for (const u of usage.results) {
    const t = todayByUser.get(u.user_id) ?? {};
    (t as Record<string, number>)[u.kind] = u.count;
    todayByUser.set(u.user_id, t);
  }
  const providers = providerStatus(c.env);
  const overview: AdminOverview = {
    users: users.results.map((u) => ({ ...toPublicUser(u), recipeCount: u.recipe_count, today: todayByUser.get(u.id) ?? {} })),
    global: Object.fromEntries(global.results.map((g) => [g.kind, g.count])),
    policy,
    events: events.results.map((e) => ({ id: e.id, userId: e.user_id, userName: e.user_name, kind: e.kind, detail: e.detail, createdAt: e.created_at })),
    invites: invites.results.map((i) => ({ code: i.code, note: i.note, maxUses: i.max_uses, uses: i.uses, createdAt: i.created_at, expiresAt: i.expires_at })),
    providers: {
      ...providers,
      youtubeApi: Boolean(c.env.YOUTUBE_API_KEY),
      instaHelper: Boolean(c.env.INSTA_HELPER_URL),
      turnstile: Boolean(c.env.TURNSTILE_SECRET && c.env.TURNSTILE_SITE_KEY),
      mock: isMock(c.env),
    },
  };
  return c.json(overview);
});

admin.patch("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const me = c.get("user");
  const body = await readJson<{ role?: Role; status?: UserStatus; reason?: string }>(c);
  const target = await c.env.DB.prepare("SELECT id, role FROM users WHERE id = ?1").bind(id).first<{ id: number; role: Role }>();
  if (!target) throw new ApiError(404, "not_found", "사용자를 찾을 수 없어요.");
  if (id === me.id && (body.role && body.role !== "admin")) throw new ApiError(400, "self", "내 관리자 권한은 내가 뺄 수 없어요.");
  if (id === me.id && body.status && body.status !== "active") throw new ApiError(400, "self", "내 계정은 제한하거나 차단할 수 없어요.");
  if (body.role) {
    if (!["admin", "friend", "member"].includes(body.role)) throw new ApiError(400, "bad_role", "알 수 없는 역할이에요.");
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE users SET role = ?1 WHERE id = ?2").bind(body.role, id),
      c.env.DB.prepare("INSERT INTO events (user_id, kind, detail, created_at) VALUES (?1, 'role', ?2, ?3)").bind(id, `관리자: 역할을 ${body.role}(으)로 바꿈`, Date.now()),
    ]);
  }
  if (body.status) {
    if (!["active", "limited", "blocked"].includes(body.status)) throw new ApiError(400, "bad_status", "알 수 없는 상태예요.");
    const reason = body.status === "active" ? null : String(body.reason ?? "").trim().slice(0, 100) || (body.status === "blocked" ? "관리자가 차단" : "관리자가 제한");
    await setStatus(c.env.DB, id, body.status, reason, me.id);
    if (body.status === "active") {
      // 오늘 쌓인 거절 기록을 지워서 바로 다시 자동 제한되지 않게
      await c.env.DB.prepare("DELETE FROM usage_daily WHERE user_id = ?1 AND day = ?2 AND kind = 'denied'").bind(id, kstDay()).run();
    }
  }
  return c.json({ ok: true });
});

admin.post("/users/:id/reset-password", async (c) => {
  const id = Number(c.req.param("id"));
  const temp = randomId(6).replace(/[-_]/g, "x");
  const res = await c.env.DB.prepare("UPDATE users SET password_hash = ?1 WHERE id = ?2").bind(await hashPassword(temp, c.env), id).run();
  if (!res.meta.changes) throw new ApiError(404, "not_found", "사용자를 찾을 수 없어요.");
  await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(id).run();
  return c.json({ password: temp });
});

admin.delete("/users/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (id === c.get("user").id) throw new ApiError(400, "self", "내 계정은 여기서 지울 수 없어요.");
  await deleteUserData(c.env, id);
  return c.json({ ok: true });
});

// 헷갈리는 글자(0/O, 1/I)는 뺀 초대 코드
function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

admin.post("/invites", async (c) => {
  const body = await readJson<{ note?: string; maxUses?: number; expiresDays?: number | null }>(c);
  const code = inviteCode();
  const maxUses = Math.min(100, Math.max(1, Math.round(Number(body.maxUses) || 1)));
  const days = Number(body.expiresDays);
  const expiresAt = Number.isFinite(days) && days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : null;
  await c.env.DB.prepare("INSERT INTO invites (code, note, max_uses, uses, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)")
    .bind(code, String(body.note ?? "").trim().slice(0, 40), maxUses, c.get("user").id, Date.now(), expiresAt)
    .run();
  return c.json({ code });
});

admin.delete("/invites/:code", async (c) => {
  await c.env.DB.prepare("DELETE FROM invites WHERE code = ?1").bind(c.req.param("code")).run();
  return c.json({ ok: true });
});

admin.put("/policy", async (c) => {
  const body = await readJson<{ policy?: unknown }>(c);
  const policy = mergePolicy(body.policy);
  await c.env.DB.prepare("INSERT INTO settings (key, value) VALUES ('policy', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(policy))
    .run();
  clearPolicyCache();
  return c.json({ policy });
});

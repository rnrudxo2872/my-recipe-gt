// 사용량 한도.
// - 지인(friend)과 관리자는 한도 없이 쓴다. 사용량은 기록만 한다.
// - 일반 가입자(member)는 하루 횟수, 분당 횟수, 일반 가입자 전체 몫 안에서 쓴다.
// - 한도 초과로 거절된 요청이 하루에 많이 쌓이면 자동으로 '제한', 더 쌓이면 '차단'한다.

import type { Limits, Policy, QuotaKind } from "../shared/api";
import { kstDay, nextKstMidnight } from "../shared/time";
import { ApiError, type AppEnv, type SessionUser } from "./env";

export const DEFAULT_POLICY: Policy = {
  // 일반 계정은 맛보기 수준으로 둔다(나중에 멤버십으로 늘릴 예정). 지인·관리자는 한도 없음.
  member: { ai: 3, import: 3, video: 3, upload: 20, save: 60, recipes: 300, burstPerMin: 8, videoMaxMinutes: 20 },
  limited: { ai: 1, import: 1, video: 0, upload: 3, save: 10, recipes: 300, burstPerMin: 2, videoMaxMinutes: 0 },
  global: { aiDaily: 900, memberShare: 0.5, videoMinutes: 420, memberVideoShare: 0.4 },
  abuse: { limitAfterDenials: 20, blockAfterDenials: 80 },
};

let policyCache: { value: Policy; at: number } | null = null;

export async function getPolicy(db: D1Database): Promise<Policy> {
  if (policyCache && Date.now() - policyCache.at < 60_000) return policyCache.value;
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'policy'").first<{ value: string }>();
  let value = DEFAULT_POLICY;
  if (row) {
    try {
      value = mergePolicy(JSON.parse(row.value));
    } catch {
      value = DEFAULT_POLICY;
    }
  }
  policyCache = { value, at: Date.now() };
  return value;
}

export function clearPolicyCache() {
  policyCache = null;
}

/** 저장된 설정 일부만 있어도 기본값 위에 덮어서 완전한 정책을 만든다. 숫자가 아닌 값은 버린다. */
export function mergePolicy(input: unknown): Policy {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, Record<string, unknown>>;
  const pick = <T extends object>(base: T, over: Record<string, unknown> | undefined): T => {
    const out = { ...base } as Record<string, number>;
    if (over && typeof over === "object") {
      for (const key of Object.keys(base)) {
        const v = over[key];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
      }
    }
    return out as T;
  };
  return {
    member: pick(DEFAULT_POLICY.member, src.member),
    limited: pick(DEFAULT_POLICY.limited, src.limited),
    global: pick(DEFAULT_POLICY.global, src.global),
    abuse: pick(DEFAULT_POLICY.abuse, src.abuse),
  };
}

export function isUnlimited(user: Pick<SessionUser, "role">): boolean {
  return user.role === "admin" || user.role === "friend";
}

export function limitsFor(user: Pick<SessionUser, "role" | "status">, policy: Policy): Limits | null {
  if (isUnlimited(user)) return null;
  return user.status === "limited" ? policy.limited : policy.member;
}

export async function addUsage(db: D1Database, userId: number, kind: string, amount = 1, day = kstDay()) {
  await db
    .prepare(
      "INSERT INTO usage_daily (day, user_id, kind, count) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(day, user_id, kind) DO UPDATE SET count = count + excluded.count",
    )
    .bind(day, userId, kind, amount)
    .run();
}

export async function getUsage(db: D1Database, userId: number, day = kstDay()): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT kind, count FROM usage_daily WHERE day = ?1 AND user_id = ?2")
    .bind(day, userId)
    .all<{ kind: string; count: number }>();
  const out: Record<string, number> = {};
  for (const r of results) out[r.kind] = r.count;
  return out;
}

/** 짧은 구간 카운터. 구간이 지나면 1부터 다시 센다. */
export async function bump(db: D1Database, key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_buckets (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_buckets.reset_at <= ?3 THEN 1 ELSE rate_buckets.count + 1 END,
         reset_at = CASE WHEN rate_buckets.reset_at <= ?3 THEN ?2 ELSE rate_buckets.reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number; reset_at: number }>();
  return { count: row?.count ?? 1, resetAt: row?.reset_at ?? now + windowMs };
}

/** 로그인·가입 같은 비로그인 요청의 횟수 제한 */
export async function limitAttempts(db: D1Database, key: string, windowMs: number, max: number, message: string) {
  const { count, resetAt } = await bump(db, key, windowMs);
  if (count > max) throw new ApiError(429, "too_many_attempts", message, { resetAt });
}

const KIND_LABEL: Record<QuotaKind, string> = {
  ai: "AI 기능",
  import: "링크 가져오기",
  video: "영상 분석",
  upload: "사진 올리기",
  save: "레시피 저장·수정",
};

// 본인이 너무 많이(quota_exceeded)·너무 빨리(too_fast) 쓴 경우만 자동 제한 횟수에 센다.
// 전체 몫 소진이나 긴 영상처럼 본인 잘못이 아닌 거절은 세지 않는다.
const ABUSE_CODES = new Set(["quota_exceeded", "too_fast"]);

async function deny(env: AppEnv, user: SessionUser, policy: Policy, code: string, message: string, resetAt: number): Promise<never> {
  const db = env.DB;
  if (!ABUSE_CODES.has(code)) throw new ApiError(429, code, message, { resetAt });
  await addUsage(db, user.id, "denied");
  const usage = await getUsage(db, user.id);
  const denied = usage.denied ?? 0;
  if (denied >= policy.abuse.blockAfterDenials && user.status !== "blocked") {
    await setStatus(db, user.id, "blocked", `하루 한도 초과 요청 ${denied}회 (자동 차단)`);
  } else if (denied >= policy.abuse.limitAfterDenials && user.status === "active") {
    await setStatus(db, user.id, "limited", `하루 한도 초과 요청 ${denied}회 (자동 제한)`);
  }
  throw new ApiError(429, code, message, { resetAt });
}

export async function setStatus(db: D1Database, userId: number, status: "active" | "limited" | "blocked", reason: string | null, actor: "auto" | number = "auto") {
  await db.batch([
    db.prepare("UPDATE users SET status = ?1, status_reason = ?2 WHERE id = ?3").bind(status, reason, userId),
    db
      .prepare("INSERT INTO events (user_id, kind, detail, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(userId, `status:${status}`, `${actor === "auto" ? "자동" : "관리자"}: ${reason ?? ""}`.trim(), Date.now()),
  ]);
  if (status === "blocked") await db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId).run();
}

/**
 * 기능을 쓰기 전에 부른다. 한도 안이면 사용량을 1 늘리고, 넘으면 429 오류를 던진다.
 * videoMinutes는 영상 분석에서 영상 길이를 넘긴다.
 */
export async function useQuota(env: AppEnv, user: SessionUser, kind: QuotaKind, opts: { videoMinutes?: number; aiCost?: boolean } = {}) {
  // aiCost: false면 AI를 부르지 않는 사용(캐시에서 가져오기)이라 일반 계정 전체 AI 몫에서 빼지 않는다.
  const aiCost = opts.aiCost !== false;
  const db = env.DB;
  const day = kstDay();
  const resetAt = nextKstMidnight();
  if (isUnlimited(user)) {
    await addUsage(db, user.id, kind, 1, day);
    if (kind === "video") await addUsage(db, 0, "video_min", Math.ceil(opts.videoMinutes ?? 10), day);
    return;
  }
  const policy = await getPolicy(db);
  const limits = limitsFor(user, policy)!;
  const usage = await getUsage(db, user.id, day);
  const used = usage[kind] ?? 0;
  if (used >= limits[kind]) {
    const extra = user.status === "limited" ? " 사용량이 많아 이 계정은 한도가 줄어든 상태예요." : "";
    await deny(env, user, policy, "quota_exceeded", `오늘 ${KIND_LABEL[kind]} 횟수(${limits[kind]}회)를 다 썼어요. 자정에 다시 채워져요.${extra}`, resetAt);
  }

  if (kind === "ai" || kind === "import" || kind === "video") {
    const burst = await bump(db, `burst:${user.id}`, 60_000);
    if (burst.count > limits.burstPerMin) {
      await deny(env, user, policy, "too_fast", "요청이 너무 빨라요. 1분 뒤에 다시 시도해 주세요.", burst.resetAt);
    }
    const global = await getUsage(db, 0, day);
    if (aiCost && (global.ai_member ?? 0) >= Math.floor(policy.global.aiDaily * policy.global.memberShare)) {
      await deny(env, user, policy, "global_exhausted", "오늘 일반 계정에 배정된 무료 AI 사용량이 모두 찼어요. 자정에 다시 열려요.", resetAt);
    }
    if (kind === "video") {
      const minutes = Math.ceil(opts.videoMinutes ?? 10);
      if (minutes > limits.videoMaxMinutes) {
        await deny(
          env,
          user,
          policy,
          "video_too_long",
          limits.videoMaxMinutes > 0
            ? `${limits.videoMaxMinutes}분이 넘는 영상은 분석할 수 없어요. 설명란이나 자막을 붙여넣어 주세요.`
            : "이 계정은 영상 분석을 쓸 수 없어요. 설명란이나 자막을 붙여넣어 주세요.",
          resetAt,
        );
      }
      if ((global.video_min_member ?? 0) + minutes > policy.global.videoMinutes * policy.global.memberVideoShare) {
        await deny(env, user, policy, "global_exhausted", "오늘 영상 분석 무료 사용량이 모두 찼어요. 설명란이나 자막을 붙여넣어 주세요.", resetAt);
      }
    }
  }

  await addUsage(db, user.id, kind, 1, day);
  if ((kind === "ai" || kind === "import") && aiCost) await addUsage(db, 0, "ai_member", 1, day);
  if (kind === "video") {
    const minutes = Math.ceil(opts.videoMinutes ?? 10);
    await addUsage(db, 0, "video_min_member", minutes, day);
    await addUsage(db, 0, "video_min", minutes, day);
  }
}

/** 영상 분석은 설명란 정리가 실패했을 때만 하므로, 미리 한도를 확인만 하고 싶을 때 쓴다. */
export async function canUseVideo(env: AppEnv, user: SessionUser): Promise<boolean> {
  if (isUnlimited(user)) return true;
  const policy = await getPolicy(env.DB);
  const limits = limitsFor(user, policy)!;
  if (limits.video <= 0) return false;
  const usage = await getUsage(env.DB, user.id);
  return (usage.video ?? 0) < limits.video;
}

export async function assertRecipeRoom(env: AppEnv, user: SessionUser) {
  if (isUnlimited(user)) return;
  const policy = await getPolicy(env.DB);
  const limits = limitsFor(user, policy)!;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
  if ((row?.n ?? 0) >= limits.recipes) {
    throw new ApiError(403, "recipe_limit", `레시피는 ${limits.recipes}개까지 저장할 수 있어요. 안 쓰는 레시피를 지운 뒤 다시 시도해 주세요.`);
  }
}

/** AI 엔진별 하루 호출 수 (관리자 화면용) */
export async function recordProviderCall(db: D1Database, provider: string) {
  const day = kstDay();
  await db.batch([
    db
      .prepare(
        "INSERT INTO usage_daily (day, user_id, kind, count) VALUES (?1, 0, ?2, 1) ON CONFLICT(day, user_id, kind) DO UPDATE SET count = count + 1",
      )
      .bind(day, `ai:${provider}`),
    db
      .prepare(
        "INSERT INTO usage_daily (day, user_id, kind, count) VALUES (?1, 0, 'ai_all', 1) ON CONFLICT(day, user_id, kind) DO UPDATE SET count = count + 1",
      )
      .bind(day),
  ]);
}

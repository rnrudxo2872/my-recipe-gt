import type { Context } from "hono";
import type { PublicUser } from "../shared/api";

export interface AppEnv {
  DB: D1Database;
  /** 선택: 사진 저장용 R2. 없으면 D1에 저장 */
  IMAGES?: R2Bucket;
  /** 선택: Workers AI (예비 AI 엔진) */
  AI?: Ai;
  ASSETS: Fetcher;

  APP_NAME: string;
  GEMINI_MODELS: string;
  GROQ_MODEL: string;
  WORKERS_AI_MODEL: string;
  OPENROUTER_MODEL: string;
  TURNSTILE_SITE_KEY: string;
  INSTA_HELPER_URL: string;

  /** 쉼표로 구분한 관리자 이메일 (비밀값). 비워 두면 첫 가입자가 관리자 */
  ADMIN_EMAILS?: string;
  AUTH_PEPPER?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  YOUTUBE_API_KEY?: string;
  TURNSTILE_SECRET?: string;
  INSTA_HELPER_TOKEN?: string;
  AI_MOCK?: string;
}

export interface SessionUser extends PublicUser {
  lastSeenAt: number | null;
}

export type HonoEnv = { Bindings: AppEnv; Variables: { user: SessionUser } };
export type Ctx = Context<HonoEnv>;

export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    public code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function isMock(env: AppEnv): boolean {
  return env.AI_MOCK === "1" || env.AI_MOCK === "true";
}

export function clientIp(c: Ctx): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

export function randomId(bytes = 12): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return base64url(buf);
}

export function base64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function readJson<T = Record<string, unknown>>(c: Ctx): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new ApiError(400, "bad_json", "요청 형식이 올바르지 않아요.");
  }
}

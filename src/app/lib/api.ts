// 서버 API 호출

import type { AdminOverview, AppConfig, ImportEvent, MeResponse, Policy, Role, SubstituteResult, UserStatus } from "../../shared/api";
import type { RecipeContent, RecipeDetail, RecipeSummary, RecipeVersion, SourceType } from "../../shared/recipe";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public resetAt?: number,
  ) {
    super(message);
  }
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "x-recipong": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "인터넷 연결을 확인해 주세요.");
  }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string; resetAt?: number } };
    return new ApiError(res.status, data.error?.code ?? "error", data.error?.message ?? "문제가 생겼어요. 다시 시도해 주세요.", data.error?.resetAt);
  } catch {
    return new ApiError(res.status, "error", "서버에 연결하지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
  }
}

export const api = {
  config: () => request<AppConfig>("GET", "/api/config"),
  me: () => request<{ me: MeResponse | null }>("GET", "/api/me").then((r) => r.me),
  signup: (body: { email: string; password: string; name: string; turnstile?: string; website?: string }) =>
    request<{ ok: true; verifyRequired: boolean; devLink?: string; mailError?: string }>("POST", "/api/auth/signup", body),
  verifyEmail: (token: string) => request<{ ok: true }>("POST", "/api/auth/verify", { token }),
  resendVerification: () => request<{ ok: true; devLink?: string; already?: boolean }>("POST", "/api/auth/verify/resend"),
  changeEmail: (email: string) => request<{ ok: true; devLink?: string }>("POST", "/api/me/email", { email }),
  forgotPassword: (email: string) => request<{ ok: true; devLink?: string }>("POST", "/api/auth/forgot", { email }),
  resetPassword: (token: string, password: string) => request<{ ok: true }>("POST", "/api/auth/reset", { token, password }),
  login: (email: string, password: string) => request<{ ok: true }>("POST", "/api/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout"),
  rename: (name: string) => request<{ ok: true }>("PATCH", "/api/me", { name }),
  changePassword: (current: string, next: string) => request<{ ok: true }>("POST", "/api/me/password", { current, next }),
  deleteAccount: (password: string) => request<{ ok: true }>("DELETE", "/api/me", { password }),

  recipes: () => request<{ recipes: RecipeSummary[] }>("GET", "/api/recipes").then((r) => r.recipes),
  recipe: (id: string) => request<{ recipe: RecipeDetail }>("GET", `/api/recipes/${id}`).then((r) => r.recipe),
  createRecipe: (body: { content: RecipeContent; image?: string | null; sourceType?: SourceType }) => request<{ id: string }>("POST", "/api/recipes", body),
  saveRecipe: (id: string, content: RecipeContent, note: string, kind: RecipeVersion["kind"] = "edit") =>
    request<{ recipe: RecipeDetail }>("PUT", `/api/recipes/${id}`, { content, note, kind }).then((r) => r.recipe),
  patchRecipe: (id: string, body: { favorite?: boolean; image?: string | null }) =>
    request<{ recipe: RecipeDetail }>("PATCH", `/api/recipes/${id}`, body).then((r) => r.recipe),
  deleteRecipe: (id: string) => request<{ ok: true }>("DELETE", `/api/recipes/${id}`),
  versions: (id: string) => request<{ versions: RecipeVersion[] }>("GET", `/api/recipes/${id}/versions`).then((r) => r.versions),
  version: (id: string, vid: number) =>
    request<{ version: RecipeVersion & { content: RecipeContent } }>("GET", `/api/recipes/${id}/versions/${vid}`).then((r) => r.version),
  restoreVersion: (id: string, vid: number) =>
    request<{ recipe: RecipeDetail }>("POST", `/api/recipes/${id}/versions/${vid}/restore`).then((r) => r.recipe),
  substitutes: (id: string, missing: string[]) =>
    request<{ result: SubstituteResult }>("POST", `/api/recipes/${id}/substitutes`, { missing }).then((r) => r.result),
  tweak: (id: string, instruction: string) => request<{ content: RecipeContent; changes: string[] }>("POST", `/api/recipes/${id}/tweak`, { instruction }),

  pantry: () => request<{ items: string[]; staples: boolean }>("GET", "/api/fridge/pantry"),
  savePantry: (items: string[], staples: boolean) => request<{ items: string[]; staples: boolean }>("PUT", "/api/fridge/pantry", { items, staples }),
  matchPantry: (items: string[], staples: boolean) =>
    request<{ matches: { recipe: RecipeSummary; have: string[]; missing: string[]; ratio: number }[] }>("POST", "/api/fridge/match", { items, staples }).then(
      (r) => r.matches,
    ),
  recommend: (items: string[], note: string, staples: boolean) =>
    request<{ recipes: RecipeContent[] }>("POST", "/api/fridge/ai", { items, note, staples }).then((r) => r.recipes),

  uploadImage: async (blob: Blob): Promise<string> => {
    let res: Response;
    try {
      res = await fetch("/api/images", { method: "POST", headers: { "x-recipong": "1", "content-type": blob.type }, body: blob, credentials: "same-origin" });
    } catch {
      throw new ApiError(0, "network", "인터넷 연결을 확인해 주세요.");
    }
    if (!res.ok) throw await toError(res);
    return ((await res.json()) as { url: string }).url;
  },

  admin: {
    overview: () => request<AdminOverview>("GET", "/api/admin/overview"),
    updateUser: (id: number, body: { role?: Role; status?: UserStatus; reason?: string; verified?: boolean }) => request<{ ok: true }>("PATCH", `/api/admin/users/${id}`, body),
    resetPassword: (id: number) => request<{ password: string }>("POST", `/api/admin/users/${id}/reset-password`),
    deleteUser: (id: number) => request<{ ok: true }>("DELETE", `/api/admin/users/${id}`),
    /** 이메일로 권한 바꾸기. 아직 가입 전이면 예약(pending) */
    setRoleByEmail: (email: string, role: Role) =>
      request<{ status: "updated" | "pending"; name?: string; previous?: Role }>("POST", "/api/admin/roles", { email, role }),
    deleteGrant: (email: string) => request<{ ok: true }>("DELETE", `/api/admin/roles/${encodeURIComponent(email)}`),
    savePolicy: (policy: Policy) => request<{ policy: Policy }>("PUT", "/api/admin/policy", { policy }),
  },
};

/** 가져오기: 진행 단계를 하나씩 받아 onEvent로 넘긴다. */
export async function runImport(
  body: { link?: string; text?: string; caption?: string; image?: string; force?: boolean },
  onEvent: (e: ImportEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/import", {
      method: "POST",
      headers: { "x-recipong": "1", "content-type": "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    throw new ApiError(0, "network", "인터넷 연결을 확인해 주세요.");
  }
  if (!res.ok || !res.body) throw await toError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as ImportEvent;
      if (event.type !== "stage") finished = true;
      onEvent(event);
    }
  }
  if (!finished) throw new ApiError(0, "network", "연결이 끊겼어요. 레시피 목록에 저장됐는지 확인해 주세요.");
}

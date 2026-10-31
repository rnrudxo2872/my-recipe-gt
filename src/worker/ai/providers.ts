// AI 엔진 호출. Gemini 모델들을 차례로 시도하고, 모두 막히면 예비 엔진으로 넘어간다.
// 모델마다 무료 한도가 따로 잡혀 있어서 여러 모델을 두면 버틸 수 있는 양이 늘어난다.

import { ApiError, isMock, type AppEnv } from "../env";
import { recordProviderCall } from "../quota";
import { mockResponse } from "./mock";
import type { AiTask } from "./prompts";

class ProviderError extends Error {
  constructor(
    public provider: string,
    public status: number,
    detail: string,
  ) {
    super(`${provider} ${status}: ${detail.slice(0, 300)}`);
  }
}

export function parseJsonLoose(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(s.slice(start, end + 1));
    throw new Error("JSON을 찾을 수 없음");
  }
}

function geminiModels(env: AppEnv): string[] {
  return env.GEMINI_MODELS.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

async function callGemini(env: AppEnv, model: string, task: AiTask, minimal: boolean): Promise<unknown> {
  const hasVideo = task.parts.some((p) => "video" in p);
  const parts = task.parts.map((p) => ("video" in p ? { fileData: { fileUri: p.video } } : { text: p.text }));
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    temperature: task.temperature ?? 0.4,
  };
  if (!minimal) {
    generationConfig.responseJsonSchema = task.schema;
    if (/^gemini-[3-9]/.test(model)) generationConfig.thinkingConfig = { thinkingLevel: "low" };
    if (hasVideo) generationConfig.mediaResolution = "MEDIA_RESOLUTION_LOW";
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: task.system }] },
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
    signal: AbortSignal.timeout(hasVideo ? 150_000 : 60_000),
  });
  if (!res.ok) throw new ProviderError(`gemini:${model}`, res.status, await res.text());
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.filter((p) => !p.thought && p.text)
    .map((p) => p.text)
    .join("");
  if (!text) {
    throw new ProviderError(`gemini:${model}`, 422, data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "빈 응답");
  }
  return parseJsonLoose(text);
}

async function callOpenAiCompatible(name: string, url: string, key: string, model: string, task: AiTask, jsonMode: boolean): Promise<unknown> {
  const text = task.parts.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: task.system },
      { role: "user", content: text },
    ],
    temperature: task.temperature ?? 0.4,
    max_tokens: 4096,
  };
  if (jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new ProviderError(name, res.status, await res.text());
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new ProviderError(name, 422, "빈 응답");
  return parseJsonLoose(content);
}

async function callWorkersAi(env: AppEnv, task: AiTask): Promise<unknown> {
  const text = task.parts.map((p) => ("text" in p ? p.text : "")).join("\n\n");
  const out = (await env.AI!.run(env.WORKERS_AI_MODEL as Parameters<Ai["run"]>[0], {
    messages: [
      { role: "system", content: task.system },
      { role: "user", content: text },
    ],
    max_tokens: 4096,
  } as never)) as { response?: unknown };
  const response = out?.response;
  if (response && typeof response === "object") return response;
  if (typeof response === "string" && response.trim()) return parseJsonLoose(response);
  throw new ProviderError("workers-ai", 422, "빈 응답");
}

export function providerStatus(env: AppEnv) {
  return {
    gemini: Boolean(env.GEMINI_API_KEY),
    groq: Boolean(env.GROQ_API_KEY),
    workersAi: Boolean(env.AI),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
  };
}

export function aiReady(env: AppEnv): boolean {
  const s = providerStatus(env);
  return isMock(env) || s.gemini || s.groq || s.workersAi || s.openrouter;
}

export function videoReady(env: AppEnv): boolean {
  return isMock(env) || Boolean(env.GEMINI_API_KEY);
}

/**
 * AI에게 작업을 맡기고 JSON 결과를 돌려준다.
 * 영상 작업은 Gemini만 할 수 있고, 글 작업은 예비 엔진까지 시도한다.
 */
export async function runAi(env: AppEnv, task: AiTask): Promise<{ data: unknown; provider: string }> {
  if (isMock(env)) {
    await new Promise((r) => setTimeout(r, task.name === "extract_video" ? 1500 : 700));
    await recordProviderCall(env.DB, "mock").catch(() => {});
    return { data: mockResponse(task), provider: "mock" };
  }
  const hasVideo = task.parts.some((p) => "video" in p);
  const attempts: { name: string; run: () => Promise<unknown> }[] = [];
  if (env.GEMINI_API_KEY) {
    for (const model of geminiModels(env)) {
      attempts.push({
        name: `gemini:${model}`,
        run: async () => {
          try {
            return await callGemini(env, model, task, false);
          } catch (e) {
            // 스키마나 설정을 모델이 받아 주지 않으면 최소 설정으로 한 번 더
            if (e instanceof ProviderError && e.status === 400) return callGemini(env, model, task, true);
            throw e;
          }
        },
      });
    }
  }
  if (!hasVideo) {
    if (env.GROQ_API_KEY) {
      attempts.push({
        name: "groq",
        run: () => callOpenAiCompatible("groq", "https://api.groq.com/openai/v1/chat/completions", env.GROQ_API_KEY!, env.GROQ_MODEL, task, true),
      });
    }
    if (env.AI) attempts.push({ name: "workers-ai", run: () => callWorkersAi(env, task) });
    if (env.OPENROUTER_API_KEY) {
      attempts.push({
        name: "openrouter",
        run: () =>
          callOpenAiCompatible("openrouter", "https://openrouter.ai/api/v1/chat/completions", env.OPENROUTER_API_KEY!, env.OPENROUTER_MODEL, task, false),
      });
    }
  }
  if (!attempts.length) {
    throw new ApiError(
      503,
      "ai_not_configured",
      hasVideo ? "영상 분석에 필요한 Gemini 키가 아직 설정되지 않았어요. 설명란이나 자막을 붙여넣어 주세요." : "AI 키가 아직 설정되지 않았어요. 관리자에게 알려 주세요.",
    );
  }
  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const data = await attempt.run();
      await recordProviderCall(env.DB, attempt.name).catch(() => {});
      return { data, provider: attempt.name };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      // 키가 잘못됐거나 권한이 없는 경우도 다음 엔진으로 넘긴다.
    }
  }
  console.error("AI 실패", task.name, errors);
  const quotaHit = errors.some((e) => / 429:/.test(e));
  throw new ApiError(
    503,
    quotaHit ? "ai_quota" : "ai_unavailable",
    quotaHit ? "오늘 무료 AI 사용량이 다 찼어요. 내일 다시 시도해 주세요." : "AI가 지금 응답하지 않아요. 잠시 뒤에 다시 시도해 주세요.",
  );
}

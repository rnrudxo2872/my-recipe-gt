// 요리 종류를 AI로 정한다.
// - 종류 없이 들어온 레시피(웹페이지 정보로 바로 읽은 것, 이 기능 전에 만든 공용 캐시)
// - 이 기능 전에 저장한 레시피(관리 화면에서 한꺼번에)
// 링크를 AI로 정리할 때는 그 요청에서 종류도 함께 받으므로 여기를 거치지 않는다.

import type { Category, RecipeContent } from "../shared/recipe";
import { classifyTask, parseClassified } from "./ai/prompts";
import { runAi } from "./ai/providers";
import type { AppEnv } from "./env";

/** 레시피 하나의 종류. AI가 실패하면 null(관리 화면에서 나중에 다시 정한다) */
export async function classifyContent(env: AppEnv, content: RecipeContent): Promise<Category[] | null> {
  try {
    const { data } = await runAi(env, classifyTask([{ title: content.title, ingredients: content.ingredients.map((i) => i.name) }]));
    return parseClassified(data, 1).get(1) ?? null;
  } catch (e) {
    console.warn("요리 종류 정하기 실패", e instanceof Error ? e.message : e);
    return null;
  }
}

// 제목과 재료 이름만 보내므로 40개를 묶어도 요청이 작다.
const BATCH = 40;

export async function countUncategorized(env: AppEnv): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipes WHERE categories IS NULL").first<{ n: number }>();
  return row?.n ?? 0;
}

/** 종류를 아직 정하지 않은 레시피를 한 묶음 정한다. AI가 빠뜨린 레시피는 그대로 남아 다음 묶음에서 다시 묻는다. */
export async function categorizePending(env: AppEnv): Promise<{ done: number; left: number }> {
  const { results } = await env.DB.prepare("SELECT id, title, ingredient_names FROM recipes WHERE categories IS NULL ORDER BY created_at LIMIT ?1")
    .bind(BATCH)
    .all<{ id: string; title: string; ingredient_names: string }>();
  if (!results.length) return { done: 0, left: 0 };
  const { data } = await runAi(env, classifyTask(results.map((r) => ({ title: r.title, ingredients: r.ingredient_names.split("\n").filter(Boolean) }))));
  const updates = [...parseClassified(data, results.length)].map(([n, categories]) =>
    env.DB.prepare(
      // 레시피 내용(JSON)에도 넣어야 수정 화면이 같은 종류를 보여 주고, 다음 저장 때 지워지지 않는다.
      `UPDATE recipes SET categories = ?1,
         content = CASE WHEN json_valid(content) THEN json_set(content, '$.categories', json(?1)) ELSE content END
       WHERE id = ?2 AND categories IS NULL`,
    ).bind(JSON.stringify(categories), results[n - 1].id),
  );
  if (updates.length) await env.DB.batch(updates);
  return { done: updates.length, left: await countUncategorized(env) };
}

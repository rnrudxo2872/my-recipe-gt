// 레시피와 버전 기록을 DB에 읽고 쓰는 함수들

import { normalizeRecipe, searchTextOf, type RecipeContent, type RecipeDetail, type RecipeSummary, type RecipeVersion, type SourceType } from "../shared/recipe";
import { ApiError, randomId, type AppEnv } from "./env";

export interface RecipeRow {
  id: string;
  user_id: number;
  title: string;
  content: string;
  image: string | null;
  source_type: SourceType;
  source_url: string | null;
  source_key: string | null;
  favorite: number;
  version_count: number;
  time_minutes: number | null;
  servings: number | null;
  tags: string;
  ingredient_names: string;
  created_at: number;
  updated_at: number;
}

const MAX_VERSIONS = 30;

export const SUMMARY_COLUMNS = "id, title, image, source_type, favorite, time_minutes, servings, tags, created_at, updated_at";

export function toSummary(row: Pick<RecipeRow, "id" | "title" | "image" | "source_type" | "favorite" | "time_minutes" | "servings" | "tags" | "created_at" | "updated_at">): RecipeSummary {
  let tags: string[] = [];
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    title: row.title,
    image: row.image,
    sourceType: row.source_type,
    favorite: row.favorite === 1,
    timeMinutes: row.time_minutes,
    servings: row.servings,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDetail(row: RecipeRow): RecipeDetail {
  let content: RecipeContent;
  try {
    content = normalizeRecipe(JSON.parse(row.content));
  } catch {
    content = normalizeRecipe({ title: row.title });
  }
  return { ...toSummary(row), content, sourceUrl: row.source_url, versionCount: row.version_count };
}

function derived(content: RecipeContent) {
  return {
    title: content.title,
    json: JSON.stringify(content),
    time: content.timeMinutes,
    servings: content.servings,
    tags: JSON.stringify(content.tags),
    names: content.ingredients.map((i) => i.name).join("\n"),
    search: searchTextOf(content),
  };
}

export async function getOwnedRecipe(env: AppEnv, userId: number, id: string): Promise<RecipeRow> {
  const row = await env.DB.prepare("SELECT * FROM recipes WHERE id = ?1 AND user_id = ?2").bind(id, userId).first<RecipeRow>();
  if (!row) throw new ApiError(404, "not_found", "레시피를 찾을 수 없어요. 이미 지웠을 수 있어요.");
  return row;
}

export async function createRecipe(
  env: AppEnv,
  userId: number,
  content: RecipeContent,
  opts: { image?: string | null; sourceType: SourceType; sourceUrl?: string | null; sourceKey?: string | null; note?: string },
): Promise<string> {
  const id = randomId(9);
  const now = Date.now();
  const d = derived(content);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO recipes (id, user_id, title, content, image, source_type, source_url, source_key, time_minutes, servings, tags, ingredient_names, search_text, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)`,
    ).bind(id, userId, d.title, d.json, opts.image ?? null, opts.sourceType, opts.sourceUrl ?? null, opts.sourceKey ?? null, d.time, d.servings, d.tags, d.names, d.search, now),
    env.DB.prepare("INSERT INTO recipe_versions (recipe_id, content, note, kind, created_at) VALUES (?1, ?2, ?3, 'original', ?4)").bind(
      id,
      d.json,
      opts.note ?? "원본",
      now,
    ),
  ]);
  return id;
}

export async function saveVersion(env: AppEnv, row: RecipeRow, content: RecipeContent, note: string, kind: RecipeVersion["kind"]) {
  const now = Date.now();
  const d = derived(content);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE recipes SET title = ?1, content = ?2, time_minutes = ?3, servings = ?4, tags = ?5, ingredient_names = ?6, search_text = ?7,
       version_count = version_count + 1, updated_at = ?8 WHERE id = ?9`,
    ).bind(d.title, d.json, d.time, d.servings, d.tags, d.names, d.search, now, row.id),
    env.DB.prepare("INSERT INTO recipe_versions (recipe_id, content, note, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(row.id, d.json, note, kind, now),
    // 원본은 남기고 오래된 버전부터 정리
    env.DB.prepare(
      `DELETE FROM recipe_versions WHERE recipe_id = ?1 AND kind != 'original' AND id NOT IN (
         SELECT id FROM recipe_versions WHERE recipe_id = ?1 ORDER BY id DESC LIMIT ?2)`,
    ).bind(row.id, MAX_VERSIONS),
  ]);
}

export async function listVersions(env: AppEnv, recipeId: string): Promise<RecipeVersion[]> {
  const { results } = await env.DB.prepare("SELECT id, note, kind, created_at FROM recipe_versions WHERE recipe_id = ?1 ORDER BY id DESC")
    .bind(recipeId)
    .all<{ id: number; note: string; kind: RecipeVersion["kind"]; created_at: number }>();
  return results.map((r) => ({ id: r.id, note: r.note, kind: r.kind, createdAt: r.created_at }));
}

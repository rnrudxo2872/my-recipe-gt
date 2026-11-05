// 레시피와 버전 기록을 DB에 읽고 쓰는 함수들

import {
  normalizeCategories,
  normalizeRecipe,
  searchTextOf,
  type Category,
  type RecipeContent,
  type RecipeDetail,
  type RecipeSummary,
  type RecipeVersion,
  type SourceType,
} from "../shared/recipe";
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
  /** 요리 종류 JSON 배열. NULL은 아직 정하지 않음(빈 배열 '[]'은 기타로 정해진 것) */
  categories: string | null;
  created_at: number;
  updated_at: number;
}

// 원본 + 최근 19개. 버전이 쌓여 무료 D1(DB당 500MB)을 채우지 않도록
const MAX_VERSIONS = 20;

export const SUMMARY_COLUMNS = "id, title, image, source_type, categories, favorite, time_minutes, servings, tags, created_at, updated_at";

/** 저장된 요리 종류. 아직 정하지 않았으면 빈 배열(화면에서는 기타) */
export function categoriesOf(row: Pick<RecipeRow, "categories">): Category[] {
  if (!row.categories) return [];
  try {
    return normalizeCategories(JSON.parse(row.categories));
  } catch {
    return [];
  }
}

export function toSummary(
  row: Pick<RecipeRow, "id" | "title" | "image" | "source_type" | "categories" | "favorite" | "time_minutes" | "servings" | "tags" | "created_at" | "updated_at">,
): RecipeSummary {
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
    categories: categoriesOf(row),
    favorite: row.favorite === 1,
    timeMinutes: row.time_minutes,
    servings: row.servings,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toDetail(row: RecipeRow, changeNotes: string[] = []): RecipeDetail {
  let content: RecipeContent;
  try {
    content = normalizeRecipe(JSON.parse(row.content));
  } catch {
    content = normalizeRecipe({ title: row.title });
  }
  const summary = toSummary(row);
  return { ...summary, content: { ...content, categories: summary.categories }, sourceUrl: row.source_url, versionCount: row.version_count, changeNotes };
}

// 메모를 비워 두고 저장하면 붙는 기본 문구. 레시피 화면의 '내가 바꾼 점'에는 띄우지 않는다.
const DEFAULT_NOTES = new Set(["직접 수정", "AI로 맛 조정", "재료 바꿈"]);

/**
 * 원본에서 지금 버전까지 사용자가 남긴 메모(최신 것부터, 같은 문구는 한 번).
 * versions는 최신 순. 되돌린 적이 있으면 그 뒤에 남긴 것만 본다(그 앞 메모는 지금 내용과 맞지 않을 수 있어서).
 */
export function changeNotesOf(versions: { note: string; kind: RecipeVersion["kind"] }[]): string[] {
  const notes: string[] = [];
  for (const v of versions) {
    if (v.kind === "original" || v.kind === "restore") break;
    const note = v.note.trim();
    if (note && !DEFAULT_NOTES.has(note) && !notes.includes(note)) notes.push(note);
  }
  return notes;
}

/** 레시피 화면에 보낼 내용: 레시피 + 지금 버전까지 남긴 메모 */
export async function loadDetail(env: AppEnv, row: RecipeRow): Promise<RecipeDetail> {
  const { results } = await env.DB.prepare("SELECT note, kind FROM recipe_versions WHERE recipe_id = ?1 ORDER BY id DESC LIMIT ?2")
    .bind(row.id, MAX_VERSIONS)
    .all<{ note: string; kind: RecipeVersion["kind"] }>();
  return toDetail(row, changeNotesOf(results));
}

function derived(content: RecipeContent) {
  return {
    title: content.title,
    json: JSON.stringify(content),
    time: content.timeMinutes,
    servings: content.servings,
    tags: JSON.stringify(content.tags),
    categories: JSON.stringify(content.categories),
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
  opts: {
    image?: string | null;
    sourceType: SourceType;
    sourceUrl?: string | null;
    sourceKey?: string | null;
    note?: string;
    /** false면 요리 종류를 아직 못 정한 것으로 저장한다(나중에 관리 화면에서 AI로 정한다). */
    classified?: boolean;
  },
): Promise<string> {
  const id = randomId(9);
  const now = Date.now();
  const d = derived(content);
  const categories = opts.classified === false ? null : d.categories;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO recipes (id, user_id, title, content, image, source_type, source_url, source_key, time_minutes, servings, tags, ingredient_names, search_text, categories, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)`,
    ).bind(
      id,
      userId,
      d.title,
      d.json,
      opts.image ?? null,
      opts.sourceType,
      opts.sourceUrl ?? null,
      opts.sourceKey ?? null,
      d.time,
      d.servings,
      d.tags,
      d.names,
      d.search,
      categories,
      now,
    ),
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
  // 아직 종류를 정하지 않은 레시피를 종류 없이 고쳐 저장하면 '정하지 않음'으로 둔다(관리 화면의 AI 분류가 계속 맡도록).
  const categories = row.categories === null && !content.categories.length ? null : d.categories;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE recipes SET title = ?1, content = ?2, time_minutes = ?3, servings = ?4, tags = ?5, ingredient_names = ?6, search_text = ?7,
       categories = ?8, version_count = version_count + 1, updated_at = ?9 WHERE id = ?10`,
    ).bind(d.title, d.json, d.time, d.servings, d.tags, d.names, d.search, categories, now, row.id),
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

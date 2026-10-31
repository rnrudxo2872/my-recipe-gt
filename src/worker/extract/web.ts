// 일반 레시피 웹페이지. 대부분의 레시피 사이트는 검색엔진용 구조화 데이터(JSON-LD Recipe)를 넣어 두므로
// 그게 있으면 AI 없이 바로 정리하고, 없으면 본문 글을 AI에게 넘긴다.

import { normalizeRecipe, parseIngredientLine, type RecipeContent } from "../../shared/recipe";
import { decodeEntities, htmlToText, metaContent, readLimited } from "./text";
import { parseIsoDuration } from "./youtube";

export interface WebPage {
  recipe: RecipeContent | null;
  title: string;
  text: string;
  image: string | null;
}

type Json = Record<string, unknown>;

function findRecipeNode(node: unknown): Json | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as Json;
  const type = obj["@type"];
  if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return obj;
  if (obj["@graph"]) return findRecipeNode(obj["@graph"]);
  return null;
}

function imageOf(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return imageOf(value[0]);
  if (typeof value === "object") return imageOf((value as Json).url);
  return null;
}

function instructionsOf(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.split(/\n+|(?<=[.다요])\s+(?=\d+\.)/).map(clean).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(instructionsOf);
  if (typeof value === "object") {
    const obj = value as Json;
    if (obj["@type"] === "HowToSection") return instructionsOf(obj.itemListElement);
    return [clean(String(obj.text ?? obj.name ?? ""))].filter(Boolean);
  }
  return [];
}

function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function recipeFromJsonLd(node: Json): RecipeContent {
  const ingredients = Array.isArray(node.recipeIngredient) ? node.recipeIngredient.map((l) => parseIngredientLine(clean(String(l)))) : [];
  const yieldValue = Array.isArray(node.recipeYield) ? node.recipeYield[0] : node.recipeYield;
  const time = typeof node.totalTime === "string" ? parseIsoDuration(node.totalTime) : typeof node.cookTime === "string" ? parseIsoDuration(node.cookTime) : null;
  const keywords = typeof node.keywords === "string" ? node.keywords.split(/[,#]/) : Array.isArray(node.keywords) ? node.keywords : [];
  return normalizeRecipe({
    title: clean(String(node.name ?? "")),
    description: clean(String(node.description ?? "")),
    servings: yieldValue,
    time_minutes: time ? Math.round(time / 60) : null,
    ingredients,
    steps: instructionsOf(node.recipeInstructions),
    tips: [],
    tags: keywords.map((k) => clean(String(k))).filter(Boolean).slice(0, 5),
  });
}

export function parseRecipePage(html: string, baseUrl: string): WebPage {
  let recipe: RecipeContent | null = null;
  let image: string | null = null;
  const scripts = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    try {
      const node = findRecipeNode(JSON.parse(m[1].trim()));
      if (node) {
        recipe = recipeFromJsonLd(node);
        image = imageOf(node.image);
        break;
      }
    } catch {
      // 깨진 JSON-LD는 건너뛴다
    }
  }
  image = image ?? metaContent(html, "og:image");
  if (image) {
    try {
      image = new URL(image, baseUrl).toString();
    } catch {
      image = null;
    }
  }
  const title = metaContent(html, "og:title") ?? clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  return { recipe, title, text: recipe ? "" : htmlToText(html), image };
}

export async function fetchWebPage(url: string): Promise<WebPage | null> {
  try {
    const res = await fetch(url, {
      headers: { "accept-language": "ko-KR,ko;q=0.9", accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = await readLimited(res, 1_500_000);
    return parseRecipePage(html, res.url || url);
  } catch {
    return null;
  }
}

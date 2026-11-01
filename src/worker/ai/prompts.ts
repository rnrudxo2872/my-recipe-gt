// AI에게 보내는 지시문과 응답 형식(JSON Schema)

import type { RecipeContent } from "../../shared/recipe";
import { formatAmount } from "../../shared/recipe";

export type AiPart = { text: string } | { video: string };

export interface AiTask {
  name: "extract" | "extract_video" | "substitute" | "tweak" | "recommend";
  system: string;
  parts: AiPart[];
  schema: Record<string, unknown>;
  temperature?: number;
}

const ingredientSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    qty: { type: ["number", "null"] },
    unit: { type: "string" },
    note: { type: "string" },
    group: { type: "string" },
  },
  required: ["name", "qty", "unit", "note", "group"],
};

const recipeProperties = {
  title: { type: "string" },
  description: { type: "string" },
  servings: { type: ["integer", "null"] },
  time_minutes: { type: ["integer", "null"] },
  difficulty: { type: "string", enum: ["쉬움", "보통", "어려움"] },
  ingredients: { type: "array", items: ingredientSchema },
  steps: { type: "array", items: { type: "string" } },
  tips: { type: "array", items: { type: "string" } },
  tags: { type: "array", items: { type: "string" } },
};
const recipeRequired = ["title", "description", "servings", "time_minutes", "difficulty", "ingredients", "steps", "tips", "tags"];

const recipeSchema = {
  type: "object",
  properties: { is_recipe: { type: "boolean" }, ...recipeProperties },
  required: ["is_recipe", ...recipeRequired],
};

const RECIPE_SHAPE =
  '{"is_recipe":true,"title":"","description":"","servings":2,"time_minutes":20,"difficulty":"쉬움","ingredients":[{"name":"","qty":1,"unit":"","note":"","group":""}],"steps":[""],"tips":[""],"tags":[""]}';

const RECIPE_RULES = `규칙:
- 자료에 있는 내용을 우선해요. 분량이 글·말·자막·화면에 나오면 그대로 옮겨요.
- 분량이 없거나 "적당량", "취향껏"처럼 애매하면, 그 인분에 맞는 보통 양을 숫자로 추정해 qty와 unit에 적고 note 맨 앞에 "추정"이라고 적어요(예: 대파 → qty 0.5, unit "대", note "추정, 송송 썬"). 처음 하는 사람이 바로 따라 할 수 있게 하려는 거예요. 추정할 때는 재료에 맞는 단위를 써요(무·양파·감자 → "개", 고기·생선 → "g" 또는 "마리", 양념 → "큰술").
- unit은 한국어로 적어요: "Tbsp"·"T" → "큰술", "tsp"·"t" → "작은술", "cup" → "컵", "oz"·"lb"는 g으로 바꿔요. 자료가 미국 계량컵(240ml) 기준이면 그 재료의 note에 "미국 계량컵"이라고 적어요.
- 소금·후추·깨·참기름처럼 원래 조금씩 넣는 것만 qty를 null로 하고 unit에 "약간"이라고 적어요.
- "대파, 버터, 후추"처럼 한 줄에 여러 재료가 있으면 따로따로 나눠요. 괄호 속 생략·대체 안내는 note에 짧게 옮겨요(예: "없어도 돼요", "없으면 진간장이나 소금").
- title: 요리 이름만 적어요. 채널명, 이모지, 광고 문구, 해시태그는 빼요. 예: "돼지고기 김치찌개"
- description: 이 요리의 맛과 특징을 한두 문장으로.
- servings: 인분 숫자, 모르면 null. time_minutes: 전체 조리 시간(분), 모르면 null. difficulty: "쉬움", "보통", "어려움" 중 하나.
- ingredients: name은 재료 이름만 짧게("대파", "돼지고기 앞다리살"). qty는 숫자(1/2 → 0.5), unit은 "큰술", "작은술", "컵", "g", "ml", "개", "줌" 같은 단위. 손질법은 크기까지 note에("0.5cm로 송송 썬", "한입 크기로 썬"). 양념장·소스처럼 따로 섞는 묶음은 group에 그 이름("양념장")을, 나머지는 빈 문자열.
- steps: 처음 해 보는 사람도 따라 할 수 있게 써요. 한 단계에 한두 동작만, "~해요" 말투로.
  · 불 세기(약불·중불·센불)와 걸리는 시간(분)을 적어요.
  · 다 됐는지 눈으로 알 수 있는 신호를 함께 적어요. 예: "양파 가장자리가 투명해질 때까지 3분", "국물이 반으로 줄 때까지", "겉면이 노릇해지면 뒤집어요".
  · 자료에 시간이나 신호가 없으면 흔히 쓰는 것을 짧게 보태도 돼요. 번호는 붙이지 마세요.
- tips: 맛을 좌우하는 요령이나 주의할 점. 없으면 빈 배열.
- tags: 3~5개 ("국물요리", "자취요리", "15분", "밑반찬" 같은 것).`;

const EDITOR = "당신은 한국 가정요리 레시피를 정리하는 편집자예요. 답은 반드시 JSON 하나로만 해요.";

export function extractTextTask(input: { sourceLabel: string; title?: string; text: string }): AiTask {
  const header = [`자료 종류: ${input.sourceLabel}`, input.title ? `제목: ${input.title}` : ""].filter(Boolean).join("\n");
  return {
    name: "extract",
    system: `${EDITOR}\n주어진 글에서 레시피를 뽑아 이 형식으로 답해요:\n${RECIPE_SHAPE}\n${RECIPE_RULES}\n- 글이 요리 레시피가 아니거나 재료·순서를 알 수 없으면 is_recipe를 false로 해요.`,
    parts: [{ text: `${header}\n\n${input.text.slice(0, 20000)}` }],
    schema: recipeSchema,
    temperature: 0.2,
  };
}

export function extractVideoTask(input: { url: string; title?: string; description?: string }): AiTask {
  const context = [
    input.title ? `영상 제목: ${input.title}` : "",
    input.description ? `설명란(참고):\n${input.description.slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    name: "extract_video",
    system: `${EDITOR}\n요리 영상을 보고 레시피를 이 형식으로 정리해요:\n${RECIPE_SHAPE}\n${RECIPE_RULES}\n- 화면 자막, 말, 동작에서 재료와 분량, 순서를 찾아요.\n- 요리 영상이 아니면 is_recipe를 false로 해요.`,
    parts: [{ video: input.url }, { text: `${context}\n\n이 영상의 레시피를 정리해 주세요.`.trim() }],
    schema: recipeSchema,
    temperature: 0.2,
  };
}

function recipeBrief(content: RecipeContent): string {
  const ingredients = content.ingredients
    .map((i) => `- ${i.group ? `[${i.group}] ` : ""}${i.name} ${formatAmount(i)}${i.note ? ` (${i.note})` : ""}`.trimEnd())
    .join("\n");
  const steps = content.steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  return `요리: ${content.title}${content.servings ? ` (${content.servings}인분)` : ""}\n재료:\n${ingredients}\n만드는 법:\n${steps}`;
}

export function substituteTask(content: RecipeContent, missing: string[]): AiTask {
  return {
    name: "substitute",
    system: `당신은 집밥 요리 선생님이에요. 레시피에서 집에 없는 재료를 대신할 것을 알려 줘요. 답은 JSON 하나로만 해요.
형식: {"items":[{"missing":"없는 재료 이름","options":[{"name":"대체 재료","qty":1,"unit":"큰술","note":"맛이 어떻게 달라지는지, 넣는 방법"}],"can_skip":false,"skip_note":""}],"tip":""}
규칙:
- 없는 재료마다 대체 재료를 1~3개, 한국 가정집에 흔한 것부터 추천해요.
- qty와 unit은 이 레시피 분량에 맞춘 양이에요. 모르면 qty null.
- note는 한 문장. 맛·식감 차이와 바꿔 넣을 때 조리법이 달라지면 그 내용을 적어요.
- 빼도 괜찮으면 can_skip을 true로 하고 skip_note에 빼면 어떻게 되는지 적어요.
- tip은 전체적으로 한 문장 조언. 없으면 빈 문자열.`,
    parts: [{ text: `${recipeBrief(content)}\n\n집에 없는 재료: ${missing.join(", ")}` }],
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              missing: { type: "string" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, qty: { type: ["number", "null"] }, unit: { type: "string" }, note: { type: "string" } },
                  required: ["name", "qty", "unit", "note"],
                },
              },
              can_skip: { type: "boolean" },
              skip_note: { type: "string" },
            },
            required: ["missing", "options", "can_skip", "skip_note"],
          },
        },
        tip: { type: "string" },
      },
      required: ["items", "tip"],
    },
    temperature: 0.4,
  };
}

export function tweakTask(content: RecipeContent, instruction: string): AiTask {
  return {
    name: "tweak",
    system: `당신은 집밥 요리 선생님이에요. 사용자의 입맛에 맞게 레시피를 고쳐 줘요. 답은 JSON 하나로만 해요.
형식: {"title":"","description":"","servings":2,"time_minutes":20,"difficulty":"쉬움","ingredients":[{"name":"","qty":1,"unit":"","note":"","group":""}],"steps":[""],"tips":[""],"tags":[""],"changes":["바뀐 점"]}
규칙:
- 요청에 필요한 만큼만 바꾸고 나머지 재료, 분량, 순서, 문장은 그대로 둬요.
- 인분을 바꾸라는 요청이면 모든 분량을 비율에 맞게 바꿔요.
- changes에는 바뀐 점을 짧게 적어요. 예: "고춧가루 1큰술 → 2큰술", "청양고추 1개 추가".
- 제목은 요리가 크게 바뀔 때만 고쳐요.
${RECIPE_RULES}`,
    parts: [{ text: `${recipeBrief(content)}\n\n원래 설명: ${content.description}\n원래 팁: ${content.tips.join(" / ")}\n태그: ${content.tags.join(", ")}\n\n요청: ${instruction}` }],
    schema: {
      type: "object",
      properties: { ...recipeProperties, changes: { type: "array", items: { type: "string" } } },
      required: [...recipeRequired, "changes"],
    },
    temperature: 0.5,
  };
}

export function recommendTask(pantry: string[], note: string, assumeStaples: boolean): AiTask {
  return {
    name: "recommend",
    system: `당신은 냉장고 파먹기를 도와주는 집밥 요리 선생님이에요. 가진 재료로 만들 수 있는 요리 3가지를 추천해요. 답은 JSON 하나로만 해요.
형식: {"recipes":[${RECIPE_SHAPE.replace('"is_recipe":true,', "")}]}
규칙:
- 가진 재료를 최대한 쓰고, 더 필요한 재료는 요리마다 2개 이하로 해요.
- ${assumeStaples ? "소금, 후추, 설탕, 간장, 식용유, 참기름, 깨, 식초, 맛술은 집에 있다고 봐요." : "기본 양념도 가진 재료에 없으면 없다고 봐요."}
- 서로 다른 종류의 요리로 골라요(예: 볶음, 국물, 반찬).
- 실제로 맛있게 만들 수 있는 검증된 집밥 위주로 추천해요.
- 직접 짜는 레시피라 분량을 정확한 숫자로 적어요. note에 "추정"이라고 적지 마세요.
- steps는 4~8단계로, 손질부터 그릇에 담기까지 빠짐없이 적어요.
${RECIPE_RULES}`,
    parts: [{ text: `가진 재료: ${pantry.join(", ")}${note ? `\n원하는 것: ${note}` : ""}` }],
    schema: {
      type: "object",
      properties: {
        recipes: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: { type: "object", properties: recipeProperties, required: recipeRequired },
        },
      },
      required: ["recipes"],
    },
    temperature: 0.8,
  };
}

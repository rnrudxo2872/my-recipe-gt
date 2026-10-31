// AI_MOCK=1일 때 쓰는 예시 응답. 키 없이 화면과 흐름을 시험할 수 있다.

import type { AiTask } from "./prompts";

const KIMCHI_FRIED_RICE = {
  is_recipe: true,
  title: "스팸 김치볶음밥",
  description: "잘 익은 김치와 스팸을 버터에 볶아 고소하고 새콤한 한 그릇 요리예요.",
  servings: 2,
  time_minutes: 15,
  difficulty: "쉬움",
  ingredients: [
    { name: "밥", qty: 2, unit: "공기", note: "식은 밥", group: "" },
    { name: "신김치", qty: 1, unit: "컵", note: "잘게 썬", group: "" },
    { name: "스팸", qty: 100, unit: "g", note: "깍둑 썬", group: "" },
    { name: "대파", qty: 0.5, unit: "대", note: "송송 썬", group: "" },
    { name: "달걀", qty: 2, unit: "개", note: "", group: "" },
    { name: "버터", qty: 1, unit: "큰술", note: "", group: "" },
    { name: "고춧가루", qty: 0.5, unit: "큰술", note: "", group: "양념" },
    { name: "간장", qty: 1, unit: "작은술", note: "", group: "양념" },
    { name: "설탕", qty: 0.5, unit: "작은술", note: "김치가 시면", group: "양념" },
    { name: "참기름", qty: null, unit: "약간", note: "", group: "양념" },
  ],
  steps: [
    "팬에 버터를 녹이고 대파를 약불에서 1분 볶아 파기름을 내요.",
    "스팸을 넣고 중불에서 노릇해질 때까지 3분 볶아요.",
    "김치와 고춧가루, 설탕을 넣고 김치가 투명해질 때까지 4분 볶아요.",
    "밥을 넣고 간장을 팬 가장자리에 둘러 눌리듯 2분 볶아요.",
    "불을 끄고 참기름을 두른 뒤 그릇에 담아요.",
    "달걀 프라이를 반숙으로 부쳐 올려요.",
  ],
  tips: ["김치 국물을 한두 숟가락 넣으면 색과 맛이 진해져요.", "밥은 식은 밥을 써야 질척이지 않아요."],
  tags: ["한그릇", "자취요리", "15분"],
};

export function mockResponse(task: AiTask): unknown {
  const prompt = task.parts.map((p) => ("text" in p ? p.text : `[video ${p.video}]`)).join("\n");
  switch (task.name) {
    case "extract":
    case "extract_video": {
      if (/레시피 아님|not a recipe/i.test(prompt)) return { ...KIMCHI_FRIED_RICE, is_recipe: false };
      const title = prompt.match(/제목: (.+)/)?.[1]?.trim();
      return { ...KIMCHI_FRIED_RICE, title: title && title.length < 30 && !/http/.test(title) ? title.replace(/[#|].*$/, "").trim() : KIMCHI_FRIED_RICE.title };
    }
    case "substitute": {
      const missing = prompt.match(/집에 없는 재료: (.+)/)?.[1]?.split(",").map((s) => s.trim()) ?? [];
      return {
        items: missing.map((m) => ({
          missing: m,
          options:
            m.includes("스팸") || m.includes("햄")
              ? [
                  { name: "소시지", qty: 100, unit: "g", note: "짠맛이 덜해서 간장을 조금 더 넣어요.", group: "" },
                  { name: "참치캔", qty: 1, unit: "캔", note: "기름을 빼고 김치와 함께 볶아요.", group: "" },
                ]
              : [
                  { name: `${m} 대신 양파`, qty: 0.5, unit: "개", note: "단맛이 조금 더 나요.", group: "" },
                  { name: "쪽파", qty: 2, unit: "줄기", note: "향이 비슷하고 더 부드러워요.", group: "" },
                ],
          can_skip: !m.includes("밥"),
          skip_note: m.includes("밥") ? "" : "빼면 감칠맛이 조금 줄어요.",
        })),
        tip: "대체 재료는 처음엔 적게 넣고 맛을 보며 늘려요.",
      };
    }
    case "tweak": {
      const request = prompt.match(/요청: (.+)/)?.[1] ?? "";
      return {
        ...KIMCHI_FRIED_RICE,
        ingredients: KIMCHI_FRIED_RICE.ingredients.map((i) => (i.name === "고춧가루" ? { ...i, qty: 1 } : i)).concat([
          { name: "청양고추", qty: 1, unit: "개", note: "다진", group: "" },
        ]),
        changes: [`요청 반영: ${request}`, "고춧가루 ½큰술 → 1큰술", "청양고추 1개 추가"],
      };
    }
    case "recommend": {
      return {
        recipes: [
          { ...KIMCHI_FRIED_RICE },
          {
            ...KIMCHI_FRIED_RICE,
            title: "김치 달걀국",
            description: "김치와 달걀만으로 끓이는 시원한 국이에요.",
            time_minutes: 10,
            ingredients: [
              { name: "신김치", qty: 0.5, unit: "컵", note: "", group: "" },
              { name: "달걀", qty: 2, unit: "개", note: "풀어 둔", group: "" },
              { name: "대파", qty: 0.5, unit: "대", note: "", group: "" },
              { name: "물", qty: 600, unit: "ml", note: "", group: "" },
              { name: "국간장", qty: 1, unit: "큰술", note: "", group: "" },
            ],
            steps: ["물에 김치를 넣고 5분 끓여요.", "국간장으로 간을 해요.", "달걀물을 둘러 넣고 대파를 올려 1분 더 끓여요."],
            tags: ["국물요리", "10분"],
          },
          {
            ...KIMCHI_FRIED_RICE,
            title: "김치전",
            description: "바삭하게 부친 김치전이에요.",
            time_minutes: 20,
            ingredients: [
              { name: "신김치", qty: 1, unit: "컵", note: "", group: "" },
              { name: "부침가루", qty: 1, unit: "컵", note: "", group: "" },
              { name: "물", qty: 150, unit: "ml", note: "", group: "" },
              { name: "식용유", qty: 3, unit: "큰술", note: "", group: "" },
            ],
            steps: ["김치를 잘게 썰어 부침가루, 물과 섞어요.", "기름을 넉넉히 두르고 얇게 펴서 앞뒤로 3분씩 부쳐요."],
            tags: ["전", "간식"],
          },
        ],
      };
    }
  }
}

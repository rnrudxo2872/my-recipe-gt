// 요리 용어 풀이. 레시피 글 속 '송송 썬', '투명해질 때까지' 같은 말을 눌러 뜻을 본다.
// AI를 부르지 않으므로 비용이 들지 않고, 모든 레시피(가져온 것, 직접 쓴 것, 추천받은 것)에 똑같이 쓴다.

export interface CookingTerm {
  /** 시트 제목으로 보여 줄 이름 */
  term: string;
  /** 글에서 찾을 표현들(활용형 포함) */
  patterns: string[];
  explain: string;
  /** 유튜브에서 찾을 말 */
  search: string;
}

export const GLOSSARY: CookingTerm[] = [
  // 썰기
  {
    term: "송송 썰기",
    patterns: ["송송 썰", "송송 썬", "송송썰", "송송썬"],
    explain: "대파·쪽파·고추처럼 가늘고 긴 재료를 0.3~0.5cm 두께로 동그랗게 써는 거예요. 김치는 1cm 안팎으로 잘게 썰면 돼요.",
    search: "대파 송송 썰기",
  },
  {
    term: "어슷썰기",
    patterns: ["어슷썰", "어슷 썰", "어슷하게"],
    explain: "칼을 비스듬히 눕혀 길쭉한 타원 모양으로 써는 거예요. 대파·고추·오이를 찌개나 볶음에 넣을 때 많이 써요.",
    search: "어슷썰기 하는 법",
  },
  {
    term: "깍둑썰기",
    patterns: ["깍둑썰", "깍둑 썰", "깍둑"],
    explain: "사방 1.5~2cm 주사위 모양으로 써는 거예요. 감자·무·스팸을 찌개나 볶음에 넣을 때 써요.",
    search: "깍둑썰기 하는 법",
  },
  {
    term: "채썰기",
    patterns: ["채썰", "채 썰", "채 썬", "채썬"],
    explain: "얇게 저민 것을 겹쳐 놓고 성냥개비처럼 가늘고 길게 써는 거예요. 두께는 0.2~0.3cm 정도예요.",
    search: "채썰기 하는 법",
  },
  {
    term: "다지기",
    patterns: ["다진", "다져", "다지"],
    explain: "칼로 쌀알만 하게 아주 잘게 써는 거예요. 마늘은 칼 옆면으로 눌러 으깬 뒤 다지면 쉬워요.",
    search: "마늘 다지기",
  },
  {
    term: "반달썰기",
    patterns: ["반달썰", "반달 썰", "반달 모양", "반달로"],
    explain: "애호박·당근처럼 둥근 재료를 길이로 반 가른 뒤 0.5cm 두께로 써는 거예요.",
    search: "반달썰기 하는 법",
  },
  {
    term: "나박썰기",
    patterns: ["나박썰", "나박 썰", "나박하게"],
    explain: "무 같은 재료를 사방 2~3cm, 두께 0.3cm 정도의 얇은 네모로 써는 거예요. 맑은 국에 많이 써요.",
    search: "무 나박썰기",
  },
  {
    term: "한입 크기",
    patterns: ["한입 크기", "한 입 크기", "먹기 좋은 크기"],
    explain: "숟가락에 한 번에 올라가는 2~3cm 크기예요.",
    search: "재료 한입 크기 썰기",
  },
  {
    term: "편 썰기",
    patterns: ["편 썰", "편으로 썰", "편썰", "편 썬", "편썬"],
    explain: "마늘·생강 같은 재료를 모양 그대로 0.2cm 정도로 얇고 납작하게 써는 거예요.",
    search: "마늘 편 썰기",
  },
  // 불 세기
  {
    term: "센불",
    patterns: ["센불", "센 불", "강불"],
    explain: "불꽃이 냄비 바닥 전체에 닿을 만큼 세게 켠 불이에요. 물을 끓이거나 재료를 빨리 볶을 때 써요.",
    search: "가스레인지 불 세기 센불 중불 약불",
  },
  {
    term: "중불",
    patterns: ["중불", "중간 불", "중강불"],
    explain: "불꽃 끝이 냄비 바닥에 살짝 닿는 정도예요. 대부분의 볶음과 굽기는 중불이면 돼요.",
    search: "가스레인지 불 세기 센불 중불 약불",
  },
  {
    term: "약불",
    patterns: ["약불", "약한 불", "중약불", "불을 줄"],
    explain: "불꽃이 냄비 바닥에 닿지 않을 만큼 작게 켠 불이에요. 졸이거나, 마늘·양념처럼 타기 쉬운 재료를 볶을 때 써요.",
    search: "가스레인지 불 세기 센불 중불 약불",
  },
  // 익은 정도·신호
  {
    term: "투명해질 때까지",
    patterns: ["투명해질", "투명해지", "투명하게", "투명해"],
    explain: "양파·김치·무처럼 하얗던 부분이 반쯤 비쳐 보이고 숨이 죽어 부드러워진 상태예요. 중불에서 보통 3~5분 걸려요.",
    search: "양파 투명해질 때까지 볶기",
  },
  {
    term: "숨이 죽다",
    patterns: ["숨이 죽", "숨이 살짝 죽", "숨을 죽"],
    explain: "채소가 열이나 소금 때문에 빳빳함이 없어지고 부피가 줄어 부드럽게 휘는 상태예요.",
    search: "채소 숨이 죽을 때까지",
  },
  {
    term: "노릇하게",
    patterns: ["노릇노릇", "노릇하", "노릇해", "노릇"],
    explain: "겉면이 연한 갈색으로 익어 고소한 냄새가 나는 상태예요. 너무 진한 갈색이 되기 전에 뒤집어요.",
    search: "노릇하게 굽기",
  },
  {
    term: "한소끔 끓이기",
    patterns: ["한소끔"],
    explain: "부글부글 한 번 끓어오를 때까지 끓이는 거예요. 끓기 시작하면 1분 안쪽으로 더 두면 돼요.",
    search: "한소끔 끓이기 뜻",
  },
  {
    term: "자작하게",
    patterns: ["자작하", "자작자작"],
    explain: "국물이 재료에 겨우 잠길 만큼 적은 상태예요. 국물이 많으면 뚜껑을 열고 더 졸여요.",
    search: "자작하게 졸이기",
  },
  {
    term: "반숙",
    patterns: ["반숙"],
    explain: "흰자는 익고 노른자는 흐를 만큼 덜 익힌 상태예요. 달걀 프라이는 중약불에서 2~3분, 삶은 달걀은 끓는 물에서 6~7분이에요.",
    search: "반숙 달걀 프라이",
  },
  {
    term: "한 김 식히기",
    patterns: ["한 김 식", "한김 식"],
    explain: "뜨거운 김이 한 번 빠질 만큼 1~2분만 식히는 거예요.",
    search: "한 김 식히기 뜻",
  },
  // 손질·조리법
  {
    term: "파기름",
    patterns: ["파기름", "파 기름"],
    explain: "기름에 송송 썬 파를 약불~중불로 볶아 파 향을 낸 기름이에요. 파 가장자리가 노릇해지면 다 된 거예요.",
    search: "파기름 내는 법",
  },
  {
    term: "데치기",
    patterns: ["데쳐", "데친", "데치"],
    explain: "끓는 물에 재료를 30초~1분 정도 잠깐 넣었다가 건지는 거예요. 시금치 같은 잎채소는 데친 뒤 찬물에 헹궈요.",
    search: "시금치 데치기",
  },
  {
    term: "졸이기",
    patterns: ["졸여", "졸이", "졸인"],
    explain: "국물이 줄어들 때까지 끓여 맛을 진하게 만드는 거예요. 바닥이 눌어붙지 않게 가끔 저어요.",
    search: "조림 졸이기",
  },
  {
    term: "밑간",
    patterns: ["밑간"],
    explain: "조리하기 전에 소금·후추·간장 같은 것으로 재료에 미리 간을 해 두는 거예요.",
    search: "고기 밑간 하는 법",
  },
  {
    term: "재우기",
    patterns: ["재워", "재운"],
    explain: "고기나 생선을 양념에 담가 맛이 배게 두는 거예요. 보통 30분 이상, 냉장고에서요.",
    search: "고기 양념 재우기",
  },
  {
    term: "불리기",
    patterns: ["불린", "불려", "불리"],
    explain: "마른 재료를 물에 담가 부드럽게 만드는 거예요. 당면은 30분, 마른미역은 10분, 쌀은 30분 정도예요.",
    search: "당면 불리기",
  },
  {
    term: "체에 밭치기",
    patterns: ["체에 밭", "체에 걸러", "체에 받"],
    explain: "체 위에 부어 물기만 빠지게 두는 거예요. 물이 거의 안 떨어질 때까지 두면 돼요.",
    search: "체에 밭쳐 물기 빼기",
  },
  {
    term: "거품 걷기",
    patterns: ["거품을 걷", "거품을 건져", "거품 걷"],
    explain: "끓을 때 위에 뜨는 회색 거품을 숟가락으로 떠내는 거예요. 국물이 맑고 깔끔해져요.",
    search: "국물 거품 걷어내기",
  },
  {
    term: "간 보기",
    patterns: ["간을 보", "간을 맞", "간 보"],
    explain: "국물이나 양념을 조금 맛보고 싱거우면 소금·간장을, 짜면 물을 조금씩 더하는 거예요.",
    search: "국 간 맞추는 법",
  },
];

export interface TextPart {
  text: string;
  term?: CookingTerm;
}

// 긴 표현부터 맞춰야 '중약불'이 '약불'로 잘리지 않는다.
const ENTRIES = GLOSSARY.flatMap((t) => t.patterns.map((p) => ({ p, t }))).sort((a, b) => b.p.length - a.p.length);
const RE = new RegExp(ENTRIES.map((e) => e.p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");

/** 글을 용어 조각으로 나눈다. 같은 용어는 글마다 처음 한 번만 표시한다. */
export function splitTerms(text: string): TextPart[] {
  const out: TextPart[] = [];
  const seen = new Set<CookingTerm>();
  let last = 0;
  for (const m of text.matchAll(RE)) {
    const term = ENTRIES.find((e) => e.p === m[0])!.t;
    if (seen.has(term)) continue;
    seen.add(term);
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], term });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** 유튜브 검색 결과 주소(검색이라 없는 영상을 가리킬 일이 없다) */
export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

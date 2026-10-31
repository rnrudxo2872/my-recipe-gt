// 화면 문구 도우미

/** 마지막 글자에 받침이 있는지. 한글이 아니면 숫자·영문 읽는 법을 대략 따른다. */
function finalConsonant(word: string): "none" | "rieul" | "other" {
  const last = word.trim().slice(-1);
  if (!last) return "none";
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    if (jong === 0) return "none";
    return jong === 8 ? "rieul" : "other";
  }
  if (/[013678]/.test(last)) return /[178]/.test(last) ? "rieul" : "other";
  if (/[lmnr]/i.test(last)) return /[lr]/i.test(last) ? "rieul" : "other";
  return "none";
}

const JOSA_PAIRS: [string, string][] = [
  ["을", "를"],
  ["이", "가"],
  ["은", "는"],
  ["과", "와"],
  ["이랑", "랑"],
];

/** 단어 뒤 조사를 받침에 맞춘다. josa('소시지', '을') → '를' */
export function josa(word: string, particle: string): string {
  const fc = finalConsonant(word);
  if (particle === "으로" || particle === "로") return fc === "other" ? "으로" : "로";
  for (const [withBatchim, without] of JOSA_PAIRS) {
    if (particle === withBatchim || particle === without) return fc === "none" ? without : withBatchim;
  }
  return particle;
}

/** 문장 속 재료 이름을 바꾸고 바로 뒤 조사도 맞춘다. '스팸을 넣고' → '소시지를 넣고' */
export function replaceIngredientName(text: string, from: string, to: string): string {
  if (!from || from === to) return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`${escaped}(이랑|으로|을|를|이|가|은|는|과|와|랑|로)?`, "g"), (_, p: string | undefined) => (p ? `${to}${josa(to, p)}` : to));
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours()}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ""}`;
}

// 글이 레시피처럼 보이는지 AI 없이 가늠하고, 웹페이지 HTML을 다룬다.

const AMOUNT_HINT =
  /(\d+(?:\.\d+)?|\d+\/\d+|[½⅓¼¾]|반|한|두|세)\s*(?:kg|g|ml|mL|L|cc|컵|큰술|작은술|스푼|숟가락|티스푼|T\b|t\b|개|알|장|쪽|대|줄기|마리|모|봉지|팩|캔|꼬집|줌|토막|공기)/g;
const RECIPE_WORDS = /(재료|양념|만드는\s*법|레시피|조리|순서|분량|인분)/g;

/** 설명란이나 캡션에 레시피가 들어 있을 가능성. 분량 표현이 4개 이상이거나 재료/만드는 법 표시가 있으면 true */
export function looksLikeRecipe(text: string): boolean {
  if (!text || text.length < 40) return false;
  const amounts = text.match(AMOUNT_HINT)?.length ?? 0;
  const words = text.match(RECIPE_WORDS)?.length ?? 0;
  return amounts >= 4 || (amounts >= 2 && words >= 1);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : null;
}

/** 본문 글만 남긴다. 스크립트, 스타일, 메뉴는 버린다. */
export function htmlToText(html: string, max = 15000): string {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .join("\n")
    .slice(0, max);
}

/** fetch 응답을 최대 maxBytes까지만 읽는다. 큰 페이지 때문에 CPU를 낭비하지 않도록 */
export async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

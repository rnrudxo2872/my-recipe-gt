const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 한국 시간 기준 날짜 'YYYY-MM-DD'. 사용량 한도는 이 날짜로 끊는다. */
export function kstDay(now: number = Date.now()): string {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 다음 한국 시간 자정(밀리초) */
export function nextKstMidnight(now: number = Date.now()): number {
  const shifted = now + KST_OFFSET_MS;
  const dayStart = shifted - (shifted % (24 * 60 * 60 * 1000));
  return dayStart + 24 * 60 * 60 * 1000 - KST_OFFSET_MS;
}

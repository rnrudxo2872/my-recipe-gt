#!/data/data/com.termux/files/usr/bin/sh
# 레시퐁 인스타 도우미 재시작 루프. 도우미가 죽으면 10초 뒤 다시 띄운다.
# 직접 실행하지 말고 start.sh로 띄운다(tmux 세션 'recipong' 안에서 돈다).
export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/helper.log"
mkdir -p "$DIR/logs"
cd "$DIR" || exit 1
while true; do
  # 로그가 1MB를 넘으면 하나만 남기고 넘긴다
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then mv -f "$LOG" "$LOG.1"; fi
  node --env-file="$DIR/.env" "$DIR/insta-helper.mjs" >> "$LOG" 2>&1
  echo "$(date '+%m-%d %H:%M:%S') 도우미 종료(코드 $?) — 10초 뒤 다시 띄움" >> "$LOG"
  sleep 10
done

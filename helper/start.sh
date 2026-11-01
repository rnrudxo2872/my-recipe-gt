#!/data/data/com.termux/files/usr/bin/sh
# 레시퐁 인스타 도우미 기동 (Termux 네이티브) — 멱등. 이미 떠 있으면 건드리지 않는다.
#
# 부팅 자동시작: ~/.termux/boot/start.sh 맨 끝에 한 줄 — sh ~/recipong-helper/start.sh
# Termux:Boot 컨텍스트는 PATH가 최소라 아래 export가 없으면 tmux/node를 못 찾는다.
export PATH="${PREFIX:-/data/data/com.termux/files/usr}/bin:$PATH"
termux-wake-lock 2>/dev/null

DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$DIR/.env" ]; then
  echo "[recipong-helper] .env 가 없습니다 — 기동하지 않습니다. (README의 설치 순서 참고)"
  exit 0
fi
mkdir -p "$DIR/logs" "$DIR/bin"

# 터널은 'rp-tunnel'이라는 이름(cloudflared를 가리키는 링크)으로 띄운다.
# 작업장(workshop-start.sh)은 이름에 'cloudflared'가 들어간 프로세스를 전부 자기 터널로 보고
# 살아 있다고 판단하거나 한꺼번에 끈다. 이름을 달리해서 서로 간섭하지 않게 한다.
CF="$(command -v cloudflared)"
if [ -z "$CF" ]; then
  echo "[recipong-helper] cloudflared 없음 — 폰에서: pkg install cloudflared"
elif [ ! -e "$DIR/bin/rp-tunnel" ]; then
  ln -s "$CF" "$DIR/bin/rp-tunnel"
fi

if tmux has-session -t recipong 2>/dev/null && pgrep -f "[r]ecipong-helper/run-loop.sh" >/dev/null 2>&1; then
  echo "[recipong-helper] 이미 실행 중 — 변경 없음 (재시작: tmux kill-session -t recipong 먼저)"
else
  tmux kill-session -t recipong 2>/dev/null
  # ⚠️ 순서: 재시작 루프를 먼저 끈다 — node만 끄면 10초 뒤 되살아난다.
  for p in $(pgrep -f "[r]ecipong-helper/run-loop.sh"); do kill "$p" 2>/dev/null; done
  for p in $(pgrep -f "[r]ecipong-helper/insta-helper.mjs"); do kill "$p" 2>/dev/null; done
  sleep 1
  tmux new-session -d -s recipong "sh $DIR/run-loop.sh"
  echo "[recipong-helper] 기동 — 로그: tail -f $DIR/logs/helper.log"
fi

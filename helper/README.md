# 폰서버 인스타 도우미

인스타그램은 Cloudflare 같은 데이터센터에서 오는 요청을 `facebook.com/unsupportedbrowser`로 돌려보냅니다. 그래서 레시퐁 서버는 인스타 캡션을 직접 읽지 못합니다. 집 인터넷에 있는 폰은 공개 게시물 페이지를 그대로 받으므로, 폰이 **미리보기 정보(캡션·썸네일)만** 대신 읽어 레시퐁에 넘겨 줍니다.

- 로그인·영상 없이 공개 게시물 페이지 하나만 읽습니다. 요청 1건에 1초 안팎입니다.
- 한 번에 1건만 처리하고 같은 게시물은 6시간 기억합니다. 다른 서버가 돌고 있는 폰에도 부담이 작습니다.
- Node 20 이상만 있으면 됩니다. 설치할 패키지가 없습니다.
- cloudflared **임시 터널**을 도우미가 직접 띄우고, 주소가 정해지면 레시퐁에 알립니다(10분마다 다시 알림). 폰이 재부팅해서 주소가 바뀌어도 재배포할 필요가 없습니다. 터널이 죽거나 바깥에서 안 열리면 새로 엽니다.
- 폰이 꺼져 있어도 레시퐁은 계속 돌아갑니다. 30분 넘게 소식이 없으면 레시퐁이 도우미를 꺼진 것으로 보고, 인스타 링크는 "캡션 붙여넣기" 화면으로 넘어갑니다.

| 파일 | 하는 일 |
| --- | --- |
| `insta-helper.mjs` | 도우미 본체(127.0.0.1에서만 받음) + 임시 터널 관리 + 레시퐁에 주소 알리기 |
| `run-loop.sh` | 도우미가 죽으면 10초 뒤 다시 띄움. 로그는 `logs/helper.log`(1MB 넘으면 넘김) |
| `start.sh` | tmux 세션 `recipong`으로 띄움(멱등). 부팅 훅에서 부름 |

## 1. 폰(Termux)에 올리기

```sh
pkg install nodejs-lts cloudflared tmux
mkdir -p ~/recipong-helper
```

PC에서 파일을 복사합니다(폰 SSH 주소는 환경에 맞게).

```sh
scp -P 8022 helper/insta-helper.mjs helper/run-loop.sh helper/start.sh 폰계정@폰IP:~/recipong-helper/
```

## 2. 토큰 정하기

긴 랜덤 문자열 하나를 레시퐁 비밀값과 폰 설정에 똑같이 넣습니다.

```sh
# PC, 레시퐁 폴더에서
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put INSTA_HELPER_TOKEN
```

폰의 `~/recipong-helper/.env`:

```sh
INSTA_HELPER_TOKEN=위에서-만든-토큰
APP_URL=https://recipong.sest.workers.dev
PORT=8790
TUNNEL=quick
```

`chmod 600 ~/recipong-helper/.env` 로 다른 앱이 못 읽게 해 둡니다.

## 3. 켜기와 부팅 자동시작

```sh
sh ~/recipong-helper/start.sh
tail -f ~/recipong-helper/logs/helper.log   # "터널 주소: https://….trycloudflare.com" 이 보이면 정상
```

부팅할 때 같이 켜려면 `~/.termux/boot/start.sh` 맨 끝에 한 줄을 넣습니다(Termux:Boot 앱 필요).

```sh
sh ~/recipong-helper/start.sh
```

관리 → 사용량·한도 → 연결 상태에서 "폰서버 인스타 도우미"가 **연결됨**이면 끝입니다.

## 고정 주소를 쓰고 싶다면

Cloudflare에 도메인이 있으면 이름 붙은 터널(named tunnel)로 고정 주소를 만들 수 있습니다. 그때는 폰 `.env`에 `TUNNEL=off`를 넣고, 레시퐁 `wrangler.jsonc`의 `vars`에 `"INSTA_HELPER_URL": "https://insta.내도메인.com"`을 넣어 배포합니다. 고정 주소가 있으면 레시퐁은 알려 온 주소보다 그걸 먼저 씁니다.

## 문제가 생기면

- `tmux attach -t recipong` 또는 `tail -50 ~/recipong-helper/logs/helper.log`로 로그를 봅니다.
- 다시 켜기: `tmux kill-session -t recipong; sh ~/recipong-helper/start.sh`
- 로그에 `인스타가 다른 곳으로 보냄`이나 `미리보기 정보 없음`이 자주 보이면 인스타가 집 인터넷도 막기 시작한 것입니다. 그때는 앱에서 캡션 붙여넣기로 씁니다.
- 레시퐁에 알리기가 `401`이면 폰 `.env`의 토큰과 레시퐁 비밀값 `INSTA_HELPER_TOKEN`이 다른 것입니다.
- 터널 프로세스 이름은 `rp-tunnel`(cloudflared를 가리키는 링크)입니다. 같은 폰의 다른 서비스가 `cloudflared`라는 이름으로 프로세스를 찾아 끄거나 세는 경우가 있어서, 서로 간섭하지 않게 이름을 다르게 했습니다.

# 폰서버 인스타 도우미

인스타그램은 공식 API가 없고 클라우드 서버 IP를 자주 막습니다. 그래서 집에 있는 안드로이드 폰(A34)이 **캡션 글자만** 대신 읽어 레시퐁에 넘겨 줍니다.

- 영상은 받지 않고 캡션과 썸네일 주소만 조회합니다. 요청 1건에 몇 초면 끝납니다.
- 한 번에 1건만 처리하고 같은 게시물은 6시간 동안 기억해 둡니다. 이미 다른 서버가 돌고 있는 폰에도 부담이 작습니다.
- 폰이 꺼져 있어도 레시퐁은 계속 돌아갑니다. 그동안 인스타 링크는 "캡션 붙여넣기" 화면으로 바뀝니다.

## 1. Termux에 설치

```sh
pkg update
pkg install python cloudflared
pip install -U yt-dlp
termux-wake-lock   # 화면이 꺼져도 Termux가 잠들지 않게
```

안드로이드 설정 → 애플리케이션 → Termux → 배터리 → **제한 없음**으로 바꿔 두세요. 배터리 최적화가 Termux를 끄면 도우미와 터널도 같이 꺼집니다.

## 2. 도우미 실행

```sh
python insta_helper.py --port 8790 --token 아주-긴-랜덤-문자열
```

토큰은 레시퐁의 `INSTA_HELPER_TOKEN` 비밀값과 같아야 합니다.

## 3. 바깥에서 들어올 수 있게 터널 열기

이미 폰서버에서 Cloudflare Tunnel을 쓰고 있다면, 그 터널 설정(ingress)에 한 줄을 추가하는 것이 가장 깔끔합니다.

```yaml
ingress:
  - hostname: insta.내도메인.com
    service: http://localhost:8790
  # ...기존 서버 설정
```

도메인이 없다면 임시 터널로도 됩니다. 다만 다시 켤 때마다 주소가 바뀝니다.

```sh
cloudflared tunnel --url http://localhost:8790
# 출력되는 https://xxxx.trycloudflare.com 주소를 아래 INSTA_HELPER_URL에 넣기
```

## 4. 레시퐁에 연결

`wrangler.jsonc`의 `vars`에 주소를 넣습니다.

```jsonc
"INSTA_HELPER_URL": "https://insta.내도메인.com"
```

토큰은 비밀값으로 넣습니다.

```sh
npx wrangler secret put INSTA_HELPER_TOKEN
npm run deploy
```

관리 → 사용량·한도 → 연결 상태에서 "폰서버 인스타 도우미"가 **연결됨**으로 보이면 끝입니다.

## 문제가 생기면

- 캡션을 못 가져오고 `login required` 오류가 나는 게시물은 인스타가 로그인을 요구하는 경우입니다. 이때는 앱에서 캡션 붙여넣기로 쓰면 됩니다. 꼭 자동으로 받아야 한다면 `--cookies`로 쿠키 파일을 줄 수 있습니다. 다만 계정이 제한될 위험이 있으니 개인 계정은 쓰지 마세요.
- yt-dlp는 인스타 변경에 맞춰 자주 업데이트됩니다. 안 되면 먼저 `pip install -U yt-dlp`를 해 보세요.

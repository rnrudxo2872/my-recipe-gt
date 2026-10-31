# 레시피GT

유튜브·인스타 요리 링크를 **사진 한 장 + 재료 + 순서**로 정리해 두는 지인용 레시피 웹앱입니다. 운영비 0원을 목표로 Cloudflare 무료 플랜과 Gemini 무료 티어 위에서 돌아갑니다.

<img src="public/icons/icon-192.png" width="96" alt="">

## 할 수 있는 일

| 기능 | 설명 |
|---|---|
| 사진 + 레시피 | 사진을 맨 위에, 설명과 재료, 만드는 법, 팁을 그 아래에 보여 줍니다. 사진은 직접 찍어 바꿀 수 있습니다. |
| 링크로 정리 | 유튜브는 설명란을 먼저 보고, 레시피가 없으면 Gemini가 영상을 직접 봅니다. 인스타는 캡션, 일반 레시피 사이트는 구조화 데이터(JSON-LD)나 본문을 읽습니다. 글을 붙여넣어도 됩니다. |
| 없는 재료 대체 | 재료를 눌러 "없음"으로 표시하면 대체 재료와 양을 추천합니다. 고른 대로 새 버전에 반영합니다. |
| 냉장고 파먹기 | 남은 재료를 넣으면 내 레시피 중 바로 만들 수 있는 것부터 보여 줍니다(AI 안 씀). 원하면 AI가 새 요리 3가지를 추천합니다. |
| 내 입맛 버전 | "더 맵게", "덜 짜게"처럼 AI로 고치거나 직접 수정합니다. 원본은 남고 버전 기록에서 언제든 되돌릴 수 있습니다. |
| 요리 모드 | 큰 글씨로 한 단계씩 보여 주고, 화면 꺼짐을 막고, 단계 속 시간으로 타이머를 켭니다. |
| 앱 설치·공유하기 | 휴대폰에 설치(PWA)하면 유튜브·인스타 앱의 "공유하기"로 링크를 바로 보낼 수 있습니다. |

## 가입과 사용량

- 누구나 이메일로 가입할 수 있습니다.
- **지인**(초대 코드로 가입하거나 관리자가 지정)과 **관리자**는 사용량 제한이 없습니다.
- **일반 계정**은 하루 횟수가 정해져 있습니다. 기본값은 링크 가져오기 8회, AI 기능 15회, 영상 분석 3회, 사진 20장이고, AI 요청은 1분에 8회까지입니다.
- 일반 계정들이 함께 쓸 수 있는 AI 몫은 하루 예산의 50%입니다. 나머지는 지인 몫으로 남겨 둡니다.
- 한도를 넘어 거절된 요청이 하루 20번 쌓이면 자동으로 **제한**(한도 대폭 축소), 80번이면 **차단**합니다.
- 가입은 IP당 하루 5번, 로그인 시도는 15분에 10번까지입니다. 봇이 채우는 숨은 칸이 있고, 원하면 Cloudflare Turnstile도 켤 수 있습니다.
- 위 숫자는 모두 **관리 → 사용량·한도**에서 바꿀 수 있습니다.

## 구조

```
[휴대폰 브라우저 / 설치한 앱]
        │
        ▼
Cloudflare Worker (하나로 화면 + API)
  ├─ D1: 사용자, 레시피, 버전 기록, 분석 캐시, 사진(base64)
  ├─ AI: Gemini 3.8 Flash → 3.5 Flash-Lite → 3.1 Flash-Lite → Groq → Workers AI → OpenRouter
  │      (모델마다 무료 한도가 따로라 차례로 넘어감, 영상 분석은 Gemini만)
  ├─ 같은 링크는 한 번만 분석하고 모든 사용자가 결과를 함께 씀
  └─ 인스타 링크 → (선택) 폰서버 도우미 → 캡션
```

- 사진은 기본으로 D1에 저장합니다. R2는 활성화할 때 카드 등록을 요구해서 기본값에서 뺐습니다. `wrangler.jsonc`의 R2 주석을 풀면 R2를 씁니다.
- 사진은 폰에서 1280px, 1MB 이하로 줄여서 올립니다. 무료 Worker는 요청당 CPU가 10ms라서 서버에서 줄이지 않습니다.
- 비밀번호는 PBKDF2(2만 회)와 서버 비밀값(pepper)으로 저장합니다. 무료 플랜 CPU 한도 안에 들어가는 강도입니다.

## 로컬에서 실행

```sh
npm install
cp .dev.vars.example .dev.vars        # AI_MOCK=1이면 키 없이 예시 응답으로 화면을 볼 수 있어요
npm run db:migrate:local
npm run dev                            # http://localhost:5173
```

실제 AI로 시험하려면 `.dev.vars`에 `GEMINI_API_KEY`를 넣고 `AI_MOCK=0`으로 바꿉니다.

점검:

```sh
npm test            # 레시피 정리·링크 판별·재료 매칭 등 단위 테스트
npm run typecheck
npm run smoke       # 개발 서버를 켠 상태에서 가입부터 한도·차단까지 전체 흐름 점검 (AI_MOCK=1 필요)
```

## 배포

처음 한 번:

```sh
npx wrangler login
npm run setup -- --admin 내이메일@example.com --gemini 내-Gemini-키
```

`setup`이 하는 일은 다음과 같습니다. 다시 실행해도 이미 있는 것은 건드리지 않습니다.

1. D1 데이터베이스를 만들고 `wrangler.jsonc`에 ID를 적습니다.
2. 빌드하고, 표를 만들고, 배포합니다.
3. `AUTH_PEPPER`를 자동으로 만들고, 넘겨받은 키들을 비밀값으로 넣습니다.

그다음부터는 `npm run deploy`만 하면 됩니다.

### GitHub에 올리면 자동 배포 (GitHub Actions 없이)

Cloudflare 대시보드 → Workers & Pages → recipegt → Settings → **Builds**에서 이 GitHub 저장소를 연결합니다.

- Build command: `npm run build`
- Deploy command: `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy`

이렇게 하면 Cloudflare가 직접 빌드합니다(무료 플랜 포함). `main`에 올리면 배포됩니다.

### 주소가 Cloudflare 로그인 화면으로 막힐 때

계정의 `workers.dev`에 Cloudflare Access가 걸려 있으면 낯선 방문자가 앱에 들어오지 못합니다. Workers & Pages → recipegt → Settings → Domains & Routes에서 workers.dev의 Access를 끄거나, 개인 도메인을 연결하세요.

## 설정

`wrangler.jsonc`의 `vars`(공개):

| 이름 | 설명 |
|---|---|
| `GEMINI_MODELS` | 차례로 시도할 Gemini 모델들. 모델이 바뀌면 여기만 고치면 됩니다. |
| `GROQ_MODEL`, `WORKERS_AI_MODEL`, `OPENROUTER_MODEL` | 예비 엔진 모델 |
| `TURNSTILE_SITE_KEY` | 가입 봇 차단(선택). 비밀 키는 `TURNSTILE_SECRET`로 |
| `INSTA_HELPER_URL` | 폰서버 인스타 도우미 주소(선택, [helper/README.md](helper/README.md)) |

비밀값(`npx wrangler secret put 이름`):

| 이름 | 필수 | 설명 |
|---|---|---|
| `AUTH_PEPPER` | ✔ | 비밀번호 해시용. `setup`이 만들어 줍니다. **한 번 정하면 바꾸지 마세요.** 바꾸면 모든 비밀번호가 맞지 않게 됩니다. |
| `ADMIN_EMAILS` |  | 관리자 이메일(쉼표 구분). 없으면 첫 가입자가 관리자입니다. |
| `GEMINI_API_KEY` | 사실상 ✔ | https://aistudio.google.com/apikey |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` |  | 예비 AI |
| `YOUTUBE_API_KEY` |  | 설명란 조회를 안정적으로(무료 하루 1만 건). 없으면 공개 페이지를 읽습니다. |
| `TURNSTILE_SECRET` |  | 가입 봇 차단 |
| `INSTA_HELPER_TOKEN` |  | 폰서버 도우미와 맞춘 토큰 |

## 무료로 버티는 규모와 주의점

- 가장 먼저 닿는 한도는 Gemini 하루 요청 수입니다. 첫날 [AI Studio의 rate limit 화면](https://aistudio.google.com/rate-limit)에서 내 프로젝트 숫자를 확인하고 **관리 → 하루 AI 예산**을 그보다 조금 낮게 맞추세요.
- Gemini 무료 티어 입력은 구글 제품 개선에 쓰일 수 있습니다. 가입 화면에 그렇게 안내하고 있습니다.
- 유튜브 URL 직접 분석은 Gemini의 프리뷰 기능입니다. 무료 티어는 하루 8시간 분량이고 공개 영상만 됩니다. 막히면 설명란·자막 붙여넣기로 자동 전환됩니다.

## 폴더

```
src/shared/   화면과 서버가 함께 쓰는 로직 (레시피 정리, 분량 계산, 링크 판별, 재료 매칭)
src/worker/   Cloudflare Worker: 인증, 한도, AI, 링크 추출, API
src/app/      React 화면
migrations/   D1 표 정의
helper/       폰서버 인스타 도우미 (Termux + yt-dlp)
scripts/      setup(첫 배포), smoke(전체 흐름 점검), make-icons(icon.png → 앱 아이콘)
copy.md       화면별 구성 요소와 문구 (디자인 의뢰용)
```

아이콘을 바꾸려면 `icon.png`를 교체하고 `npm run icons`를 실행하세요.

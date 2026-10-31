// 로컬 개발 서버(AI_MOCK=1)에 대해 주요 흐름을 실제로 호출해 보는 점검 스크립트.
// 실행: npm run dev 를 켠 상태에서  node scripts/smoke.mjs [http://localhost:5173]

import { execSync } from "node:child_process";

const BASE = process.argv[2] ?? "http://localhost:5173";
const stamp = Date.now().toString(36);
let failures = 0;

/** 로컬 D1에 SQL 실행 (테스트 준비용) */
function localSql(sql) {
  execSync(`npx wrangler d1 execute DB --local --command "${sql}"`, { stdio: "ignore" });
}

// 여러 번 돌려도 같은 조건이 되도록 시도 제한 기록과 분석 캐시를 비운다.
localSql("DELETE FROM rate_buckets");
localSql("DELETE FROM extraction_cache");

function client() {
  let cookie = "";
  return async function call(method, path, body, extra = {}) {
    const headers = { "x-recipegt": "1", ...(extra.headers ?? {}) };
    if (cookie) headers.cookie = cookie;
    let payload;
    if (body instanceof Uint8Array) payload = body;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    let res = await fetch(BASE + path, { method, headers, body: payload });
    // 분당 한도에 걸리면 창이 풀릴 때까지 기다렸다 한 번 더 (한도 시험 구간은 noWait로 끈다)
    if (res.status === 429 && !extra.noWait) {
      const body429 = await res.clone().json().catch(() => null);
      if (body429?.error?.code === "too_fast") {
        const wait = Math.max(0, body429.error.resetAt - Date.now()) + 500;
        console.log(`    (분당 한도 — ${Math.round(wait / 1000)}초 기다림)`);
        await new Promise((r) => setTimeout(r, wait));
        res = await fetch(BASE + path, { method, headers, body: payload });
      }
    }
    const set = res.headers.get("set-cookie");
    if (set) {
      const m = set.match(/rgt_sid=([^;]*)/);
      if (m) cookie = m[1] ? `rgt_sid=${m[1]}` : "";
    }
    const type = res.headers.get("content-type") ?? "";
    let data;
    if (type.includes("ndjson")) data = (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    else if (type.includes("json")) data = await res.json();
    else data = await res.text();
    return { status: res.status, data };
  };
}

function check(name, ok, detail) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : "");
  }
}

const admin = client();
const member = client();
const friend = client();
const anon = client();

console.log("가입과 로그인");
let r = await admin("POST", "/api/auth/signup", { email: `admin-${stamp}@test.dev`, password: "password123", name: "관리자" });
check("관리자 가입", r.status === 200, r.data);
r = await admin("GET", "/api/me");
if (r.data.me?.user.role !== "admin") {
  // 이미 다른 관리자가 있는 DB면 테스트 계정을 관리자로 올린다.
  localSql(`UPDATE users SET role='admin' WHERE email='admin-${stamp}@test.dev'`);
  r = await admin("GET", "/api/me");
}
const firstIsAdmin = r.data.me?.user.role === "admin";
check("관리자 계정 준비", firstIsAdmin, r.data);

r = await member("POST", "/api/auth/signup", { email: `member-${stamp}@test.dev`, password: "password123", name: "일반" });
check("일반 가입", r.status === 200, r.data);
r = await member("GET", "/api/me");
check("일반 계정은 member + 한도 있음", r.data.me?.user.role === "member" && r.data.me.limits?.ai > 0 && !r.data.me.unlimited, r.data);

r = await anon("POST", "/api/auth/signup", { email: `bot-${stamp}@test.dev`, password: "password123", website: "http://spam" });
check("숨은 칸을 채운 봇 가입 거절", r.status === 400, r.data);
r = await anon("POST", "/api/auth/signup", { email: `short-${stamp}@test.dev`, password: "123" });
check("짧은 비밀번호 거절", r.status === 400 && r.data.error.code === "bad_password", r.data);
r = await anon("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: "wrong-password" });
check("틀린 비밀번호 거절", r.status === 401, r.data);
r = await anon("POST", "/api/auth/signup", { email: `member-${stamp}@test.dev`, password: "password123" }, {});
check("중복 이메일 거절", r.status === 409, r.data);
r = await fetch(BASE + "/api/auth/logout", { method: "POST" });
check("커스텀 헤더 없는 요청(CSRF) 거절", r.status === 403);

if (firstIsAdmin) {
  console.log("초대 코드로 지인 가입");
  r = await admin("POST", "/api/admin/invites", { note: "테스트", maxUses: 1, expiresDays: 7 });
  check("초대 코드 생성", r.status === 200 && /^[A-Z2-9]{8}$/.test(r.data.code), r.data);
  const code = r.data.code;
  r = await friend("POST", "/api/auth/signup", { email: `friend-${stamp}@test.dev`, password: "password123", name: "지인", invite: code.toLowerCase() });
  check("초대 코드로 가입 → 지인", r.status === 200 && r.data.inviteAccepted === true, r.data);
  r = await friend("GET", "/api/me");
  check("지인은 한도 없음", r.data.me?.user.role === "friend" && r.data.me.unlimited === true && r.data.me.limits === null, r.data);
  r = await anon("POST", "/api/auth/signup", { email: `late-${stamp}@test.dev`, password: "password123", invite: code });
  check("다 쓴 초대 코드는 일반 가입으로", r.status === 200 && r.data.inviteRejected === true, r.data);
} else {
  r = await friend("POST", "/api/auth/signup", { email: `friend-${stamp}@test.dev`, password: "password123", name: "지인" });
}

console.log("레시피 가져오기");
r = await member("POST", "/api/import", { text: "김치볶음밥 재료: 김치 1컵, 밥 2공기, 스팸 100g, 대파 반 대\n1. 스팸을 볶는다 2. 김치를 넣는다 3. 밥을 넣고 볶는다" });
const doneText = Array.isArray(r.data) && r.data.find((e) => e.type === "done");
check("글 붙여넣기 → 레시피", Boolean(doneText), r.data);
const recipeId = doneText?.recipeId;

r = await member("POST", "/api/import", { link: "https://www.youtube.com/shorts/dQw4w9WgXcQ" });
const ytEvents = Array.isArray(r.data) ? r.data : [];
const ytDone = ytEvents.find((e) => e.type === "done");
check("유튜브 링크 → 레시피 (진행 단계 포함)", Boolean(ytDone) && ytEvents.some((e) => e.type === "stage" && e.stage === "meta"), ytEvents);
r = await member("POST", "/api/import", { link: "https://youtu.be/dQw4w9WgXcQ" });
check("같은 영상 다시 → 이미 저장됨 안내", Array.isArray(r.data) && r.data.some((e) => e.type === "exists"), r.data);
r = await friend("POST", "/api/import", { link: "https://youtu.be/dQw4w9WgXcQ" });
check("다른 사람이 같은 영상 → 캐시 사용", Array.isArray(r.data) && r.data.some((e) => e.type === "done" && e.cached), r.data);
if (ytDone) {
  r = await member("GET", `/api/recipes/${ytDone.recipeId}`);
  check("유튜브 썸네일이 사진으로", typeof r.data.recipe?.image === "string" && r.data.recipe.image.includes("ytimg.com"), r.data.recipe?.image);
}
r = await member("POST", "/api/import", { link: "https://www.instagram.com/reel/TESTCODE123/" });
check("인스타 캡션 못 가져오면 붙여넣기 요청", Array.isArray(r.data) && r.data.some((e) => e.type === "need_caption"), r.data);
r = await member("POST", "/api/import", {
  link: "https://www.instagram.com/reel/TESTCODE123/",
  caption: "초간단 김치볶음밥 🍳 재료: 김치 1컵, 밥 1공기, 달걀 1개, 참기름 약간. 김치를 볶다가 밥을 넣고 달걀 프라이를 올려요.",
});
check("인스타 캡션 붙여넣기 → 레시피", Array.isArray(r.data) && r.data.some((e) => e.type === "done"), r.data);

console.log("레시피 보기·수정·버전");
r = await member("GET", "/api/recipes");
check("목록", r.status === 200 && r.data.recipes.length >= 3, r.data);
r = await member("GET", `/api/recipes/${recipeId}`);
check("상세", r.status === 200 && r.data.recipe.content.ingredients.length > 0, r.data);
const original = r.data.recipe.content;
r = await friend("GET", `/api/recipes/${recipeId}`);
check("남의 레시피는 못 봄", r.status === 404, r.data);

r = await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["스팸"] });
check("대체 재료 추천", r.status === 200 && r.data.result.items[0]?.options.length > 0, r.data);
r = await member("POST", `/api/recipes/${recipeId}/tweak`, { instruction: "더 맵게" });
check("맛 조정 미리보기", r.status === 200 && r.data.changes.length > 0, r.data);
const tweaked = r.data.content;
r = await member("PUT", `/api/recipes/${recipeId}`, { content: tweaked, note: "더 맵게", kind: "ai" });
check("새 버전 저장", r.status === 200 && r.data.recipe.versionCount === 2, r.data);
r = await member("GET", `/api/recipes/${recipeId}/versions`);
check("버전 기록 2개", r.data.versions?.length === 2 && r.data.versions[1].kind === "original", r.data);
const originalVid = r.data.versions[1].id;
r = await member("POST", `/api/recipes/${recipeId}/versions/${originalVid}/restore`);
check(
  "원본으로 되돌리기",
  r.status === 200 && JSON.stringify(r.data.recipe.content.ingredients) === JSON.stringify(original.ingredients) && r.data.recipe.versionCount === 3,
  r.data,
);
r = await member("PATCH", `/api/recipes/${recipeId}`, { favorite: true });
check("즐겨찾기", r.data.recipe?.favorite === true, r.data);

console.log("사진");
// 1x1 PNG
const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
r = await member("POST", "/api/images", png, { headers: { "content-type": "image/png" } });
check("사진 올리기", r.status === 200 && r.data.url?.startsWith("/img/"), r.data);
const imgUrl = r.data.url;
const imgRes = await fetch(BASE + imgUrl);
const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
check("올린 사진 그대로 받기", imgRes.status === 200 && imgBytes.length === png.length && imgRes.headers.get("cache-control")?.includes("immutable"));
r = await member("PATCH", `/api/recipes/${recipeId}`, { image: imgUrl });
check("레시피 사진 바꾸기", r.data.recipe?.image === imgUrl, r.data);
r = await member("POST", "/api/images", new TextEncoder().encode("<svg/>"), { headers: { "content-type": "image/svg+xml" } });
check("SVG 같은 형식 거절", r.status === 400, r.data);

console.log("냉장고");
r = await member("PUT", "/api/fridge/pantry", { items: ["김치", "찬밥", "계란"], staples: true });
check("냉장고 저장", r.data.items?.length === 3, r.data);
r = await member("POST", "/api/fridge/match", { items: ["김치", "찬밥"], staples: true });
check("내 레시피에서 찾기", r.status === 200 && r.data.matches.length > 0, r.data);
r = await member("POST", "/api/fridge/ai", { items: ["김치", "달걀"], note: "" });
check("AI 추천 3개", r.status === 200 && r.data.recipes.length === 3, r.data);
r = await member("POST", "/api/recipes", { content: r.data.recipes[1], sourceType: "ai" });
check("추천 레시피 저장", r.status === 200 && r.data.id, r.data);

console.log("한도와 자동 제한");
r = await member("GET", "/api/me");
const me = r.data.me;
console.log(`    오늘 사용: AI ${me.usage.ai}/${me.limits.ai}, 가져오기 ${me.usage.import}/${me.limits.import}`);
let denied = null;
let fastHit = false;
for (let i = 0; i < 40; i++) {
  r = await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["대파"] }, { noWait: true });
  if (r.status === 429) {
    if (r.data.error.code === "too_fast") fastHit = true;
    if (r.data.error.code === "quota_exceeded") {
      denied = r.data;
      break;
    }
  }
}
check("분당 한도(너무 빠름) 걸림", fastHit);
check("하루 한도 넘으면 429와 안내", denied?.error?.code === "quota_exceeded" && typeof denied.error.resetAt === "number", denied);
for (let i = 0; i < 25; i++) await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["대파"] }, { noWait: true });
r = await member("GET", "/api/me");
check("거절이 쌓이면 자동 제한", r.data.me?.user.status === "limited", r.data.me?.user);
check("제한된 계정은 한도가 줄어듦", r.data.me?.limits?.ai === 3, r.data.me?.limits);

r = await friend("POST", `/api/import`, { text: "된장찌개 재료: 된장 2큰술, 두부 반 모, 애호박 1/2개, 물 500ml\n1. 물에 된장을 푼다 2. 채소를 넣고 끓인다" });
let friendOk = Array.isArray(r.data) && r.data.some((e) => e.type === "done");
for (let i = 0; i < 20 && friendOk; i++) {
  const x = await friend("POST", `/api/recipes/${r.data.find((e) => e.type === "done").recipeId}/substitutes`, { missing: ["두부"] });
  if (x.status !== 200) friendOk = false;
}
check("지인은 20번 연속 써도 제한 없음", friendOk);

if (firstIsAdmin) {
  console.log("관리자");
  r = await admin("GET", "/api/admin/overview");
  check("관리 개요", r.status === 200 && r.data.users.length >= 3, r.data);
  const m = r.data.users.find((u) => u.email === `member-${stamp}@test.dev`);
  check("자동 제한 기록이 남음", r.data.events.some((e) => e.kind === "status:limited" && e.userId === m?.id), r.data.events.slice(0, 5));
  r = await member("GET", "/api/admin/overview");
  check("일반 계정은 관리 화면 못 씀", r.status === 403, r.data);
  r = await admin("PATCH", `/api/admin/users/${m.id}`, { status: "blocked", reason: "테스트 차단" });
  check("관리자가 차단", r.status === 200, r.data);
  r = await member("GET", "/api/recipes");
  check("차단되면 세션이 끊김", r.status === 401 || r.status === 403, r.data);
  r = await member("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: "password123" });
  check("차단된 계정 로그인 거절", r.status === 403 && r.data.error.code === "blocked", r.data);
  r = await admin("PATCH", `/api/admin/users/${m.id}`, { status: "active" });
  r = await member("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: "password123" });
  check("차단 풀면 다시 로그인", r.status === 200, r.data);
  r = await admin("POST", `/api/admin/users/${m.id}/reset-password`);
  check("임시 비밀번호", typeof r.data.password === "string" && r.data.password.length >= 8, r.data);
  const temp = r.data.password;
  r = await member("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: temp });
  check("임시 비밀번호로 로그인", r.status === 200, r.data);
  r = await admin("PUT", "/api/admin/policy", { policy: { member: { ai: 50 } } });
  check("한도 설정 저장", r.data.policy?.member.ai === 50 && r.data.policy.member.import === 8, r.data);
  await admin("PUT", "/api/admin/policy", { policy: { member: { ai: 15 } } });
}

console.log("정리");
r = await member("DELETE", `/api/recipes/${recipeId}`);
check("레시피 지우기", r.status === 200, r.data);
r = await member("GET", imgUrl.replace("/img/", "/img/"));
const gone = await fetch(BASE + imgUrl);
check("안 쓰는 사진도 함께 지움", gone.status === 404);
r = await member("POST", "/api/auth/logout");
r = await member("GET", "/api/me");
check("로그아웃", r.data.me === null, r.data);

console.log(failures ? `\n실패 ${failures}개` : "\n모두 통과");
process.exit(failures ? 1 : 0);

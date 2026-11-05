// 로컬 개발 서버(AI_MOCK=1)에 대해 주요 흐름을 실제로 호출해 보는 점검 스크립트.
// 실행: npm run dev 를 켠 상태에서  node scripts/smoke.mjs [http://localhost:5173]
// 내 로컬 데이터와 섞지 않으려면:
//   STATE_DIR=.wrangler/smoke npx wrangler d1 migrations apply DB --local --persist-to .wrangler/smoke
//   STATE_DIR=.wrangler/smoke npx vite --port 5174   그리고   STATE_DIR=.wrangler/smoke node scripts/smoke.mjs http://localhost:5174

import { execSync } from "node:child_process";

const BASE = process.argv[2] ?? "http://localhost:5173";
const stamp = Date.now().toString(36);
let failures = 0;

/** 로컬 D1에 SQL 실행 (테스트 준비용) */
// STATE_DIR을 주면 그 로컬 저장소에 실행한다(개발 서버도 같은 STATE_DIR로 켜야 한다).
const PERSIST = process.env.STATE_DIR ? ` --persist-to "${process.env.STATE_DIR}"` : "";

function localSql(sql) {
  execSync(`npx wrangler d1 execute DB --local${PERSIST} --command "${sql}"`, { stdio: "ignore" });
}

// 여러 번 돌려도 같은 조건이 되도록 시도 제한 기록과 분석 캐시를 비운다.
localSql("DELETE FROM rate_buckets");
localSql("DELETE FROM extraction_cache");

function client() {
  let cookie = "";
  return async function call(method, path, body, extra = {}) {
    const headers = { "x-recipong": "1", ...(extra.headers ?? {}) };
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

/** 시험 모드(MAIL_MOCK=1)에서 응답에 담겨 오는 인증 링크로 이메일을 인증한다 */
async function verifyVia(call, devLink) {
  const token = devLink ? new URL(devLink).searchParams.get("token") : "";
  return call("POST", "/api/auth/verify", { token });
}

const admin = client();
const member = client();
const friend = client();
const anon = client();

console.log("가입과 로그인");
let r = await admin("POST", "/api/auth/signup", { email: `admin-${stamp}@test.dev`, password: "password123", name: "관리자" });
check("관리자 가입", r.status === 200, r.data);
check("가입하면 인증 메일 (시험 모드 링크)", r.data.verifyRequired === true && r.data.devLink?.includes("/verify?token="), r.data);
const adminLink = r.data.devLink;
r = await admin("GET", "/api/recipes");
check("인증 전에는 앱 기능 막힘", r.status === 403 && r.data.error.code === "unverified", r.data);
r = await admin("POST", "/api/auth/verify/resend");
check("인증 메일 다시 보내기는 1분에 한 번", r.status === 429, r.data);
r = await admin("POST", "/api/auth/verify", { token: "wrong-token" });
check("잘못된 인증 링크 거절", r.status === 400 && r.data.error.code === "bad_token", r.data);
r = await verifyVia(admin, adminLink);
check("인증 링크로 인증", r.status === 200, r.data);
r = await verifyVia(admin, adminLink);
check("쓴 인증 링크는 다시 못 씀", r.status === 400, r.data);
r = await admin("GET", "/api/recipes");
check("인증 후 앱 기능 열림", r.status === 200, r.data);
r = await admin("GET", "/api/me");
if (r.data.me?.user.role !== "admin") {
  // 이미 다른 관리자가 있는 DB면 테스트 계정을 관리자로 올린다.
  localSql(`UPDATE users SET role='admin' WHERE email='admin-${stamp}@test.dev'`);
  r = await admin("GET", "/api/me");
}
const firstIsAdmin = r.data.me?.user.role === "admin";
check("관리자 계정 준비", firstIsAdmin, r.data);
// 이 점검은 AI를 수십 번 부른다. 실제 AI 키로 돌면 무료 한도를 쓰고, 영상 점검도 예시 응답을 전제로 한다.
r = await admin("GET", "/api/admin/overview");
if (r.data.providers && !r.data.providers.mock) {
  console.error("\n서버가 실제 AI로 돌고 있어요(AI_MOCK이 꺼짐). 무료 한도를 쓰지 않도록 여기서 멈춥니다.");
  console.error(".dev.vars에 AI_MOCK=1을 넣고 개발 서버를 다시 켠 뒤 실행해 주세요.");
  process.exit(1);
}
// 기능 점검 동안은 일반 계정 한도를 넉넉히 둔다. 한도 점검 구간에서 기본값으로 되돌린다.
r = await admin("PUT", "/api/admin/policy", { policy: { member: { ai: 30, import: 20 } } });
check("점검용 한도 설정", r.data.policy?.member.ai === 30, r.data);

r = await member("POST", "/api/auth/signup", { email: `member-${stamp}@test.dev`, password: "password123", name: "일반" });
check("일반 가입", r.status === 200, r.data);
r = await verifyVia(member, r.data.devLink);
check("일반 계정 인증", r.status === 200, r.data);
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
  console.log("이메일로 권한 바꾸기");
  // 1) 아직 가입 전인 이메일은 예약해 두었다가 가입·인증 때 적용
  r = await admin("POST", "/api/admin/roles", { email: `friend-${stamp}@test.dev`, role: "friend" });
  check("가입 전 이메일은 예약", r.status === 200 && r.data.status === "pending", r.data);
  r = await friend("POST", "/api/auth/signup", { email: `friend-${stamp}@test.dev`, password: "password123", name: "지인" });
  const friendLink = r.data.devLink;
  r = await friend("GET", "/api/me");
  check("인증 전에는 예약 권한이 아직 적용 안 됨", r.data.me?.user.role === "member", r.data.me?.user);
  await verifyVia(friend, friendLink);
  r = await friend("GET", "/api/me");
  check("인증하면 예약한 지인 권한 적용", r.data.me?.user.role === "friend" && r.data.me.unlimited === true && r.data.me.limits === null, r.data);
  check("지인은 한도 없음", r.data.me?.limits === null, r.data.me);
  r = await admin("GET", "/api/admin/overview");
  check("적용된 예약은 목록에서 사라짐", !r.data.grants.some((g) => g.email === `friend-${stamp}@test.dev`), r.data.grants);

  // 2) 이미 가입한 계정은 바로 바뀜
  r = await anon("POST", "/api/auth/signup", { email: `late-${stamp}@test.dev`, password: "password123" });
  await verifyVia(anon, r.data.devLink);
  r = await admin("POST", "/api/admin/roles", { email: `LATE-${stamp}@test.dev`, role: "friend" });
  check("가입한 이메일은 바로 지인으로 (대소문자 무시)", r.data.status === "updated", r.data);
  r = await anon("GET", "/api/me");
  check("바로 적용됨", r.data.me?.user.role === "friend", r.data.me?.user);
  await admin("POST", "/api/admin/roles", { email: `late-${stamp}@test.dev`, role: "member" });
  r = await anon("GET", "/api/me");
  check("다시 일반으로", r.data.me?.user.role === "member", r.data.me?.user);
  r = await member("POST", "/api/admin/roles", { email: `member-${stamp}@test.dev`, role: "friend" });
  check("일반 계정은 권한을 못 바꿈", r.status === 403, r.data);
  r = await admin("POST", "/api/admin/roles", { email: `admin-${stamp}@test.dev`, role: "member" });
  check("내 관리자 권한은 못 뺌", r.status === 400, r.data);

  // 3) 예약 지우기
  await admin("POST", "/api/admin/roles", { email: `someone-${stamp}@test.dev`, role: "friend" });
  await admin("DELETE", `/api/admin/roles/${encodeURIComponent(`someone-${stamp}@test.dev`)}`);
  r = await admin("GET", "/api/admin/overview");
  check("예약 지우기", !r.data.grants.some((g) => g.email === `someone-${stamp}@test.dev`), r.data.grants);
} else {
  r = await friend("POST", "/api/auth/signup", { email: `friend-${stamp}@test.dev`, password: "password123", name: "지인" });
  await verifyVia(friend, r.data.devLink);
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
r = await friend("POST", "/api/import", { link: "https://www.instagram.com/reel/TESTCODE123/" });
check("붙여넣은 캡션은 공용 캐시에 쓰지 않음", Array.isArray(r.data) && r.data.some((e) => e.type === "need_caption"), r.data);

r = await member("GET", "/api/me");
const importsBefore = r.data.me.usage.import;
r = await member("POST", "/api/import", { text: "레시피 아님 — 오늘 날씨가 좋아서 산책을 했어요. 저녁에는 친구를 만날 예정이에요." });
check("레시피가 아닌 글은 안내", Array.isArray(r.data) && r.data.some((e) => e.type === "error" && e.code === "not_recipe"), r.data);
r = await member("GET", "/api/me");
check("AI를 쓴 실패는 횟수를 돌려주지 않음", r.data.me.usage.import === importsBefore + 1, { before: importsBefore, after: r.data.me.usage.import });

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

console.log("요리 종류");
check("가져올 때 AI가 요리 종류도 정함", JSON.stringify(original.categories) === JSON.stringify(["한식"]), original.categories);
r = await member("GET", "/api/recipes");
check("목록에도 요리 종류", JSON.stringify(r.data.recipes.find((x) => x.id === recipeId)?.categories) === JSON.stringify(["한식"]), r.data.recipes);
r = await member("PUT", `/api/recipes/${recipeId}`, { content: { ...original, categories: ["브런치", "양식"] }, note: "종류 바꿈" });
check("직접 고친 종류 저장 (여러 개, 정해진 순서)", JSON.stringify(r.data.recipe?.categories) === JSON.stringify(["양식", "브런치"]) && JSON.stringify(r.data.recipe.content.categories) === JSON.stringify(["양식", "브런치"]), r.data.recipe);
{
  const { categories: _omit, ...oldClientContent } = original;
  r = await member("PUT", `/api/recipes/${recipeId}`, { content: oldClientContent, note: "옛 화면에서 저장" });
  check("종류 칸 없이 보낸 저장은 종류를 지우지 않음", JSON.stringify(r.data.recipe?.categories) === JSON.stringify(["양식", "브런치"]), r.data.recipe);
}
r = await member("POST", `/api/recipes/${recipeId}/tweak`, { instruction: "덜 짜게" });
check("맛 조정해도 종류는 그대로", JSON.stringify(r.data.content?.categories) === JSON.stringify(["양식", "브런치"]), r.data.content);
r = await member("POST", "/api/recipes", { content: { title: "만능 양념장", ingredients: [{ name: "간장" }, { name: "설탕" }], steps: ["섞어요."], categories: [] } });
const sauceId = r.data.id;
r = await member("GET", `/api/recipes/${sauceId}`);
check("종류를 안 고른 직접 작성은 기타(빈 종류)", r.status === 200 && Array.isArray(r.data.recipe.categories) && r.data.recipe.categories.length === 0, r.data.recipe);
await member("DELETE", `/api/recipes/${sauceId}`);

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
r = await member("GET", "/api/fridge");
check("처음엔 냉장고 하나", r.status === 200 && r.data.fridges.length === 1, r.data);
const mainFridge = r.data.fridges[0].id;
r = await member("POST", "/api/fridge/items", {
  fridgeId: mainFridge,
  items: [
    { name: "달걀", qty: 10, unit: "개" },
    { name: "김치", qty: null, unit: "" },
    { name: "밥", qty: 3, unit: "공기" },
    { name: "스팸", qty: 340, unit: "g" },
  ],
});
check("재료 넣기", r.data.items?.length === 4, r.data);
r = await member("POST", "/api/fridge/items", { fridgeId: mainFridge, items: [{ name: "계란", qty: 6, unit: "개" }] });
const egg = r.data.items?.find((i) => i.name === "달걀");
check("같은 재료는 양을 더함", egg?.qty === 16 && r.data.items.length === 4, r.data.items);
r = await member("POST", "/api/fridge/fridges", { name: "냉동실", kind: "freezer" });
check("냉장고 더하기", r.data.state?.fridges.length === 2, r.data);
const freezer = r.data.id;
r = await member("PATCH", `/api/fridge/items/${egg.id}`, { fridgeId: freezer, qty: 12 });
check("재료 옮기고 양 고치기", r.data.items?.find((i) => i.id === egg.id)?.fridgeId === freezer, r.data);
r = await friend("PATCH", `/api/fridge/items/${egg.id}`, { qty: 1 });
check("남의 재료는 못 고침", r.status === 404, r.data);
const spam = (await member("GET", "/api/fridge")).data.items.find((i) => i.name === "스팸");
r = await member("POST", "/api/fridge/cook", {
  uses: [
    { itemId: egg.id, use: 2 },
    { itemId: spam.id, use: 340 },
  ],
});
check(
  "요리하면 쓴 만큼 빼고 다 쓴 건 지움",
  r.data.state?.items.find((i) => i.id === egg.id)?.qty === 10 && !r.data.state.items.some((i) => i.id === spam.id) && r.data.before.length === 2,
  r.data,
);
r = await member("POST", "/api/fridge/items/restore", { items: r.data.before });
check("되돌리기", r.data.items?.find((i) => i.id === egg.id)?.qty === 12 && r.data.items.some((i) => i.id === spam.id), r.data);
r = await member("DELETE", `/api/fridge/fridges/${mainFridge}`);
check("냉장고 지우기(안의 재료도)", r.data.fridges?.length === 1 && !r.data.items.some((i) => i.fridgeId === mainFridge), r.data);
r = await member("DELETE", `/api/fridge/fridges/${freezer}`);
check("마지막 냉장고는 못 지움", r.status === 400, r.data);
r = await member("POST", "/api/fridge/items", { fridgeId: freezer, items: [{ name: "김치" }, { name: "찬밥" }, { name: "계란", qty: 6, unit: "개" }] });
r = await member("POST", "/api/fridge/match", { items: ["김치", "찬밥"], staples: true });
check("내 레시피에서 찾기", r.status === 200 && r.data.matches.length > 0, r.data);
r = await member("POST", "/api/fridge/ai", { items: ["김치", "달걀"], note: "" });
check("AI 추천 3개", r.status === 200 && r.data.recipes.length === 3, r.data);
check("추천에는 '추정' 표시가 없음", r.data.recipes.every((x) => x.ingredients.every((i) => !i.note.includes("추정"))), r.data.recipes);
r = await member("POST", "/api/recipes", { content: r.data.recipes[1], sourceType: "ai" });
check("추천 레시피 저장", r.status === 200 && r.data.id, r.data);

console.log("식단");
const today = new Date().toISOString().slice(0, 10);
r = await member("POST", "/api/plan", { day: today, slot: "dinner", recipeId, servings: 4 });
check("식단에 레시피 넣기", r.status === 200 && r.data.entry?.recipeId === recipeId && r.data.entry.servings === 4, r.data);
const planId = r.data.entry?.id;
r = await member("POST", "/api/plan", { day: today, slot: "lunch", title: "외식" });
check("직접 적은 메뉴", r.data.entry?.title === "외식" && r.data.entry.recipeId === null, r.data);
r = await member("POST", "/api/plan", { day: "2026-13-40", slot: "lunch", title: "x" });
check("이상한 날짜는 거절", r.status === 400, r.data);
r = await friend("POST", "/api/plan", { day: today, slot: "lunch", recipeId });
check("남의 레시피는 못 넣음", r.status === 404, r.data);
r = await member("GET", `/api/plan?from=${today}&to=${today}`);
check("식단 보기(끼니 순서)", r.data.entries?.length === 2 && r.data.entries[0].slot === "lunch", r.data);
r = await member("GET", `/api/plan/needs?from=${today}&to=${today}`);
check("장보기: 냉장고에 없는 재료", r.status === 200 && r.data.meals === 1 && r.data.needs.some((n) => n.name.includes("스팸")), r.data);
r = await member("POST", "/api/fridge/cook", { uses: [], planId });
r = await member("GET", `/api/plan?from=${today}&to=${today}`);
check("만들었어요 표시", r.data.entries?.find((e) => e.id === planId)?.done === true, r.data);
r = await member("GET", `/api/plan/needs?from=${today}&to=${today}`);
check("만든 메뉴는 장보기에서 빠짐", r.data.meals === 0, r.data);
r = await member("PATCH", `/api/plan/${planId}`, { done: false, slot: "breakfast" });
check("식단 고치기", r.data.entry?.done === false && r.data.entry.slot === "breakfast", r.data);
r = await member("DELETE", `/api/plan/${planId}`);
check("식단에서 빼기", r.status === 200, r.data);

console.log("한도와 자동 제한");
// 1) 분당 한도: 하루 한도를 넉넉히 둔 채 빠르게 보내면 too_fast
let fastHit = false;
for (let i = 0; i < 15 && !fastHit; i++) {
  r = await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["대파"] }, { noWait: true });
  if (r.status === 429 && r.data.error.code === "too_fast") fastHit = true;
}
check("분당 한도(너무 빠름) 걸림", fastHit);

// 2) 기본 한도로 되돌리면 이미 3회를 넘게 쓴 일반 계정은 바로 하루 한도에 걸린다
r = await admin("PUT", "/api/admin/policy", { policy: {} });
check("기본 한도: 일반 계정 링크 3회·AI 3회", r.data.policy?.member.ai === 3 && r.data.policy.member.import === 3, r.data.policy?.member);
r = await member("GET", "/api/me");
console.log(`    오늘 사용: AI ${r.data.me.usage.ai}/${r.data.me.limits.ai}, 가져오기 ${r.data.me.usage.import}/${r.data.me.limits.import}`);
r = await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["대파"] }, { noWait: true });
check("하루 한도 넘으면 429와 안내", r.data?.error?.code === "quota_exceeded" && /3회/.test(r.data.error.message) && typeof r.data.error.resetAt === "number", r.data);
r = await member("POST", "/api/import", { text: "김치볶음밥 재료: 김치 1컵, 밥 2공기, 스팸 100g 1. 볶는다 2. 밥을 넣는다" }, { noWait: true });
// 가져오기는 진행 단계를 스트림으로 보내므로 한도 초과도 스트림 안의 오류 이벤트로 온다.
check("링크 가져오기도 하루 3회", Array.isArray(r.data) && r.data.some((e) => e.type === "error" && e.code === "quota_exceeded" && /3회/.test(e.message)), r.data);

// 3) 거절이 쌓이면 자동 제한
for (let i = 0; i < 25; i++) await member("POST", `/api/recipes/${recipeId}/substitutes`, { missing: ["대파"] }, { noWait: true });
r = await member("GET", "/api/me");
check("거절이 쌓이면 자동 제한", r.data.me?.user.status === "limited", r.data.me?.user);
check("제한된 계정은 한도가 줄어듦", r.data.me?.limits?.ai === 1 && r.data.me.limits.import === 1, r.data.me?.limits);

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
  check("한도 설정 저장", r.data.policy?.member.ai === 50 && r.data.policy.member.import === 3, r.data);
  await admin("PUT", "/api/admin/policy", { policy: {} });

  // 요리 종류가 생기기 전에 저장한 레시피 흉내: 종류를 비우고 관리 화면에서 한꺼번에 정한다.
  localSql(
    `UPDATE recipes SET categories = NULL, content = json_remove(content, '$.categories') WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%-${stamp}@test.dev')`,
  );
  r = await admin("GET", "/api/admin/overview");
  const pending = r.data.uncategorized;
  check("종류 없는 레시피 수", pending > 0, r.data.uncategorized);
  r = await admin("POST", "/api/admin/categorize");
  check("관리자가 AI로 한꺼번에 종류 정하기", r.status === 200 && r.data.done === pending && r.data.left === 0, r.data);
  r = await member("GET", "/api/recipes");
  check("정한 종류가 목록에 보임", r.data.recipes.every((x) => Array.isArray(x.categories)) && r.data.recipes.some((x) => x.categories.includes("한식")), r.data.recipes);
  r = await member("GET", `/api/recipes/${r.data.recipes[0].id}`);
  check("정한 종류가 레시피 내용에도 들어감", JSON.stringify(r.data.recipe.content.categories) === JSON.stringify(r.data.recipe.categories), r.data.recipe);
  r = await member("POST", "/api/admin/categorize");
  check("일반 계정은 종류 정하기 못 씀", r.status === 403, r.data);

  // 요리 종류가 생기기 전에 만든 공용 캐시 흉내: 다시 가져갈 때 종류만 따로 정하고 캐시에도 넣어 둔다.
  localSql("UPDATE extraction_cache SET content = json_remove(content, '$.categories')");
  r = await admin("POST", "/api/import", { link: "https://youtu.be/dQw4w9WgXcQ" });
  const oldCacheDone = Array.isArray(r.data) && r.data.find((e) => e.type === "done" && e.cached);
  check("종류 없는 옛 캐시로 가져오기", Boolean(oldCacheDone), r.data);
  if (oldCacheDone) {
    r = await admin("GET", `/api/recipes/${oldCacheDone.recipeId}`);
    check("옛 캐시로 가져와도 종류가 정해짐", r.data.recipe?.categories.length > 0, r.data.recipe?.categories);
    await admin("DELETE", `/api/recipes/${oldCacheDone.recipeId}`);
  }
}

console.log("비밀번호 찾기");
r = await anon("POST", "/api/auth/forgot", { email: `member-${stamp}@test.dev` });
check("재설정 메일 (시험 모드 링크)", r.status === 200 && r.data.devLink?.includes("/reset?token="), r.data);
const resetToken = r.data.devLink ? new URL(r.data.devLink).searchParams.get("token") : "";
r = await anon("POST", "/api/auth/forgot", { email: `nobody-${stamp}@test.dev` });
check("없는 이메일도 같은 응답", r.status === 200 && r.data.ok === true && !r.data.devLink, r.data);
r = await anon("POST", "/api/auth/reset", { token: resetToken, password: "newpass1234" });
check("새 비밀번호 정하기", r.status === 200, r.data);
r = await member("GET", "/api/recipes");
check("재설정하면 다른 기기 로그인은 풀림", r.status === 401, r.data);
r = await anon("POST", "/api/auth/reset", { token: resetToken, password: "another1234" });
check("쓴 재설정 링크는 다시 못 씀", r.status === 400, r.data);
r = await member("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: "password123" });
check("예전 비밀번호는 안 됨", r.status === 401, r.data);
r = await member("POST", "/api/auth/login", { email: `member-${stamp}@test.dev`, password: "newpass1234" });
check("새 비밀번호로 로그인", r.status === 200, r.data);

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

// 처음 배포: Cloudflare에 DB를 만들고, 표를 만들고, 배포하고, 비밀값을 넣는다.
// 다시 실행해도 안전하다(이미 있는 DB·비밀값은 그대로 둔다).
//
// 사용법 (먼저 `npx wrangler login`):
//   npm run setup
//   npm run setup -- --admin me@example.com --gemini AIza... --groq gsk_... --youtube AIza...
//                    --resend re_... --mail-from "레시퐁 <no-reply@내도메인.com>"

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const DB_NAME = "recipong-db";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "1";
}

function sh(cmd, { capture = false, input } = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: capture || input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit", input });
}

const interactive = process.stdin.isTTY;
const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
async function ask(question) {
  if (!rl) return "";
  return (await rl.question(question)).trim();
}

function step(text) {
  console.log(`\n▶ ${text}`);
}

// 1. 로그인 확인
step("Cloudflare 로그인 확인");
let who = "";
try {
  who = sh("npx wrangler whoami", { capture: true });
} catch (e) {
  who = String(e.stdout ?? "");
}
if (/not authenticated|You are not logged in/i.test(who)) {
  console.log("Cloudflare에 로그인되어 있지 않아요. 먼저 `npx wrangler login`을 실행해 주세요.");
  process.exit(1);
}
console.log("로그인되어 있어요.");

// 2. D1 데이터베이스
step(`데이터베이스(${DB_NAME}) 준비`);
let config = readFileSync("wrangler.jsonc", "utf8");
if (config.includes(PLACEHOLDER)) {
  const findId = () => {
    const list = JSON.parse(sh("npx wrangler d1 list --json", { capture: true }));
    return list.find((d) => d.name === DB_NAME)?.uuid ?? null;
  };
  let id = findId();
  if (!id) {
    sh(`npx wrangler d1 create ${DB_NAME}`, { capture: true });
    id = findId();
  }
  if (!id) {
    console.log("데이터베이스를 만들지 못했어요. Cloudflare 대시보드에서 D1을 확인해 주세요.");
    process.exit(1);
  }
  config = config.replace(PLACEHOLDER, id);
  writeFileSync("wrangler.jsonc", config);
  console.log(`wrangler.jsonc에 데이터베이스 ID를 적었어요: ${id}`);
} else {
  console.log("wrangler.jsonc에 이미 데이터베이스 ID가 있어요.");
}

// 2-1. 사진 저장소(KV)
step("사진 저장소(KV) 준비");
const KV_PLACEHOLDER = '"id": "00000000000000000000000000000000"';
const KV_TITLE = "recipong-images";
config = readFileSync("wrangler.jsonc", "utf8");
if (config.includes(KV_PLACEHOLDER)) {
  const findKv = () => {
    const list = JSON.parse(sh("npx wrangler kv namespace list", { capture: true }));
    return list.find((n) => n.title === KV_TITLE || n.title.endsWith(`-${KV_TITLE}`))?.id ?? null;
  };
  let id = findKv();
  if (!id) {
    sh(`npx wrangler kv namespace create ${KV_TITLE}`, { capture: true });
    id = findKv();
  }
  if (!id) {
    console.log("사진 저장소를 만들지 못했어요. Cloudflare 대시보드에서 Workers KV를 확인해 주세요.");
    process.exit(1);
  }
  config = config.replace(KV_PLACEHOLDER, `"id": "${id}"`);
  writeFileSync("wrangler.jsonc", config);
  console.log(`wrangler.jsonc에 사진 저장소 ID를 적었어요: ${id}`);
} else {
  console.log("wrangler.jsonc에 이미 사진 저장소 ID가 있어요.");
}

// 2-2. 인증 메일 보내는 주소 (공개 설정이라 wrangler.jsonc에 적는다)
step("인증 메일 보내는 주소");
config = readFileSync("wrangler.jsonc", "utf8");
let mailFrom = args["mail-from"];
if (!mailFrom && config.includes('"MAIL_FROM": ""')) {
  mailFrom = await ask('인증 메일 보내는 주소 (예: 레시퐁 <no-reply@내도메인.com>, Resend에서 인증한 도메인. 비우면 건너뜀): ');
}
if (mailFrom) {
  config = config.replace(/"MAIL_FROM": "[^"]*"/, `"MAIL_FROM": ${JSON.stringify(mailFrom)}`);
  writeFileSync("wrangler.jsonc", config);
  console.log(`wrangler.jsonc의 MAIL_FROM을 정했어요: ${mailFrom}`);
} else {
  console.log("MAIL_FROM이 비어 있으면 이메일 인증 없이 동작해요.");
}

// 3. 빌드와 표 만들기, 배포
step("빌드");
sh("npm run build");
step("표 만들기(마이그레이션)");
sh("npx wrangler d1 migrations apply DB --remote", { input: "y\n" });
step("배포");
const deployOut = sh("npx wrangler deploy", { capture: true });
console.log(deployOut.split("\n").filter((l) => /https:\/\/|Uploaded|Deployed/.test(l)).join("\n"));
const url = deployOut.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];

// 4. 비밀값
step("비밀값 넣기");
let existing = [];
try {
  existing = JSON.parse(sh("npx wrangler secret list --format json", { capture: true })).map((s) => s.name);
} catch {
  existing = [];
}
function putSecret(name, value) {
  sh(`npx wrangler secret put ${name}`, { input: `${value}\n` });
  console.log(`${name} 넣음`);
}
if (!existing.includes("AUTH_PEPPER")) {
  // 한 번 정하면 바꾸지 않는다. 바꾸면 모든 비밀번호가 맞지 않게 된다.
  putSecret("AUTH_PEPPER", randomBytes(32).toString("hex"));
} else {
  console.log("AUTH_PEPPER는 이미 있어요(그대로 둠).");
}
const optional = [
  ["ADMIN_EMAILS", "admin", "관리자 이메일 (쉼표로 여러 개, 비우면 첫 가입자가 관리자): "],
  ["GEMINI_API_KEY", "gemini", "Gemini API 키 (https://aistudio.google.com/apikey, 비우면 건너뜀): "],
  ["GROQ_API_KEY", "groq", "Groq API 키 (선택, 비우면 건너뜀): "],
  ["YOUTUBE_API_KEY", "youtube", "YouTube Data API 키 (선택, 비우면 건너뜀): "],
  ["RESEND_API_KEY", "resend", "Resend API 키 (이메일 인증·비밀번호 찾기, 비우면 건너뜀): "],
];
for (const [name, flag, question] of optional) {
  let value = args[flag];
  if (!value && !existing.includes(name)) value = await ask(question);
  if (value) putSecret(name, value);
  else if (existing.includes(name)) console.log(`${name}는 이미 있어요.`);
}
rl?.close();

console.log(`
완료!
${url ? `주소: ${url}` : "주소는 Cloudflare 대시보드의 Workers & Pages에서 확인하세요."}

다음 할 일
1. 위 주소로 들어가 가입하세요. 관리자 이메일로 가입하면(또는 첫 가입자면) 관리자가 됩니다.
2. 지인이 가입한 이메일을 알려 주면 내 정보 → 관리 → 사용자 → "이메일로 권한 바꾸기"에서 지인으로 바꾸세요.
3. 주소를 열었는데 Cloudflare 로그인 화면이 뜨면 workers.dev에 Access가 걸린 상태예요.
   대시보드 → Workers & Pages → recipong → Settings → Domains & Routes에서 workers.dev의 Access를 꺼 주세요.
`);

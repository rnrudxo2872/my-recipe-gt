// 처음 배포: Cloudflare에 DB를 만들고, 표를 만들고, 배포하고, 비밀값을 넣는다.
// 다시 실행해도 안전하다(이미 있는 DB·비밀값은 그대로 둔다).
//
// 사용법:
//   npm run setup
//   npm run setup -- --admin me@example.com --gemini AIza... --groq gsk_... --youtube AIza...
//                    --resend re_... --mail-from "레시퐁 <no-reply@내도메인.com>"
//   npm run setup -- --own-login   (컴퓨터의 wrangler 로그인과 다른 계정을 이 폴더에서만 쓰기)

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const DB_NAME = "recipong-db";
// 이 폴더 전용 Cloudflare 로그인을 저장하는 곳. wrangler는 폴더의 .env를 읽는다.
const LOCAL_LOGIN_DIR = ".wrangler-home";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "1";
}

function sh(cmd, { capture = false, input } = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: capture || input !== undefined ? ["pipe", "pipe", "pipe"] : "inherit", input });
}

const interactive = process.stdin.isTTY;
// 질문할 때만 입력을 잡는다. 계속 잡고 있으면 중간에 실행하는 명령이 입력을 받지 못한다.
async function ask(question) {
  if (!interactive) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

function step(text) {
  console.log(`\n▶ ${text}`);
}

function whoami() {
  try {
    return JSON.parse(sh("npx wrangler whoami --json", { capture: true }));
  } catch (e) {
    try {
      return JSON.parse(String(e.stdout ?? ""));
    } catch {
      return { loggedIn: false };
    }
  }
}

// .env에 로그인 위치를 적어, 이 폴더에서 실행하는 wrangler만 따로 로그인하게 한다.
// 새로 적었으면 true, 이미 이 폴더 전용 로그인을 쓰고 있었으면 false.
function useLocalLogin() {
  const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
  if (/^XDG_CONFIG_HOME=/m.test(env)) return false;
  const sep = env && !env.endsWith("\n") ? "\n" : "";
  const dir = resolve(LOCAL_LOGIN_DIR).replaceAll("\\", "/");
  writeFileSync(".env", `${env}${sep}# 이 폴더 전용 Cloudflare 로그인 위치 (npm run setup이 적음)\nXDG_CONFIG_HOME=${dir}\n`);
  return true;
}

async function login() {
  console.log("브라우저가 열리면 레시퐁에 쓸 Cloudflare 계정으로 로그인하고 [Allow]를 누르세요.");
  console.log("브라우저의 dash.cloudflare.com에 다른 계정이 로그인돼 있으면 그 계정이 연결됩니다. 먼저 로그아웃해 두세요.");
  await ask("준비되면 Enter: ");
  sh("npx wrangler login");
}

// 1. Cloudflare 계정 확인
step("Cloudflare 계정 확인");
if (args["own-login"] && useLocalLogin()) console.log("이 폴더에서만 쓰는 로그인을 만들었어요. 컴퓨터에 로그인된 계정은 그대로 둡니다.");
let me = whoami();
for (;;) {
  if (!me.loggedIn) {
    if (!interactive) {
      console.log("Cloudflare에 로그인되어 있지 않아요. `npx wrangler login` 후 다시 실행해 주세요.");
      process.exit(1);
    }
    await login();
    me = whoami();
    if (!me.loggedIn) {
      console.log("로그인하지 못했어요. 다시 실행해 주세요.");
      process.exit(1);
    }
  }
  console.log(`로그인한 계정: ${me.email ?? "(이메일 없음)"}`);
  const answer = await ask("이 계정에 레시퐁을 배포할까요? 다른 계정을 쓰려면 n (Y/n): ");
  if (!/^n/i.test(answer)) break;
  if (useLocalLogin()) console.log("이 폴더에서만 쓰는 로그인을 따로 만들게요. 컴퓨터에 로그인된 계정은 그대로 둡니다.");
  else sh("npx wrangler logout", { capture: true }); // 이 폴더 전용 로그인만 로그아웃된다
  me = { loggedIn: false };
}

// 계정 ID를 wrangler.jsonc에 적어 두면, 나중에 다른 계정으로 로그인한 채 배포해도 엉뚱한 계정에 올라가지 않는다.
let config = readFileSync("wrangler.jsonc", "utf8");
const accounts = me.accounts ?? [];
let accountId = config.match(/"account_id":\s*"([0-9a-f]{32})"/)?.[1];
if (accountId) {
  if (accounts.length && !accounts.some((a) => a.id === accountId)) {
    console.log(`wrangler.jsonc의 account_id(${accountId})는 지금 로그인한 계정에 없어요.`);
    console.log("그 계정으로 로그인하거나, 처음부터 다시 하려면 wrangler.jsonc의 account_id 줄과 DB·KV ID를 원래대로 되돌린 뒤 실행하세요.");
    process.exit(1);
  }
} else if (accounts.length) {
  accountId = accounts[0].id;
  if (accounts.length > 1) {
    accounts.forEach((a, i) => console.log(`  ${i + 1}. ${a.name} (${a.id})`));
    const pick = Number(await ask("어느 계정에 배포할까요? 번호: ")) || 1;
    accountId = accounts[Math.min(Math.max(pick, 1), accounts.length) - 1].id;
  }
  const withId = config.replace(/("name": "recipong",\r?\n)/, `$1  "account_id": "${accountId}",\n`);
  if (withId !== config) {
    config = withId;
    writeFileSync("wrangler.jsonc", config);
  }
}
if (accountId) {
  process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
  console.log(`배포할 계정: ${accounts.find((a) => a.id === accountId)?.name ?? accountId}`);
}

// 2. D1 데이터베이스
step(`데이터베이스(${DB_NAME}) 준비`);
config = readFileSync("wrangler.jsonc", "utf8");
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
try {
  // 새 계정이면 workers.dev 주소를 정하라고 물어보므로, 입력을 그대로 넘긴다.
  sh("npx wrangler deploy");
} catch {
  console.log("\n배포하지 못했어요. 위 메시지를 확인해 주세요.");
  if (accountId) {
    console.log(`새 계정이라 workers.dev 주소가 없다면 https://dash.cloudflare.com/${accountId}/workers/onboarding 에서 정한 뒤 다시 실행하세요.`);
  }
  process.exit(1);
}

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

console.log(`
완료!
주소는 위 배포 결과의 https://recipong.<하위 도메인>.workers.dev 입니다.

다음 할 일
1. 위 주소로 들어가 가입하세요. 관리자 이메일로 가입하면(또는 첫 가입자면) 관리자가 됩니다.
2. 지인이 가입한 이메일을 알려 주면 내 정보 → 관리 → 사용자 → "이메일로 권한 바꾸기"에서 지인으로 바꾸세요.
3. 주소를 열었는데 Cloudflare 로그인 화면이 뜨면 workers.dev에 Access가 걸린 상태예요.
   대시보드 → Workers & Pages → recipong → Settings → Domains & Routes에서 workers.dev의 Access를 꺼 주세요.
4. wrangler.jsonc에 적힌 계정·DB·KV ID는 비밀이 아니니 커밋해 두세요.
`);

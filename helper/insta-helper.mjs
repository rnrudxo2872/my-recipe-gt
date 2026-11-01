#!/usr/bin/env node
// 레시퐁 인스타그램 도우미 (폰서버용, Node 20 이상, 설치할 패키지 없음)
//
// 인스타그램은 Cloudflare 같은 데이터센터에서 오는 요청을 facebook.com/unsupportedbrowser로 돌려보낸다.
// 집 인터넷에 있는 폰은 공개 페이지를 그대로 받으므로, 폰이 미리보기 정보(og 태그)만 대신 읽어 준다.
// - 로그인·영상 없이 공개 게시물 페이지 하나만 읽는다. 한 번에 1건, 같은 게시물은 6시간 기억한다.
// - cloudflared 임시 터널을 직접 띄우고, 주소가 정해지면 레시퐁에 알린다(10분마다 다시 알림).
//   터널이 죽거나 바깥에서 안 열리면 새로 연다. 폰 재부팅으로 주소가 바뀌어도 재배포가 필요 없다.
//
// 설정(.env, `node --env-file=.env insta-helper.mjs` 로 읽음):
//   INSTA_HELPER_TOKEN=레시퐁 비밀값과 같은 긴 문자열 (필수, 24자 이상)
//   APP_URL=https://recipong.sest.workers.dev   터널 주소를 알릴 레시퐁 주소
//   PORT=8790                                   127.0.0.1에서만 받는다
//   TUNNEL=quick                                quick(기본) | off(터널 없이, 고정 주소를 따로 쓸 때)
//   CLOUDFLARED=                                cloudflared 경로. 비우면 bin/rp-tunnel, 없으면 cloudflared

import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const CACHE_TTL = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const MAX_WAITING = 5;
const ANNOUNCE_EVERY = 10 * 60 * 1000;

// ───────── 게시물 읽기 (레시퐁 src/worker/extract와 같은 규칙) ─────────

const POST_PATH = /^\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/;

/** 인스타 게시물 주소만 받아서 한 가지 꼴로 바꾼다. 아니면 null */
export function postUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(url.hostname)) return null;
  const m = url.pathname.match(POST_PATH);
  return m ? `https://www.instagram.com/reel/${m[1]}/` : null;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function metaContent(html, prop) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decodeEntities(content) : null;
}

/** og:description은 '좋아요 12개, 댓글 3개 - 아이디 - 날짜: "캡션"' 꼴이다. 따옴표 안만 뽑는다 */
function captionFromOg(desc) {
  const quoted = desc.match(/[:：]\s*["“]([\s\S]*)["”]\s*\.?\s*$/);
  return (quoted ? quoted[1] : desc).trim();
}

/** 게시물 페이지에서 캡션·썸네일·작성자를 뽑는다. 인스타 밖으로 보내졌거나 미리보기가 없으면 오류 */
export function parsePost(html, finalUrl) {
  const host = new URL(finalUrl).hostname;
  if (!/(^|\.)instagram\.com$/.test(host)) throw new Error(`인스타가 다른 곳으로 보냄: ${host}`);
  const desc = metaContent(html, "og:description");
  const image = metaContent(html, "og:image");
  if (!desc && !image) throw new Error("미리보기 정보 없음(로그인 화면이거나 지워진 게시물)");
  return {
    caption: desc ? captionFromOg(desc) : "",
    thumbnail: image,
    uploader: desc?.match(/\s-\s([A-Za-z0-9_.]+)\s-\s/)?.[1] ?? "",
  };
}

async function readLimited(res, maxBytes) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return out + decoder.decode();
}

async function readPost(url) {
  const res = await fetch(url, { headers: { "accept-language": "ko-KR,ko;q=0.9" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`인스타 응답 ${res.status}`);
  // og 태그는 페이지 앞부분(20KB 안쪽)에 있다
  return parsePost(await readLimited(res, 400_000), res.url || url);
}

// ───────── 서버 ─────────

function sameSecret(given, expected) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
const log = (...args) => console.log(now(), ...args);

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const token = process.env.INSTA_HELPER_TOKEN ?? "";
  const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
  const port = Number(process.env.PORT || 8790);
  const tunnelMode = process.env.TUNNEL || "quick";
  const cloudflared = process.env.CLOUDFLARED || (existsSync(join(here, "bin/rp-tunnel")) ? join(here, "bin/rp-tunnel") : "cloudflared");
  const pidFile = join(here, "tunnel.pid");

  if (token.length < 24) {
    console.error("INSTA_HELPER_TOKEN이 없거나 너무 짧아요(24자 이상). .env를 확인해 주세요.");
    process.exit(1);
  }

  const cache = new Map();
  let chain = Promise.resolve();
  let waiting = 0;

  const server = createServer(async (req, res) => {
    const send = (status, data) => {
      const body = JSON.stringify(data);
      res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
      res.end(body);
    };
    const url = new URL(req.url ?? "/", "http://helper");
    if (url.pathname === "/health") return send(200, { ok: true });
    if (url.pathname !== "/extract" || req.method !== "GET") return send(404, { error: "not found" });
    if (!sameSecret(req.headers.authorization ?? "", `Bearer ${token}`)) return send(401, { error: "unauthorized" });
    const target = postUrl(url.searchParams.get("url") ?? "");
    if (!target) return send(400, { error: "instagram post url only" });
    const code = target.split("/")[4];

    const hit = cache.get(target);
    if (hit && Date.now() - hit.at < CACHE_TTL) return send(200, hit.data);
    if (waiting >= MAX_WAITING) return send(503, { error: "busy" });

    // 폰에서 다른 서버도 돌고 있으니 한 번에 하나씩만 읽는다.
    waiting++;
    const job = chain.then(() => readPost(target));
    chain = job.catch(() => {});
    try {
      const data = await job;
      cache.set(target, { at: Date.now(), data });
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      log("읽음", code, `캡션 ${data.caption.length}자`);
      send(200, data);
    } catch (e) {
      log("실패", code, e.message);
      send(502, { error: String(e.message).slice(0, 200) });
    } finally {
      waiting--;
    }
  });
  server.listen(port, "127.0.0.1", () => log(`도우미 실행 중: http://127.0.0.1:${port} (터널: ${tunnelMode})`));

  if (tunnelMode !== "quick") return;

  // ───────── 임시 터널 ─────────
  let child = null;
  let tunnelUrl = null;
  let stopping = false;
  let failedChecks = 0;

  /** 지난번에 띄운 터널이 남아 있으면 끈다. 다른 프로세스를 잘못 끄지 않도록 명령줄까지 확인한다 */
  function killStaleTunnel() {
    try {
      const pid = Number(readFileSync(pidFile, "utf8"));
      const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replace(/\0/g, " ");
      if (cmd.includes(`--url http://127.0.0.1:${port}`)) process.kill(pid);
    } catch {
      // 없으면 그만
    }
  }

  async function announce() {
    if (!appUrl || !tunnelUrl) return;
    try {
      const res = await fetch(`${appUrl}/api/insta-helper/announce`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-recipong": "1" },
        body: JSON.stringify({ url: tunnelUrl }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) log("레시퐁에 알리기 실패:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      log("레시퐁에 알리기 실패:", e.message);
    }
  }

  /** 바깥에서 터널로 도우미가 열리는지 본다. 세 번 연속 안 되면 터널을 새로 연다 */
  async function checkTunnel() {
    if (!tunnelUrl || !child) return;
    try {
      const res = await fetch(`${tunnelUrl}/health`, { signal: AbortSignal.timeout(15_000) });
      failedChecks = res.ok ? 0 : failedChecks + 1;
    } catch {
      failedChecks++;
    }
    if (failedChecks >= 3) {
      log("터널이 바깥에서 안 열려요. 새로 엽니다.");
      failedChecks = 0;
      child.kill();
    }
  }

  function startTunnel() {
    killStaleTunnel();
    tunnelUrl = null;
    child = spawn(cloudflared, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    const me = child;
    if (me.pid) writeFileSync(pidFile, String(me.pid));
    const onLine = (line) => {
      const found = line.match(/https:\/\/([a-z0-9-]+)\.trycloudflare\.com/);
      if (found && found[1] !== "api" && found[0] !== tunnelUrl) {
        tunnelUrl = found[0];
        log("터널 주소:", tunnelUrl);
        // 새 주소가 바깥에 퍼질 때까지 몇 초 걸린다
        setTimeout(announce, 5_000);
      } else if (/\bERR\b/.test(line)) {
        log("터널:", line.slice(0, 200));
      }
    };
    createInterface({ input: me.stdout }).on("line", onLine);
    createInterface({ input: me.stderr }).on("line", onLine);
    let restarted = false;
    const restart = (why) => {
      if (restarted) return;
      restarted = true;
      if (child === me) {
        child = null;
        tunnelUrl = null;
      }
      try {
        unlinkSync(pidFile);
      } catch {
        // 이미 없음
      }
      if (stopping) return;
      log(`터널이 꺼졌어요(${why}). 15초 뒤 다시 엽니다.`);
      setTimeout(startTunnel, 15_000);
    };
    me.on("exit", (code, signal) => restart(signal ?? `코드 ${code}`));
    me.on("error", (e) => restart(e.message));
  }

  startTunnel();
  setInterval(async () => {
    await checkTunnel();
    await announce();
  }, ANNOUNCE_EVERY);

  const stop = () => {
    stopping = true;
    child?.kill();
    server.close();
    setTimeout(() => process.exit(0), 500);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

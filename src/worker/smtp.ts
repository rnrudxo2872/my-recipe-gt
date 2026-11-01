// 메일 한 통을 보내는 작은 SMTP 클라이언트(Gmail 앱 비밀번호용).
// 소켓은 밖에서 받는다. 실제로는 Workers의 connect()로 smtp.gmail.com:465에 TLS로 붙고, 시험에서는 가짜 서버를 끼운다.

export interface SmtpSocket {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): Promise<void>;
}

export interface SmtpMail {
  from: { name: string; address: string };
  to: string;
  subject: string;
  html: string;
  text: string;
}

const encoder = new TextEncoder();
const ASCII = /^[\x20-\x7e]*$/;

/** "레시퐁 <a@b.com>" → { name: "레시퐁", address: "a@b.com" } */
export function parseAddress(value: string): { name: string; address: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2] };
  return { name: "", address: value.trim() };
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** 한글이 든 머리글을 =?UTF-8?B?…?= 조각으로 바꾼다. 조각 하나는 75자를 넘지 않는다. */
function encodeHeader(value: string): string {
  if (ASCII.test(value)) return value;
  const words: string[] = [];
  let chunk = "";
  for (const ch of value) {
    if (chunk && encoder.encode(chunk + ch).length > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(encoder.encode(w))}?=`).join("\r\n ");
}

function bodyPart(boundary: string, type: string, body: string): string {
  const lines = base64(encoder.encode(body)).replace(/.{1,76}/g, "$&\r\n");
  return `--${boundary}\r\nContent-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines}`;
}

export function buildMessage(mail: SmtpMail, opts: { date?: Date; id?: string } = {}): string {
  if ([mail.to, mail.from.address].some((v) => /[\s<>]/.test(v)) || [mail.from.name, mail.subject].some((v) => /[\r\n]/.test(v))) {
    throw new Error("메일 주소나 제목에 쓸 수 없는 글자가 있어요.");
  }
  const id = opts.id ?? crypto.randomUUID().replaceAll("-", "");
  const boundary = `=_recipong_${id}`;
  const domain = mail.from.address.split("@")[1] || "localhost";
  const name = !mail.from.name
    ? ""
    : ASCII.test(mail.from.name)
      ? `"${mail.from.name.replace(/["\\]/g, "\\$&")}" `
      : `${encodeHeader(mail.from.name)} `;
  return [
    `From: ${name}<${mail.from.address}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${(opts.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    bodyPart(boundary, "text/plain", mail.text) + bodyPart(boundary, "text/html", mail.html) + `--${boundary}--`,
  ].join("\r\n");
}

export class SmtpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

async function converse(socket: SmtpSocket, login: { user: string; password: string }, mail: SmtpMail, heloHost: string): Promise<void> {
  // 주소를 명령에 넣기 전에 먼저 검사한다.
  const message = buildMessage(mail);
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const decoder = new TextDecoder();
  let buffer = "";

  // 여러 줄 응답("250-…")은 마지막 줄("250 …")까지 모아서 돌려준다.
  async function reply(): Promise<{ code: number; text: string }> {
    const lines: string[] = [];
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) {
        const { value, done } = await reader.read();
        if (done) throw new SmtpError(0, `메일 서버가 연결을 끊었어요. ${lines.join(" ")}`.trim());
        buffer += decoder.decode(value, { stream: true });
        continue;
      }
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      lines.push(line);
      if (line.length < 4 || line[3] === " ") return { code: Number(line.slice(0, 3)), text: lines.join(" ") };
    }
  }
  async function expect(codes: number[], step: string): Promise<void> {
    const r = await reply();
    if (!codes.includes(r.code)) throw new SmtpError(r.code, `${step}: ${r.text}`);
  }
  const send = (line: string) => writer.write(encoder.encode(`${line}\r\n`));

  await expect([220], "인사");
  await send(`EHLO ${heloHost}`);
  await expect([250], "EHLO");
  await send(`AUTH PLAIN ${base64(encoder.encode(`\0${login.user}\0${login.password}`))}`);
  await expect([235], "로그인");
  await send(`MAIL FROM:<${mail.from.address}>`);
  await expect([250], "보내는 사람");
  await send(`RCPT TO:<${mail.to}>`);
  await expect([250, 251], "받는 사람");
  await send("DATA");
  await expect([354], "DATA");
  // 줄 맨 앞의 점은 본문 끝 표시와 헷갈리지 않게 두 번 쓴다.
  await writer.write(encoder.encode(`${message.replace(/\r\n\./g, "\r\n..")}\r\n.\r\n`));
  await expect([250], "본문");
  await send("QUIT");
  await reply().catch(() => undefined);
}

export async function sendSmtp(
  socket: SmtpSocket,
  login: { user: string; password: string },
  mail: SmtpMail,
  { timeoutMs = 15_000, heloHost = "recipong" } = {},
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      converse(socket, login, mail, heloHost),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError(0, "메일 서버 응답이 너무 늦어요.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    await socket.close().catch(() => undefined);
  }
}

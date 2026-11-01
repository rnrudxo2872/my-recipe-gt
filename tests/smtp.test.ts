import { describe, expect, it } from "vitest";
import { buildMessage, parseAddress, sendSmtp, type SmtpMail, type SmtpSocket } from "../src/worker/smtp";

const enc = new TextEncoder();
const dec = new TextDecoder();
const fromB64 = (s: string) => Buffer.from(s, "base64").toString("utf8");

const MAIL: SmtpMail = {
  from: { name: "레시퐁", address: "reci4257@gmail.com" },
  to: "friend@example.com",
  subject: "[레시퐁] 이메일 인증",
  text: "링크를 열어 주세요.\n.점으로 시작하는 줄",
  html: "<p>안녕하세요</p>",
};

/** Gmail처럼 대답하는 가짜 SMTP 서버. 받은 명령과 본문을 기록한다. */
function fakeServer({ authOk = true } = {}) {
  const toServer = new TransformStream<Uint8Array, Uint8Array>();
  const toClient = new TransformStream<Uint8Array, Uint8Array>();
  const out = toClient.writable.getWriter();
  const say = (s: string) => out.write(enc.encode(s));
  const log = { commands: [] as string[], data: "", closed: false };

  void (async () => {
    await say("220 smtp.test ESMTP ready\r\n");
    const reader = toServer.readable.getReader();
    let buf = "";
    let inData = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      if (inData) {
        const end = buf.indexOf("\r\n.\r\n");
        if (end === -1) continue;
        log.data = buf.slice(0, end);
        buf = buf.slice(end + 5);
        inData = false;
        await say("250 2.0.0 OK queued\r\n");
      }
      let nl: number;
      while (!inData && (nl = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        log.commands.push(line);
        if (line.startsWith("EHLO")) await say("250-smtp.test at your service\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8\r\n");
        else if (line.startsWith("AUTH")) {
          await say(authOk ? "235 2.7.0 Accepted\r\n" : "535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more\r\n");
        } else if (line.startsWith("MAIL") || line.startsWith("RCPT")) await say("250 2.1.0 OK\r\n");
        else if (line === "DATA") {
          await say("354 Go ahead\r\n");
          inData = true;
        } else if (line === "QUIT") {
          await say("221 2.0.0 closing\r\n");
          await out.close();
          return;
        }
      }
    }
  })();

  const socket: SmtpSocket = {
    readable: toClient.readable,
    writable: toServer.writable,
    close: async () => {
      log.closed = true;
    },
  };
  return { socket, log };
}

/** 본문에서 base64 조각을 꺼내 풀어 본다 */
function partBody(message: string, type: string): string {
  const start = message.indexOf(`Content-Type: ${type}`);
  const body = message.slice(message.indexOf("\r\n\r\n", start) + 4, message.indexOf("\r\n--", start));
  return fromB64(body.replace(/\r\n/g, ""));
}

describe("parseAddress", () => {
  it("splits a display name and address", () => {
    expect(parseAddress("레시퐁 <reci4257@gmail.com>")).toEqual({ name: "레시퐁", address: "reci4257@gmail.com" });
    expect(parseAddress('"Recipong" <a@b.com>')).toEqual({ name: "Recipong", address: "a@b.com" });
    expect(parseAddress(" a@b.com ")).toEqual({ name: "", address: "a@b.com" });
  });
});

describe("buildMessage", () => {
  it("encodes Korean headers and both bodies", () => {
    const msg = buildMessage(MAIL, { id: "abc123", date: new Date("2026-11-01T00:00:00Z") });
    expect(msg).toContain(`From: =?UTF-8?B?${Buffer.from("레시퐁").toString("base64")}?= <reci4257@gmail.com>`);
    expect(msg).toContain("To: <friend@example.com>");
    expect(msg).toContain("Date: Sun, 01 Nov 2026 00:00:00 +0000");
    expect(msg).toContain("Message-ID: <abc123@gmail.com>");
    const subject = msg.match(/^Subject: (.*)$/m)![1];
    expect(fromB64(subject.match(/=\?UTF-8\?B\?(.*)\?=/)![1])).toBe("[레시퐁] 이메일 인증");
    expect(partBody(msg, "text/plain")).toBe(MAIL.text);
    expect(partBody(msg, "text/html")).toBe(MAIL.html);
    expect(msg.split("\r\n").every((l) => l.length <= 78)).toBe(true);
  });

  it("splits long subjects into short encoded words", () => {
    const subject = "아주 긴 제목 ".repeat(12).trim();
    const msg = buildMessage({ ...MAIL, subject });
    const header = msg.slice(msg.indexOf("Subject: "), msg.indexOf("\r\nDate:"));
    const words = [...header.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)];
    expect(words.length).toBeGreaterThan(1);
    expect(words.every((w) => w[0].length <= 75)).toBe(true);
    expect(words.map((w) => fromB64(w[1])).join("")).toBe(subject);
  });

  it("refuses addresses that could break the conversation", () => {
    expect(() => buildMessage({ ...MAIL, to: "a@b.com>\r\nRCPT TO:<x@y.com" })).toThrow();
    expect(() => buildMessage({ ...MAIL, subject: "제목\r\nBcc: x@y.com" })).toThrow();
  });
});

describe("sendSmtp", () => {
  it("logs in with an app password and delivers the message", async () => {
    const { socket, log } = fakeServer();
    await sendSmtp(socket, { user: "reci4257@gmail.com", password: "abcdabcdabcdabcd" }, MAIL);
    expect(log.commands[0]).toBe("EHLO recipong");
    expect(fromB64(log.commands[1].replace("AUTH PLAIN ", ""))).toBe("\0reci4257@gmail.com\0abcdabcdabcdabcd");
    expect(log.commands.slice(2)).toEqual(["MAIL FROM:<reci4257@gmail.com>", "RCPT TO:<friend@example.com>", "DATA", "QUIT"]);
    expect(log.data).toContain("Subject: =?UTF-8?B?");
    expect(partBody(log.data, "text/plain")).toBe(MAIL.text);
    expect(log.closed).toBe(true);
  });

  it("fails with the server's reason when the password is wrong", async () => {
    const { socket, log } = fakeServer({ authOk: false });
    await expect(sendSmtp(socket, { user: "reci4257@gmail.com", password: "wrong" }, MAIL)).rejects.toThrow(/535.*not accepted/);
    expect(log.commands).not.toContain("DATA");
    expect(log.closed).toBe(true);
  });

  it("gives up when the server stops answering", async () => {
    const silent: SmtpSocket = { readable: new ReadableStream(), writable: new WritableStream(), close: async () => undefined };
    await expect(sendSmtp(silent, { user: "a@b.com", password: "x" }, MAIL, { timeoutMs: 50 })).rejects.toThrow(/늦어요/);
  });
});

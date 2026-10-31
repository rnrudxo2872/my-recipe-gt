#!/usr/bin/env python3
"""레시피GT 인스타그램 도우미 (폰서버용)

인스타그램은 공식 경로가 없고 클라우드 IP를 잘 막아서, 집에 있는 폰에서 캡션만 대신 읽어 준다.
영상은 받지 않고 캡션·썸네일 주소만 조회하므로 몇 초면 끝나고 폰 부담이 작다.

실행:  python insta_helper.py --port 8790 --token 아무-긴-랜덤-문자열
요청:  GET /extract?url=https://www.instagram.com/reel/XXXX/   (Authorization: Bearer 토큰)
"""

import argparse
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import yt_dlp

ALLOWED_HOSTS = {"instagram.com", "www.instagram.com", "m.instagram.com"}
CACHE_TTL = 6 * 60 * 60
CACHE_MAX = 200

cache: dict[str, tuple[float, dict]] = {}
# 폰에서 다른 서버도 돌고 있으니 한 번에 하나씩만 처리한다.
busy = threading.Semaphore(1)
TOKEN = ""
COOKIES = None


def extract(url: str) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "socket_timeout": 15,
    }
    if COOKIES:
        opts["cookiefile"] = COOKIES
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "caption": info.get("description") or "",
        "thumbnail": info.get("thumbnail"),
        "uploader": info.get("uploader") or info.get("channel") or "",
        "title": info.get("title") or "",
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, data: dict) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            return self.send_json(200, {"ok": True})
        if parsed.path != "/extract":
            return self.send_json(404, {"error": "not found"})
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            return self.send_json(401, {"error": "unauthorized"})

        url = parse_qs(parsed.query).get("url", [""])[0]
        target = urlparse(url)
        if target.scheme != "https" or (target.hostname or "") not in ALLOWED_HOSTS:
            return self.send_json(400, {"error": "instagram https url only"})

        hit = cache.get(url)
        if hit and time.time() - hit[0] < CACHE_TTL:
            return self.send_json(200, hit[1])

        if not busy.acquire(timeout=20):
            return self.send_json(503, {"error": "busy"})
        try:
            data = extract(url)
        except Exception as e:  # yt-dlp는 여러 종류의 오류를 낸다
            return self.send_json(502, {"error": str(e)[:300]})
        finally:
            busy.release()

        cache[url] = (time.time(), data)
        if len(cache) > CACHE_MAX:
            oldest = sorted(cache.items(), key=lambda kv: kv[1][0])[: len(cache) - CACHE_MAX]
            for key, _ in oldest:
                cache.pop(key, None)
        self.send_json(200, data)

    def log_message(self, fmt: str, *args) -> None:
        # 캡션이나 토큰이 로그에 남지 않도록 경로만 짧게 남긴다.
        print(f"{self.address_string()} {self.command} {urlparse(self.path).path}")


def main() -> None:
    global TOKEN, COOKIES
    parser = argparse.ArgumentParser(description="레시피GT 인스타그램 캡션 도우미")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--host", default="127.0.0.1", help="터널(cloudflared)만 접근하도록 기본은 127.0.0.1")
    parser.add_argument("--token", required=True, help="레시피GT의 INSTA_HELPER_TOKEN과 같은 값")
    parser.add_argument("--cookies", help="(선택) 로그인이 필요한 게시물용 쿠키 파일(Netscape 형식)")
    opts = parser.parse_args()
    TOKEN = opts.token
    COOKIES = opts.cookies
    server = ThreadingHTTPServer((opts.host, opts.port), Handler)
    print(f"인스타 도우미 실행 중: http://{opts.host}:{opts.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()

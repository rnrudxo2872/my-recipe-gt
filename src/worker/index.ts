import { Hono } from "hono";
import type { AppConfig } from "../shared/api";
import { aiReady } from "./ai/providers";
import { requireUser } from "./auth";
import { ApiError, type AppEnv, type HonoEnv } from "./env";
import { cleanOrphanImages, getImage, imageUrl, putImage } from "./images";
import { isUnlimited, useQuota } from "./quota";
import { account } from "./routes/account";
import { admin } from "./routes/admin";
import { fridge } from "./routes/fridge";
import { importer } from "./routes/import";
import { recipes } from "./routes/recipes";

// 일반 계정 한 명이 올릴 수 있는 사진 총수 (KV 1GB를 나눠 쓰므로)
const MAX_IMAGES_PER_MEMBER = 200;

const app = new Hono<HonoEnv>();

// 다른 사이트가 로그인 쿠키를 이용해 요청을 보내지 못하도록, 바꾸는 요청에는 우리 앱만 붙이는 헤더를 요구한다.
// (다른 출처에서 이 헤더를 붙이려면 CORS 허락이 필요한데, 이 서버는 허락하지 않는다.)
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-recipegt") !== "1") {
    throw new ApiError(403, "csrf", "잘못된 요청이에요. 페이지를 새로고침해 주세요.");
  }
  await next();
  c.header("cache-control", "no-store");
});

app.get("/api/config", (c) =>
  c.json<AppConfig>({
    appName: c.env.APP_NAME,
    turnstileSiteKey: c.env.TURNSTILE_SECRET ? c.env.TURNSTILE_SITE_KEY : "",
    instaHelper: Boolean(c.env.INSTA_HELPER_URL),
    aiReady: aiReady(c.env),
  }),
);

app.route("/api", account);
app.route("/api/recipes", recipes);
app.route("/api/import", importer);
app.route("/api/fridge", fridge);
app.route("/api/admin", admin);

app.post("/api/images", requireUser, async (c) => {
  const user = c.get("user");
  const mime = (c.req.header("content-type") ?? "").split(";")[0].trim();
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > 1_300_000) throw new ApiError(413, "image_too_large", "사진이 너무 커요. 1MB 이하로 줄여 주세요.");
  if (!isUnlimited(user)) {
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM images WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
    if ((row?.n ?? 0) >= MAX_IMAGES_PER_MEMBER) {
      throw new ApiError(403, "image_limit", `사진은 ${MAX_IMAGES_PER_MEMBER}장까지 올릴 수 있어요. 안 쓰는 레시피를 지운 뒤 다시 시도해 주세요.`);
    }
  }
  await useQuota(c.env, user, "upload");
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  const key = await putImage(c.env, user.id, bytes, mime);
  return c.json({ url: imageUrl(key) });
});

app.get("/img/:key", async (c) => {
  const img = await getImage(c.env, c.req.param("key"));
  if (!img) return c.text("Not found", 404);
  return new Response(img.body, {
    headers: {
      "content-type": img.mime,
      // 사진 주소는 바뀌지 않으므로 브라우저가 오래 보관해도 된다.
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
});

app.all("/api/*", () => {
  throw new ApiError(404, "not_found", "없는 주소예요.");
});

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal", message: "서버에 문제가 생겼어요. 잠시 뒤에 다시 시도해 주세요." } }, 500);
});

export default {
  fetch: app.fetch,
  // 매일 새벽(한국 시간 4시)에 지난 기록을 정리한다.
  async scheduled(_event: ScheduledController, env: AppEnv) {
    const now = Date.now();
    const old = new Date(now - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now),
      env.DB.prepare("DELETE FROM rate_buckets WHERE reset_at < ?1").bind(now),
      env.DB.prepare("DELETE FROM usage_daily WHERE day < ?1").bind(old),
      env.DB.prepare("DELETE FROM events WHERE created_at < ?1").bind(now - 90 * 24 * 60 * 60 * 1000),
    ]);
    await cleanOrphanImages(env);
  },
} satisfies ExportedHandler<AppEnv>;

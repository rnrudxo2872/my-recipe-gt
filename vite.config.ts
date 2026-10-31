import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      // Workers AI 같은 원격 바인딩은 로컬 개발에서 기본으로 끈다(로그인·Access 없이도 개발 서버가 뜨도록).
      // 로컬에서 실제 Workers AI를 쓰려면 CF_REMOTE=1 npm run dev
      remoteBindings: process.env.CF_REMOTE === "1",
      // 점검 스크립트는 STATE_DIR로 따로 저장해서, 직접 쓰는 로컬 데이터와 섞이지 않게 한다.
      persistState: process.env.STATE_DIR ? { path: process.env.STATE_DIR } : true,
    }),
  ],
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [
    react(),
    // Workers AI 같은 원격 바인딩은 로컬 개발에서 기본으로 끈다(로그인·Access 없이도 개발 서버가 뜨도록).
    // 로컬에서 실제 Workers AI를 쓰려면 CF_REMOTE=1 npm run dev
    cloudflare({ remoteBindings: process.env.CF_REMOTE === "1" }),
  ],
});

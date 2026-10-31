import { defineConfig } from "vitest/config";

// Cloudflare 플러그인 없이 순수 로직만 Node에서 테스트한다.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});

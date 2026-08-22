/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
    // Playwright voice-benchmark runs write traces/screenshots into
    // benchmark-results/ inside this package; watching them made the dev
    // server reload every open page mid-benchmark (found during the
    // 2026-08-14 baseline run — it systematically killed 20-client rounds).
    watch: {
      ignored: ["**/benchmark-results/**", "**/e2e/tutor/results/**"],
    },
    // Phase 5 UI 集成 e2e：tutor workspace 首挂会引入 jsxgraph 等重依赖；
    // 不预热会在测试中途触发依赖优化 → dev server 整页 reload → 会话状态
    // 重置（2026-08-22 排查）。启动时预变换学习页入口的完整依赖图。
    warmup: {
      clientFiles: ["./index.html", "./src/pages/LearnPage.tsx", "./src/pages/PracticePage.tsx"],
    },
  },
  test: {
    // geometry machines are pure, but JSXGraph adapters touch the DOM.
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // These master-branch POC checks are standalone `tsx` scripts, not Vitest suites.
    exclude: ["src/poc/geometry-actions/__tests__/**"],
  },
});

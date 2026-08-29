/// <reference types="vitest/config" />
import * as nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// fe-prep（2026-08-28）：frontend 消费 web/shared/canonical 的 Zod 镜像
// （view/v1 renderer 的唯一类型/校验来源）。frontend 自身不依赖 zod 且本轮
// 禁止 npm install，故将裸说明符解析到 backend 已安装的同版本（3.25.76，
// 与 backend 合同 parity 门禁同一份代码）。canonical 目录本身只读。
const backendZodDir = nodePath.resolve(
  nodePath.dirname(fileURLToPath(import.meta.url)),
  "../backend/node_modules/zod",
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      zod: backendZodDir,
    },
  },
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
  },
});

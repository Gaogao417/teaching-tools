/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";

/**
 * Phase 5 新代码 Vitest 入口（remediation 计划 §4.1）。
 *
 * 既有 node 直跑测试保留在 `npm test`（全仓回归不动）；本配置只收编
 * Phase 5 remediation 新代码：tutorIntelligence / coordinator 新入口 /
 * validator / API routes / 事件 v3 store。coverage 用 V8：
 * statement ≥90%、branch ≥85%（只对计入 include 的新模块收口）。
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.vitest.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // 每个测试文件独立模块图 + 独立 SQLITE_PATH（db 单例在模块加载期读 env）。
    isolate: true,
    pool: "forks",
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: [
        "src/services/tutorIntelligence/**/*.ts",
        "src/services/tutorSession/TutorSession.ts",
        "src/services/tutorSession/TutorSessionEvent.ts",
        "src/services/tutorSession/TutorSessionEventStore.ts",
        "src/services/tutorSession/TutorRuntimeStateProjection.ts",
        "src/services/tutorSession/ReasoningAligner.ts",
        "src/services/tutorSession/turnTelemetry.ts",
        "src/services/tutorPresentation/PreparePresentation.ts",
        "src/services/tutorPresentation/VoiceAction.ts",
        "src/services/tutorPresentation/WorkspaceAction.ts",
        "src/transport/http/tutorSessionRoutes.ts",
      ],
      exclude: [
        "src/**/__tests__/**",
        "src/**/*.vitest.ts",
        "src/**/*.test.ts",
        // 纯类型合同文件（无可执行语句）
        "src/services/tutorPresentation/WorkspaceAction.ts",
      ],
      thresholds: {
        // 计划 §4.1 门禁只针对 Phase 5 新代码范围（智能图/coordinator 新入口/
        // validator/HTTP 合同）；legacy 模块（store/projection/aligner）随
        // 全量测试保留，不设阈值。
        "src/services/tutorIntelligence/**": {
          statements: 90,
          branches: 85,
          functions: 80,
          lines: 90,
        },
        "src/services/tutorSession/TutorSession.ts": {
          statements: 90,
          branches: 85,
          functions: 80,
          lines: 90,
        },
        "src/services/tutorPresentation/PreparePresentation.ts": {
          statements: 90,
          branches: 85,
          functions: 80,
          lines: 90,
        },
        "src/transport/http/tutorSessionRoutes.ts": {
          statements: 90,
          branches: 85,
          functions: 80,
          lines: 90,
        },
      },
    },
  },
});

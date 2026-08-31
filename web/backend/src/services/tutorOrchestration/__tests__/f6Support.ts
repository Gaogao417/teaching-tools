/**
 * F6 测试共用工件（node 链与 vitest 共用；f6-scope-ledger 输出 7）。
 *
 * 复用 F5 navigatorSupport 的真实 canonical root 解析 / 固定题常量 / 裁决 JSON
 * 工件（G5 义务同源）；F6 侧新增：orchestrator 组合根工件（模型 pin + provider）、
 * golden 学生命令构造、journey 断言助手。
 */
import { existsSync } from "node:fs";
import * as path from "node:path";

import type { OrchestratorModelInput } from "../TutorSessionOrchestratorV5";
import { MODEL_GATE_ADJUDICATOR_VERSION, type GateAdjudicationProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";

export {
  adjudicationJson,
  clientRequestId,
  failFor,
  GOLDEN,
  passFor,
  questionOn,
  realCanonicalRoot,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  ANSWER_INVARIANTS_WRONG,
  QUESTION_IN_BOUND,
  SCAFFOLD_STEP1_OK,
} from "../../tutorNavigator/__tests__/navigatorSupport";

/** node 链专用：临时 SQLITE_PATH（先于 db 单例模块加载执行）。 */
export function ensureF6Sqlite(): void {
  if (process.env.SQLITE_PATH) return;
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-f6-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
}

/** 组合根模型声明（显式 provider + session pin；f6-scope-ledger「生产模型接线」）。 */
export function f6Model(provider: GateAdjudicationProvider, pinProvider: string, modelId = "fixed-model"): OrchestratorModelInput {
  return {
    provider,
    pin: {
      provider: pinProvider,
      model_id: modelId,
      prompt_version: MODEL_GATE_ADJUDICATOR_VERSION,
      adjudicator_version: MODEL_GATE_ADJUDICATOR_VERSION,
    },
  };
}

/** canonical 学生 workspace 命令（golden BT-02：标注已知线段 segment-AD=t）。 */
export function markKnownSegmentsCommand(input: {
  sessionId: string;
  commandId: string;
  clientCommandId: string;
  expectedWorkspaceRevision: number;
  targetIds?: string[];
  capability?: string;
}): Record<string, unknown> {
  return {
    schema: "ai_teaching_student_workspace_command/v1",
    session_id: input.sessionId,
    command_id: input.commandId,
    surface: "geometry",
    capability: input.capability ?? "similarity.mark-known-segments",
    origin: "student",
    target_ids: input.targetIds ?? ["segment-AD"],
    params: { values: { AD: "t" } },
    expected_workspace_revision: input.expectedWorkspaceRevision,
    client_command_id: input.clientCommandId,
  };
}

/** fixtures 目录（node 链 dist 运行口径：web/backend → ../shared/canonical）。 */
export const FIXTURES_DIR = path.resolve(process.cwd(), "../shared/canonical/fixtures");

export function readFixtureJson(name: string): unknown {
  if (!existsSync(path.join(FIXTURES_DIR, name))) {
    throw new Error(`fixture ${name} unreachable under ${FIXTURES_DIR}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

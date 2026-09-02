/**
 * F5 测试共用工件（node 链与 vitest 共用）：真实 canonical root 解析 +
 * 真实 Approved 链装载 + 真实链文本口径的输入常量。
 *
 * G5 义务（f5-scope-ledger）：session start 的 Plan pin 来自 F4 importer 真实
 * 产物（F4 多分辨率补救后：TP-SMV-009@v3 → PR-SMV-001/002@v3 → RG-SMV-001@v3
 * → QT/AS/PP，registry 锚定对账内建于 importer），不得用 fixture 发明教学结构。
 *
 * root 解析先例：tutorIntelligence/__tests__/alignmentDatasetGate.vitest.ts
 * （`TUTOR_E2E_CANONICAL_ROOT` 覆盖，缺省 skills 仓绝对路径；不可达即 fail，
 * 不 skip——skip 会空洞化真实链门禁）。
 */
import { existsSync } from "node:fs";
import * as path from "node:path";

import type { ImportedApprovedPlanV5 } from "../../planBuild/v5/ImportApprovedPlanV5";

/** 固定题（f4-scope-ledger「固定题目」）：QT-SMV-001 / goldenMinhangFold2020。 */
export const GOLDEN_TP_ID = "TP-SMV-009";
export const GOLDEN_TASK_ID = "goldenMinhangFold2020";
export const GOLDEN_SCENARIO_ID = "golden-similarity-mvp-001:QT-SMV-001";

export const GOLDEN = {
  tpId: GOLDEN_TP_ID,
  taskId: GOLDEN_TASK_ID,
  scenarioId: GOLDEN_SCENARIO_ID,
  mainlineProtocol: "PR-SMV-001",
  scaffoldProtocol: "PR-SMV-002",
  mainlineBeats: ["BT-01", "BT-02", "BT-03", "BT-04", "BT-05", "BT-06"] as const,
} as const;

export function realCanonicalRoot(): string {
  const root =
    process.env.TUTOR_E2E_CANONICAL_ROOT ?? "/Users/gaochong/develop/teaching-skills-mvp/artifacts/canonical-authoring";
  if (!existsSync(path.join(root, "tutor-plan", GOLDEN_TP_ID))) {
    throw new Error(
      `real canonical root unreachable: ${root}（设置 TUTOR_E2E_CANONICAL_ROOT 指向 teaching-skills-mvp artifacts/canonical-authoring）`,
    );
  }
  return root;
}

/** 经 F4 importer 公开入口装载真实 Approved 链（anchored 对账内建）。 */
export function importGoldenPlan(
  importer?: typeof import("../../planBuild/v5/ImportApprovedPlanV5"),
): ImportedApprovedPlanV5 {
  // 惰性 require：node 链须先 ensureSqlite 再加载 db 单例；importer 链经
  // canonicalInputs → RuntimeRegistrySnapshot 不触 db，但保持同一惰性纪律。
  // vitest（ESM 变换）下 require 相对解析不可用——由调用方以 ESM import 注入。
  const { importApprovedPlanV5 } =
    importer ?? (require("../../planBuild/v5/ImportApprovedPlanV5") as typeof import("../../planBuild/v5/ImportApprovedPlanV5"));
  const result = importApprovedPlanV5({ canonicalRoot: realCanonicalRoot() }, GOLDEN_TP_ID);
  if (!result.ok) {
    throw new Error(`golden plan import failed: ${result.errors.join("; ")}`);
  }
  return result.imported;
}

/**
 * canonical fixtures 目录：node 链经 dist 运行（tsc 不拷贝 .json），与 F2
 * node 链同口径以 process.cwd() 解析（web/backend → ../shared/canonical）。
 */
export const FIXTURES_DIR = path.resolve(process.cwd(), "../shared/canonical/fixtures");

// --------------------------------------------------------------------------- //
// 学生输入常量（与已发布 RG-SMV-001/PR-SMV-001/002@v3 artifact 内容逐字对齐的
// 确定性匹配文本；归一化 LCS ≥ 4 口径 = SemanticInterpreterV5）
// --------------------------------------------------------------------------- //

/** BT-02/BT-03 gate（GT-02→FN-06 相似判定；GT-03→FN-10 前置长度）的满足性作答。 */
export const ANSWER_INVARIANTS_OK = "由两组角相等可得 △CAD∽△CBA，相似比为 2:3，所以 AD=CD=8/3、BD=10/3";
/** BT-02/BT-03 gate 的不满足作答（与 FN-06/FN-10 无 ≥4 公共子串）。 */
export const ANSWER_INVARIANTS_WRONG = "BE 的长就是 99";
/** BT-05 gate（GT-05→FN-23 goal fact "$BE=1$"）的满足性作答。 */
export const ANSWER_GOAL_OK = "BE=1";
/** BT-05 gate 的不满足作答。 */
export const ANSWER_GOAL_WRONG = "BE=2";
/** 命中 SV-02（二倍角替代路线，IF-26..33）的作答；保留旧导出名以免扩大测试接口变更。 */
export const ANSWER_ALTERNATE_COORDINATE =
  "我用替代路线：设底角为 x，cos x=3/4；AB=AE=4 且 ∠BAE=180°-4x，所以 BE=8cos2x=1";
/** BT-01（in-bound、branch trigger=ask_question）的题内提问（命中 FN-03 翻折保长保角）。 */
export const QUESTION_IN_BOUND = "题目里的翻折保长保角是什么意思";
/** 与全部 RG facts/purpose 无 ≥4 公共子串的 out-of-bound 提问。 */
export const QUESTION_OUT_OF_BOUND = "明天中午吃什么比较好";
/** PR-SMV-002 BT-01 gate（无 graph_fact_id，basis=requirement）满足性作答。 */
export const SCAFFOLD_STEP1_OK = "我说不出这道题问的是什么";

let requestCounter = 0;
export const clientRequestId = (): string => {
  requestCounter += 1;
  return `cr-nav5-${String(requestCounter).padStart(4, "0")}`;
};

/** node 链专用：临时 SQLITE_PATH（先于 db 单例模块加载执行）。 */
export function ensureNavigatorSqlite(): void {
  if (process.env.SQLITE_PATH) return;
  const os = require("node:os") as typeof import("node:os");
  const fs = require("node:fs") as typeof import("node:fs");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tutor-nav5-"));
  process.env.SQLITE_PATH = path.join(dir, "test.sqlite");
}

// --------------------------------------------------------------------------- //
// R3 固定响应 provider 工件（确定性测试的「判卷人」：固定响应模型）。
// --------------------------------------------------------------------------- //

export interface AdjudicationFields {
  response_kind?: "final_answer" | "alternate_path" | "question" | "help_request" | "restatement" | "mixed_or_ambiguous";
  matched_gate_id?: string;
  verdict?: "pass" | "fail" | "unclear" | "not_applicable";
  reasoning_location?: "aligned" | "partially_aligned" | "misaligned" | "unknown";
  grounding_refs?: string[];
  brief_reason?: string;
}

/** 模型裁决 JSON 文本（缺省：final_answer/pass/aligned）。 */
export function adjudicationJson(fields: AdjudicationFields = {}): string {
  return JSON.stringify({
    response_kind: fields.response_kind ?? "final_answer",
    ...(fields.matched_gate_id !== undefined ? { matched_gate_id: fields.matched_gate_id } : {}),
    verdict: fields.verdict ?? "pass",
    reasoning_location: fields.reasoning_location ?? "aligned",
    grounding_refs: fields.grounding_refs ?? [],
    ...(fields.brief_reason !== undefined ? { brief_reason: fields.brief_reason } : {}),
  });
}

/** 常用固定响应：pass 当前 gate 并引用给定 fact。 */
export const passFor = (gateId: string, factId: string): string =>
  adjudicationJson({ response_kind: "final_answer", matched_gate_id: gateId, verdict: "pass", grounding_refs: [factId] });

/** 常用固定响应：fail（学生最终主张不满足）并锚定给定 fact。 */
export const failFor = (factId: string): string =>
  adjudicationJson({ response_kind: "final_answer", verdict: "fail", reasoning_location: "misaligned", grounding_refs: [factId] });

/** 常用固定响应：提问（in-bound 引用给定 fact / out-of-bound 无引用）。 */
export const questionOn = (factId: string | null): string =>
  adjudicationJson({
    response_kind: "question",
    verdict: "not_applicable",
    reasoning_location: factId ? "aligned" : "unknown",
    grounding_refs: factId ? [factId] : [],
  });

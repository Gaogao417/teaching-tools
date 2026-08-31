/**
 * F3 workspace kernel 测试共用数据工件（node 链与 vitest 共用）。
 *
 * 只含纯数据构造（node:crypto + type-only import），不加载 db——两种测试
 * 进程都能安全按各自时序 require/import（node 链须先 ensureSqlite 设
 * SQLITE_PATH 再加载 db 单例；vitest 由 vitest.setup.ts 前置）。
 */
import { createHash } from "node:crypto";

import type { TopicGeometryModel } from "../../../../../shared/topicPractice";
import type { WorkspacePresentationCatalogV5 } from "../WorkspacePresentationCatalogV5";
import { buildWorkspacePresentationCatalog } from "../WorkspacePresentationCatalogV5";

export const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

export const WS_REF = {
  question: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f3") },
  approachSet: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f3") },
  solutionGraph: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f3") },
  protocol: { artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f3") },
  tutorPlan: { artifact_id: "TP-SMV-002", version: "v6", content_hash: SHA("tp-f3") },
} as const;

export const WS_PROFILE_SNAPSHOT = {
  profile_id: "PP-SMV-001",
  version: "v1",
  primary_provider: "deterministic-rules",
  fallback_provider: "safe-fallback",
  model_id: "none",
  prompt_version: "pv-1",
} as const;

export const at = (): string => new Date().toISOString();

/** canonical v5 session_started payload（pin 全量字段）。 */
export function wsSessionStartedPayload() {
  return {
    task_id: "goldenMinhangCross2020",
    scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
    question_ref: { ...WS_REF.question },
    approach_set_ref: { ...WS_REF.approachSet },
    solution_graph_ref: { ...WS_REF.solutionGraph },
    protocol_refs: [{ ...WS_REF.protocol }],
    tutor_plan_ref: { ...WS_REF.tutorPlan },
    policy_profile_snapshot: { ...WS_PROFILE_SNAPSHOT },
    initial_cursor: { protocol_id: WS_REF.protocol.artifact_id, beat_id: "BT-01" },
  };
}

export function wsStartInput(sessionId: string) {
  return {
    sessionId,
    studentId: "student-f3",
    sessionStarted: wsSessionStartedPayload(),
    occurred_at: at(),
  };
}

// --------------------------------------------------------------------------- //
// catalogs
// --------------------------------------------------------------------------- //

/** canonical fixture 风格 authored 题图（元素 id 与 canonical fixtures 对齐：segment-AD…）。 */
export function fixtureGeometryBase(): TopicGeometryModel {
  return {
    viewBox: { width: 400, height: 300 },
    points: [
      { id: "A", x: 60, y: 220, derived: false },
      { id: "B", x: 300, y: 220, derived: false },
      { id: "C", x: 300, y: 100, derived: false },
      { id: "D", x: 120, y: 160, derived: false },
      { id: "E", x: 120, y: 100, derived: false },
    ],
    segments: [
      { id: "segment-AD", from: "A", to: "D", derived: false },
      { id: "segment-BC", from: "B", to: "C", derived: false },
      { id: "segment-DE", from: "D", to: "E", derived: false },
    ],
  };
}

const FIXTURE_AUTHORED_KINDS = {
  A: "point" as const,
  B: "point" as const,
  C: "point" as const,
  D: "point" as const,
  E: "point" as const,
  "segment-AD": "segment" as const,
  "segment-BC": "segment" as const,
  "segment-DE": "segment" as const,
};

/** 标准测试 catalog：题图（segment-* 风格）+ 五条 Board 条目（PG-01/PG-02）。
 * final 条目绑定 gate（R2 五级绑定）：BE-04←GT-01@BT-01、BE-05←GT-02@BT-01
 * （不同 gate 授权不同条目——wrong-resource 负例依赖该分离）。 */
export function wsTestCatalog(): WorkspacePresentationCatalogV5 {
  return buildWorkspacePresentationCatalog({
    schemaVersion: 1,
    taskId: "goldenMinhangCross2020",
    baseGeometry: fixtureGeometryBase(),
    authoredElementKinds: FIXTURE_AUTHORED_KINDS,
    boardEntries: [
      { entryId: "BE-01", kind: "statement", content: "△ADE ∽ △ABC（A 字型）", presentationGroup: "PG-01", revealRequirement: "intermediate" },
      { entryId: "BE-02", kind: "derivation", content: "AD/AB = DE/BC", presentationGroup: "PG-01", revealRequirement: "intermediate" },
      { entryId: "BE-03", kind: "derivation", content: "由 DE∥BC 得对应边成比例", presentationGroup: "PG-02", revealRequirement: "intermediate" },
      {
        entryId: "BE-04",
        kind: "conclusion",
        content: "DE = 2",
        presentationGroup: "PG-02",
        revealRequirement: "final",
        revealGate: { gateId: "GT-01", beatId: "BT-01", protocolId: "PR-SMV-002" },
      },
      {
        entryId: "BE-05",
        kind: "conclusion",
        content: "EF = 4",
        presentationGroup: "PG-02",
        revealRequirement: "final",
        revealGate: { gateId: "GT-02", beatId: "BT-01", protocolId: "PR-SMV-002" },
      },
    ],
    canonicalPathEntryIds: ["BE-01", "BE-02", "BE-03", "BE-04", "BE-05"],
  });
}

/** 无题图 catalog（投影 canonical workspace-runtime-state fixture 用——内容对齐 view fixture）。 */
export function wsFixtureStateCatalog(): WorkspacePresentationCatalogV5 {
  return buildWorkspacePresentationCatalog({
    schemaVersion: 1,
    taskId: "fixture-projection",
    boardEntries: [
      { entryId: "BE-01", kind: "statement", content: "△ADE ∽ △ABC（A 字型）", presentationGroup: "PG-01", revealRequirement: "intermediate" },
      { entryId: "BE-02", kind: "derivation", content: "AD/AB = DE/BC", presentationGroup: "PG-01", revealRequirement: "intermediate" },
      {
        entryId: "BE-05",
        kind: "conclusion",
        content: "EF = 4",
        presentationGroup: "PG-02",
        revealRequirement: "final",
        revealGate: { gateId: "GT-01", beatId: "BT-02", protocolId: "PR-SMV-002" },
      },
    ],
    canonicalPathEntryIds: ["BE-01", "BE-02", "BE-05"],
  });
}

// --------------------------------------------------------------------------- //
// truth-leak 自动推导扫描（R2 2026-08-31：废弃手工字符串黑名单——禁漏集合从
// catalog/state 自动计算，View 全树递归扫描断言零泄漏）
// --------------------------------------------------------------------------- //

/** 从 catalog + state 自动推导禁漏片段：一切 hidden 条目的 id 与 content
 * （含答案类真值——final 条目 hidden 期间即答案真值）。 */
export function deriveForbiddenTruthFragments(
  catalog: WorkspacePresentationCatalogV5,
  state: { solution_board: { entries: ReadonlyArray<{ entry_id: string; visibility: string }> } },
): string[] {
  const hiddenIds = new Set(
    state.solution_board.entries.filter((entry) => entry.visibility === "hidden").map((entry) => entry.entry_id),
  );
  const fragments: string[] = [];
  for (const entry of catalog.boardEntries) {
    if (hiddenIds.has(entry.entryId)) {
      fragments.push(entry.entryId, entry.content);
    }
  }
  return fragments;
}

/** 递归收集 View 内全部字符串（对象键与值、数组元素——嵌套任意深度）。 */
export function collectTreeStrings(node: unknown, acc: string[] = []): string[] {
  if (typeof node === "string") {
    acc.push(node);
  } else if (Array.isArray(node)) {
    node.forEach((item) => collectTreeStrings(item, acc));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      acc.push(key);
      collectTreeStrings(value, acc);
    }
  }
  return acc;
}

/** 断言 View（任意嵌套）不含任何自动推导的 hidden 真值片段（字符串包含级）。 */
export function assertNoWorkspaceTruthLeak(
  view: unknown,
  catalog: WorkspacePresentationCatalogV5,
  state: { solution_board: { entries: ReadonlyArray<{ entry_id: string; visibility: string }> } },
): void {
  const forbidden = deriveForbiddenTruthFragments(catalog, state);
  const strings = collectTreeStrings(view);
  for (const fragment of forbidden) {
    for (const value of strings) {
      if (value.includes(fragment)) {
        throw new Error(`truth leak：View 字符串 "${value}" 含 hidden 真值片段 "${fragment}"`);
      }
    }
  }
}

// --------------------------------------------------------------------------- //
// canonical WSA / SC 构造（canonical 合同全字段；shape 由 Zod 校验）
// --------------------------------------------------------------------------- //

export interface WsaOverrides {
  action_id?: string;
  decision_id?: string;
  beat_id?: string;
  surface?: "geometry" | "solution_board";
  capability?: string;
  target_ids?: string[];
  command_payload?: string;
  reveal_scope?: "none" | "target_highlight" | "step_narration" | "intermediate_result" | "final_result";
  presentation_only?: boolean;
}

export function wsa(sessionId: string, overrides: WsaOverrides = {}) {
  return {
    schema: "ai_teaching_workspace_surface_action/v1",
    session_id: sessionId,
    action_id: overrides.action_id ?? "WSA-20260829-0001",
    decision_id: overrides.decision_id ?? "TD-20260829-0001",
    ...(overrides.beat_id !== undefined ? { beat_id: overrides.beat_id } : {}),
    surface: overrides.surface ?? "solution_board",
    capability: overrides.capability ?? "board.reveal-entry",
    origin: "tutor",
    ...(overrides.target_ids !== undefined ? { target_ids: overrides.target_ids } : {}),
    ...(overrides.command_payload !== undefined ? { command_payload: overrides.command_payload } : {}),
    reveal_scope: overrides.reveal_scope ?? "step_narration",
    ...(overrides.presentation_only !== undefined ? { presentation_only: overrides.presentation_only } : {}),
  };
}

export interface ScOverrides {
  command_id?: string;
  surface?: "geometry" | "solution_board";
  capability?: string;
  target_ids?: string[];
  params?: Record<string, unknown>;
  expected_workspace_revision?: number;
  client_command_id?: string;
}

export function sc(sessionId: string, expectedRevision: number, overrides: ScOverrides = {}) {
  return {
    schema: "ai_teaching_student_workspace_command/v1",
    session_id: sessionId,
    command_id: overrides.command_id ?? "SC-20260829-0001",
    origin: "student",
    surface: overrides.surface ?? "solution_board",
    capability: overrides.capability ?? "board.submit-attempt",
    target_ids: overrides.target_ids ?? ["BE-01"],
    ...(overrides.params !== undefined ? { params: overrides.params } : {}),
    expected_workspace_revision: overrides.expected_workspace_revision ?? expectedRevision,
    client_command_id: overrides.client_command_id ?? "cc-20260829-0001",
  };
}

/** DomainCommand（Geometry 内核形状；构图 JSON 字符串给 WSA.command_payload / SC.params.command）。 */
export function constructParallelJson(throughPointId: string, referenceLineId: string, outputLineId: string): string {
  return JSON.stringify({
    commandId: `cmd-${outputLineId}`,
    actionId: "authored-demo",
    type: "construct-parallel",
    throughPointId,
    referenceLineId,
    outputLineId,
  });
}

export function setSegmentLabelJson(segmentId: string, markId: string, valueLatex: string): string {
  return JSON.stringify({
    commandId: `cmd-${markId}`,
    actionId: "authored-demo",
    type: "set-segment-label",
    segmentId,
    markId,
    valueLatex,
    labelKind: "length",
  });
}

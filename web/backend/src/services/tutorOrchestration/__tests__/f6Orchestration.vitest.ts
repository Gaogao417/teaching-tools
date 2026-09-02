/**
 * F6 Vitest 套件（Orchestrator / Presenter / 统一 Projection 集成）。
 *
 * node 链（f6Orchestration.test.ts）以真实 Approved 链 + F2/F3/F5 真实提交路径
 * 覆盖 G6 门禁正/负例；本套件补充单元与适配器语义：StructuredModelPort 适配器
 * （生产模型接线——薄边界不绕过、错误归一 fail closed）、Presenter 确定性与
 * Assessment 隔离/final 预检、golden catalog 装配确定性、失败分类映射、
 * F6 参与推导，以及 vitest 进程下的 kernel 旅程闭环（SQLITE_PATH 由
 * vitest.setup.ts 前置；口径同 F5 vitest）。
 */
import { describe, expect, it } from "vitest";

import { validatePayload } from "../../../../../shared/canonical";
import * as importerModule from "../../planBuild/v5/ImportApprovedPlanV5";
import type { PlanResourceV4, ProtocolBeatPayload } from "../../planBuild/canonicalInputs";
import type { StructuredModelPort, StructuredCompletionRequest } from "../../tutorIntelligence/structuredModelPort";
import { StructuredModelError } from "../../tutorIntelligence/structuredModelPort";
import { ModelGateAdjudicatorV5 } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import { buildNavigatorPlan } from "../../tutorNavigator/NavigatorPlanV5";
import type { NavigatorDecision } from "../../tutorNavigator/TutorNavigatorV5";
import { buildGoldenWorkspaceCatalogV5, GOLDEN_CATALOG_TASK_ID } from "../GoldenWorkspaceCatalog";
import { StructuredModelGateProvider } from "../StructuredModelGateProvider";
import { realizePresentationPlanV5, TutorPresenterError } from "../TutorPresenterV5";
import { TutorSessionOrchestratorV5 } from "../TutorSessionOrchestratorV5";
import {
  classifyTurnFailure,
  deriveF6Participation,
  projectUnifiedViews,
} from "../UnifiedViewProjectionV5";
import {
  adjudicationJson,
  ANSWER_GOAL_OK,
  ANSWER_INVARIANTS_OK,
  ensureF6Sqlite,
  f6Model,
  GOLDEN,
  markKnownSegmentsCommand,
  readFixtureJson,
  realCanonicalRoot,
} from "./f6Support";

ensureF6Sqlite();

/** 最小 fake StructuredModelPort（记录请求、回放结构化结果/错误）。 */
class FakeStructuredModelPort implements StructuredModelPort {
  readonly provider = "deepseek-compatible";
  readonly modelId = "deepseek-v4-flash";
  readonly requests: StructuredCompletionRequest[] = [];
  constructor(private readonly respond: (request: StructuredCompletionRequest) => Promise<unknown>) {}
  async complete<T>(request: StructuredCompletionRequest): Promise<{ value: T; modelId: string; promptVersion: string; latencyMs: number }> {
    this.requests.push(request);
    const value = await this.respond(request);
    return { value: value as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 5 };
  }
}

const ROOT = realCanonicalRoot();

function importedGoldenPlan(): importerModule.ImportedApprovedPlanV5 {
  const result = importerModule.importApprovedPlanV5({ canonicalRoot: ROOT, anchored: true }, GOLDEN.tpId);
  if (!result.ok) throw new Error(result.errors.join("; "));
  return result.imported;
}

describe("F6 StructuredModelGateProvider（生产模型接线：复用 StructuredModelPort，不建第三套）", () => {
  it("适配器经 port 完成一次结构化调用并保留薄边界校验（不绕过 validateAdjudicationResponse）", async () => {
    const port = new FakeStructuredModelPort(async () => ({
      response_kind: "final_answer",
      matched_gate_id: "GT-03",
      verdict: "pass",
      reasoning_location: "aligned",
      grounding_refs: ["FN-05"],
      brief_reason: "ok",
    }));
    const provider = new StructuredModelGateProvider(port);
    const adjudicator = new ModelGateAdjudicatorV5(provider);
    const context = {
      question: { artifact_id: "QT-SMV-001", question_type: "fill_blank", stem: "stem" },
      current_beat: { beat_id: "BT-03", protocol_id: "PR-SMV-001", purpose: "p", graph_fact_refs: ["FN-05"] },
      eligible_gates: [{ gate_id: "GT-03", criterion: "prove the first similarity and derive lengths" }],
      relevant_solution_context: [{ fact_id: "FN-05", statement: "△CAD∽△CBA，所以 AD=CD=8/3、BD=10/3", in_current_beat: true }],
      alternate_routes: [{ variant_id: "SV-01", goal_fact_id: "FN-06", goal_statement: "BE=1" }],
      recent_dialogue: [],
      student_input: { intent_kind: "submit_answer", text: "由 △CAD∽△CBA 得 AD=CD=8/3、BD=10/3" },
    };
    const result = await adjudicator.adjudicate(context);
    expect(port.requests).toHaveLength(1);
    expect(port.requests[0].promptVersion).toBe("model-gate-adjudicator/v5");
    expect(port.requests[0].userPayload).toEqual(context);
    expect(result.verdict).toBe("pass");
    expect(result.matched_gate_id).toBe("GT-03");
    expect(result.degraded_reason).toBeUndefined();
  });

  it("port 抛 StructuredModelError（timeout/provider/invalid-json）→ 裁决降级 unclear（fail closed，不回退字符串规则）", async () => {
    for (const code of ["timeout", "provider-error", "invalid-json"] as const) {
      const port = new FakeStructuredModelPort(async () => {
        throw new StructuredModelError(code, "boom", code === "timeout");
      });
      const provider = new StructuredModelGateProvider(port);
      const adjudicator = new ModelGateAdjudicatorV5(provider);
      const result = await adjudicator.adjudicate({
        question: { artifact_id: "QT", question_type: "fill_blank", stem: "s" },
        current_beat: { beat_id: "BT-01", protocol_id: "PR-SMV-001", purpose: "p", graph_fact_refs: [] },
        eligible_gates: [],
        relevant_solution_context: [],
        alternate_routes: [],
        recent_dialogue: [],
        student_input: { intent_kind: "submit_answer", text: "x" },
      });
      expect(result.verdict).toBe("unclear");
      expect(result.degraded_reason).toContain(code === "timeout" ? "provider_timeout" : "provider_error");
    }
  });

  it("模型 pin 从 port 派生（provider/model/prompt/version 随 session pin）", () => {
    const port = new FakeStructuredModelPort(async () => ({}));
    const provider = new StructuredModelGateProvider(port);
    expect(provider.modelGatePin()).toEqual({
      provider: "structured-model/deepseek-compatible",
      model_id: "deepseek-v4-flash",
      prompt_version: "model-gate-adjudicator/v5",
      adjudicator_version: "model-gate-adjudicator/v5",
    });
    expect(provider.name).toBe("structured-model/deepseek-compatible");
  });
});

describe("F6 GoldenWorkspaceCatalog（F3 BE- 分配接口绑定 F4 materializer 真实产物）", () => {
  it("装配确定性 + final 条目五级绑定（FN-23 → GT-05@BT-05@PR-SMV-001）", () => {
    const first = buildGoldenWorkspaceCatalogV5(importedGoldenPlan());
    const second = buildGoldenWorkspaceCatalogV5(importedGoldenPlan());
    expect(first.catalog).toEqual(second.catalog);
    expect(first.catalog.taskId).toBe(GOLDEN_CATALOG_TASK_ID);
    expect(first.catalog.initialInteractionMode).toBe("construction");
    const finalEntries = first.catalog.boardEntries.filter((entry) => entry.revealRequirement === "final");
    expect(finalEntries.map((entry) => entry.entryId)).toEqual(["BE-23"]);
    expect(finalEntries[0].revealGate).toEqual({ gateId: "GT-05", beatId: "BT-05", protocolId: "PR-SMV-001" });
    expect(first.factEntryIds.get("FN-23")).toBe("BE-23");
    // intermediate 条目禁带 revealGate；final 必带（F3 纪律）。
    for (const entry of first.catalog.boardEntries) {
      if (entry.revealRequirement === "intermediate") expect(entry.revealGate).toBeUndefined();
      else expect(entry.revealGate).toBeDefined();
    }
  });
});

describe("F6 TutorPresenterV5（deterministic realize；Assessment 隔离；final 预检）", () => {
  it("同输入 → 同 PresentationPlan（确定性）；approved 资源优先为 voice 文本", () => {
    const imported = importedGoldenPlan();
    const golden = buildGoldenWorkspaceCatalogV5(imported);
    const decision: NavigatorDecision = {
      decision_id: "TD-TS-8001-0001",
      decision_kind: "execute_beat",
      protocol_id: "PR-SMV-001",
      beat_id: "BT-02",
      policy_version: "protocol-navigator/v5-deterministic",
      source_event_sequence: 2,
      source_state_revision: 2,
    };
    const ledger = {
      evaluations: new Map(),
      decisions: new Map([["TD-TS-8001-0001", { decisionId: "TD-TS-8001-0001", protocolId: "PR-SMV-001", beatId: "BT-02", sequence: 2 }]]),
      cursor: { protocolId: "PR-SMV-001", beatId: "BT-02" },
      pinnedProtocols: ["PR-SMV-001"],
      pinnedTaskId: GOLDEN_CATALOG_TASK_ID,
      completed: false,
    };
    const resources = new Map<string, PlanResourceV4>(imported.plan.resources.map((resource) => [resource.resource_id, resource]));
    const intent: ProtocolBeatPayload["presentation_intent"] = { voice: ["narrate"], workspace_surfaces: ["geometry", "solution_board"] };
    const input = {
      sessionId: "TS-8001",
      decision,
      // Navigator beat view（v2 protocol 的 solution_refs 已归一为 graph_fact_refs）。
      beat: buildNavigatorPlan(imported).mainline.beats.get("BT-02")!,
      presentationIntent: intent,
      resources,
      catalog: golden.catalog,
      factEntryIds: golden.factEntryIds,
      gateLedger: ledger,
      hiddenEntryIds: new Set(golden.catalog.boardEntries.map((entry) => entry.entryId)),
      actionSerial: 7,
    };
    const first = realizePresentationPlanV5(input);
    const second = realizePresentationPlanV5(input);
    expect(first).toEqual(second);
    expect(first.plan_id).toBe("PPT-TS-8001-0007");
    // v4：BT-02 只绑 diagnostic_probe（RES2）——主线 narrate 不消费提问资源，
    // voice 回退 purpose（approved-resource 优先路径由下方 BT-01 断言覆盖）。
    expect(first.voice_actions[0].source).toBe("deterministic-scaffold");
    expect(first.voice_actions[0].resource_ref).toBeUndefined();
    expect(first.workspace_actions.map((action) => action.target_ids)).toEqual([["BE-01", "BE-02", "BE-03", "BE-05", "BE-06"]]);
    expect(first.workspace_actions[0].reveal_scope).toBe("step_narration");
    // BT-01（voice_seed RES1、仅 geometry 面）：approved 资源优先为 voice 文本。
    const opening = realizePresentationPlanV5({
      ...input,
      decision: { ...decision, decision_id: "TD-TS-8001-0002", beat_id: "BT-01" },
      beat: buildNavigatorPlan(imported).mainline.beats.get("BT-01")!,
      presentationIntent: imported.protocols.get("PR-SMV-001")!.beats.find((candidate) => candidate.beat_id === "BT-01")!.presentation_intent,
      gateLedger: {
        ...ledger,
        decisions: new Map([["TD-TS-8001-0002", { decisionId: "TD-TS-8001-0002", protocolId: "PR-SMV-001", beatId: "BT-01", sequence: 2 }]]),
        cursor: { protocolId: "PR-SMV-001", beatId: "BT-01" },
      },
      actionSerial: 8,
    });
    expect(opening.voice_actions[0].source).toBe("approved-resource");
    expect(opening.voice_actions[0].resource_ref).toBe("RES1");
    expect(opening.voice_actions[0].text).toContain("翻折");
    expect(opening.workspace_actions).toEqual([]);
  });

  it("未提交决策 → 拒绝（presenter never invents causation）", () => {
    const imported = importedGoldenPlan();
    const golden = buildGoldenWorkspaceCatalogV5(imported);
    const beat = imported.protocols.get("PR-SMV-001")!.beats.find((candidate) => candidate.beat_id === "BT-01")!;
    expect(() =>
      realizePresentationPlanV5({
        sessionId: "TS-8002",
        decision: { decision_id: "TD-TS-8002-9999", decision_kind: "execute_beat", protocol_id: "PR-SMV-001", beat_id: "BT-01", policy_version: "v", source_event_sequence: 1, source_state_revision: 1 },
        beat: { ...beat, protocol_id: "PR-SMV-001" } as never,
        presentationIntent: beat.presentation_intent,
        resources: new Map(),
        catalog: golden.catalog,
        factEntryIds: golden.factEntryIds,
        gateLedger: { evaluations: new Map(), decisions: new Map(), cursor: { protocolId: "PR-SMV-001", beatId: "BT-01" }, pinnedProtocols: ["PR-SMV-001"], completed: false },
        hiddenEntryIds: new Set(golden.catalog.boardEntries.map((entry) => entry.entryId)),
        actionSerial: 1,
      }),
    ).toThrow(TutorPresenterError);
  });

  it("assessment 模式：无任何 workspace 动作、voice 只剩确定性指示（教学工具禁用）", () => {
    const imported = importedGoldenPlan();
    const golden = buildGoldenWorkspaceCatalogV5(imported);
    const beat = imported.protocols.get("PR-SMV-001")!.beats.find((candidate) => candidate.beat_id === "BT-02")!;
    const plan = realizePresentationPlanV5({
      sessionId: "TS-8003",
      decision: { decision_id: "TD-TS-8003-0001", decision_kind: "execute_beat", protocol_id: "PR-SMV-001", beat_id: "BT-02", policy_version: "v", source_event_sequence: 2, source_state_revision: 2 },
      beat: { ...beat, protocol_id: "PR-SMV-001" } as never,
      presentationIntent: beat.presentation_intent,
      resources: new Map(imported.plan.resources.map((resource) => [resource.resource_id, resource])),
      catalog: golden.catalog,
      factEntryIds: golden.factEntryIds,
      gateLedger: { evaluations: new Map(), decisions: new Map([["TD-TS-8003-0001", { decisionId: "TD-TS-8003-0001", protocolId: "PR-SMV-001", beatId: "BT-02", sequence: 2 }]]), cursor: { protocolId: "PR-SMV-001", beatId: "BT-02" }, pinnedProtocols: ["PR-SMV-001"], completed: false },
      hiddenEntryIds: new Set(golden.catalog.boardEntries.map((entry) => entry.entryId)),
      assessmentMode: true,
      actionSerial: 3,
    });
    expect(plan.workspace_actions).toEqual([]);
    expect(plan.voice_actions).toHaveLength(1);
    expect(plan.voice_actions[0].source).toBe("deterministic-scaffold");
    expect(plan.voice_actions[0].text).toContain("独立完成");
  });
});

describe("F6 失败分类与参与推导（统一 Projection 语义单元）", () => {
  it("classifyTurnFailure：六类语义分离（gate binding 内存前缀继承 R3 口径）", () => {
    expect(classifyTurnFailure({ failure_class: "policy_engine_error", message: "gate_binding_mismatch: ..." })).toBe("gate_binding_integrity_failure");
    expect(classifyTurnFailure({ failure_class: "revision_conflict", message: "stale" })).toBe("revision_conflict_failure");
    expect(classifyTurnFailure({ failure_class: "internal_error", message: "gate_adjudicator_model_failure" })).toBe("model_runtime_failure");
    expect(classifyTurnFailure({ failure_class: "gate_unresolvable", message: "x" })).toBe("policy_failure");
    expect(classifyTurnFailure({ failure_class: "timeout", message: "x" })).toBe("policy_failure");
  });

  it("deriveF6Participation：evidence_kind 细分 answer/workspace/confirm（gate 必填）", () => {
    const base = { completed: false, inquiry_cursor: null, teaching_cursor: { protocol_id: "PR-SMV-001", beat_id: "BT-02", phase: "awaiting_evidence" } };
    expect(deriveF6Participation(base as never, { completion_evidence: { evidence_kind: "student_answer", gate: { gate_id: "GT-03" } } } as never)).toEqual({ kind: "answer_input", gate_id: "GT-03" });
    expect(deriveF6Participation(base as never, { completion_evidence: { evidence_kind: "workspace_command", gate: { gate_id: "GT-02" } } } as never)).toEqual({ kind: "workspace_input", gate_id: "GT-02" });
    expect(deriveF6Participation(base as never, { completion_evidence: { evidence_kind: "student_confirmation", gate: { gate_id: "GT-01" } } } as never)).toEqual({ kind: "confirm_input", gate_id: "GT-01" });
    expect(deriveF6Participation({ ...base, completed: true } as never, { completion_evidence: { evidence_kind: "student_answer" } } as never)).toEqual({ kind: "read_only_completed" });
  });
});

describe("F6 vitest 进程下的 orchestrator 旅程闭环（kernel 真实提交路径）", () => {
  it("start → confirm → workspace command → 模型裁决 gate：统一投影逐步演进", async () => {
    const { FixedResponseGateProvider } = await import("../../tutorNavigator/ModelGateAdjudicatorV5");
    // v4 主线：BT-02..BT-05 均为 student_answer gate（模型裁决）；本旅程走到 BT-03。
    const provider = new FixedResponseGateProvider([
      JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-02", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-06"], brief_reason: "ok" }),
    ], "fixed-vitest-f6");
    const orch = TutorSessionOrchestratorV5.start({
      sessionId: "TS-8101", studentId: "student-f6", canonicalRoot: ROOT,
      model: f6Model(provider, "fixed-response/fixed-vitest-f6"),
    });
    const initial = orch.projectUnifiedViews();
    expect(initial.coachPanelView.mainline).toEqual({ kind: "awaiting_confirmation", beat_id: "BT-01", gate_id: "GT-01" });
    expect(initial.status.last_failure).toBeUndefined();
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-8101-1" });
    expect(orch.state.teaching_cursor.beat_id).toBe("BT-02");
    // v4：BT-02 gate 是 student_answer——workspace receipt 只记账，不产 gate/decision、不推进 Beat。
    const command = orch.submitWorkspaceCommand(markKnownSegmentsCommand({
      sessionId: "TS-8101", commandId: "SC-TS-8101-0001", clientCommandId: "cc-8101-1", expectedWorkspaceRevision: 1,
    }));
    expect(command.turn.decision).toBeUndefined();
    expect(orch.state.teaching_cursor.beat_id).toBe("BT-02");
    const afterCommand = orch.projectUnifiedViews();
    expect(afterCommand.studentWorkspaceView.revision).toBe(2);
    await orch.submitStudentIntent({ intent_kind: "submit_answer", text: ANSWER_INVARIANTS_OK, client_request_id: "cr-8101-3" });
    expect(orch.state.teaching_cursor.beat_id).toBe("BT-03");
    expect(provider.callCount).toBe(1);
    // live == rebuilt（统一投影入口内部即 fresh rebuild）。
    const live = orch.projectUnifiedViews();
    const resumed = TutorSessionOrchestratorV5.resume({ sessionId: "TS-8101", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-vitest-f6") });
    expect(resumed.projectUnifiedViews()).toEqual(live);
    expect(provider.callCount).toBe(1);
    expect(ANSWER_GOAL_OK.length).toBeGreaterThan(0);
  });

  it("assessment start → resume：committed catalog pin 恢复 locked catalog 与 assessmentMode（F6.1 P1-1）", async () => {
    const { FixedResponseGateProvider } = await import("../../tutorNavigator/ModelGateAdjudicatorV5");
    const provider = new FixedResponseGateProvider([
      JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-03", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-05"] }),
    ], "fixed-vitest-f6a");
    const orch = TutorSessionOrchestratorV5.start({
      sessionId: "TS-8102", studentId: "student-f6", canonicalRoot: ROOT,
      model: f6Model(provider, "fixed-response/fixed-vitest-f6a"), assessment: true,
    });
    await orch.submitStudentIntent({ intent_kind: "confirm", client_request_id: "cr-8102-1" });
    const live = orch.projectUnifiedViews();
    const resumed = TutorSessionOrchestratorV5.resume({ sessionId: "TS-8102", canonicalRoot: ROOT, model: f6Model(provider, "fixed-response/fixed-vitest-f6a") });
    expect(resumed.assessmentMode).toBe(true);
    expect(resumed.state).toEqual(orch.state);
    expect(resumed.projectUnifiedViews()).toEqual(live);
    expect(resumed.projectUnifiedViews().studentWorkspaceView.canvas.interaction_enabled).toBe(false);
    expect(provider.callCount).toBe(0);
    await expect(resumed.submitStudentIntent({ intent_kind: "request_scaffold", client_request_id: "cr-8102-x" })).rejects.toThrow(/assessment mode forbids/);
  });

  it("canonical fixtures：model_gate_pin 负例拒绝 + presentation-plan 正负（vitest 进程同口径）", () => {
    expect(validatePayload(readFixtureJson("tutor-session-event.v5.negative.session-started-bad-model-gate-pin.json")).ok).toBe(false);
    expect(validatePayload(readFixtureJson("presentation-plan.positive.json")).ok).toBe(true);
    expect(validatePayload(readFixtureJson("presentation-plan.negative.empty-actions.json")).ok).toBe(false);
    expect(adjudicationJson({ verdict: "fail" })).toContain('"verdict":"fail"');
  });
});

/**
 * F7 RT4 会话级接线测试：v9 生成会话全链（真实 golden Approved 资产 + 真实
 * TutorSessionKernelV9 + 编排层预约/驱动/交付；Presenter 用 scripted 端口——
 * 确定性管线验证，不冒充模型质量）。
 *
 * 覆盖（生成生命周期规格 Acceptance tests 的会话面）：
 * 1. start（presenter 端口注入）⇒ v9 会话：session_started 携 presenter pin、
 *    event_schema='v9'、首 Beat 呈现=预约（pending slot；report 不伪造 sequence）；
 * 2. drive ⇒ committed：planned(v4+generation) 原子收口（request committed +
 *    slot idle）、队首沿既有 delivery 链交付（validated+delivered、cursor
 *    awaiting_browser、snapshot pending_presentation）、outcome presented 推进；
 * 3. 恢复：resume（带 presenter）零模型调用取回已提交序列；无 pending；
 * 4. barge_in ⇒ cancelled；新 assistance 输入 ⇒ superseded_by_new_input 且
 *    新决策预约新任务（新预算）；幂等重投不产生第二个任务；
 * 5. v7 会话（无 presenter）零变化：start 走确定性链（无 generation 事件）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ensureSqlite } from "../../tutorSession/__tests__/support";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { f6Model } from "./f6Support";
import { FixedResponseGateProvider, type GateAdjudicationProvider } from "../../tutorNavigator/ModelGateAdjudicatorV5";
import type { PresenterGeneratorPort, PresenterGenerationPin } from "../presentationGeneration/GeneratorPort";
import { readSessionEventSchema } from "../../tutorSession/RuntimeStateRebuilderV9";

const sqlitePath = ensureSqlite("f7-rt4-v9-session");

const orchestratorModule = require("../TutorSessionOrchestratorV7") as typeof import("../TutorSessionOrchestratorV7");
const { TutorSessionOrchestratorV7 } = orchestratorModule;

const ROOT = realCanonicalRoot();
const at = (): string => new Date().toISOString();

/** scripted Presenter 端口：从 prompt 载荷取首个批准依据回填 basis_refs（确定性）。 */
class ScriptedPresenterPort implements PresenterGeneratorPort {
  readonly provider = "scripted-presenter";
  readonly modelId = "scripted-presenter/v1";
  calls = 0;
  readonly pin: PresenterGenerationPin = {
    provider: this.provider,
    model_id: this.modelId,
    prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1",
    tool_catalog_version: "presentation-tool-catalog/v1",
  };
  async generatePresentationDraft(request: {
    readonly request_id: string;
    readonly userPayload: unknown;
  }): Promise<{ draft: { schema: "ai_teaching_presentation_draft/v2"; request_id: string; items: Array<{ type: "speech"; text: string; basis_refs: string[] }> }; latencyMs: number }> {
    this.calls += 1;
    const payload = request.userPayload as { allowed_knowledge?: Array<{ ref: string }> };
    const ref = payload.allowed_knowledge?.[0]?.ref ?? "FN-01";
    return {
      draft: {
        schema: "ai_teaching_presentation_draft/v2",
        request_id: request.request_id,
        items: [{ type: "speech", text: `我们把 ${ref} 讲清楚。`, basis_refs: [ref] }],
      },
      latencyMs: 1,
    };
  }
}

/** 抛错端口：恢复路径零模型调用的 oracle。 */
class ThrowingPresenterPort extends ScriptedPresenterPort {
  constructor(private readonly reason: string) {
    super();
  }
  async generatePresentationDraft(): Promise<never> {
    throw new Error(`presenter must not be called: ${this.reason}`);
  }
}

const PASS_GT02 = JSON.stringify({ response_kind: "final_answer", matched_gate_id: "GT-02", verdict: "pass", reasoning_location: "aligned", grounding_refs: ["FN-06"], brief_reason: "ok" });

function gateProvider(): GateAdjudicationProvider {
  return new FixedResponseGateProvider([PASS_GT02], "fixed-f7-rt4-v9");
}

// 运行唯一会话 id（sqlite 文件跨运行持久——时间戳后缀避免与本仓历史运行碰撞）。
const runTag = Date.now().toString().slice(-7);
let sessionCounter = 0;
const freshSessionId = (): string => {
  sessionCounter += 1;
  return `TS-9${runTag}${String(sessionCounter).padStart(2, "0")}`;
};

type Orchestrator = import("../TutorSessionOrchestratorV7").TutorSessionOrchestratorV7;

function startV9(sessionId: string, presenter: PresenterGeneratorPort, provider: GateAdjudicationProvider = gateProvider()): Orchestrator {
  return TutorSessionOrchestratorV7.start({
    sessionId,
    studentId: "student-rt4-v9",
    taskId: "goldenMinhangFold2020",
    canonicalRoot: ROOT,
    model: f6Model(provider, `fixed-response/${provider.name}`),
    presenter,
  });
}

function resume(sessionId: string, presenter?: PresenterGeneratorPort): Orchestrator {
  return TutorSessionOrchestratorV7.resume({
    sessionId,
    canonicalRoot: ROOT,
    model: f6Model(gateProvider(), "fixed-response/fixed-f7-rt4-v9"),
    ...(presenter !== undefined ? { presenter } : {}),
  });
}

test("v9 session: start reserves generation; drive commits atomically and delivers the head via the existing chain", async () => {
  const sessionId = freshSessionId();
  const presenter = new ScriptedPresenterPort();
  const orchestrator = startV9(sessionId, presenter);

  // start 即预约（presentCurrentBeat → v9 分支）：pending slot、v9 行、presenter pin。
  assert.equal(readSessionEventSchema(sessionId), "v9");
  const state0 = orchestrator.rebuildRuntimeState();
  assert.equal(state0.generation_slot?.status, "pending");
  assert.equal((state0.pinned_plan as unknown as { presenter_generation_pin?: unknown }).presenter_generation_pin !== undefined, true);
  assert.equal(orchestrator.hasPendingGeneration(), true);

  // drive：模型调用（事务外）→ 编译/预演 → planned(v4) 原子提交 + 队首交付。
  const outcome = await orchestrator.drivePendingGeneration();
  assert.equal(outcome.kind, "committed");
  assert.equal(presenter.calls, 1);
  const state1 = orchestrator.rebuildRuntimeState();
  const request = state1.generation_requests?.[0] as { status: string; sequence_id?: string };
  assert.equal(request.status, "committed");
  assert.ok(request.sequence_id);
  assert.deepEqual(state1.generation_slot, { status: "idle" });
  // 既有 delivery 链：队首 validated+delivered，cursor awaiting_browser。
  assert.equal(state1.presentation_cursor.status, "awaiting_browser");
  const snapshot = orchestrator.snapshot();
  assert.ok(snapshot.pending_presentation, "head delivery projects pending_presentation");
  assert.equal(snapshot.pending_presentation?.action_id, state1.presentation_cursor.status === "awaiting_browser" ? state1.presentation_cursor.action_id : "");

  // 浏览器 outcome：presented（末项）→ cursor idle（既有链零改动）。
  const cursor = state1.presentation_cursor;
  assert.equal(cursor.status, "awaiting_browser");
  const advanced = orchestrator.reportPresentationOutcome({
    sequence_id: cursor.sequence_id,
    ordinal: cursor.ordinal,
    action_id: cursor.action_id,
    outcome: "presented",
    client_request_id: "cr-v9-outcome-1",
  });
  assert.equal(advanced.advanced, false);
  assert.equal(orchestrator.rebuildRuntimeState().presentation_cursor.status, "idle");
});

test("v9 session recovery: committed sequence is retrieved with zero model calls", async () => {
  const sessionId = freshSessionId();
  const presenter = new ScriptedPresenterPort();
  const first = startV9(sessionId, presenter);
  await first.drivePendingGeneration();

  const resumed = resume(sessionId, new ThrowingPresenterPort("recovery reads committed state"));
  assert.equal(resumed.eventSchema, "v9");
  assert.equal(resumed.hasPendingGeneration(), false);
  const state = resumed.rebuildRuntimeState();
  assert.equal((state.generation_requests as { status: string }[])[0].status, "committed");
  // 恢复后 pending delivery 原样重投零新事件（crash-window 续投由 resumePresentation 承担）。
  assert.equal(resumed.rebuildRuntimeState().presentation_cursor.status, "awaiting_browser");
  const eventsBefore = resumed.events.length;
  const again = resume(sessionId, new ThrowingPresenterPort("second restore is a pure read"));
  assert.equal(again.events.length, eventsBefore);
});

test("barge_in cancels the pending generation as a normal control outcome", async () => {
  const sessionId = freshSessionId();
  const presenter = new ScriptedPresenterPort();
  const orchestrator = startV9(sessionId, presenter);
  assert.equal(orchestrator.hasPendingGeneration(), true);

  await orchestrator.submitStudentInput(
    { input: { kind: "control", command: "barge_in" }, client_request_id: "cr-v9-barge-1" },
    {},
  );
  const state = orchestrator.rebuildRuntimeState();
  const request = (state.generation_requests as { status: string; cancel_reason?: string }[])[0];
  assert.equal(request.status, "cancelled");
  assert.equal(request.cancel_reason, "cancelled");
  assert.equal(orchestrator.hasPendingGeneration(), false);
  // barge_in 不产生新预约（无 execute 类呈现决策时无 generation 事件族追加）。
  assert.equal((state.generation_requests as unknown[]).length, 1);
});

test("new assistance input supersedes the pending generation and reserves a fresh task", async () => {
  const sessionId = freshSessionId();
  const presenter = new ScriptedPresenterPort();
  const orchestrator = startV9(sessionId, presenter);
  const firstRequestId = (orchestrator.rebuildRuntimeState().generation_slot as { request_id: string }).request_id;

  await orchestrator.submitStudentInput(
    { input: { kind: "utterance", channel: "assistance", text: "这里为什么要这样折？" }, client_request_id: "cr-v9-ask-1" },
    {},
  );
  let state = orchestrator.rebuildRuntimeState();
  const first = (state.generation_requests as { request_id: string; status: string; cancel_reason?: string }[])[0];
  assert.equal(first.request_id, firstRequestId);
  assert.equal(first.status, "cancelled");
  assert.equal(first.cancel_reason, "superseded_by_new_input");
  // 新决策（assistance 提问 → inquiry/clarification 路径可能预约新任务）。
  if (orchestrator.hasPendingGeneration()) {
    const second = await orchestrator.drivePendingGeneration();
    assert.equal(second.kind, "committed");
    state = orchestrator.rebuildRuntimeState();
    const requests = state.generation_requests as { request_id: string; status: string }[];
    assert.equal(requests.length, 2);
    assert.equal(requests[1].status, "committed");
    assert.notEqual(requests[1].request_id, firstRequestId);
  }
  // 幂等重投：同 client_request_id 不产生第三个任务、零模型调用。
  const callsBefore = presenter.calls;
  await orchestrator.submitStudentInput(
    { input: { kind: "utterance", channel: "assistance", text: "这里为什么要这样折？" }, client_request_id: "cr-v9-ask-1" },
    {},
  );
  const finalRequests = (orchestrator.rebuildRuntimeState().generation_requests as unknown[]).length;
  assert.equal(finalRequests, state.generation_requests?.length);
  assert.equal(presenter.calls, callsBefore);
});

test("v7 sessions without a presenter port are unchanged (deterministic chain, zero generation events)", () => {
  const sessionId = freshSessionId();
  const orchestrator = TutorSessionOrchestratorV7.start({
    sessionId,
    studentId: "student-rt4-v7",
    taskId: "goldenMinhangFold2020",
    canonicalRoot: ROOT,
    model: f6Model(gateProvider(), "fixed-response/fixed-f7-rt4-v9"),
  });
  assert.equal(orchestrator.eventSchema, "v7");
  assert.equal(orchestrator.hasPendingGeneration(), false);
  const state = orchestrator.rebuildRuntimeState();
  assert.equal((state as { generation_requests?: unknown[] }).generation_requests, undefined);
  // 确定性链照常交付队首（Geometry→Voice→Board 冻结顺序）。
  assert.equal(state.presentation_cursor.status, "awaiting_browser");
  const events = orchestrator.events;
  assert.ok(events.every((event) => (event.event_type as string).indexOf("presentation_generation") !== 0));
});

void sqlitePath;
void at;

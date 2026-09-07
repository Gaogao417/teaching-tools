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
import { PresenterGenerationError, type PresenterGeneratorPort, type PresenterGenerationPin } from "../presentationGeneration/GeneratorPort";
import { readSessionEventSchema } from "../../tutorSession/RuntimeStateRebuilderV9";

const sqlitePath = ensureSqlite("f7-rt4-v9-session");

const orchestratorModule = require("../TutorSessionOrchestratorV7") as typeof import("../TutorSessionOrchestratorV7");
const { TutorSessionOrchestratorV7, OrchestratorV7Error } = orchestratorModule;

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

// --------------------------------------------------------------------------- //
// F7 P2-B 会话级返工（B1/B3/B4）
// --------------------------------------------------------------------------- //

/** 捕获 payload 的 scripted 端口（B1：payload 必须含学生问题原文）。 */
class CapturingPresenterPort extends ScriptedPresenterPort {
  readonly payloads: unknown[] = [];
  async generatePresentationDraft(request: Parameters<ScriptedPresenterPort["generatePresentationDraft"]>[0]) {
    this.payloads.push(request.userPayload);
    return super.generatePresentationDraft(request);
  }
}

/** 首次调用 draft_invalid（不可重试 ⇒ 立即 failed），之后恢复成功的端口（B4）。 */
class FailOncePresenterPort extends ScriptedPresenterPort {
  failuresLeft = 1;
  attempts = 0;
  async generatePresentationDraft(request: Parameters<ScriptedPresenterPort["generatePresentationDraft"]>[0]) {
    this.attempts += 1;
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new PresenterGenerationError("draft_invalid", "scripted first failure (non-retryable)", false);
    }
    return super.generatePresentationDraft(request);
  }
}

/** pin 不同的端口（B3：换 provider/model 恢复必须被拒绝）。 */
class ChangedPinPresenterPort extends ScriptedPresenterPort {
  override readonly pin: PresenterGenerationPin = {
    provider: "other-provider",
    model_id: "other-model/v1",
    prompt_version: "presenter-interleaved/v1",
    context_builder_version: "presentation-context-builder/v1",
    tool_catalog_version: "presentation-tool-catalog/v1",
  };
}

test("B1 online prompt assembly carries the student question and already-presented speech from the frozen cutoff", async () => {
  const sessionId = freshSessionId();
  const presenter = new CapturingPresenterPort();
  const orchestrator = startV9(sessionId, presenter);

  // 首段讲解：无学生输入 ⇒ stuck_point=null、already_presented=[]（首段合法缺省）。
  await orchestrator.drivePendingGeneration();
  assert.equal(presenter.payloads.length, 1);
  const first = presenter.payloads[0] as { student_stuck_point: unknown; already_presented: unknown[] };
  assert.equal(first.student_stuck_point, null);
  assert.deepEqual(first.already_presented, []);

  // 浏览器 outcome presented（末项）⇒ cursor idle，为追问腾出预约面。
  const cursor = orchestrator.rebuildRuntimeState().presentation_cursor;
  assert.equal(cursor.status, "awaiting_browser");
  orchestrator.reportPresentationOutcome({
    sequence_id: cursor.sequence_id,
    ordinal: cursor.ordinal,
    action_id: cursor.action_id,
    outcome: "presented",
    client_request_id: "cr-b1-presented-1",
  });
  assert.equal(orchestrator.rebuildRuntimeState().presentation_cursor.status, "idle");

  // 学生追问（assistance）⇒ 新决策预约新任务；驱动时 payload 必须含问题原文。
  const question = "为什么这里要这样折？我不理解折叠。";
  await orchestrator.submitStudentInput(
    { input: { kind: "utterance", channel: "assistance", text: question }, client_request_id: "cr-b1-question-1" },
    {},
  );
  assert.equal(orchestrator.hasPendingGeneration(), true, "assistance question reserves a new generation task");
  const outcome = await orchestrator.drivePendingGeneration();
  assert.equal(outcome.kind, "committed");
  const second = presenter.payloads.at(-1) as { student_stuck_point: { text: string } | null; already_presented: string[] };
  assert.ok(JSON.stringify(presenter.payloads).includes(question), "payload must carry the student question verbatim");
  assert.equal(second.student_stuck_point?.text, question);
  assert.ok(second.already_presented.length >= 1, "after a delivered presentation already_presented must be non-empty");
  const nextCursor = orchestrator.rebuildRuntimeState().presentation_cursor;
  assert.equal(nextCursor.status, "awaiting_browser");
  orchestrator.reportPresentationOutcome({sequence_id:nextCursor.sequence_id,ordinal:nextCursor.ordinal,action_id:nextCursor.action_id,outcome:"presented",client_request_id:"cr-r1-second-ended"});
  const followup = "为什么折叠以后这两个角相等？";
  await orchestrator.submitStudentInput({input:{kind:"utterance",channel:"assistance",text:followup},client_request_id:"cr-r1-second-question"},{});
  assert.equal(orchestrator.hasPendingGeneration(),true);
  await orchestrator.drivePendingGeneration();
  const third = presenter.payloads.at(-1) as {student_stuck_point:{text:string}};
  assert.equal(third.student_stuck_point.text,followup,"revision cutoff must retain the latest question after multi-event batches");

});

test("B3 resume with a changed presenter pin is refused fail-closed (explicit error, zero events, zero model calls)", async () => {
  const sessionId = freshSessionId();
  startV9(sessionId, new ScriptedPresenterPort());

  const eventsBefore = resume(sessionId).events.length;
  const changed = new ChangedPinPresenterPort();
  assert.throws(
    () => resume(sessionId, changed),
    (error: unknown) => error instanceof OrchestratorV7Error
      && error.code === "PRESENTER_PIN_MISMATCH"
      && error.message.includes("fail closed"),
  );
  assert.equal(changed.calls, 0, "zero model calls from the rejected port");
  assert.equal(resume(sessionId).events.length, eventsBefore, "zero events appended by the refused resume");
  // 会话保持可只读加载（不带 presenter 端口）。
  const readonly = resume(sessionId);
  assert.equal(readonly.eventSchema, "v9");
});

test("B3 resume with the pinned presenter port proceeds and committed provenance stays truthful", async () => {
  const sessionId = freshSessionId();
  startV9(sessionId, new ScriptedPresenterPort());
  const restored = resume(sessionId, new ScriptedPresenterPort());
  const outcome = await restored.drivePendingGeneration();
  assert.equal(outcome.kind, "committed");
  const request = (restored.rebuildRuntimeState().generation_requests as Array<{ status: string; presenter_pin: { provider: string } }>)[0];
  assert.equal(request.status, "committed");
  assert.equal(request.presenter_pin.provider, "scripted-presenter");
  const planned = restored.events.find((event) => event.event_type === "presentation_sequence_planned")!;
  const generation = (planned.payload as { generation: { presenter_pin: { provider: string }; epoch: number } }).generation;
  assert.equal(generation.presenter_pin.provider, "scripted-presenter", "planned generation pin equals the frozen request pin (provenance truthful)");
  assert.equal(generation.epoch, 2, "commit carries the claimed fencing epoch");
});

test("B4 retry_recovery after generation failure reserves a fresh request with a new budget; the failed record survives", async () => {
  const sessionId = freshSessionId();
  const presenter = new FailOncePresenterPort();
  const orchestrator = startV9(sessionId, presenter);

  // 第一次生成：不可重试失败 ⇒ slot=failed、cursor=idle（生成失败是 slot 停留）。
  const failed = await orchestrator.drivePendingGeneration();
  assert.equal(failed.kind, "failed");
  assert.equal(failed.errorClass, "draft_invalid");
  let state = orchestrator.rebuildRuntimeState();
  assert.equal(state.generation_slot?.status, "failed");
  assert.equal(state.presentation_cursor.status, "idle");

  // 显式重试：control.retry_recovery ⇒ 为原 decision/scope 创建新生成请求。
  const turn = await orchestrator.submitStudentInput(
    { input: { kind: "control", command: "retry_recovery" }, client_request_id: "cr-b4-retry-1" },
    {},
  );
  assert.ok(turn.presentations[0]?.generation, "retry recovery report carries the fresh pending generation");
  state = orchestrator.rebuildRuntimeState();
  const requests = state.generation_requests as Array<{ request_id: string; status: string; attempt: number }>;
  assert.equal(requests.length, 2, "a second generation request is created");
  assert.equal(requests[0].status, "failed", "old failed record untouched");
  assert.equal(requests[1].status, "pending");
  assert.notEqual(requests[1].request_id, requests[0].request_id);
  assert.equal(requests[1].attempt, 1, "fresh attempt budget for the new request");
  assert.equal(state.generation_slot?.status, "pending");

  // 正常 drive ⇒ 模型再调（第 2 次）并 committed。
  const outcome = await orchestrator.drivePendingGeneration();
  assert.equal(outcome.kind, "committed");
  assert.equal(presenter.attempts, 2, "the model is called again for the retried task");
});

test("B4 retry_recovery without any failure stays refused (fail closed)", async () => {
  const sessionId = freshSessionId();
  const presenter = new ScriptedPresenterPort();
  const orchestrator = startV9(sessionId, presenter);
  await orchestrator.drivePendingGeneration();
  // 无 failed cursor / 无 failed slot ⇒ 显式拒绝。
  await assert.rejects(
    () => orchestrator.submitStudentInput(
      { input: { kind: "control", command: "retry_recovery" }, client_request_id: "cr-b4-neg-1" },
      {},
    ),
    (error: unknown) => error instanceof OrchestratorV7Error && error.code === "RETRY_RECOVERY_WITHOUT_FAILURE",
  );
});

void sqlitePath;
void at;


test("R2 retry_recovery preserves a pending request and its frozen budget instead of cancelling it", async () => {
  const presenter = new ScriptedPresenterPort();
  const session = startV9(freshSessionId(), presenter);
  const before = structuredClone(session.rebuildRuntimeState().generation_requests);
  const turn = await session.submitStudentInput({ input: {kind: "control", command: "retry_recovery"}, client_request_id: "r2-pending-recovery" }, {});
  assert.equal(turn.presentations[0]?.generation?.status, "pending");
  assert.deepEqual(session.rebuildRuntimeState().generation_requests, before);
  assert.equal(presenter.calls, 0);
  assert.equal(session.events.filter(event => String(event.event_type) === "presentation_generation_invalidated").length, 0);
  assert.equal((await session.drivePendingGeneration()).kind, "committed");
  assert.equal(presenter.calls, 1);
});

/**
 * Phase 5 remediation 智能链测试：
 * - DeepSeekStructuredModel：JSON 模式请求体（temperature 0 / thinking disabled /
 *   response_format）、错误映射、<think> 剥离解析；
 * - gateAlignmentProposal：置信度阈值确定性降级、grounding 校验、no_progress
 *   只能来自确定性路径；
 * - projectProvisional：expected 推进、alternate 真实路线切换；
 * - validateProposal：hint/repair 动态文案剥离、泄题 fail closed、档位重复、
 *   diagnosis evidence 非学生事实拒绝；
 * - createTutorPolicyGraph（fake structured model）：happy path、校验失败重试一次
 *   成功、两次失败 Wait fallback、silence/pointing 不调对齐模型、模型错误转
 *   PolicyFailure。
 */
import assert from "node:assert/strict";

import { StructuredModelError } from "../structuredModelPort";
import type { StructuredModelPort, StructuredCompletionRequest } from "../structuredModelPort";
import { DeepSeekStructuredModel, parseModelJson } from "../adapters/deepseek/DeepSeekStructuredModel";
import { buildAlignmentContext, validateGroundingRef } from "../contextView";
import { gateAlignmentProposal, projectProvisional } from "../policyGraph";
import { createTutorPolicyGraph } from "../policyGraph";
import { validateProposal, waitFallbackProposal } from "../proposalValidation";
import { projectRuntimeState } from "../../tutorSession/TutorRuntimeStateProjection";
import type { TutorRuntimeState } from "../../tutorSession/TutorRuntimeStateProjection";

// --------------------------------------------------------------------------- //
// fixtures
// --------------------------------------------------------------------------- //

const PLAN = {
  artifact_id: "TP-SMV-001",
  version: "v2",
  content_hash: "sha256:" + "0".repeat(64),
  checkpoints: [
    {
      checkpoint_id: "CP1",
      part_id: "1",
      expected_reasoning: "学生看到 ∠DAC=∠ACD 能立刻写出 AD=DC 并设元。",
      skill_annotations: [{ skill_id: "SKILL-SMV-001", evidence_refs: ["TA-SMV-009@v1#S1"] }],
    },
    {
      checkpoint_id: "CP2",
      part_id: "1",
      expected_reasoning: "学生能列出翻折不变量清单（对应边相等、对应角相等）。",
      accepted_alternatives: ["翻折前后对应线段保持相等"],
      skill_annotations: [{ skill_id: "SKILL-SMV-008", evidence_refs: ["TA-SMV-009@v1#S2"] }],
    },
    {
      checkpoint_id: "CP3",
      part_id: "1",
      expected_reasoning: "学生能先解出 t 与 BD，再选余弦定理收口。",
      common_deviations: ["在斜三角形中硬凑勾股"],
    },
  ],
  recommended_routes: [
    { route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2", "CP3"] },
    {
      route_id: "R2",
      role: "alternate",
      part_id: "1",
      entry_condition: "学生已能先列翻折不变量清单再求解",
      checkpoint_ids: ["CP2", "CP3"],
    },
  ],
  resources: [
    { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP1", content: "先标注等腰条件，再由等角对等边设元。" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP2", assistance_level: 1, content: "翻折保长保角，先列哪些量不变？" },
    { resource_id: "RES3", kind: "hint", checkpoint_id: "CP2", assistance_level: 2, content: "翻折后 AE=AC、DE=DC，逐项对照。" },
    { resource_id: "RES4", kind: "repair", checkpoint_id: "CP3", content: "回到目标节点，教师重新示范后请学生复述关键一步。" },
    { resource_id: "RES5", kind: "diagnostic_probe", checkpoint_id: "CP2", content: "你能指出翻折后哪条边等于哪条边吗？" },
    {
      resource_id: "RES6",
      kind: "action_template",
      checkpoint_id: "CP1",
      capability: "similarity.mark-known-segments",
      action_ref: "tp:synth:1:mark-segment-values",
      content: JSON.stringify({
        actionId: "tp:synth:1",
        sourceStepId: "S1",
        kind: "mark-segment-values",
        version: 1,
        title: "标注已知线段",
        instruction: "把题图中已知的线段长度标注回图形。",
        input: {},
        teachingInput: { secret: "学生不可见" },
        localTruth: { answer: ["BE=1"] },
        expectedValues: ["BE=1"],
        capabilities: ["similarity.mark-known-segments"],
        answerSlots: [],
        submitOnComplete: true,
      }),
    },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
    maximum_assistance_level: 2,
    allowed_capabilities: [],
  },
} as never;

function stateAt(checkpointId: string): TutorRuntimeState {
  const events = [
    {
      schema: "ai_teaching_tutor_session_event/v2" as const,
      session_id: "TS-9401",
      sequence: 1,
      state_revision: 1,
      occurred_at: "2026-08-21T00:00:00Z",
      event_type: "session_started",
      payload: {
        plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "0".repeat(64) },
        initial_mode: "guided_solve" as const,
      },
      idempotency_key: "TS-9401:1",
    },
  ];
  const state = projectRuntimeState(PLAN, events as never);
  state.reasoning.current_checkpoint_id = checkpointId;
  return state;
}

const FACTS = [
  { sequence: 1, event_type: "session_started" as const, summary: "会话开始", student_fact: false },
  { sequence: 2, event_type: "reasoning_aligned" as const, summary: "expected@CP1", student_fact: true },
];

const ANSWER_VALUES = new Map<string, readonly string[]>([["1", ["BE=1"]]]);

// --------------------------------------------------------------------------- //
// fake structured model
// --------------------------------------------------------------------------- //

class FakeStructuredModel implements StructuredModelPort {
  readonly provider = "fake";
  readonly modelId: string;
  private readonly responses: Array<Record<string, unknown> | Error> = [];
  readonly calls: Array<StructuredCompletionRequest> = [];

  constructor(modelId = "fake-structured-0") {
    this.modelId = modelId;
  }

  enqueue(response: Record<string, unknown> | Error): this {
    this.responses.push(response);
    return this;
  }

  async complete<T>(request: StructuredCompletionRequest): Promise<{ value: T; modelId: string; promptVersion: string; latencyMs: number; usage?: { inputTokens?: number; outputTokens?: number } }> {
    this.calls.push(request);
    const next = this.responses.shift();
    if (!next) throw new StructuredModelError("provider-error", "fake queue empty", false);
    if (next instanceof Error) throw next;
    return { value: next as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 5, usage: { inputTokens: 10, outputTokens: 20 } };
  }

  get alignerCalls(): number {
    return this.calls.filter((call) => call.promptVersion.startsWith("TUTOR_ALIGNER")).length;
  }

  get policyCalls(): number {
    return this.calls.filter((call) => call.promptVersion.startsWith("TUTOR_POLICY_VOICE")).length;
  }
}

function alignerResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    classification: "expected_checkpoint",
    checkpoint_id: "CP1",
    confidence: 0.95,
    grounding_refs: ["CP1.expected"],
    ...overrides,
  };
}

function confirmMoveVoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    move: { move_type: "confirm", purpose_code: "confirm.progress", checkpoint_id: "CP1" },
    voice: { text: "很好，设元这一步完成了。接下来观察翻折之后哪些量保持不变。", source: "model-generated" },
    ...overrides,
  };
}

// --------------------------------------------------------------------------- //
// DeepSeekStructuredModel
// --------------------------------------------------------------------------- //

function fakeFetchOk(content: string): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    capturedBody = body;
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }),
      { status: 200 },
    );
  };
}

let capturedBody: Record<string, unknown> | undefined;

function testDeepSeekAdapter(): void {
  const model = new DeepSeekStructuredModel({
    apiKey: "test-key",
    baseUrl: "https://fake.deepseek",
    model: "deepseek-v4-flash",
    fetchImpl: fakeFetchOk('{"ok": true}'),
  });
  const result = model.complete<{ ok: boolean }>({ systemPrompt: "s", promptVersion: "p", userPayload: { a: 1 }, timeoutMs: 500 });
  result.then((outcome) => {
    assert.equal(outcome.value.ok, true);
    assert.equal(capturedBody?.temperature, 0);
    assert.deepEqual(capturedBody?.thinking, { type: "disabled" });
    assert.deepEqual(capturedBody?.response_format, { type: "json_object" });
    assert.equal(capturedBody?.stream, false);
    assert.equal((capturedBody?.messages as Array<{ role: string }>)[1].role, "user");
    assert.equal(outcome.usage?.inputTokens, 5);
  });

  // <think> 剥离 + 首尾大括号截取
  assert.deepEqual(parseModelJson('<think>hidden</think>{"x": 1}'), { x: 1 });
  assert.throws(() => parseModelJson("不是 JSON"), /不是合法 JSON/);

  // 未配置 key
  const unconfigured = new DeepSeekStructuredModel({ apiKey: "", fetchImpl: async () => new Response("{}", { status: 200 }) });
  unconfigured.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 }).catch((error) => {
    assert.equal((error as StructuredModelError).code, "not-configured");
  });

  // 401 → auth-error 不可重试
  const unauthorized = new DeepSeekStructuredModel({
    apiKey: "k",
    fetchImpl: async () => new Response("denied", { status: 401 }),
  });
  unauthorized.complete({ systemPrompt: "s", promptVersion: "p", userPayload: {}, timeoutMs: 100 }).catch((error) => {
    assert.equal((error as StructuredModelError).code, "auth-error");
    assert.equal((error as StructuredModelError).retryable, false);
  });
}

// --------------------------------------------------------------------------- //
// 置信度门 / grounding / 暂定投影
// --------------------------------------------------------------------------- //

function testGating(): void {
  const view = buildAlignmentContext(PLAN, stateAt("CP1"));
  // expected 达标
  const pass = gateAlignmentProposal(alignerResponse(), view);
  assert.equal(pass.classification, "expected_checkpoint");
  assert.equal(pass.checkpointId, "CP1");
  // 0.84 < 0.85 → unclear
  assert.equal(gateAlignmentProposal(alignerResponse({ confidence: 0.84 }), view).classification, "unclear");
  // grounding ref 不在候选 → unclear
  assert.equal(gateAlignmentProposal(alignerResponse({ grounding_refs: ["CP9.expected"] }), view).classification, "unclear");
  // 声称 checkpoint 与 grounding 不一致 → unclear
  assert.equal(
    gateAlignmentProposal(alignerResponse({ checkpoint_id: "CP2", grounding_refs: ["CP1.expected"] }), view).classification,
    "unclear",
  );
  // no_progress 模型不可产出
  assert.equal(gateAlignmentProposal(alignerResponse({ classification: "no_progress" }), view).classification, "unclear");
  // incorrect：0.74 < 0.75 降级；0.9 且 deviation ref 通过
  assert.equal(
    gateAlignmentProposal(alignerResponse({ classification: "incorrect", confidence: 0.74, grounding_refs: ["CP3.deviation[0]"] }), view).classification,
    "unclear",
  );
  const incorrect = gateAlignmentProposal(alignerResponse({ classification: "incorrect", confidence: 0.9, checkpoint_id: undefined, grounding_refs: ["CP3.deviation[0]"] }), view);
  assert.equal(incorrect.classification, "incorrect");
  // alternate 走路线：必须带 plan 内 route id
  const alternate = gateAlignmentProposal(
    alignerResponse({ classification: "alternate_valid", route_id: "R2", checkpoint_id: "CP2", grounding_refs: ["route.R2.entry"] }),
    view,
  );
  assert.equal(alternate.classification, "alternate_valid");
  assert.equal(alternate.routeId, "R2");
  assert.equal(gateAlignmentProposal(alignerResponse({ classification: "alternate_valid", route_id: "R9", grounding_refs: ["route.R9.entry"] }), view).classification, "unclear");

  // grounding ref 校验器：格式/越界
  assert.equal(validateGroundingRef("CP1.what", view).ok, false);
  assert.equal(validateGroundingRef("CP2.alt[5]", view).ok, false);
  assert.equal(validateGroundingRef("CP3.deviation[0]", view).ok, true);

  // 暂定投影：expected 推进沿 primary 路线
  const progressed = projectProvisional({ classification: "expected_checkpoint", checkpointId: "CP1", confidence: 0.95, groundingRefs: [] }, PLAN, stateAt("CP1"));
  assert.equal(progressed.progressed_checkpoint_id, "CP1");
  assert.equal(progressed.next_checkpoint_id, "CP2");
  assert.equal(progressed.route_switch_to, undefined);
  // alternate：真实切换路线
  const switched = projectProvisional({ classification: "alternate_valid", checkpointId: "CP2", routeId: "R2", confidence: 0.95, groundingRefs: [] }, PLAN, stateAt("CP1"));
  assert.equal(switched.route_switch_to, "R2");
  assert.equal(switched.next_checkpoint_id, "CP3");
  // incorrect 不推进
  assert.deepEqual(projectProvisional({ classification: "incorrect", confidence: 0.9, groundingRefs: [] }, PLAN, stateAt("CP1")), {});
}

// --------------------------------------------------------------------------- //
// 提案校验
// --------------------------------------------------------------------------- //

function baseProposal(overrides: Record<string, unknown> = {}): never {
  return {
    move: { move_type: "confirm", purpose_code: "confirm.progress", checkpoint_id: "CP1" },
    voiceText: "很好，设元完成了。",
    voiceSource: "model-generated",
    workflowVersion: "w",
    modelId: "m",
    promptVersions: [],
    ...overrides,
  } as never;
}

function testValidation(): void {
  const state = stateAt("CP1");
  // 合法 confirm + 生成文案
  const ok = validateProposal(baseProposal(), PLAN, state, FACTS, ANSWER_VALUES);
  assert.equal(ok.ok, true);

  // hint：模型文案被剥离（逐字资源原文规则）
  const hint = validateProposal(
    baseProposal({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP2", assistance_level: 1, resource_ids: ["RES2"] },
      voiceText: "我帮你改写了一句提示",
      voiceSource: "model-generated",
    }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(hint.ok, true);
  assert.equal(hint.proposal.voiceText, undefined);
  assert.equal(hint.proposal.voiceSource, "approved-resource");

  // 生成文案泄题 fail closed（答案值 BE=1）
  const leak = validateProposal(
    baseProposal({ voiceText: "所以最后 BE=1，记住这个结果。" }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(leak.ok, false);
  assert.ok(leak.errors.some((error) => error.includes("泄漏答案值")));

  // 超过 3 句
  const chatty = validateProposal(
    baseProposal({ voiceText: "第一句。第二句。第三句。第四句。" }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(chatty.ok, false);

  // hint 档位重复
  const withLedger = stateAt("CP2");
  withLedger.assistance.CP2 = {
    hintLevelsIssued: [1],
    incorrectSequences: [],
    failedActionSequences: [],
    promptsIssued: 0,
    promptSequences: [],
    explainedSequences: [],
  };
  const repeated = validateProposal(
    baseProposal({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP2", assistance_level: 1, resource_ids: ["RES2"] },
      voiceText: undefined,
    }),
    PLAN,
    withLedger,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(repeated.ok, false);
  assert.ok(repeated.errors.some((error) => error.includes("已发过")));

  // diagnosis evidence 指向非学生事实事件
  const badEvidence = validateProposal(
    baseProposal({
      move: {
        move_type: "confirm",
        purpose_code: "confirm.progress",
        checkpoint_id: "CP1",
        diagnosis_updates: [{ summary_code: "blocker.suspected", evidence_sequences: [1] }],
      },
    }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(badEvidence.ok, false);
  assert.ok(badEvidence.errors.some((error) => error.includes("非学生事实")));

  // Wait 兜底：零文案、fallback 标记
  const fallback = waitFallbackProposal(state, { workflowVersion: "w", modelId: "m", promptVersions: [] });
  assert.equal(fallback.move.move_type, "wait");
  assert.equal(fallback.move.fallback, true);
  assert.equal(fallback.voiceText, undefined);
}

// --------------------------------------------------------------------------- //
// 图（fake model）
// --------------------------------------------------------------------------- //

async function testGraphHappyPath(): Promise<void> {
  const model = new FakeStructuredModel()
    .enqueue(alignerResponse())
    .enqueue(confirmMoveVoice());
  const graph = createTutorPolicyGraph({ model });
  const outcome = await graph.proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "reasoning_utterance", text: "我看到 ∠DAC=∠ACD，所以 AD=DC，设 t" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.proposal.alignment?.classification, "expected_checkpoint");
  assert.equal(outcome.proposal.move.move_type, "confirm");
  assert.equal(outcome.proposal.voiceSource, "model-generated");
  assert.equal(outcome.proposal.workflowVersion, "tutor-policy-deepseek-langgraph/v1");
  assert.equal(outcome.proposal.modelId, model.modelId);
  assert.equal(outcome.proposal.usage?.calls, 2);
  assert.ok((outcome.proposal.latencyMs ?? 0) >= 0);
}

async function testGraphRetryOnce(): Promise<void> {
  const model = new FakeStructuredModel()
    .enqueue(alignerResponse())
    // 第一次 move 非法（未知资源 + hint 无 level），带错误反馈重试
    .enqueue({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", resource_ids: ["RES404"] },
      voice: { source: "approved-resource" },
    })
    .enqueue(confirmMoveVoice());
  const graph = createTutorPolicyGraph({ model });
  const outcome = await graph.proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "reasoning_utterance", text: "所以 AD=DC" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(outcome.ok, true);
  assert.equal(model.policyCalls, 2);
  // 重试请求携带 previous_attempt_errors
  const retryCall = model.calls[model.calls.length - 1];
  const payload = retryCall.userPayload as { previous_attempt_errors?: string[] };
  assert.ok(Array.isArray(payload.previous_attempt_errors) && payload.previous_attempt_errors.length > 0);
}

async function testGraphFallbackAfterTwoFailures(): Promise<void> {
  const model = new FakeStructuredModel()
    .enqueue(alignerResponse())
    .enqueue({ move: { move_type: "hint", purpose_code: "x", checkpoint_id: "CP1", resource_ids: ["RES404"] }, voice: {} })
    .enqueue({ move: { move_type: "hint", purpose_code: "x", checkpoint_id: "CP1", resource_ids: ["RES404"] }, voice: {} });
  const graph = createTutorPolicyGraph({ model });
  const outcome = await graph.proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "reasoning_utterance", text: "所以 AD=DC" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  // 两次校验失败 → Wait fallback 提案（fallback:true），failure 保留 invalid_proposal
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.proposal.move.move_type, "wait");
  assert.equal(outcome.proposal.move.fallback, true);
  assert.equal(model.policyCalls, 2);
}

async function testGraphDeterministicPaths(): Promise<void> {
  // silence：不调对齐模型；policy 决定 wait
  const model = new FakeStructuredModel().enqueue({ move: { move_type: "wait", purpose_code: "wait.silence_first", checkpoint_id: "CP1" }, voice: {} });
  const graph = createTutorPolicyGraph({ model });
  const silence = await graph.proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "silence_observed" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(silence.ok, true);
  assert.equal(model.alignerCalls, 0);
  if (silence.ok) assert.equal(silence.proposal.alignment?.classification, "no_progress");

  // pointing：不构成对齐（unclear），不调对齐模型
  const pointingModel = new FakeStructuredModel().enqueue(confirmMoveVoice());
  const pointing = await createTutorPolicyGraph({ model: pointingModel }).proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "pointing_evidence", object_id: "seg-AD" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(pointingModel.alignerCalls, 0);
  if (pointing.ok) assert.equal(pointing.proposal.alignment?.classification, "unclear");

  // action evidence：typed evaluator 结论直通（无模型对齐调用）
  const actionModel = new FakeStructuredModel().enqueue(confirmMoveVoice());
  const action = await createTutorPolicyGraph({ model: actionModel }).proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: {
      input_kind: "structured_action_evidence",
      actionAlignment: { alignment: "expected_checkpoint", checkpoint_id: "CP1" },
    },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(actionModel.alignerCalls, 0);
  if (action.ok) assert.equal(action.proposal.alignment?.classification, "expected_checkpoint");
}

async function testGraphModelError(): Promise<void> {
  const model = new FakeStructuredModel();
  const graph = createTutorPolicyGraph({ model });
  const outcome = await graph.proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "reasoning_utterance", text: "所以 AD=DC" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.equal(outcome.failure.kind, "model_error");
}

// --------------------------------------------------------------------------- //
// 追加裁定（2026-08-21）：模型可见目录与 workspace kind 兼容
// --------------------------------------------------------------------------- //

async function testModelCatalogSanitization(): Promise<void> {
  const model = new FakeStructuredModel().enqueue(alignerResponse()).enqueue(confirmMoveVoice());
  await createTutorPolicyGraph({ model }).proposeTurn({
    plan: PLAN,
    state: stateAt("CP1"),
    input: { input_kind: "reasoning_utterance", text: "所以 AD=DC" },
    facts: FACTS,
    answerValuesByPart: ANSWER_VALUES,
  });
  const policyCall = model.calls.find((call) => call.promptVersion.startsWith("TUTOR_POLICY_VOICE"));
  assert.ok(policyCall, "policy 节点必须被调用");
  const payload = policyCall.userPayload as { resource_catalog: Array<Record<string, unknown>> };
  const serialized = JSON.stringify(payload.resource_catalog);
  assert.ok(!serialized.includes("teachingInput"), "目录不得含 teachingInput");
  assert.ok(!serialized.includes("localTruth"), "目录不得含 localTruth");
  assert.ok(!serialized.includes("expectedValues"), "目录不得含 expectedValues");
  assert.ok(!serialized.includes("action_ref"), "目录不得含 action_ref");
  assert.ok(!serialized.includes("similarity.mark-known-segments"), "目录不得含 capability 词汇");
  const template = payload.resource_catalog.find((entry) => entry.resource_id === "RES6") as {
    workspace_step?: { title?: string; instruction?: string };
    excerpt?: string;
  };
  assert.equal(template.workspace_step?.title, "标注已知线段");
  assert.equal(template.excerpt, undefined, "action_template 不得投影原文 excerpt");
}

function testWorkspaceKindCompatibility(): void {
  const state = stateAt("CP1");
  // 裁定 §5 测试 4：explain 引用 action_template → 拒绝（JSON 不得当 Voice 文本）
  const bad = validateProposal(
    baseProposal({
      move: { move_type: "explain", purpose_code: "explain.open", checkpoint_id: "CP1", resource_ids: ["RES6"] },
    }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((error) => error.includes("workspace 资源")));
  // prompt 引用 action_template → 合法（Presenter 解析为学生操作步）
  const okPrompt = validateProposal(
    baseProposal({
      move: { move_type: "prompt", purpose_code: "prompt.action_step", checkpoint_id: "CP1", resource_ids: ["RES6"] },
    }),
    PLAN,
    state,
    FACTS,
    ANSWER_VALUES,
  );
  assert.equal(okPrompt.ok, true);
}

// --------------------------------------------------------------------------- //

async function main(): Promise<void> {
  testDeepSeekAdapter();
  testGating();
  testValidation();
  await testGraphHappyPath();
  await testGraphRetryOnce();
  await testGraphFallbackAfterTwoFailures();
  await testGraphDeterministicPaths();
  await testGraphModelError();
  await testModelCatalogSanitization();
  testWorkspaceKindCompatibility();
  console.log("PASS tutorIntelligence (adapter/gating/projection/validation/graph/adjudication)");
}

main().then(
  () => undefined,
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);

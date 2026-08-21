/**
 * P5-09/10：Presenter 与 WorkspaceAction 安全 adapter 测试——一 Move 零到多
 * 动作、Wait 零呈现、Confirm 只说话、workspace 五重校验、truth isolation。
 */
import assert from "node:assert/strict";

const { preparePresentation } = require("../PreparePresentation") as typeof import("../PreparePresentation");
const { VOICE_SCAFFOLDS } = require("../VoiceAction") as typeof import("../VoiceAction");
const {
  validateWorkspaceAction,
} = require("../adapters/legacyActionRuntime/workspaceActionAdapter") as typeof import("../adapters/legacyActionRuntime/workspaceActionAdapter");

const TEMPLATE = {
  actionId: "tp:TP-SMV-001:1:enter-text",
  sourceStepId: "S3",
  kind: "enter-text",
  version: 1,
  title: "本题结论",
  instruction: "写出最终结论。",
  input: { placeholder: "写出本题结论" },
  teachingInput: { expectedValues: ["$1$"] },
  capabilities: ["similarity.plan-similarity-proof", "agent:select-object"],
  answerSlots: [{ id: "value", label: "结论", kind: "text", required: true }],
  submitOnComplete: true,
};

const PLAN = {
  artifact_id: "TP-SMV-001",
  checkpoints: [
    { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "写出 AD=DC" },
    { checkpoint_id: "CP3", part_id: "1", expected_reasoning: "解出 BE" },
  ],
  recommended_routes: [{ route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP3"] }],
  resources: [
    { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP1", source: "authored", content: "标注等腰条件，由等角对等边得 AD=DC。" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP1", assistance_level: 1, source: "agent_generated", content: "读题标注，等角翻译成等边" },
    { resource_id: "RES14", kind: "action_template", checkpoint_id: "CP3", source: "agent_generated", action_ref: "tp:TP-SMV-001:1:enter-text", capability: "similarity.plan-similarity-proof", content: JSON.stringify(TEMPLATE) },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
    allowed_capabilities: ["similarity.plan-similarity-proof"],
    forbidden_content_kinds: ["canonical_answer"],
    maximum_assistance_level: 2,
    assessment_enabled: false,
  },
};

const STATE = {
  session_id: "TS-9501",
  plan_ref: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:x" },
  initial_mode: "guided_solve",
  mode: "guided_solve",
  revision: 1,
  last_sequence: 1,
  curriculum: { parts: [{ part_id: "1", route_id: "R1", checkpoint_ids: ["CP1", "CP3"], current_index: 0, completed_checkpoints: [] }], current_part_index: 0, completed: false },
  dialogue: { answered_questions: [] },
  reasoning: { current_checkpoint_id: "CP3", self_corrections: [], interruptions: [], consecutive_no_progress: 0 },
  workspace: { action_history: [] },
  assistance: {},
  working_diagnosis: [],
  repair: { active: false },
  failures: { policy_failures: [], runtime_failures: [] },
  completed: false,
};

function decision(move_type: string, overrides?: Record<string, unknown>) {
  return {
    decision_id: "TD-TS-9501-1",
    move_type,
    purpose_code: `${move_type}.generic`,
    policy_version: "tutor-policy-deterministic-rules/v1",
    source_event_sequence: 1,
    source_state_revision: 1,
    ...overrides,
  } as never;
}

const PROJECTION = {
  plan_ref: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:x" },
  parts: [],
  action_contracts: [
    {
      resource_id: "RES14",
      action_ref: "tp:TP-SMV-001:1:enter-text",
      learn: { ...TEMPLATE, localTruth: { expectedValues: ["$1$"] } },
      assessment: (() => {
        const copy = { ...TEMPLATE } as Record<string, unknown>;
        delete copy.teachingInput;
        delete (copy as { localTruth?: unknown }).localTruth;
        return copy;
      })(),
    },
  ],
};

function main(): void {
  // Explain：资源原文派生 1 条 voice
  const explain = preparePresentation({
    decision: decision("explain", { purpose_code: "explain.open", checkpoint_id: "CP1", resource_ids: ["RES1"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 1,
    workspaceOrdinal: 1,
    answerValues: ["$1$"],
  });
  assert.equal(explain.ok, true);
  assert.equal(explain.presentation!.voice.length, 1);
  assert.equal(explain.presentation!.voice[0].text, "标注等腰条件，由等角对等边得 AD=DC。");
  assert.equal(explain.presentation!.voice[0].interruptible, true);

  // Hint：资源原文、零 workspace（hint 不交接操作步）
  const hint = preparePresentation({
    decision: decision("hint", { purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 2,
    workspaceOrdinal: 1,
    answerValues: ["$1$"],
  });
  assert.equal(hint.presentation!.voice[0].text, "读题标注，等角翻译成等边");
  assert.equal(hint.presentation!.workspace.length, 0);

  // Prompt at action checkpoint：voice + workspace 附着（交互步交给学生）
  const prompt = preparePresentation({
    decision: decision("prompt", { purpose_code: "prompt.action_step", checkpoint_id: "CP3" }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 3,
    workspaceOrdinal: 1,
    answerValues: ["$1$"],
  });
  assert.equal(prompt.presentation!.voice.length, 1);
  assert.equal(prompt.presentation!.workspace.length, 1);
  assert.equal(prompt.presentation!.workspace[0].capability, "similarity.plan-similarity-proof");
  assert.equal((prompt.presentation!.workspace[0].command_payload as { resource_id: string }).resource_id, "RES14");
  assert.equal(prompt.presentation!.voice[0].text, VOICE_SCAFFOLDS["prompt.action_step"]);

  // Confirm：只说话；Wait：零动作
  const confirm = preparePresentation({
    decision: decision("confirm", { purpose_code: "confirm.progress", checkpoint_id: "CP1" }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 4,
    workspaceOrdinal: 1,
    answerValues: ["$1$"],
  });
  assert.equal(confirm.presentation!.voice.length, 1);
  assert.equal(confirm.presentation!.workspace.length, 0);

  const wait = preparePresentation({
    decision: decision("wait", { purpose_code: "wait.silence_first", checkpoint_id: "CP1" }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 5,
    workspaceOrdinal: 1,
    answerValues: ["$1$"],
  });
  assert.equal(wait.presentation!.voice.length, 0);
  assert.equal(wait.presentation!.workspace.length, 0);

  // 泄漏兜底：脚手架命中答案值 → 拒绝派生
  const leaky = preparePresentation({
    decision: decision("confirm", { purpose_code: "confirm.progress", checkpoint_id: "CP1" }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 6,
    workspaceOrdinal: 1,
    answerValues: ["成立。继续"],
  });
  assert.equal(leaky.ok, false, "脚手架文本命中答案值必须被泄漏自查拦截");

  // WorkspaceAction 五重校验
  const baseAction = {
    action_id: "WA-TS-9501-1",
    decision_id: "TD-TS-9501-1",
    capability: "similarity.plan-similarity-proof",
    target_ids: [],
    command_payload: { resource_id: "RES14", action_ref: "tp:TP-SMV-001:1:enter-text", mode: "learn" },
  };

  const valid = validateWorkspaceAction(baseAction as never, PLAN as never, PROJECTION as never);
  assert.equal(valid.ok, true, `合法动作应通过: ${valid.errors.join(";")}`);
  assert.equal(valid.template?.actionId, "tp:TP-SMV-001:1:enter-text");
  assert.ok(!JSON.stringify(valid.student_view).includes("expectedValues"), "学生面不得含 expectedValues");
  assert.ok(!JSON.stringify(valid.student_view).includes("localTruth"), "学生面不得含 localTruth");
  assert.ok(JSON.stringify(valid.learn_contract).includes("localTruth"), "learn 面应持有 localTruth");

  const badCapability = validateWorkspaceAction(
    { ...baseAction, capability: "workspace.focus-objects" } as never,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(badCapability.ok, false);
  assert.ok(badCapability.errors.join(";").includes("allowed_capabilities"));

  const badTarget = validateWorkspaceAction(
    { ...baseAction, command_payload: { resource_id: "RES999", action_ref: "x", mode: "learn" } } as never,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(badTarget.ok, false);
  assert.ok(badTarget.errors.join(";").includes("RES999"));

  const badMode = validateWorkspaceAction(
    { ...baseAction, command_payload: { resource_id: "RES14", action_ref: "tp:TP-SMV-001:1:enter-text", mode: "assessment" } } as never,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(badMode.ok, false);

  const assessment = validateWorkspaceAction(baseAction as never, PLAN as never, PROJECTION as never, { sessionKind: "assessment" });
  assert.equal(assessment.ok, false);
  assert.ok(assessment.errors.join(";").includes("Assessment"));

  // ---- 2026-08-21 追加裁定 §5/§6/§8：kind 分流与生命周期隔离 ----
  const { resolveWorkspacePresentation } = require("../PreparePresentation") as typeof import("../PreparePresentation");

  // 测试 4：explain 引用 action_template → 不得把 JSON 当 Voice 文本下发
  const explainWithTemplate = preparePresentation({
    decision: decision("explain", { purpose_code: "explain.open", checkpoint_id: "CP1", resource_ids: ["RES1", "RES14"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 9,
    workspaceOrdinal: 9,
    answerValues: ["$1$"],
  });
  assert.equal(explainWithTemplate.ok, true);
  assert.equal(explainWithTemplate.presentation!.voice.length, 1, "action_template 不得成为 Voice 文本");
  assert.equal(explainWithTemplate.presentation!.voice[0].resource_id, "RES1");
  assert.ok(!explainWithTemplate.presentation!.voice[0].text.includes("actionId"), "Voice 不得携带模板 JSON");

  // 测试 3：prompt 显式引用 action_template → Presenter 确定性解析为 workspace 草案
  const promptWithTemplate = preparePresentation({
    decision: decision("prompt", { purpose_code: "prompt.generic", checkpoint_id: "CP3", resource_ids: ["RES14"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 10,
    workspaceOrdinal: 10,
    answerValues: ["$1$"],
  });
  assert.equal(promptWithTemplate.ok, true);
  assert.equal(promptWithTemplate.presentation!.workspace.length, 1, "prompt 引用 action_template 应派生 workspace 草案");

  // 测试 3b：prompt 只引用 explanation → 零 workspace（explanation 永不是 Workspace 资源）
  const promptWithExplanation = preparePresentation({
    decision: decision("prompt", { purpose_code: "prompt.generic", checkpoint_id: "CP1", resource_ids: ["RES1"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 11,
    workspaceOrdinal: 11,
    answerValues: ["$1$"],
  });
  assert.equal(promptWithExplanation.ok, true);
  assert.equal(promptWithExplanation.presentation!.workspace.length, 0, "explanation 不得解析为 WorkspaceAction");

  // 测试 7/8：resolveWorkspacePresentation 生命周期——合法草案升格为
  // ValidatedWorkspaceAction（学生安全形态），非法草案留在 failures、不进呈现
  const goodResolution = resolveWorkspacePresentation(
    promptWithTemplate.presentation!.workspace,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(goodResolution.presentation.length, 1);
  assert.equal(goodResolution.failures.length, 0);
  const validated = goodResolution.presentation[0];
  assert.equal(validated.resource_id, "RES14");
  assert.equal(validated.action_ref, "tp:TP-SMV-001:1:enter-text");
  const serializedView = JSON.stringify(validated);
  assert.ok(!serializedView.includes("localTruth"), "已验证呈现不得含 localTruth");
  assert.ok(!serializedView.includes("teachingInput"), "已验证呈现不得含 teachingInput");
  assert.ok(!serializedView.includes("expectedValues"), "已验证呈现不得含 expectedValues");
  assert.ok(!("learn_contract" in validated), "已验证呈现不得携带 learn_contract");

  // 测试 5：capability 不在 plan allowlist → 不签发、不返回（只留失败记录）
  const badCapabilityResolution = resolveWorkspacePresentation(
    [{ ...baseAction, capability: "workspace.focus-objects" }] as never,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(badCapabilityResolution.presentation.length, 0, "非法 capability 不得进入已验证呈现");
  assert.equal(badCapabilityResolution.failures.length, 1);

  // 测试 6：action_ref 不在确定性投影 → 不签发、不返回
  const badRefResolution = resolveWorkspacePresentation(
    [{ ...baseAction, command_payload: { resource_id: "RES14", action_ref: "tp:missing:9:x", mode: "learn" } }] as never,
    PLAN as never,
    PROJECTION as never,
  );
  assert.equal(badRefResolution.presentation.length, 0, "投影外 action_ref 不得进入已验证呈现");
  assert.equal(badRefResolution.failures.length, 1);

  // 测试 11：Hint/Repair 文本与批准资源逐字一致（不截断、不包装）
  const hintVerbatim = preparePresentation({
    decision: decision("hint", { purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] }),
    plan: PLAN as never,
    state: STATE as never,
    sessionId: "TS-9501",
    voiceOrdinal: 12,
    workspaceOrdinal: 12,
    answerValues: ["$1$"],
  });
  const hintResource = (PLAN as { resources: Array<{ resource_id: string; content: string }> }).resources.find((r) => r.resource_id === "RES2")!;
  assert.equal(hintVerbatim.presentation!.voice[0].text, hintResource.content, "hint 逐字使用批准资源原文");

  console.log("PASS preparePresentation + workspaceActionAdapter (0..n actions, 5-fold validation, truth isolation, adjudication lifecycle)");
}

main();

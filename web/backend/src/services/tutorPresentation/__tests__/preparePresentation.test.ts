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

  console.log("PASS preparePresentation + workspaceActionAdapter (0..n actions, 5-fold validation, truth isolation)");
}

main();

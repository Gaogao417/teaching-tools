/**
 * P5-06/07/08：DecideTutorMove 组合测试——plan constraints fail closed、
 * safe fallback（timeout / 非法 move / 异常）、Assessment fail closed。
 */
import assert from "node:assert/strict";

const { createDecideTutorMove } = require("../DecideTutorMove") as typeof import("../DecideTutorMove");
const { validateDecisionAgainstPlan } = require("../TutorMove") as typeof import("../TutorMove");
const { deterministicRulesPolicy, DETERMINISTIC_POLICY_VERSION } = require("../adapters/model/deterministicRulesPolicy") as typeof import("../adapters/model/deterministicRulesPolicy");

const PLAN = {
  artifact_id: "TP-SMV-001",
  checkpoints: [
    { checkpoint_id: "CP1", part_id: "1", expected_reasoning: "写出 AD=DC 并设元" },
  ],
  recommended_routes: [{ route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1"] }],
  resources: [
    { resource_id: "RES1", kind: "hint", checkpoint_id: "CP1", assistance_level: 1, source: "agent_generated", content: "读题标注" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP1", assistance_level: 2, source: "agent_generated", content: "检查条件" },
    { resource_id: "RES3", kind: "explanation", checkpoint_id: "CP1", source: "authored", content: "讲解" },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait"],
    allowed_capabilities: ["similarity.plan-similarity-proof"],
    forbidden_content_kinds: ["canonical_answer"],
    maximum_assistance_level: 2,
    assessment_enabled: false,
  },
};

const STATE = {
  session_id: "TS-9401",
  plan_ref: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:x" },
  initial_mode: "guided_solve",
  mode: "guided_solve",
  revision: 3,
  last_sequence: 3,
  curriculum: { parts: [{ part_id: "1", route_id: "R1", checkpoint_ids: ["CP1"], current_index: 0, completed_checkpoints: [] }], current_part_index: 0, completed: false },
  dialogue: { answered_questions: [] },
  reasoning: { current_checkpoint_id: "CP1", self_corrections: [], interruptions: [], consecutive_no_progress: 0 },
  workspace: { action_history: [] },
  assistance: {
    CP1: {
      hintLevelsIssued: [],
      incorrectSequences: [3],
      failedActionSequences: [],
      promptsIssued: 0,
      promptSequences: [],
      explainedSequences: [],
    },
  },
  working_diagnosis: [],
  repair: { active: false },
  failures: { policy_failures: [], runtime_failures: [] },
  completed: false,
};

function context(overrides?: Record<string, unknown>) {
  return {
    plan: PLAN,
    state: STATE,
    trigger: { kind: "student_input", event_sequence: 3, input_kind: "reasoning_utterance", alignment: "incorrect" },
    session_kind: "tutoring",
    ...overrides,
  } as never;
}

async function main(): Promise<void> {
  // 1. 决策越界被 plan constraints 拒绝（fail closed 矩阵）
  const bad = validateDecisionAgainstPlan(
    { move_type: "repair", purpose_code: "repair.ladder_exhausted", resource_ids: ["RES1"] } as never,
    PLAN as never,
    STATE as never,
  );
  assert.equal(bad.ok, false, "repair move 不在 allowed_move_types");
  assert.ok(bad.errors.join(";").includes("allowed_move_types"));

  const levelOverflow = validateDecisionAgainstPlan(
    { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 3, resource_ids: ["RES1"] } as never,
    { ...PLAN, policy_constraints: { ...PLAN.policy_constraints, allowed_move_types: ["hint"] } } as never,
    STATE as never,
  );
  assert.equal(levelOverflow.ok, false);
  assert.ok(levelOverflow.errors.join(";").includes("maximum_assistance_level"));

  const dangling = validateDecisionAgainstPlan(
    { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES999"] } as never,
    { ...PLAN, policy_constraints: { ...PLAN.policy_constraints, allowed_move_types: ["hint"] } } as never,
    STATE as never,
  );
  assert.equal(dangling.ok, false);
  assert.ok(dangling.errors.join(";").includes("RES999"));

  // 2. 确定性 policy：incorrect → prompt（先诱导自我修正）
  const decideOk = createDecideTutorMove(deterministicRulesPolicy, { timeoutMs: 500 });
  const firstIncorrect = await decideOk(context());
  assert.ok(firstIncorrect.draft);
  assert.equal(firstIncorrect.draft!.move_type, "prompt");
  assert.equal(firstIncorrect.draft!.purpose_code, "prompt.self_check");
  assert.ok(firstIncorrect.draft!.diagnosis_updates?.length, "incorrect 必须留诊断更新");

  // 3. timeout → safe fallback（Wait、fallback:true、失败信息保留）
  const slow = {
    policyVersion: "tutor-policy-slow/v1",
    decide: async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return { ok: true as const, decision: null, policy_version: "tutor-policy-slow/v1" };
    },
  };
  const decideSlow = createDecideTutorMove(slow as never, { timeoutMs: 30 });
  const timeoutOutcome = await decideSlow(context());
  assert.ok(timeoutOutcome.draft, "timeout 后必须有回退决策");
  assert.equal(timeoutOutcome.draft!.move_type, "wait");
  assert.equal(timeoutOutcome.draft!.fallback, true);
  assert.equal(timeoutOutcome.failure?.failure_class, "policy_timeout");
  assert.equal(timeoutOutcome.failure?.fallback_used, true);

  // 4. 内层抛异常 → INVALID_MOVE fallback
  const throwing = {
    policyVersion: "tutor-policy-throw/v1",
    decide: () => {
      throw new Error("model exploded");
    },
  };
  const decideThrow = createDecideTutorMove(throwing as never, { timeoutMs: 100 });
  const thrownOutcome = await decideThrow(context());
  assert.equal(thrownOutcome.draft!.move_type, "wait");
  assert.equal(thrownOutcome.failure?.failure_class, "policy_invalid_move");

  // 5. 内层返回非法 move（repair 越权）→ 约束校验回退 Wait
  const invalid = {
    policyVersion: "tutor-policy-invalid/v1",
    decide: () => ({
      ok: true as const,
      decision: { move_type: "repair" as const, purpose_code: "repair.ladder_exhausted", resource_ids: ["RES1"] },
      policy_version: "tutor-policy-invalid/v1",
    }),
  };
  const decideInvalid = createDecideTutorMove(invalid as never, { timeoutMs: 100 });
  const invalidOutcome = await decideInvalid(context());
  assert.equal(invalidOutcome.draft!.move_type, "wait");
  assert.equal(invalidOutcome.draft!.fallback, true);
  assert.equal(invalidOutcome.failure?.failure_class, "policy_invalid_move");

  // 6. Assessment fail closed：无回退、无决策
  const assessmentOutcome = await decideOk(context({ session_kind: "assessment" }));
  assert.equal(assessmentOutcome.draft, null, "Assessment 不得产生任何教学 move");
  assert.equal(assessmentOutcome.failure?.failure_class, "assessment_fail_closed");
  assert.equal(assessmentOutcome.failure?.fallback_used, false);
  assert.equal(DETERMINISTIC_POLICY_VERSION, "tutor-policy-deterministic-rules/v1");

  console.log("PASS decideTutorMove (constraints, fallback, assessment fail-closed)");
}

void main();

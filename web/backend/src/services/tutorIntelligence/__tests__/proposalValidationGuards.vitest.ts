/**
 * validateProposal 护栏分支收口测试（Phase 5 收口：coverage 门禁 branch ≥85
 * 的缺口集中在 proposalValidation——基线 74.33%）。逐条覆盖：
 * 文案长度/句长/空文案、unclear 首 hint、自我修正确认、挣扎基线、
 * 档位耗尽、非冻结 candidate skill、isRetryableModelError 双分支。
 */
import { describe, expect, it } from "vitest";

import { validateProposal } from "../proposalValidation";
import { isRetryableModelError, StructuredModelError } from "../structuredModelPort";
import { projectRuntimeState, type TutorRuntimeState } from "../../tutorSession/TutorRuntimeStateProjection";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";
import type { TutorTurnProposal } from "../proposal";

const PLAN = {
  artifact_id: "TP-SMV-001",
  version: "v2",
  content_hash: "sha256:" + "0".repeat(64),
  checkpoints: [
    {
      checkpoint_id: "CP1",
      part_id: "1",
      expected_reasoning: "学生看到 ∠DAC=∠ACD 能立刻写出 AD=DC 并设元。",
      common_deviations: ["在斜三角形中硬凑勾股"],
      skill_annotations: [{ skill_id: "SKILL-SMV-001", evidence_refs: ["TA@v1#S1"] }],
    },
    {
      checkpoint_id: "CP2",
      part_id: "1",
      expected_reasoning: "学生能列出翻折不变量清单。",
    },
    { checkpoint_id: "CP3", part_id: "1", expected_reasoning: "学生能选余弦定理收口。" },
  ],
  recommended_routes: [{ route_id: "R1", role: "primary", part_id: "1", checkpoint_ids: ["CP1", "CP2", "CP3"] }],
  resources: [
    { resource_id: "RES1", kind: "explanation", checkpoint_id: "CP1", content: "先标注等腰条件，再由等角对等边设元。" },
    { resource_id: "RES2", kind: "hint", checkpoint_id: "CP1", assistance_level: 1, content: "翻折保长保角，先列哪些量不变？" },
    { resource_id: "RES3", kind: "hint", checkpoint_id: "CP1", assistance_level: 2, content: "翻折后 AE=AC、DE=DC，逐项对照。" },
    { resource_id: "RES4", kind: "repair", checkpoint_id: "CP3", content: "回到目标节点，教师重新示范。" },
    { resource_id: "RES5", kind: "diagnostic_probe", checkpoint_id: "CP1", content: "你能指出哪条边等于哪条边吗？" },
  ],
  policy_constraints: {
    allowed_move_types: ["explain", "prompt", "hint", "confirm", "wait", "repair"],
    maximum_assistance_level: 2,
    allowed_capabilities: [],
  },
} as unknown as TutorPlanV2Payload;

const FACTS = [
  { sequence: 1, event_type: "session_started" as const, summary: "会话开始", student_fact: false },
  { sequence: 2, event_type: "reasoning_aligned" as const, summary: "expected@CP1", student_fact: true },
];

const ANSWER_VALUES = new Map<string, readonly string[]>([["1", ["BE=1"]]]);

function stateAt(checkpointId: string): TutorRuntimeState {
  const events = [
    {
      schema: "ai_teaching_tutor_session_event/v2" as const,
      session_id: "TS-9700",
      sequence: 1,
      state_revision: 1,
      occurred_at: "2026-08-22T00:00:00Z",
      event_type: "session_started" as const,
      payload: {
        plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "0".repeat(64) },
        initial_mode: "guided_solve" as const,
      },
      idempotency_key: "TS-9700:1",
    },
  ];
  const state = projectRuntimeState(PLAN, events as never);
  state.reasoning.current_checkpoint_id = checkpointId;
  return state;
}

function ledgerAt(
  checkpointId: string,
  ledger: Partial<TutorRuntimeState["assistance"][string]>,
): TutorRuntimeState {
  const state = stateAt(checkpointId);
  state.assistance[checkpointId] = {
    hintLevelsIssued: [],
    incorrectSequences: [],
    failedActionSequences: [],
    promptsIssued: 0,
    promptSequences: [],
    explainedSequences: [],
    ...ledger,
  };
  return state;
}

function proposal(overrides: Record<string, unknown> = {}): TutorTurnProposal {
  return {
    move: {
      move_type: "confirm",
      purpose_code: "confirm.progress",
      checkpoint_id: "CP1",
    },
    voiceSource: "approved-resource",
    workflowVersion: "w",
    modelId: "m",
    promptVersions: [],
    ...overrides,
  } as unknown as TutorTurnProposal;
}

function run(state: TutorRuntimeState, prop: TutorTurnProposal, alignment?: { classification: string; confidence?: number; groundingRefs?: string[] }) {
  const withAlignment = alignment
    ? ({ ...prop, alignment: { confidence: 0.9, groundingRefs: [], ...alignment } } as TutorTurnProposal)
    : prop;
  return validateProposal(withAlignment, PLAN, state, FACTS, ANSWER_VALUES);
}

describe("validateProposal 文案护栏", () => {
  const state = stateAt("CP1");

  it("动态文案超过 240 字 → 拒绝", () => {
    const long = "这是一段很长的教学文案。".repeat(30); // ~360 字
    const result = run(state, proposal({ voiceText: long, voiceSource: "model-generated" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("超过 240 字"))).toBe(true);
  });

  it("单句超过 80 字 → 拒绝", () => {
    const longSentence = `${"这一步要注意".repeat(20)}。`;
    const result = run(state, proposal({ voiceText: longSentence, voiceSource: "model-generated" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("单句超过 80 字"))).toBe(true);
  });

  it("voice.source=model-generated 但文案为空 → 拒绝", () => {
    const result = run(state, proposal({ voiceText: "", voiceSource: "model-generated" }));
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("文案为空"))).toBe(true);
  });

  it("approved-resource 文案不做长度/泄题校验（非生成来源）", () => {
    const long = "资源原文可以很长。".repeat(40);
    const result = run(state, proposal({ voiceText: long, voiceSource: "approved-resource" }));
    expect(result.ok).toBe(true);
  });
});

describe("validateProposal 教学护栏", () => {
  it("unclear 首个输入直接 hint → 拒绝；有 prompt 史 → 放行", () => {
    const hint = proposal({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
    });
    const noPrompt = run(stateAt("CP1"), hint, { classification: "unclear" });
    expect(noPrompt.ok).toBe(false);
    expect(noPrompt.errors.some((error) => error.includes("首个 unclear 必须先 prompt"))).toBe(true);

    const withPrompt = run(ledgerAt("CP1", { promptsIssued: 1 }), hint, { classification: "unclear" });
    expect(withPrompt.ok).toBe(true);
  });

  it("错误后无协助而答对但 purpose≠self_correction → 拒绝；有 hint 后 → 放行 assisted_progress", () => {
    const confirm = proposal({ move: { move_type: "confirm", purpose_code: "confirm.assisted_progress", checkpoint_id: "CP1" } });
    const unassisted = ledgerAt("CP1", { incorrectSequences: [4] });
    const rejected = run(unassisted, confirm, { classification: "expected_checkpoint" });
    expect(rejected.ok).toBe(false);
    expect(rejected.errors.some((error) => error.includes("confirm.self_correction"))).toBe(true);

    const assisted = ledgerAt("CP1", { incorrectSequences: [4], hintLevelsIssued: [1], lastHintSequence: 6 });
    const allowed = run(assisted, confirm, { classification: "expected_checkpoint" });
    expect(allowed.ok).toBe(true);
  });

  it("repair mode 内答对不强制 self_correction（repair_complete 语义另由不变量层保证）", () => {
    const confirm = proposal({ move: { move_type: "confirm", purpose_code: "confirm.progress", checkpoint_id: "CP1" } });
    const inRepair = ledgerAt("CP1", { incorrectSequences: [4] });
    inRepair.mode = "repair";
    inRepair.repair = { active: true, source_checkpoint_id: "CP1" };
    const result = run(inRepair, confirm, { classification: "expected_checkpoint" });
    expect(result.ok).toBe(true);
  });

  it("挣扎基线：台账无 incorrect 证据时直接 hint → 拒绝", () => {
    const hint = proposal({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 1, resource_ids: ["RES2"] },
    });
    const result = run(stateAt("CP1"), hint, { classification: "incorrect" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("首个 incorrect 必须先 prompt.self_check"))).toBe(true);
  });

  it("档位耗尽：hint 台账 ≥ maximum → hint 拒绝并要求 repair", () => {
    const hint = proposal({
      move: { move_type: "hint", purpose_code: "hint.escalate", checkpoint_id: "CP1", assistance_level: 2, resource_ids: ["RES3"] },
    });
    const exhausted = ledgerAt("CP1", { incorrectSequences: [4], hintLevelsIssued: [1, 2], lastHintSequence: 8 });
    const result = run(exhausted, hint, { classification: "incorrect" });
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("必须 move_type=repair"))).toBe(true);
  });

  it("candidate skill 不在 plan 冻结集 → 拒绝；冻结 skill → 放行", () => {
    const withForeign = proposal({
      move: {
        move_type: "confirm",
        purpose_code: "confirm.progress",
        checkpoint_id: "CP1",
        diagnosis_updates: [{ summary_code: "blocker.suspected", candidate_skill_ids: ["SKILL-OTHER"], evidence_sequences: [2] }],
      },
    });
    const foreign = run(stateAt("CP1"), withForeign);
    expect(foreign.ok).toBe(false);
    expect(foreign.errors.some((error) => error.includes("不在 plan 冻结 skill 集"))).toBe(true);

    const withFrozen = proposal({
      move: {
        move_type: "confirm",
        purpose_code: "confirm.progress",
        checkpoint_id: "CP1",
        diagnosis_updates: [{ summary_code: "blocker.suspected", candidate_skill_ids: ["SKILL-SMV-001"], evidence_sequences: [2] }],
      },
    });
    expect(run(stateAt("CP1"), withFrozen).ok).toBe(true);
  });
});

describe("isRetryableModelError", () => {
  it("StructuredModelError.retryable 双分支；非 StructuredModelError 恒 false", () => {
    expect(isRetryableModelError(new StructuredModelError("timeout", "t", true))).toBe(true);
    expect(isRetryableModelError(new StructuredModelError("auth-error", "a", false))).toBe(false);
    expect(isRetryableModelError(new Error("plain"))).toBe(false);
    expect(isRetryableModelError("string")).toBe(false);
  });
});

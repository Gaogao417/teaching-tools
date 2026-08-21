/**
 * P5-05：reasoning aligner 五分类测试（expected / alternate / incorrect / unclear / no_progress）。
 * （Vitest 迁移版；与 node 版同用例集——assert 语义不变。）
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { alignReasoning, normalizeForAlignment } from "../ReasoningAligner";
import { projectRuntimeState } from "../TutorRuntimeStateProjection";
/**
 * P5-05：reasoning aligner 五分类测试（expected / alternate / incorrect /
 * unclear / no_progress，输入文本从 plan 数据派生的同构匹配）。
 */


const PLAN = {
  artifact_id: "TP-SMV-001",
  checkpoints: [
    {
      checkpoint_id: "CP1",
      part_id: "1",
      expected_reasoning: "学生看到 $\\angle DAC=\\angle ACD$ 能立刻写出 AD=DC 并设元。",
    },
    {
      checkpoint_id: "CP2",
      part_id: "1",
      expected_reasoning: "学生能列出翻折不变量清单（对应边相等、对应角相等）。",
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
    { route_id: "R2", role: "alternate", part_id: "1", entry_condition: "学生已能先列翻折不变量清单再求解", checkpoint_ids: ["CP2", "CP3"] },
  ],
};

function stateAt(checkpointId: string) {
  const events = [
    {
      schema: "ai_teaching_tutor_session_event/v2" as const,
      session_id: "TS-9301",
      sequence: 1,
      state_revision: 1,
      occurred_at: "2026-08-21T00:00:00Z",
      event_type: "session_started",
      payload: {
        plan: { artifact_id: "TP-SMV-001", version: "v2", content_hash: "sha256:" + "0".repeat(64) },
        initial_mode: "guided_solve" as const,
      },
      idempotency_key: "TS-9301:1",
    },
  ];
  const state = projectRuntimeState(PLAN as never, events as never);
  state.reasoning.current_checkpoint_id = checkpointId;
  return state;
}

describe('reasoningAligner 五分类', () => {
  it("node 版全部断言（顺序流）", async () => {

  // expected：复述预期推理（≥4 字公共子串）
  assert.equal(alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "reasoning_utterance", text: "我看到 ∠DAC=∠ACD，所以 AD=DC，设 AD=DC=t" }).alignment, "expected_checkpoint");

  // expected：LaTeX 与 Unicode 根式/角符号归一化等价（成对归一化教训）
  assert.equal(normalizeForAlignment("$\\sqrt{14}$").includes("√14"), true);
  assert.equal(alignReasoning(PLAN as never, stateAt("CP3"), { input_kind: "reasoning_utterance", text: "先解出 t 与 BD，然后用余弦定理" }).alignment, "expected_checkpoint");

  // alternate：命中备选路线 entry_condition
  const alternate = alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "reasoning_utterance", text: "我想先列翻折不变量清单再求解" });
  assert.equal(alternate.alignment, "alternate_valid");
  assert.equal(alternate.checkpoint_id, "CP2", "alternate 对齐到备选路线首个 checkpoint");

  // incorrect：命中 common_deviations（part 级扫描）
  const incorrect = alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "reasoning_utterance", text: "我打算在斜三角形中硬凑勾股试试" });
  assert.equal(incorrect.alignment, "incorrect");

  // unclear：无匹配（合法结果，不强迫分类）
  assert.equal(alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "reasoning_utterance", text: "嗯，那个……不太确定" }).alignment, "unclear");

  // no_progress：静默与空文本
  assert.equal(alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "silence_observed" }).alignment, "no_progress");
  assert.equal(alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "reasoning_utterance", text: "  " }).alignment, "no_progress");

  // 指向证据不构成对齐事实：unclear（由 Policy 追问口头化）
  assert.equal(alignReasoning(PLAN as never, stateAt("CP1"), { input_kind: "pointing_evidence", text: "这个" }).alignment, "unclear");

  // 平局优先 expected：既像预期又像备选时不误判 incorrect
  const both = alignReasoning(PLAN as never, stateAt("CP3"), { input_kind: "reasoning_utterance", text: "先解出 t 与 BD，再选余弦定理收口，不硬凑勾股" });
  assert.equal(both.alignment, "expected_checkpoint");

  console.log("PASS reasoningAligner (five-way classification)");
  });
});

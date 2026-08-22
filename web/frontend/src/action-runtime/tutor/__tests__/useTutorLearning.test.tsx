/**
 * Phase 5 UI 集成（波次 C）：useTutorLearning 控制器测试（mock api/narration）。
 *
 * 覆盖：/experience 启动（tutor/legacy）、opening narration（TTS 不可用 →
 * failed 上报 + 续走）、回答/提交通一输入合同、SubmitEvidence transport、
 * 刷新恢复（pending workspace）、换讲法（switchFromSessionId）、题目完成
 * （question_completed → /complete）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const startLearnExperience = vi.fn();
const getTutorSession = vi.fn();
const submitTutorTurn = vi.fn();
const completeTutorVoice = vi.fn();
const completeTutorSession = vi.fn();
vi.mock("../../../api/client", () => ({
  api: {
    startLearnExperience,
    getTutorSession,
    submitTutorTurn,
    completeTutorVoice,
    completeTutorSession,
    tutorAsr: vi.fn(),
    streamActionSpeech: vi.fn().mockRejectedValue(new Error("tts unavailable")),
    recordSimilarityLearnProgress: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../../../presentation/audio/MediaSessionController", () => ({
  MediaSessionController: class {
    subscribe() { return () => undefined; }
    stop() {}
    dispose() {}
    replay() {}
  },
}));
vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    enter = vi.fn().mockResolvedValue(undefined);
    stop = vi.fn();
    replay = vi.fn();
  },
}));

const { useTutorLearning } = await import("../useTutorLearning");
import type { TaskId } from "../../../../../shared/contracts";

const TUTOR_TASK = "task-tutor-1" as TaskId;
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-5001",
    revision: 2,
    client_turn_id: "system.open",
    idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
    decision: null,
    voice: [{ action_id: "VA-1", text: "我们先看这一问。", interruptible: true }],
    workspace: [],
    event_cursor: 3,
    ...overrides,
  };
}

function experience(overrides: Partial<TutorExperienceResponse> = {}): TutorExperienceResponse {
  return {
    kind: "tutor",
    task_id: "task-tutor-1",
    scenario_id: "SC-1",
    binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
    question: { artifact_id: "QT-1", stem: "如图，求证相似。", subquestions: [{ part_id: "1", prompt: "(1) 求证" }] },
    session_id: "TS-5001",
    opening: turn(),
    ...overrides,
  };
}

type Tutor = ReturnType<typeof useTutorLearning>;

function mountHarness(props: { taskId: TaskId; studentId: string; restoreSessionId?: string }): {
  tutor: () => Tutor;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Tutor | undefined;
  function Harness() {
    const tutor = useTutorLearning(props);
    latest = tutor;
    return <div data-testid="phase">{tutor.phase}</div>;
  }
  void act(() => root.render(<Harness />));
  return { tutor: () => latest!, unmount: () => { void act(() => root.unmount()); container.remove(); } };
}

describe("useTutorLearning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("start：tutor 体验 → 会话/题目就位；TTS 不可用 → voice failed 上报并回到等输入", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });

    await act(async () => { await tutor().start(); });
    expect(startLearnExperience).toHaveBeenCalledWith("task-tutor-1", { studentId: "student-1" });
    expect(tutor().sessionId).toBe("TS-5001");
    expect(tutor().question?.stem).toContain("相似");
    // TTS failed → completeTutorVoice(failed) 上报，流程不悬挂。
    await vi.waitFor(() => expect(completeTutorVoice).toHaveBeenCalledWith("TS-5001", "VA-1", "failed"));
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));
    expect(tutor().transcript.some((entry) => entry.role === "tutor")).toBe(true);
    unmount();
  });

  it("submitStudentInput：回答/提问走同一输入合同（revision 携带）", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    submitTutorTurn.mockResolvedValue(turn({ client_turn_id: "t-answer", voice: [], workspace: [], question_completed: false }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "内错角相等" }); });
    expect(submitTutorTurn).toHaveBeenCalledWith(
      "TS-5001",
      expect.stringMatching(/^turn-/),
      2,
      { input_kind: "reasoning_utterance", text: "内错角相等" },
    );
    expect(tutor().transcript.some((entry) => entry.role === "student" && entry.text.includes("内错角"))).toBe(true);

    submitTutorTurn.mockResolvedValue(turn({ client_turn_id: "t-question", voice: [], workspace: [] }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "question_asked", text: "为什么要看这两个三角形？" }); });
    expect(submitTutorTurn).toHaveBeenLastCalledWith(
      "TS-5001",
      expect.stringMatching(/^turn-/),
      expect.any(Number),
      { input_kind: "question_asked", text: "为什么要看这两个三角形？" },
    );
    unmount();
  });

  it("transport.submitEvidence：evidence → tutor 回合 + action_evaluation（错误高亮面）", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-evidence",
      voice: [],
      workspace: [],
      action_evaluation: {
        outcome: "rejected", evaluation: "wrong", revision: 3,
        diagnosis: { messageLatex: "再检查", wrongObjectIds: ["A"], wrongSlotIds: ["value"] },
        phase: "wrong_feedback", nextIndex: 0,
      },
    }));
    const evaluation = await tutor().transport.submitEvidence({
      sessionId: "TS-5001", exerciseId: "tutor:TP-1:a", sourceStepId: "S3", revision: 1,
      evidence: [{ actionId: "tp:TP-1:1:enter-text", sourceStepId: "S3", kind: "enter-text", version: 1, value: "错误答案" }],
      idempotencyKey: "idem-1",
    });
    expect(evaluation.outcome).toBe("rejected");
    expect(evaluation.diagnosis?.wrongObjectIds).toEqual(["A"]);
    expect(submitTutorTurn).toHaveBeenLastCalledWith(
      "TS-5001",
      expect.stringMatching(/^turn-/),
      2,
      {
        input_kind: "structured_action_evidence",
        action_evidence: { actionId: "tp:TP-1:1:enter-text", sourceStepId: "S3", kind: "enter-text", version: 1, value: "错误答案" },
      },
    );
    unmount();
  });

  it("restore：pending workspace 恢复（不靠内存重建）", async () => {
    getTutorSession.mockResolvedValue({
      session_id: "TS-5002", revision: 7, mode: "teach", completed: false, question_completed: false,
      current_checkpoint: { checkpoint_id: "CP3", part_id: "1", route_id: "R1" },
      pending_voice: [],
      pending_workspace: [{
        action_id: "WA-9", decision_id: "TD-9", capability: "action.enter-text", target_ids: [],
        resource_id: "RES9", action_ref: "tp:TP-1:1:enter-text",
        student_view: {
          actionId: "tp:TP-1:1:enter-text", sourceStepId: "S3", kind: "enter-text", version: 1,
          title: "本题结论", instruction: "写出结论", input: { placeholder: "写出结论" },
          capabilities: [], answerSlots: [], validationPolicy: "server-authoritative", submitOnComplete: true,
        },
        action_plan: {
          planVersion: 5, exerciseId: "tutor:TP-1:a", revision: 1, mode: "assessment",
          metadata: { taskId: "task-tutor-1", title: "t", promptLatex: "p", skillTags: [] },
          world: { revision: 1 },
          coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" },
          actions: [{
            actionId: "tp:TP-1:1:enter-text", sourceStepId: "S3", kind: "enter-text", version: 1,
            title: "本题结论", instruction: "写出结论", input: { placeholder: "写出结论" },
            capabilities: [], answerSlots: [{ id: "value", label: "本题结论", kind: "text", required: true }],
            validationPolicy: "server-authoritative", submitOnComplete: true,
          }],
          currentActionId: "tp:TP-1:1:enter-text", completedActionIds: [],
          runtimeCapabilities: {
            practiceValidation: "server-authoritative", trainingSync: "local-only",
            narrationTransport: "off", coachTurnTransport: "request-response", liveCoach: false,
          },
        },
      }],
      event_cursor: 20,
      task_id: "task-tutor-1",
      question: { artifact_id: "QT-1", stem: "如图，求证相似。", subquestions: [] },
      alternates_available: false,
    });
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1", restoreSessionId: "TS-5002" });
    let restored = false;
    await act(async () => { restored = await tutor().restore("TS-5002"); });
    expect(restored).toBe(true);
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().workspace).toHaveLength(1);
    expect(tutor().workspace[0].action_plan.actions[0].kind).toBe("enter-text");
    unmount();
  });

  it("换讲法：switchFromSessionId → 新会话/新 opening（Question 不变由响应保证）", async () => {
    startLearnExperience.mockResolvedValueOnce(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    startLearnExperience.mockResolvedValueOnce(experience({
      session_id: "TS-5009",
      opening: turn({ session_id: "TS-5009" }),
      binding: { artifact_id: "TB-1", default_plan: "TP-2", variants: [], alternates_available: true },
      previous_session_id: "TS-5001",
      switch_reason: "alternate_approach",
    }));
    await act(async () => { await tutor().start({ switchFromSessionId: "TS-5001" }); });
    expect(startLearnExperience).toHaveBeenLastCalledWith("task-tutor-1", {
      studentId: "student-1",
      switchFromSessionId: "TS-5001",
    });
    expect(tutor().sessionId).toBe("TS-5009");
    unmount();
  });

  it("question_completed → finishQuestion 关闭会话（题目完成推进信号）", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-final",
      voice: [],
      workspace: [],
      question_completed: true,
    }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "AA 判定" }); });
    expect(tutor().questionCompleted).toBe(true);
    completeTutorSession.mockResolvedValue({ session_id: "TS-5001", completed: true });
    await act(async () => { await tutor().finishQuestion(); });
    expect(completeTutorSession).toHaveBeenCalledWith("TS-5001", "finished");
    expect(tutor().phase).toBe("completed");
    unmount();
  });

  it("legacy：/experience 无 Binding → start 返回 legacy（页面回退原 LearnPage）", async () => {
    startLearnExperience.mockResolvedValue({ kind: "legacy", task_id: "task-tutor-1", reason: "no_approved_binding" });
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    const result = await tutor().start();
    expect(result?.kind).toBe("legacy");
    expect(tutor().sessionId).toBeUndefined();
    unmount();
  });
});

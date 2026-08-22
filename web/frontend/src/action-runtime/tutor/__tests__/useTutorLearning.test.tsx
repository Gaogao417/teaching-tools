/**
 * Phase 5 UI 集成（波次 C / C-2）：useTutorLearning 控制器测试（mock
 * api/narration）。
 *
 * 覆盖：/experience 启动（tutor/legacy）、opening narration（TTS 不可用 →
 * failed 上报 + 续走）、回答/提交通一输入合同、SubmitEvidence transport、
 * 刷新恢复（pending workspace）、换讲法（switchFromSessionId）、题目完成
 * （question_completed → /complete）；波次 C-2 裁定 2 phase 推导回归——
 * 播放期间标签与画布形态一致、restore 后 workspaceActive 不被空回合清掉、
 * barge-in → interrupted → resume 链。
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

/** 波次 C-2：可控 narration/media——audioUrl 置值后 enter 返回 URL 且播放
 *  挂起（media 不主动发状态），测试经 emit() 推进 loading/playing/idle。 */
const narrationHarness = vi.hoisted(() => ({
  audioUrl: undefined as string | undefined,
  listeners: new Set<(state: { status: string }) => void>(),
  emit(status: string) {
    for (const listener of this.listeners) listener({ status });
  },
}));
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
    subscribe(listener: (state: { status: string }) => void) {
      narrationHarness.listeners.add(listener);
      return () => narrationHarness.listeners.delete(listener);
    }
    stop() {}
    dispose() {}
    replay() {}
  },
}));
vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    enter = vi.fn(async () => (narrationHarness.audioUrl ? { audioUrl: narrationHarness.audioUrl } : undefined));
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
    narrationHarness.audioUrl = undefined;
    narrationHarness.listeners.clear();
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

  // ----------------------------------------------------------------- //
  // 波次 C-2 裁定 2：phase 推导回归
  // ----------------------------------------------------------------- //

  function workspaceAction(overrides: Record<string, unknown> = {}): TutorTurnResponse["workspace"][number] {
    return {
      action_id: "WA-9",
      decision_id: "TD-9",
      capability: "action.enter-text",
      target_ids: [],
      resource_id: "RES9",
      action_ref: "tp:TP-1:1:enter-text",
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
      ...overrides,
    } as TutorTurnResponse["workspace"][number];
  }

  function sessionViewWithPendingWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      session_id: "TS-5002", revision: 7, mode: "teach", completed: false, question_completed: false,
      current_checkpoint: { checkpoint_id: "CP3", part_id: "1", route_id: "R1" },
      pending_voice: [],
      pending_workspace: [workspaceAction()],
      event_cursor: 20,
      task_id: "task-tutor-1",
      question: { artifact_id: "QT-1", stem: "如图，求证相似。", subquestions: [] },
      alternates_available: false,
      ...overrides,
    };
  }

  it("phase 推导：播放期间 speaking、播完后标签追上画布（workspace 不因空回合标签脱节）", async () => {
    narrationHarness.audioUrl = "blob:tts";
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    // opening narration 挂起播放 → phase speaking。
    await vi.waitFor(() => expect(tutor().phase).toBe("speaking"));
    narrationHarness.emit("playing");
    narrationHarness.emit("idle");
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    // 回合 A：签发 workspace（无 voice）→ workspaceActive。
    const action = workspaceAction();
    submitTutorTurn.mockResolvedValue(turn({ client_turn_id: "t-ws", voice: [], workspace: [action] }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "看到了" }); });
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().workspace).toHaveLength(1);

    // 回合 B：老师只讲（voice、workspace 空），pending 重读仍有待操作步——
    // 播放期间标签 speaking 且画布仍在（同一份事实）。
    getTutorSession.mockResolvedValue(sessionViewWithPendingWorkspace());
    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-talk",
      voice: [{ action_id: "VA-2", text: "注意这两个角。", interruptible: true }],
      workspace: [],
    }));
    // 播放会挂起（media 不主动发状态）：提交链不进 act（act 会缓冲作用域内
    // 更新，中途观察不到 speaking），观察后再推进播放。
    const submission = tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "内错角" });
    await vi.waitFor(() => expect(tutor().phase).toBe("speaking"));
    expect(tutor().workspace).toHaveLength(1);
    // 播完：标签追上画布 → workspaceActive（旧实现的 turn.workspace 尾判
    // 会给出 awaitingInput，与画布脱节）。
    narrationHarness.emit("playing");
    narrationHarness.emit("idle");
    await submission;
    await vi.waitFor(() => expect(tutor().phase).toBe("workspaceActive"));
    expect(tutor().workspace).toHaveLength(1);
    unmount();
  });

  it("restore 后 workspaceActive：空 workspace 回合不清画布、标签保持一致", async () => {
    getTutorSession.mockResolvedValue(sessionViewWithPendingWorkspace());
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1", restoreSessionId: "TS-5002" });
    let restored = false;
    await act(async () => { restored = await tutor().restore("TS-5002"); });
    expect(restored).toBe(true);
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().workspace).toHaveLength(1);

    // 学生回答 → 回应回合 workspace 为空，但服务端 pending_workspace 仍在：
    // 画布保留，标签仍是 workspaceActive（不被空回合清成 awaitingInput）。
    completeTutorVoice.mockResolvedValue(null);
    submitTutorTurn.mockResolvedValue(turn({ client_turn_id: "t-after-restore", voice: [], workspace: [] }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "AA 判定" }); });
    expect(tutor().workspace).toHaveLength(1);
    expect(tutor().phase).toBe("workspaceActive");
    unmount();
  });

  it("barge-in → interrupted → resume：显式 UI 事件链（播放挂起中打断）", async () => {
    narrationHarness.audioUrl = "blob:tts";
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("speaking"));
    await act(async () => { await tutor().bargeIn(); });
    expect(tutor().phase).toBe("interrupted");
    expect(completeTutorVoice).toHaveBeenCalledWith("TS-5001", "VA-1", "interrupted");
    await act(async () => { tutor().resumeFromInterrupt(); });
    expect(tutor().phase).toBe("awaitingInput");
    unmount();
  });
});

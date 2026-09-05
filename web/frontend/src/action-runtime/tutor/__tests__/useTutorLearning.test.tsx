/**
 * Phase 5 UI 集成（波次 C / C-2）+ VS1（mvp/vs-01）useTutorLearning 测试
 * （mock api/narration）。
 *
 * 覆盖：/experience 启动（tutor/legacy）、opening narration（TTS 不可用 →
 * failed 上报 + 续走）、回答/提交通一输入合同、SubmitEvidence transport、
 * 刷新恢复（统一 workspace_view）、换讲法（switchFromSessionId）、题目完成
 * （question_completed → /complete）；phase 推导回归——播放期间标签与画布
 * 形态一致、空 workspace 回合不清画布（服务端统一 View 口径）、barge-in →
 * interrupted → resume 链。
 *
 * VS1 增补：workspace_view 是唯一 Workspace 消费面（turn 期间不再 GET
 * 回读拼装 pending_workspace）；schema 非法 → recoverable error（REQ-08）。
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
  /** 当前 media 状态（emit 推进；也可直接置值模拟「订阅前已到达」的竞态）。 */
  status: "idle" as string,
  listeners: new Set<(state: { status: string }) => void>(),
  emit(status: string) {
    this.status = status;
    for (const listener of this.listeners) listener({ status });
  },
}));
/** VS1 REQ-08：与真实 client 同形——schema 校验失败抛可识别错误类型
 *  （hoisted 供测试构造同 class 实例，保证 instanceof 判定）。 */
const { ResponseSchemaErrorMock } = vi.hoisted(() => {
  class ResponseSchemaErrorMock extends Error {}
  return { ResponseSchemaErrorMock };
});
vi.mock("../../../api/client", () => ({
  ResponseSchemaError: ResponseSchemaErrorMock,
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
    /** 波次 E 真实链竞态修复：waitForPlaybackEnd 以 getState() 初始化 sawActive。 */
    getState() { return { status: narrationHarness.status }; }
    stop() {}
    dispose() {}
    replay() {}
  },
}));
vi.mock("../../../presentation/narration/NarrationController", () => ({
  NarrationController: class {
    /** 波段 E：真实的 NarrationController.enter will push the media to playing before returning
     * (playUrl has already started)——the mock synchronizes this fact, for getState initialization
     * the attach-during-playing race surface of waitForPlaybackEnd. F7 Step 6: enter returns
     * detailed results (playing/aborted/failed)——legacy mapping consumes audioUrl. */
    enter = vi.fn(async () => {
      if (narrationHarness.audioUrl) narrationHarness.status = "playing";
      return narrationHarness.audioUrl
        ? { status: "playing" as const, audioUrl: narrationHarness.audioUrl, generation: 1 }
        : { status: "failed" as const };
    });
    stop = vi.fn();
    replay = vi.fn();
  },
}));

const { useTutorLearning } = await import("../useTutorLearning");
import type { TaskId } from "../../../../../shared/contracts";

const TUTOR_TASK = "task-tutor-1" as TaskId;
import type { TutorExperienceResponse, TutorTurnResponse } from "../../../../../shared/tutorExperience";
import type { StudentWorkspaceView } from "../../../../../shared/studentWorkspace";
import { studentWorkspaceViewFixture, tutorTurnFixture } from "../tutorTestFixtures";

function turn(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return tutorTurnFixture({
    voice: [{ action_id: "VA-1", text: "我们先看这一问。", interruptible: true }],
    ...overrides,
  });
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

/** 操作步计划（assessment 形态学生安全 plan；与旧 workspace 条目的
 *  action_plan 同形状——VS1 起经统一 View 的 participation 槽下发）。 */
function operationPlan() {
  return {
    planVersion: 5 as const, exerciseId: "tutor:TP-1:a", revision: 1, mode: "assessment" as const,
    metadata: { taskId: "task-tutor-1", title: "t", promptLatex: "p", skillTags: [] },
    world: { revision: 1 },
    coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" as const },
    actions: [{
      actionId: "tp:TP-1:1:enter-text", sourceStepId: "S3", kind: "enter-text" as const, version: 1 as const,
      title: "本题结论", instruction: "写出结论", input: { placeholder: "写出结论" },
      capabilities: [], answerSlots: [{ id: "value", label: "本题结论", kind: "text" as const, required: true }],
      validationPolicy: "server-authoritative" as const, submitOnComplete: true,
    }],
    currentActionId: "tp:TP-1:1:enter-text", completedActionIds: [],
    runtimeCapabilities: {
      practiceValidation: "server-authoritative" as const, trainingSync: "local-only" as const,
      narrationTransport: "off" as const, coachTurnTransport: "request-response" as const, liveCoach: false,
    },
  };
}

/** 统一 View 的 operate 态夹具（含 activeAction 操作步）。 */
function operateWorkspaceView(overrides: Partial<StudentWorkspaceView> = {}): StudentWorkspaceView {
  return studentWorkspaceViewFixture({
    revision: 5,
    participation: { mode: "operate", activeAction: { actionId: "WA-9", plan: operationPlan() } },
    ...overrides,
  });
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
    narrationHarness.status = "idle";
    narrationHarness.listeners.clear();
  });

  it("start：tutor 体验 → 会话/题目就位（统一 View 采用）；TTS 不可用 → voice failed 上报并回到等输入", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });

    await act(async () => { await tutor().start(); });
    expect(startLearnExperience).toHaveBeenCalledWith("task-tutor-1", { studentId: "student-1" });
    expect(tutor().sessionId).toBe("TS-5001");
    expect(tutor().question?.stem).toContain("相似");
    // VS1：opening 的 workspace_view 已采用（respond 态、与 revision 同源）。
    expect(tutor().workspaceView?.revision).toBe(2);
    expect(tutor().workspaceView?.participation.mode).toBe("respond");
    // TTS failed → completeTutorVoice(failed) 上报，流程不悬挂。
    await vi.waitFor(() => expect(completeTutorVoice).toHaveBeenCalledWith("TS-5001", "VA-1", "failed"));
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));
    expect(tutor().transcript.some((entry) => entry.role === "tutor")).toBe(true);
    unmount();
  });

  it("submitStudentInput：回答/提问走同一输入合同（revision 携带；turn 期间不 GET 回读）", async () => {
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
    // VS1：workspace 状态只来自 turn 响应的统一 View，无 GET 回读拼装。
    expect(getTutorSession).not.toHaveBeenCalled();

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

  it("restore：统一 View 恢复（operate 态 workspaceActive；不靠内存重建）", async () => {
    const restoredView = operateWorkspaceView({ sessionId: "TS-5002", revision: 7 });
    getTutorSession.mockResolvedValue({
      session_id: "TS-5002", revision: 7, mode: "teach", completed: false, question_completed: false,
      current_checkpoint: { checkpoint_id: "CP3", part_id: "1", route_id: "R1", index: 3, total: 3 },
      pending_voice: [],
      pending_workspace: [],
      workspace_view: restoredView,
      event_cursor: 20,
      task_id: "task-tutor-1",
      question: { artifact_id: "QT-1", stem: "如图，求证相似。", subquestions: [] },
      alternates_available: false,
    });
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1", restoreSessionId: "TS-5002" });
    let outcome: string | undefined;
    await act(async () => { outcome = await tutor().restore("TS-5002"); });
    expect(outcome).toBe("restored");
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().workspaceView).toEqual(restoredView);
    expect(tutor().activeOperation?.plan.actions[0].kind).toBe("enter-text");
    unmount();
  });

  it("VS1 REQ-08：session view schema 非法（缺 workspace_view）→ invalid（recoverable error，不静默重开）", async () => {
    // 剥掉 workspace_view 的「旧形状」响应——真实 api client guard 会抛
    // ResponseSchemaError；mock 直接复现该行为语义。
    getTutorSession.mockRejectedValue(new ResponseSchemaErrorMock("Invalid tutor session view"));
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1", restoreSessionId: "TS-5002" });
    let outcome: string | undefined;
    await act(async () => { outcome = await tutor().restore("TS-5002"); });
    expect(outcome).toBe("invalid");
    // recoverable error 显示（phase=recovering）；不触发重开（start 未调用）。
    expect(tutor().error).toContain("Invalid tutor session view");
    expect(tutor().phase).toBe("recovering");
    expect(startLearnExperience).not.toHaveBeenCalled();
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
  // 波次 C-2 裁定 2：phase 推导回归（VS1 口径：读统一 View 的 participation）
  // ----------------------------------------------------------------- //

  it("phase 推导：播放期间 speaking、播完后标签追上画布（空 workspace 回合不清画布）", async () => {
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

    // 回合 A：服务端统一 View 进入 operate（签发操作步）→ workspaceActive。
    const operateView = operateWorkspaceView();
    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-ws", voice: [], revision: 5,
      workspace_view: operateView,
    }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "看到了" }); });
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().activeOperation?.actionId).toBe("WA-9");

    // 回合 B：老师只讲（voice、无新操作签发）——服务端 View 仍 operate
    //（会话权威 pending 步在统一 View 里），播放期间标签 speaking 且
    // 操作步仍在（同一份事实）；不再 GET 回读。
    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-talk",
      voice: [{ action_id: "VA-2", text: "注意这两个角。", interruptible: true }],
      workspace: [],
      workspace_view: operateWorkspaceView({ revision: 6 }),
    }));
    const submission = tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "内错角" });
    await vi.waitFor(() => expect(tutor().phase).toBe("speaking"));
    expect(tutor().activeOperation?.actionId).toBe("WA-9");
    expect(getTutorSession).not.toHaveBeenCalled();
    // 播完：标签追上画布 → workspaceActive。
    narrationHarness.emit("playing");
    narrationHarness.emit("idle");
    await submission;
    await vi.waitFor(() => expect(tutor().phase).toBe("workspaceActive"));
    expect(tutor().workspaceView?.revision).toBe(6);
    unmount();
  });

  it("波次 E 真实链竞态：播放已开始才挂等待 → ended 后完成上报不悬挂（attach-during-playing）", async () => {
    narrationHarness.audioUrl = "blob:tts";
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("speaking"));
    // 竞态面：enter() 已把 media 置 playing（getState 可见），但订阅者未
    // 收到任何状态转移——真实 TTS 下 waitFor 挂上时播放早已开始；
    // subscribe 不回放当前状态（旧实现 sawActive 恒 false → 悬挂）。
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(narrationHarness.status).toBe("playing");
    narrationHarness.emit("idle");
    // 旧实现：sawActive 恒 false，ended→idle 不结算，完成永不回报（悬挂）。
    await vi.waitFor(() => expect(completeTutorVoice).toHaveBeenCalledWith("TS-5001", "VA-1", "completed"));
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));
    unmount();
  });

  it("restore 后 workspaceActive：空 workspace 回合不清画布、标签保持一致", async () => {
    const restoredView = operateWorkspaceView({ sessionId: "TS-5002", revision: 7 });
    getTutorSession.mockResolvedValue({
      session_id: "TS-5002", revision: 7, mode: "teach", completed: false, question_completed: false,
      current_checkpoint: { checkpoint_id: "CP3", part_id: "1", route_id: "R1", index: 3, total: 3 },
      pending_voice: [],
      pending_workspace: [],
      workspace_view: restoredView,
      event_cursor: 20,
      task_id: "task-tutor-1",
      question: { artifact_id: "QT-1", stem: "如图，求证相似。", subquestions: [] },
      alternates_available: false,
    });
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1", restoreSessionId: "TS-5002" });
    let outcome: string | undefined;
    await act(async () => { outcome = await tutor().restore("TS-5002"); });
    expect(outcome).toBe("restored");
    expect(tutor().phase).toBe("workspaceActive");
    expect(tutor().activeOperation?.actionId).toBe("WA-9");

    // 学生回答 → 回应回合 legacy workspace 为空，但服务端统一 View 仍
    // operate（pending 操作步还在）：画布保留，标签仍是 workspaceActive。
    completeTutorVoice.mockResolvedValue(null);
    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-after-restore", voice: [], workspace: [],
      session_id: "TS-5002", revision: 8,
      workspace_view: operateWorkspaceView({ sessionId: "TS-5002", revision: 8 }),
    }));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "AA 判定" }); });
    expect(tutor().activeOperation?.actionId).toBe("WA-9");
    expect(tutor().phase).toBe("workspaceActive");
    unmount();
  });

  it("VS1 REQ-06 修复回归：完成链的续走 voice 不丢弃同回合剩余 sibling（无 pending 泄漏）", async () => {
    startLearnExperience.mockResolvedValue(experience({
      opening: turn({
        voice: [
          { action_id: "VA-1", text: "先看条件。", interruptible: true },
          { action_id: "VA-2", text: "再看结论方向。", interruptible: true },
        ],
      }),
    }));
    // VA-1 完成 → 续走回合带 VA-3；VA-2/VA-3 也必须被完成（旧实现丢弃 VA-2）。
    completeTutorVoice
      .mockResolvedValueOnce(turn({
        client_turn_id: "voice.VA-1",
        voice: [{ action_id: "VA-3", text: "所以我们先证相似。", interruptible: true }],
      }))
      .mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    // remediation-2 呈现门：VA-1 自动播 → 门（VA-2 在队、VA-3 待续走追加）；
    // 逐次放行后队列走完。
    await vi.waitFor(() => expect(tutor().presentation.awaitingContinue).toBe(true));
    expect(tutor().presentation.playedCount).toBe(1);
    await act(async () => { tutor().advancePresentation(); });
    await vi.waitFor(() => expect(tutor().presentation.awaitingContinue).toBe(true));
    expect(tutor().presentation.playedCount).toBe(2);
    await act(async () => { tutor().advancePresentation(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));
    const completedIds = completeTutorVoice.mock.calls.map((call) => call[1]);
    expect(completedIds).toEqual(["VA-1", "VA-2", "VA-3"]);
    unmount();
  });

  it("remediation-2 裁定 2：「明白，继续」放行恰一步——快速双击不双推进、队列耗尽后 no-op", async () => {
    startLearnExperience.mockResolvedValue(experience({
      opening: turn({
        voice: [
          { action_id: "VA-1", text: "第一段。", interruptible: true },
          { action_id: "VA-2", text: "第二段。", interruptible: true },
          { action_id: "VA-3", text: "第三段。", interruptible: true },
        ],
      }),
    }));
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().presentation.playedCount).toBe(1));
    expect(tutor().presentation.awaitingContinue).toBe(true);
    expect(tutor().presentation.totalCount).toBe(3);
    // 同步双击：第一次点击已把门置 null，第二次 no-op——只放行一步。
    act(() => { tutor().advancePresentation(); tutor().advancePresentation(); });
    await vi.waitFor(() => expect(tutor().presentation.playedCount).toBe(2));
    expect(tutor().presentation.awaitingContinue).toBe(true);
    await act(async () => { tutor().advancePresentation(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));
    expect(completeTutorVoice.mock.calls.map((call) => call[1])).toEqual(["VA-1", "VA-2", "VA-3"]);
    // 队列耗尽后无门可放：再点不推进（仍 awaitingInput）。
    act(() => tutor().advancePresentation());
    expect(tutor().phase).toBe("awaitingInput");
    expect(tutor().presentation.playedCount).toBe(3);
    unmount();
  });

  it("remediation-2 裁定 1：上一拍/回开头=纯回看——零 API 写入、revision/checkpoint 不变", async () => {
    startLearnExperience.mockResolvedValue(experience({
      opening: turn({
        voice: [
          { action_id: "VA-1", text: "第一段。", interruptible: true },
          { action_id: "VA-2", text: "第二段。", interruptible: true },
        ],
      }),
    }));
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().presentation.awaitingContinue).toBe(true));
    await act(async () => { tutor().advancePresentation(); });
    await vi.waitFor(() => expect(tutor().presentation.playedCount).toBe(2));
    expect(tutor().presentation.currentText).toBe("第二段。");
    const revisionBefore = tutor().revision;
    const checkpointBefore = tutor().currentCheckpoint?.checkpoint_id;
    const completionCalls = completeTutorVoice.mock.calls.length;
    const submitCalls = submitTutorTurn.mock.calls.length;
    await act(async () => { await tutor().reviewPreviousNarration(); });
    // 回看结束：气泡回到当前拍（指针不动）。
    expect(tutor().presentation.reviewing).toBe(false);
    expect(tutor().presentation.currentText).toBe("第二段。");
    // 不二次上报 voice completion、不提交学生输入、revision/checkpoint 不变。
    expect(completeTutorVoice.mock.calls.length).toBe(completionCalls);
    expect(submitTutorTurn.mock.calls.length).toBe(submitCalls);
    expect(tutor().revision).toBe(revisionBefore);
    expect(tutor().currentCheckpoint?.checkpoint_id).toBe(checkpointBefore);
    unmount();
  });

  it("remediation-2：门上等待时学生输入 → 旧队列 abandon（单活跃队列），新回合正常播", async () => {
    startLearnExperience.mockResolvedValue(experience({
      opening: turn({
        voice: [
          { action_id: "VA-1", text: "第一段。", interruptible: true },
          { action_id: "VA-2", text: "旧队列剩余段。", interruptible: true },
        ],
      }),
    }));
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().presentation.awaitingContinue).toBe(true));
    submitTutorTurn.mockResolvedValue(turn({
      client_turn_id: "t-gate-question",
      revision: 2,
      voice: [{ action_id: "VB-1", text: "新回合第一段。", interruptible: true }],
    }));
    let submission: Promise<void> | undefined;
    await act(async () => {
      submission = tutor().submitStudentInput({ input_kind: "question_asked", text: "这一步为什么？" });
    });
    // 旧队列的 VA-2 被 abandon：只有 VA-1 与新回合 VB-1 被完成上报。
    await vi.waitFor(() => expect(tutor().presentation.currentText).toBe("新回合第一段。"));
    await vi.waitFor(() => expect(tutor().presentation.awaitingContinue).toBe(false));
    expect(completeTutorVoice.mock.calls.map((call) => call[1])).toEqual(["VA-1", "VB-1"]);
    await act(async () => { tutor().advancePresentation(); });
    await act(async () => { await submission; });
    expect(tutor().phase).toBe("awaitingInput");
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

  it("VS1 REQ-08：turn 响应缺 workspace_view（guard 拒绝）→ recoverable error，不渲染旧链", async () => {
    startLearnExperience.mockResolvedValue(experience());
    completeTutorVoice.mockResolvedValue(null);
    const { tutor, unmount } = mountHarness({ taskId: TUTOR_TASK, studentId: "student-1" });
    await act(async () => { await tutor().start(); });
    await vi.waitFor(() => expect(tutor().phase).toBe("awaitingInput"));

    submitTutorTurn.mockRejectedValue(new ResponseSchemaErrorMock("Invalid tutor turn response"));
    await act(async () => { await tutor().submitStudentInput({ input_kind: "reasoning_utterance", text: "试试" }); });
    expect(tutor().error).toContain("Invalid tutor turn response");
    expect(tutor().phase).toBe("recovering");
    // 统一 View 未被伪造推进（仍为 opening 版本）。
    expect(tutor().workspaceView?.revision).toBe(2);
    unmount();
  });
});

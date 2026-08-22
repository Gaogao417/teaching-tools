/**
 * TutorLearningController + ActionRuntimeTransport（Phase 5 UI 集成 / 计划 §3）。
 *
 * /learn/:taskId 的 Tutor 驱动工作台控制器：会话生命周期（/experience 启动、
 * GET :id 刷新恢复）、narration/media 管线（开场与每回合 voice 自动播放、
 * barge-in、autoplay-blocked 重播）、六类学生输入（回答/提问/操作证据）、
 * 同题换讲法与题目完成推进。Workspace 只消费服务端下发的学生安全
 * `action_plan`（真实 ActionRuntimeFrame 渲染），evidence 经
 * SubmitEvidence 送回 TutorSession typed evaluator——Action Runtime 与
 * Tutor state 共享同一 decision/revision。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../api/client";
import { MediaSessionController } from "../../presentation/audio/MediaSessionController";
import { NarrationController } from "../../presentation/narration/NarrationController";
import type {
  ActionEvaluationRequest,
  ActionEvaluationResponse,
  ActionEvidence,
} from "../../../../shared/actionRuntime";
import type {
  LearnExperienceResponse,
  TutorExperienceResponse,
  TutorQuestionView,
  TutorSessionView,
  TutorStudentInput,
  TutorTurnResponse,
  TutorWorkspaceAction,
} from "../../../../shared/tutorExperience";
import type { TaskId } from "../../../../shared/contracts";

/** 计划 §3 ActionRuntimeTransport：evidence → {evaluation, tutorTurn}。 */
export interface ActionRuntimeTransport {
  submitEvidence(request: ActionEvaluationRequest): Promise<ActionEvaluationResponse>;
}

export type TutorPhase =
  | "starting"
  | "speaking"
  | "awaitingInput"
  | "thinking"
  | "workspaceActive"
  | "interrupted"
  | "recovering"
  | "completed";

export interface TutorTranscriptEntry {
  id: string;
  role: "tutor" | "student";
  text: string;
  at: number;
}

const SPEECH_PROFILE_VERSION = "tutor-zh-v1";

function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 等待当前 narration 播放自然结束（loading/playing → idle/error）。
 *  blocked-by-autoplay 视作已交付（音频已就绪，可手动 replay）。
 *  isCancelled 为真（barge-in）立即返回。 */
function waitForPlaybackEnd(
  media: MediaSessionController,
  isCancelled: () => boolean,
  timeoutMs = 10 * 60_000,
): Promise<"done" | "cancelled" | "error"> {
  let sawActive = false;
  return new Promise((resolve) => {
    const finish = (result: "done" | "cancelled" | "error") => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish("done"), timeoutMs);
    const unsubscribe = media.subscribe((state) => {
      if (isCancelled()) finish("cancelled");
      else if (state.status === "loading" || state.status === "playing") sawActive = true;
      else if (sawActive && state.status === "error") finish("error");
      else if (sawActive && state.status === "idle") finish("done");
      else if (state.status === "blocked-by-autoplay" && sawActive) finish("done");
    });
  });
}

/** workspace action → ActionRuntimeFrame 的 response（plan.revision 固定 1：
 *  会话 revision 由 Tutor 合同持有，Frame 内部 revision 只驱动提交幂等）。 */
export function workspaceActionResponse(
  sessionId: string,
  action: TutorWorkspaceAction,
): { sessionId: string; plan: TutorWorkspaceAction["action_plan"] } {
  return { sessionId, plan: action.action_plan };
}

export interface UseTutorLearningOptions {
  taskId: TaskId;
  studentId: string;
  /** 刷新恢复：URL ?session= 里的会话 id。 */
  restoreSessionId?: string;
}

export function useTutorLearning({ taskId, studentId, restoreSessionId }: UseTutorLearningOptions) {
  const [phase, setPhase] = useState<TutorPhase>("starting");
  const [sessionId, setSessionId] = useState<string | undefined>(restoreSessionId);
  const [revision, setRevision] = useState(0);
  const [experience, setExperience] = useState<TutorExperienceResponse | undefined>();
  const [question, setQuestion] = useState<TutorQuestionView | undefined>();
  const [alternatesAvailable, setAlternatesAvailable] = useState(false);
  const [transcript, setTranscript] = useState<TutorTranscriptEntry[]>([]);
  const [workspace, setWorkspace] = useState<TutorWorkspaceAction[]>([]);
  const [questionCompleted, setQuestionCompleted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const revisionRef = useRef(0);
  const sessionIdRef = useRef<string | undefined>(restoreSessionId);
  const playingRef = useRef(false);
  const generationRef = useRef(0);
  const lastTurnRef = useRef<TutorTurnResponse | undefined>(undefined);

  const media = useMemo(() => new MediaSessionController(undefined), []);
  const narration = useMemo(
    () =>
      new NarrationController(
        {
          synthesize: (text, signal, correlationId) =>
            api.streamActionSpeech({ text, correlationId }, signal).then((response) => ({
              audioUrl: response.audioUrl,
            })),
        },
        media,
      ),
    [media],
  );

  useEffect(() => {
    return () => {
      narration.stop();
      media.dispose();
    };
  }, [narration, media]);

  // 浏览器阻止自动播放 → 沿用重播提示机制（不新造）。
  useEffect(() => {
    return media.subscribe((state) => {
      if (state.status === "blocked-by-autoplay") setAutoplayBlocked(true);
    });
  }, [media]);

  const appendTranscript = useCallback((role: "tutor" | "student", text: string) => {
    setTranscript((entries) => [
      ...entries,
      { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, text, at: Date.now() },
    ]);
  }, []);

  const applySession = useCallback((nextSessionId: string, nextRevision: number) => {
    sessionIdRef.current = nextSessionId;
    revisionRef.current = nextRevision;
    setSessionId(nextSessionId);
    setRevision(nextRevision);
  }, []);

  /** 回合后同步「进行中的 workspace」：显式签发优先；否则（此前有待操作步）
   *  回读学生安全视图的 pending_workspace（错答重试/多回合后仍能看到待操作
   *  步——不靠内存重建）。 */
  const hadWorkspaceRef = useRef(false);
  const syncActiveWorkspace = useCallback(async (turnSessionId: string, turn: TutorTurnResponse): Promise<void> => {
    if (turn.workspace.length) {
      hadWorkspaceRef.current = true;
      setWorkspace(turn.workspace);
      return;
    }
    if (!hadWorkspaceRef.current) {
      setWorkspace([]);
      return;
    }
    const view = await api.getTutorSession(turnSessionId).catch(() => undefined);
    const pending = view?.pending_workspace ?? [];
    hadWorkspaceRef.current = pending.length > 0;
    setWorkspace(pending);
  }, []);

  const afterTurnCommon = useCallback((turn: TutorTurnResponse) => {
    lastTurnRef.current = turn;
    revisionRef.current = turn.revision;
    setRevision(turn.revision);
    if (turn.question_completed) setQuestionCompleted(true);
  }, []);

  /** 播放一组 voice 动作（顺序播放；每个完成后上报 voice-completions 并消费
   *  返回的系统续走回合）。打断语义由 bargeIn 控制（stop 立即生效）。 */
  const speakTurn = useCallback(
    async (turn: TutorTurnResponse, generation: number): Promise<void> => {
      for (const voice of turn.voice) {
        if (!playingRef.current || generation !== generationRef.current) return;
        appendTranscript("tutor", voice.text);
        const url = await narration
          .enter(
            {
              utteranceId: voice.action_id,
              spokenText: voice.text,
              cacheKey: `${SPEECH_PROFILE_VERSION}:${voice.voice_source ?? "approved-resource"}:${voice.text}`,
            },
            undefined,
            true,
          )
          .catch(() => undefined);
        let outcome: "completed" | "failed" = "completed";
        if (url && playingRef.current) {
          const playback = await waitForPlaybackEnd(media, () => !playingRef.current);
          if (playback === "cancelled" || !playingRef.current) return;
          if (playback === "error") outcome = "failed";
        } else if (!url) {
          // TTS 不可用（CI 无 CosyVoice key）：如实上报 failed，流程继续。
          outcome = "failed";
        }
        if (!playingRef.current || generation !== generationRef.current) return;
        const followUp = await api
          .completeTutorVoice(turn.session_id, voice.action_id, outcome)
          .catch(() => null);
        if (followUp) {
          afterTurnCommon(followUp);
          await syncActiveWorkspace(turn.session_id, followUp);
          if (followUp.voice.length) {
            await speakTurn(followUp, generation);
            return;
          }
          setPhase(followUp.workspace.length ? "workspaceActive" : "awaitingInput");
          playingRef.current = false;
          return;
        }
      }
      if (generation !== generationRef.current) return;
      setPhase(turn.workspace.length ? "workspaceActive" : "awaitingInput");
      playingRef.current = false;
    },
    [appendTranscript, afterTurnCommon, media, narration, syncActiveWorkspace],
  );

  const consumeTurn = useCallback(
    async (turn: TutorTurnResponse, generation: number): Promise<void> => {
      afterTurnCommon(turn);
      await syncActiveWorkspace(turn.session_id, turn);
      if (turn.voice.length) {
        setPhase("speaking");
        await speakTurn(turn, generation);
      } else if (turn.workspace.length) {
        setPhase("workspaceActive");
        playingRef.current = false;
      } else {
        setPhase("awaitingInput");
        playingRef.current = false;
      }
    },
    [afterTurnCommon, speakTurn, syncActiveWorkspace],
  );

  /** 学生回合统一入口（回答/提问/静默等六类输入共用）。 */
  const submitStudentInput = useCallback(
    async (input: TutorStudentInput): Promise<void> => {
      const activeSession = sessionIdRef.current;
      if (!activeSession) return;
      setPhase("thinking");
      if (input.text !== undefined) {
        appendTranscript("student", input.input_kind === "question_asked" ? `（问）${input.text}` : input.text);
      }
      try {
        playingRef.current = true;
        const turn = await api.submitTutorTurn(activeSession, newTurnId(), revisionRef.current, input);
        await consumeTurn(turn, generationRef.current);
      } catch (turnError) {
        playingRef.current = false;
        const message = turnError instanceof Error ? turnError.message : String(turnError);
        setError(message);
        setPhase("recovering");
      }
    },
    [appendTranscript, consumeTurn],
  );

  /** 计划 §3 ActionRuntimeTransport.SubmitEvidence：evidence 送回 TutorSession
   *  typed evaluator；返回 evaluation 更新 Action Runtime，tutorTurn 已在内部
   *  消费（ narration/workspace/phase）。 */
  const transport: ActionRuntimeTransport = useMemo(
    () => ({
      submitEvidence: async (request) => {
        const activeSession = sessionIdRef.current;
        if (!activeSession) throw new Error("tutor session 未启动");
        const evidence = request.evidence[request.evidence.length - 1];
        const turn = await api.submitTutorTurn(activeSession, newTurnId(), revisionRef.current, {
          input_kind: "structured_action_evidence",
          action_evidence: evidence as unknown as Record<string, unknown>,
        });
        void consumeTurn(turn, generationRef.current);
        if (!turn.action_evaluation) {
          throw new Error("tutor evidence turn 缺少 action_evaluation");
        }
        return turn.action_evaluation;
      },
    }),
    [consumeTurn],
  );

  /** barge-in：立即停播并上报 interrupted（目标 <150ms 停止播放）。 */
  const bargeIn = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    narration.stop();
    media.stop("narration");
    playingRef.current = false;
    setPhase("interrupted");
    const pending = lastTurnRef.current?.voice.find((voice) => voice.interruptible)
      ?? lastTurnRef.current?.voice[0];
    if (activeSession && pending) {
      await api.completeTutorVoice(activeSession, pending.action_id, "interrupted").catch(() => null);
    }
  }, [media, narration]);

  const resumeFromInterrupt = useCallback(() => setPhase("awaitingInput"), []);

  const adoptExperience = useCallback(
    (next: TutorExperienceResponse, generation: number) => {
      generationRef.current = generation;
      lastTurnRef.current = undefined;
      hadWorkspaceRef.current = false;
      setExperience(next);
      setQuestion(next.question);
      setAlternatesAvailable(next.binding.alternates_available);
      setQuestionCompleted(false);
      setCompleted(false);
      setWorkspace([]);
      applySession(next.session_id, next.opening.revision);
      playingRef.current = true;
      void consumeTurn(next.opening, generation);
    },
    [applySession, consumeTurn],
  );

  /** 采用页面已拉取的 /experience 结果（页面只问一次，组件不重复建会话）。 */
  const adopt = useCallback(
    (next: TutorExperienceResponse) => {
      adoptExperience(next, generationRef.current + 1);
    },
    [adoptExperience],
  );

  /** /experience 启动（或换讲法：switchFromSessionId）。 */
  const start = useCallback(
    async (options?: { switchFromSessionId?: string }): Promise<LearnExperienceResponse | undefined> => {
      setPhase("starting");
      setError(undefined);
      const generation = generationRef.current + 1;
      try {
        const result = await api.startLearnExperience(taskId, {
          studentId,
          ...(options?.switchFromSessionId ? { switchFromSessionId: options.switchFromSessionId } : {}),
        });
        if (result.kind === "legacy") return result;
        adoptExperience(result, generation);
        return result;
      } catch (startError) {
        playingRef.current = false;
        const message = startError instanceof Error ? startError.message : String(startError);
        setError(message);
        setPhase("recovering");
        return undefined;
      }
    },
    [adoptExperience, studentId, taskId],
  );

  /** 刷新恢复：GET 学生安全视图，pending voice 重播、pending workspace 重建。
   *  返回是否恢复成功（404/损坏 → false，调用方按默认 Binding 重开新会话）。 */
  const restore = useCallback(async (targetSessionId: string): Promise<boolean> => {
    setPhase("starting");
    setError(undefined);
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      const view: TutorSessionView = await api.getTutorSession(targetSessionId);
      applySession(view.session_id, view.revision);
      if (view.task_id) setAlternatesAvailable(Boolean(view.alternates_available));
      if (view.question) setQuestion(view.question);
      if (view.question_completed) setQuestionCompleted(true);
      if (view.completed) {
        setCompleted(true);
        setPhase("completed");
        return true;
      }
      // 与 syncActiveWorkspace 的「此前有待操作步」口径对齐：恢复出的 pending
      // workspace 不会被后续空 workspace 回合误清。
      hadWorkspaceRef.current = view.pending_workspace.length > 0;
      setWorkspace(view.pending_workspace);
      playingRef.current = true;
      if (view.pending_workspace.length && !view.pending_voice.length) {
        setPhase("workspaceActive");
        playingRef.current = false;
        return true;
      }
      if (view.pending_voice.length) {
        await speakTurn(
          {
            session_id: view.session_id,
            revision: view.revision,
            client_turn_id: "restore",
            idempotent_replay: true,
            mode: view.mode,
            current_checkpoint: view.current_checkpoint,
            decision: null,
            voice: view.pending_voice,
            workspace: view.pending_workspace,
            event_cursor: view.event_cursor,
          },
          generation,
        );
        return true;
      }
      setPhase("awaitingInput");
      playingRef.current = false;
      return true;
    } catch (restoreError) {
      playingRef.current = false;
      const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
      setError(message);
      setPhase("recovering");
      return false;
    }
  }, [applySession, speakTurn]);

  /** 整题完成：关闭会话（session_completed）——Topic 学习进度由页面记录。 */
  const finishQuestion = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    if (!activeSession) return;
    await api.completeTutorSession(activeSession, "finished").catch(() => undefined);
    setCompleted(true);
    setPhase("completed");
  }, []);

  const replayNarration = useCallback(() => {
    void narration.replay();
  }, [narration]);

  return {
    phase,
    sessionId,
    revision,
    experience,
    question,
    alternatesAvailable,
    transcript,
    workspace,
    questionCompleted,
    completed,
    error,
    autoplayBlocked,
    currentCheckpoint: lastTurnRef.current?.current_checkpoint,
    transport,
    adopt,
    start,
    restore,
    submitStudentInput,
    bargeIn,
    resumeFromInterrupt,
    finishQuestion,
    replayNarration,
    appendTranscript,
  };
}

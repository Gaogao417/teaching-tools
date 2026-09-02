/**
 * TutorLearningController + ActionRuntimeTransport（Phase 5 UI 集成 / 计划 §3；
 * VS1 统一 StudentWorkspaceView 消费）。
 *
 * /learn/:taskId 的 Tutor 驱动工作台控制器：会话生命周期（/experience 启动、
 * GET :id 刷新恢复）、narration/media 管线（开场与每回合 voice 自动播放、
 * barge-in、autoplay-blocked 重播）、六类学生输入（回答/提问/操作证据）、
 * 同题换讲法与题目完成推进。
 *
 * VS1（mvp/vs-01 REQ-04/05/08）：Workspace 状态只来自统一
 * `StudentWorkspaceView`（turn response 与 session view 同一类型、同一
 * revision、同一服务端投影）——本 hook 不再拼装 `workspace[]`/
 * `pending_workspace`/`demonstration` 第二份状态，也不做 GET 回读重建
 * （服务端按会话权威 pending 状态投影 participation.mode/activeAction）。
 * evidence 经 SubmitEvidence 送回 TutorSession typed evaluator——Action
 * Runtime 与 Tutor state 共享同一 decision/revision。
 *
 * phase 是推导值（波次 C-2 裁定 2）：由 narration 播放状态 + 在途请求状态 +
 * 权威 workspace_view 投影经 useMemo 计算，不落 useState、不散点
 * setPhase——标签与画布形态永远读同一份事实。业务事实（revision/view/
 * checkpoint/completed）全部来自 TutorSession 服务端响应，单一权威不动；
 * 不为 phase 建后端下发、不把 UI 事件回写会话状态。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ResponseSchemaError } from "../../api/client";
import { MediaSessionController } from "../../presentation/audio/MediaSessionController";
import { NarrationController } from "../../presentation/narration/NarrationController";
import type {
  ActionEvaluationRequest,
  ActionEvaluationResponse,
  ActionEvidence,
} from "../../../../shared/actionRuntime";
import type {
  LearnExperienceResponse,
  TutorCheckpointView,
  TutorExperienceResponse,
  TutorQuestionView,
  TutorSessionView,
  TutorStudentInput,
  TutorTurnResponse,
  TutorVoiceAction,
} from "../../../../shared/tutorExperience";
import type { StudentWorkspaceView } from "../../../../shared/studentWorkspace";
import { vnextApi, VNextApiError, type VNextActiveAction, type VNextSessionResponse } from "../../api/vnextTutorClient";
import { parseCoachPanelView, parseStudentWorkspaceView } from "../../presentation/canonicalView/parseCanonicalView";
import type { CoachPanelViewV1, StudentWorkspaceViewV1 } from "../../presentation/canonicalView/canonicalViewTypes";
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

/** restore 结果（VS1 REQ-08）：区分「会话丢失可重开」与「schema 非法
 *  （recoverable error，不静默重开、不回旧渲染链）」。 */
export type TutorRestoreOutcome = "restored" | "missing" | "invalid";

/**
 * VS1 remediation-2 裁定 2（presentation advance）：本回合话术呈现指针。
 * 「明白，继续」放行恰一步（首条自动播，其后逐条等门）；「上一拍/回开头」
 * 只纯回看（narration 缓存重播），绝不写会话状态/二次上报 voice
 * completion——教学事实推进仍由学生实质回应 + checkpoint alignment 完成
 * （ADR-010 不变量 1/5）。全部为前端瞬时呈现状态。
 */
export interface TutorPresentation {
  /** 本回合已播话术数（含正在播的这条）。 */
  playedCount: number;
  /** 队列已知总片数（playedCount + 未播；续走 voice 追加会增长）。 */
  totalCount: number;
  /** 正在播放当前话术（TTS 在放）。 */
  playing: boolean;
  /** 当前话术已播完、等「明白，继续」放行下一片。 */
  awaitingContinue: boolean;
  /** 正在回看上一段/开头（纯重播，指针不动）。 */
  reviewing: boolean;
  /** 气泡当前话术文本（播放中/最近播完的一条；回看时为被回看条）。 */
  currentText?: string;
}

const INITIAL_PRESENTATION: TutorPresentation = {
  playedCount: 0,
  totalCount: 0,
  playing: false,
  awaitingContinue: false,
  reviewing: false,
};

const SPEECH_PROFILE_VERSION = "tutor-zh-v1";

function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 等待当前 narration 播放自然结束（loading/playing → idle/error）。
 *  blocked-by-autoplay 视作已交付（音频已就绪，可手动 replay）。
 *  isCancelled 为真（barge-in）立即返回。
 *  sawActive 以订阅时的当前状态初始化（波次 E 真实链修复）：tutor 流程里
 *  enter() 先把 media 推到 playing 才返回，waitFor 随后才订阅——subscribe
 *  不回放当前状态，若只靠后续转移置位，attach-during-playing 的等待者
 *  在 ended→idle 时因 sawActive=false 不结算，播放完成永远不回报
 *  （真实 TTS 下复现；fake 链走 failed 路径从未触发该竞态）。 */
function waitForPlaybackEnd(
  media: MediaSessionController,
  isCancelled: () => boolean,
  timeoutMs = 10 * 60_000,
): Promise<"done" | "cancelled" | "error"> {
  const initialStatus = media.getState().status;
  let sawActive = initialStatus === "loading" || initialStatus === "playing";
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

export interface UseTutorLearningOptions {
  taskId: TaskId;
  studentId: string;
  /** 刷新恢复：URL ?session= 里的会话 id。 */
  restoreSessionId?: string;
  /** F7 vNext 数据源（canonical Runtime 链）：true 时旧协调器 API 全停用，
   *  内部状态归一 canonical view/v1 + active_action（ledger 增补 6 清单）。 */
  vnext?: boolean;
}

export function useTutorLearning({ taskId, studentId, restoreSessionId, vnext }: UseTutorLearningOptions) {
  const [sessionId, setSessionId] = useState<string | undefined>(restoreSessionId);
  // ---- F7 vNext 数据源（canonical view/v1 内部归一；旧路径零改动）----
  const [vnextWorkspace, setVnextWorkspace] = useState<StudentWorkspaceViewV1 | undefined>();
  const [vnextCoach, setVnextCoach] = useState<CoachPanelViewV1 | undefined>();
  const [vnextParticipationKind, setVnextParticipationKind] = useState<string>("listen_only");
  const [vnextActiveAction, setVnextActiveAction] = useState<VNextActiveAction | undefined>();
  const [vnextCompleted, setVnextCompleted] = useState(false);
  const [vnextTurnFailure, setVnextTurnFailure] = useState<string | undefined>();
  const vnextRevisionRef = useRef(0);
  const vnextSessionRef = useRef<string | undefined>(undefined);

  const adoptVNext = useCallback((response: VNextSessionResponse) => {
    const workspace = parseStudentWorkspaceView(response.views.student_workspace_view);
    const coach = parseCoachPanelView(response.views.coach_panel_view);
    if (!workspace.ok || !coach.ok) {
      setError(`vNext 视图解析失败（fail closed）：${[...workspace.ok ? [] : workspace.issues, ...coach.ok ? [] : coach.issues].join("; ")}`);
      return;
    }
    vnextSessionRef.current = response.session_id;
    vnextRevisionRef.current = response.revision;
    setSessionId(response.session_id);
    setVnextWorkspace(workspace.view);
    setVnextCoach(coach.view);
    setVnextParticipationKind(String((response.views.participation as { kind?: string } | undefined)?.kind ?? "listen_only"));
    setVnextActiveAction(response.active_action);
    setVnextCompleted(Boolean(response.completed));
    setVnextTurnFailure(response.turn?.failure?.failure_class);
    if (response.question) setQuestion({ artifact_id: "", question_type: "fill_blank", stem: response.question.stem, subquestions: [] } as TutorQuestionView);
    // transcript 由 canonical coach 视图派生（呈现映射，非域反适配）。
    setTranscript(coach.view.transcript.map((turn, index) => ({
      id: turn.turn_id || `vt-${index}`,
      role: turn.role === "tutor" ? "tutor" : "student",
      text: turn.content,
      at: 0,
    })));
    setBootstrapPending(false);
    setTurnPending(false);
  }, []);
  const [revision, setRevision] = useState(0);
  const [experience, setExperience] = useState<TutorExperienceResponse | undefined>();
  const [question, setQuestion] = useState<TutorQuestionView | undefined>();
  const [alternatesAvailable, setAlternatesAvailable] = useState(false);
  const [transcript, setTranscript] = useState<TutorTranscriptEntry[]>([]);
  /** VS1：统一 Workspace View（Geometry/Board/Participation 唯一消费面；
   *  服务端投影，含会话权威 pending 操作步与披露板书）。 */
  const [workspaceView, setWorkspaceView] = useState<StudentWorkspaceView | undefined>(undefined);
  /** VS1 remediation-2：拍点只读展示（B3a 合同）——turn/restore 同源 state。 */
  const [currentCheckpoint, setCurrentCheckpoint] = useState<TutorCheckpointView | undefined>();
  /** VS1 remediation-2：呈现指针（瞬时，见 TutorPresentation 注释）。 */
  const [presentation, setPresentation] = useState<TutorPresentation>(INITIAL_PRESENTATION);
  const [questionCompleted, setQuestionCompleted] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  // phase 的推导输入（波次 C-2 裁定 2）——只记录事实，不直接命名 phase：
  const [speechActive, setSpeechActive] = useState(false);
  const [turnPending, setTurnPending] = useState(false);
  const [bootstrapPending, setBootstrapPending] = useState(false);
  /** barge-in 是真实 UI 事件，无法从 narration/请求状态推导（停播有多重原因：
   *  自然结束、TTS 失败、换讲法代际作废——只有学生点击「打断」这个意图值得
   *  进入 interrupted；由 resumeFromInterrupt 显式清除）。 */
  const [interrupted, setInterrupted] = useState(false);

  const revisionRef = useRef(0);
  const sessionIdRef = useRef<string | undefined>(restoreSessionId);
  const playingRef = useRef(false);
  const generationRef = useRef(0);
  const lastTurnRef = useRef<TutorTurnResponse | undefined>(undefined);
  /** 呈现门（remediation-2 裁定 2）：当前挂起的「明白，继续」放行回调。
   *  同步置 null 防双击双放行；新回合/barge-in 以 "abandon" 结算旧门。 */
  const continueGateRef = useRef<{ resolve: (result: "advance" | "abandon") => void } | null>(null);
  /** 本回合已播话术（纯回看数据源；followUp 追加后单调增长）。 */
  const playedVoicesRef = useRef<TutorVoiceAction[]>([]);
  /** 操作回合不设门（canonical operate 形态无教学播放控件）：签发操作步的
   *  回合话术自动播完，门只作用于讲解回合（remediation-2 语义对齐）。 */
  const operateModeRef = useRef(false);

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

  // 完成态只读（ADR-010 §7 Completed）：结算门上等待的呈现队列——完成页
  // 无 CTA，剩余话术不再放行、不悬挂。
  useEffect(() => {
    if (!questionCompleted && !completed) return;
    const gate = continueGateRef.current;
    if (gate) {
      continueGateRef.current = null;
      gate.resolve("abandon");
    }
  }, [questionCompleted, completed]);

  /** phase 投影（8 态枚举不变）：权威事实 → 状态值（页面据此渲染控件与
   *  data-tutor-phase 诊断属性）。
   *  优先级：完成 > 打断 > 错误恢复 > 启动/恢复 > 在途回合 > 讲解播放 >
   *  待操作 > 等输入。workspaceActive 读统一 View 的 participation.mode
   *  （服务端按会话权威 pending 操作步投影——空回合不丢操作画布）。 */
  const phase: TutorPhase = useMemo(() => {
    if (completed || questionCompleted) return "completed";
    if (interrupted) return "interrupted";
    if (error) return "recovering";
    if (bootstrapPending || !sessionId) return "starting";
    if (turnPending) return "thinking";
    if (speechActive) return "speaking";
    if (vnext) {
      if (vnextParticipationKind === "workspace_input") return "workspaceActive";
      return "awaitingInput";
    }
    if (workspaceView?.participation.mode === "operate") return "workspaceActive";
    return "awaitingInput";
  }, [completed, questionCompleted, interrupted, error, bootstrapPending, sessionId, turnPending, speechActive, workspaceView, vnext, vnextParticipationKind]);

  /** VS1：进行中的操作步（统一 View 的 participation 槽；operate 态才有）。 */
  const activeOperation = useMemo(
    () => {
      if (vnext) {
        // F7：active_action 与纯 Workspace View 分开（ledger 增补 6）；构造未
        // committed 时服务端不下发 → 不挂载（ActionRuntimeFrame 分支不进）。
        return vnextActiveAction
          ? { actionId: vnextActiveAction.action_id, plan: vnextActiveAction.action_plan as never }
          : undefined;
      }
      return workspaceView?.participation.mode === "operate" ? workspaceView.participation.activeAction : undefined;
    },
    [workspaceView, vnext, vnextActiveAction],
  );

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

  const afterTurnCommon = useCallback((turn: TutorTurnResponse) => {
    lastTurnRef.current = turn;
    revisionRef.current = turn.revision;
    setRevision(turn.revision);
    // VS1：统一 View 直接来自响应（guard 已验证；无第二份拼装状态）。
    setWorkspaceView(turn.workspace_view);
    operateModeRef.current = turn.workspace_view.participation.mode === "operate";
    setCurrentCheckpoint(turn.current_checkpoint);
    if (turn.question_completed) setQuestionCompleted(true);
  }, []);

  /** 播放一组 voice 动作（顺序播放；每个完成后上报 voice-completions 并消费
   *  返回的系统续走回合）。打断语义由 bargeIn 控制（stop 立即生效）。
   *
   *  VS1 修复（REQ-06 根因）：完成产生的续走 voice 只能「追加到队列尾部」，
   *  不得替换/丢弃本回合剩余的 sibling voice——旧实现的递归+return 会把
   *  同回合后续 voice 永久泄漏为服务端 pending（前端"静息"但刷新重放，
   *  revision 无故推进，破坏 live/refresh 深比较一致）。
   *
   *  VS1 remediation-2 裁定 2（presentation advance）：首条自动播，其后
   *  每条播完在门上等「明白，继续」放行——放行恰一步、不改会话状态；
   *  新回合/barge-in 以 "abandon" 结算旧门（单活跃队列）。 */
  const speakTurn = useCallback(
    async (turn: TutorTurnResponse, generation: number): Promise<void> => {
      // 新队列接管：结算上一队列可能挂起的门（旧循环拿到 abandon 后自行退出）。
      const pendingGate = continueGateRef.current;
      if (pendingGate) {
        continueGateRef.current = null;
        pendingGate.resolve("abandon");
      }
      const queue = [...turn.voice];
      playedVoicesRef.current = [];
      setPresentation({
        playedCount: 0,
        totalCount: queue.length,
        playing: queue.length > 0,
        awaitingContinue: false,
        reviewing: false,
        currentText: queue[0]?.text,
      });
      while (queue.length) {
        const voice = queue.shift()!;
        if (!playingRef.current || generation !== generationRef.current) return;
        appendTranscript("tutor", voice.text);
        setPresentation((prev) => ({ ...prev, playing: true, reviewing: false, currentText: voice.text }));
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
          // 续走 voice 排在剩余 sibling 之后（同回合批次先讲完）。
          queue.push(...followUp.voice);
        }
        if (!playingRef.current || generation !== generationRef.current) return;
        playedVoicesRef.current.push(voice);
        setPresentation((prev) => ({
          ...prev,
          playedCount: playedVoicesRef.current.length,
          totalCount: playedVoicesRef.current.length + queue.length,
          playing: false,
          currentText: voice.text,
        }));
        if (queue.length && !operateModeRef.current) {
          setPresentation((prev) => ({ ...prev, awaitingContinue: true }));
          const release = await new Promise<"advance" | "abandon">((resolve) => {
            continueGateRef.current = { resolve };
          });
          setPresentation((prev) => ({ ...prev, awaitingContinue: false }));
          if (release !== "advance") return;
        }
      }
      if (generation !== generationRef.current) return;
      playingRef.current = false;
      setPresentation((prev) => ({ ...prev, playing: false, awaitingContinue: false }));
    },
    [appendTranscript, afterTurnCommon, media, narration],
  );

  /** 「明白，继续」：放行恰一步。门不存在（非等待态）时 no-op——快速
   *  双击只放行一次（第一次点击同步置 null；负断言④）。 */
  const advancePresentation = useCallback(() => {
    const gate = continueGateRef.current;
    if (!gate) return;
    continueGateRef.current = null;
    gate.resolve("advance");
  }, []);

  /** 纯回看（裁定 1）：narration 缓存重播已播话术——不二次上报 voice
   *  completion、不改 transcript/呈现指针/任何会话状态。 */
  const reviewUtterance = useCallback(
    async (voice: TutorVoiceAction): Promise<void> => {
      setPresentation((prev) => (prev.reviewing ? prev : { ...prev, reviewing: true, currentText: voice.text }));
      const url = await narration
        .enter(
          {
            utteranceId: `${voice.action_id}:review`,
            spokenText: voice.text,
            cacheKey: `${SPEECH_PROFILE_VERSION}:${voice.voice_source ?? "approved-resource"}:${voice.text}`,
          },
          undefined,
          true,
        )
        .catch(() => undefined);
      if (url) {
        await waitForPlaybackEnd(media, () => !playingRef.current);
      }
      setPresentation((prev) => ({
        ...prev,
        reviewing: false,
        currentText: playedVoicesRef.current[playedVoicesRef.current.length - 1]?.text ?? prev.currentText,
      }));
    },
    [media, narration],
  );

  /** 上一拍：回看最近已播的上一段话术（开局单条时 no-op→按钮禁用）。 */
  const reviewPreviousNarration = useCallback(() => {
    const played = playedVoicesRef.current;
    const target = played[played.length - 2];
    if (!target) return;
    return reviewUtterance(target);
  }, [reviewUtterance]);

  /** 回开头：回看本回合第一段话术（纯呈现，不回到第一个 checkpoint）。 */
  const reviewFirstNarration = useCallback(() => {
    const target = playedVoicesRef.current[0];
    if (!target) return;
    return reviewUtterance(target);
  }, [reviewUtterance]);

  /** 消费一回合：同步统一 View，再走 narration；播放事实交给 speechActive
   *  （phase 由 useMemo 推导，speakTurn 内不再散点设置标签）。 */
  const consumeTurn = useCallback(
    async (turn: TutorTurnResponse, generation: number): Promise<void> => {
      afterTurnCommon(turn);
      if (turn.voice.length) setSpeechActive(true);
      if (turn.voice.length) {
        try {
          await speakTurn(turn, generation);
        } finally {
          // 换讲法/重开后旧代际的播放不让新回合的 speaking 标签闪断。
          if (generation === generationRef.current) setSpeechActive(false);
        }
      } else {
        playingRef.current = false;
      }
    },
    [afterTurnCommon, speakTurn],
  );

  /** 学生回合统一入口（回答/提问/静默等六类输入共用）。 */
  /** F7 vNext：类型化 intent 直通道（组件参与区/对话区用；同 submitStudentInput 的 vNext 分支实现）。 */
  const vnextSubmitIntent = useCallback(
    async (intentKind: "submit_answer" | "confirm" | "continue" | "ask_question" | "request_scaffold" | "request_rephrase" | "return_to_mainline", text?: string): Promise<void> => {
      const activeSession = vnextSessionRef.current;
      if (!activeSession) return;
      setTurnPending(true);
      if (text !== undefined) appendTranscript("student", intentKind === "ask_question" ? `（问）${text}` : text);
      try {
        adoptVNext(await vnextApi.submitIntent(activeSession, {
          intentKind,
          ...(text !== undefined ? { text } : {}),
          expectedRevision: vnextRevisionRef.current,
        }));
      } catch (turnError) {
        setTurnPending(false);
        setError(turnError instanceof Error ? turnError.message : String(turnError));
      }
    },
    [adoptVNext],
  );

  const submitStudentInput = useCallback(
    async (input: TutorStudentInput): Promise<void> => {
      const activeSession = sessionIdRef.current;
      if (!activeSession) return;
      if (vnext) {
        // F7：类型化 intent 通道（无通用聊天；assessment 由服务端边界拒）。
        const intentKind =
          input.input_kind === "reasoning_utterance" ? "submit_answer"
          : input.input_kind === "question_asked" ? "ask_question"
          : input.input_kind === "silence_observed" ? undefined
          : input.input_kind as "confirm" | "continue" | "request_scaffold" | "request_rephrase" | "barge_in" | "return_to_mainline";
        if (intentKind === undefined) return;
        setTurnPending(true);
        if (input.text !== undefined) appendTranscript("student", input.input_kind === "question_asked" ? `（问）${input.text}` : input.text);
        try {
          const response = await vnextApi.submitIntent(activeSession, {
            intentKind,
            ...(input.text !== undefined ? { text: input.text } : {}),
            expectedRevision: vnextRevisionRef.current,
          });
          adoptVNext(response);
        } catch (turnError) {
          setTurnPending(false);
          setError(turnError instanceof Error ? turnError.message : String(turnError));
        }
        return;
      }
      setTurnPending(true);
      if (input.text !== undefined) {
        appendTranscript("student", input.input_kind === "question_asked" ? `（问）${input.text}` : input.text);
      }
      try {
        playingRef.current = true;
        const turn = await api.submitTutorTurn(activeSession, newTurnId(), revisionRef.current, input);
        setTurnPending(false);
        await consumeTurn(turn, generationRef.current);
      } catch (turnError) {
        playingRef.current = false;
        setTurnPending(false);
        const message = turnError instanceof Error ? turnError.message : String(turnError);
        setError(message);
      }
    },
    [appendTranscript, consumeTurn],
  );

  /** 计划 §3 ActionRuntimeTransport.SubmitEvidence：evidence 送回 TutorSession
   *  typed evaluator；返回 evaluation 更新 Action Runtime，tutorTurn 已在内部
   *  消费（narration/workspaceView/phase）。 */
  const transport: ActionRuntimeTransport = useMemo(
    () => ({
      submitEvidence: async (request) => {
        if (vnext) {
          // F7 方案 A：服务端真实 typed evaluator 结果透传；系统失败上抛绝不
          // 映射 wrong。rejected 返回 genuine wrong+diagnosis（applyEvaluation
          // 呈现错误反馈；暂态模式=零事件已由服务端保证）。
          const vnextSession = vnextSessionRef.current;
          if (!vnextSession) throw new Error("vNext 会话未启动");
          const evidence = request.evidence[request.evidence.length - 1] as { actionId: string; sourceStepId: string; kind: string; version: number; values?: Record<string, string> };
          const response = await vnextApi.submitActionEvidence(vnextSession, {
            evidence: {
              actionId: evidence.actionId,
              sourceStepId: evidence.sourceStepId,
              kind: evidence.kind,
              version: evidence.version,
              values: evidence.values ?? {},
            },
            expectedRevision: vnextRevisionRef.current,
          });
          adoptVNext(response);
          return { ...response.action_submission.evaluation, revision: response.revision };
        }
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

  /** barge-in：立即停播并上报 interrupted（目标 <150ms 停止播放）。
   *  interrupted 是保留的显式 UI 事件状态（见 useState 声明处注释）；
   *  speechActive 是播放事实更新（停播即不再播放），不是 phase 赋值。
   *  remediation-2：门上等待的呈现队列一并 abandon（interrupted 态 CTA
   *  禁用，不再静默放行）。 */
  const bargeIn = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    const pendingGate = continueGateRef.current;
    if (pendingGate) {
      continueGateRef.current = null;
      pendingGate.resolve("abandon");
    }
    narration.stop();
    media.stop("narration");
    playingRef.current = false;
    setSpeechActive(false);
    setInterrupted(true);
    setPresentation((prev) => ({ ...prev, playing: false, awaitingContinue: false, reviewing: false }));
    const pending = lastTurnRef.current?.voice.find((voice) => voice.interruptible)
      ?? lastTurnRef.current?.voice[0];
    if (activeSession && pending) {
      await api.completeTutorVoice(activeSession, pending.action_id, "interrupted").catch(() => null);
    }
  }, [media, narration]);

  const resumeFromInterrupt = useCallback(() => setInterrupted(false), []);

  const adoptExperience = useCallback(
    (next: TutorExperienceResponse, generation: number) => {
      generationRef.current = generation;
      lastTurnRef.current = undefined;
      setExperience(next);
      setQuestion(next.question);
      setAlternatesAvailable(next.binding.alternates_available);
      setQuestionCompleted(false);
      setCompleted(false);
      setWorkspaceView(undefined);
      operateModeRef.current = false;
      setCurrentCheckpoint(undefined);
      setPresentation(INITIAL_PRESENTATION);
      // 新会话接管：清掉上一会话遗留的 UI 事件/播放事实（phase 随之重推导）。
      setInterrupted(false);
      setSpeechActive(false);
      setTurnPending(false);
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
      setError(undefined);
      setBootstrapPending(true);
      if (vnext) {
        // F7 vNext 数据源：canonical Runtime 链会话（不走旧 /experience）。
        try {
          adoptVNext(await vnextApi.start({ studentId }));
        } catch (startError) {
          setBootstrapPending(false);
          setError(startError instanceof Error ? startError.message : String(startError));
        }
        return undefined;
      }
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
        return undefined;
      } finally {
        setBootstrapPending(false);
      }
    },
    [adoptExperience, studentId, taskId],
  );

  /** 刷新恢复：GET 学生安全视图，pending voice 重播、统一 View 直接采用。
   *  VS1 REQ-08：schema 非法（含缺 workspace_view）→ "invalid"（recoverable
   *  error 显示，不静默重开）；会话丢失/网络失败 → "missing"（调用方按默认
   *  Binding 重开同一 Question——VS0 登记的既有行为，不是静默 fallback）。 */
  const restore = useCallback(async (targetSessionId: string): Promise<TutorRestoreOutcome> => {
    setError(undefined);
    setBootstrapPending(true);
    setInterrupted(false);
    if (vnext) {
      try {
        adoptVNext(await vnextApi.restore(targetSessionId));
        return "restored";
      } catch (restoreError) {
        setBootstrapPending(false);
        if (restoreError instanceof VNextApiError && restoreError.status === 404) return "missing";
        setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
        return "invalid";
      }
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    try {
      const view: TutorSessionView = await api.getTutorSession(targetSessionId);
      applySession(view.session_id, view.revision);
      if (view.task_id) setAlternatesAvailable(Boolean(view.alternates_available));
      if (view.question) setQuestion(view.question);
      if (view.question_completed) setQuestionCompleted(true);
      setWorkspaceView(view.workspace_view);
      operateModeRef.current = view.workspace_view.participation.mode === "operate";
      setCurrentCheckpoint(view.current_checkpoint);
      if (view.completed) {
        setCompleted(true);
        return "restored";
      }
      const operateMode = view.workspace_view.participation.mode === "operate";
      playingRef.current = true;
      if (operateMode && !view.pending_voice.length) {
        playingRef.current = false;
        return "restored";
      }
      if (view.pending_voice.length) {
        setSpeechActive(true);
        try {
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
              // L-04 冻结：合成回合只为 narration 重播服务——workspace 面已由
              // 上方 setWorkspaceView(view.workspace_view) 统一采用，legacy
              // 字段不再透传消费。
              workspace: [],
              workspace_view: view.workspace_view,
              event_cursor: view.event_cursor,
            },
            generation,
          );
        } finally {
          if (generation === generationRef.current) setSpeechActive(false);
        }
        return "restored";
      }
      playingRef.current = false;
      return "restored";
    } catch (restoreError) {
      playingRef.current = false;
      const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
      setError(message);
      return restoreError instanceof ResponseSchemaError ? "invalid" : "missing";
    } finally {
      setBootstrapPending(false);
    }
  }, [applySession, speakTurn]);

  /** 整题完成：关闭会话（session_completed）——Topic 学习进度由页面记录。 */
  const finishQuestion = useCallback(async () => {
    const activeSession = sessionIdRef.current;
    if (!activeSession) return;
    await api.completeTutorSession(activeSession, "finished").catch(() => undefined);
    setCompleted(true);
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
    workspaceView,
    activeOperation,
    /** F7 vNext 数据源（canonical view/v1 + active_action；vnext=false 时全 undefined）。 */
    vnextWorkspace,
    vnextCoach,
    vnextParticipationKind,
    vnextActiveAction,
    vnextCompleted,
    vnextTurnFailure,
    /** VS1 remediation-2：拍点只读展示（turn/restore 同源 state）。 */
    currentCheckpoint,
    /** VS1 remediation-2：话术呈现指针（瞬时；门/回看状态见 TutorPresentation）。 */
    presentation,
    questionCompleted,
    completed,
    error,
    autoplayBlocked,
    transport,
    adopt,
    start,
    restore,
    submitStudentInput,
    vnextSubmitIntent,
    bargeIn,
    resumeFromInterrupt,
    finishQuestion,
    replayNarration,
    advancePresentation,
    reviewPreviousNarration,
    reviewFirstNarration,
    appendTranscript,
  };
}

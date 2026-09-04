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
  ExercisePlan,
} from "../../../../shared/actionRuntime";
import { isActionEvaluationResponse, isExercisePlan } from "../../../../shared/actionRuntime";
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
import {
  newRuntimeRequestId,
  ProtocolParseError,
  TutorRuntimeHttpError,
  type StudentControlCommand,
  type TutorRuntimeClient,
  type ValidatedSessionSnapshot,
} from "../../api/tutorRuntimeClient";
import type { CoachPanelViewV1 } from "../../presentation/canonicalView/canonicalViewTypes";
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
  /** canonical Runtime 数据源（spec §4.1：LearnPage 按 availability 选择 client
   *  后注入）。提供时走 v7 SessionSnapshot 链；缺省走 legacy V5 链（F8 退场）。 */
  runtimeClient?: TutorRuntimeClient;
}

/** spec §1.3 #9 前端侧：render.geometry 的安全段 id 集（record 宽松对象，只探测 id）。 */
function renderGeometrySegmentIds(geometry: Record<string, unknown> | null): readonly string[] {
  if (!geometry) return [];
  const segments = geometry["segments"];
  if (!Array.isArray(segments)) return [];
  return segments
    .filter((segment): segment is Record<string, unknown> => typeof segment === "object" && segment !== null)
    .map((segment) => segment["id"])
    .filter((id): id is string => typeof id === "string");
}

/**
 * active_action 派生（adopt 时校验 + 渲染时同源派生，零 cast）：
 * `action_plan` 必须通过既有 ExercisePlan runtime validator；`target_ids` 必须
 * 全部存在于 render geometry（spec §1.3 #9）。任一失败 fail closed——快照
 * 不被采用（原子采用纪律），非「不挂载但采用」。
 */
function deriveRuntimeActiveOperation(snapshot: ValidatedSessionSnapshot):
  { ok: true; operation: { actionId: string; plan: ExercisePlan } | undefined }
  | { ok: false; reason: string } {
  const active = snapshot.active_action;
  if (active === undefined) return { ok: true, operation: undefined };
  if (!isExercisePlan(active.action_plan)) {
    return { ok: false, reason: `active_action.action_plan 未通过 ExercisePlan runtime validator（action_id=${active.action_id}）` };
  }
  const segmentIds = renderGeometrySegmentIds(snapshot.render.geometry);
  const missing = active.target_ids.filter((target) => !segmentIds.includes(target));
  if (missing.length > 0) {
    return { ok: false, reason: `active_action.target_ids 不在 render geometry 中：${missing.join(", ")}` };
  }
  return { ok: true, operation: { actionId: active.action_id, plan: active.action_plan } };
}

/** canonical transcript 派生（呈现映射，非域反适配；coach view 是唯一来源）。 */
function runtimeTranscriptEntries(coach: CoachPanelViewV1): TutorTranscriptEntry[] {
  return coach.transcript.map((turn, index) => ({
    id: turn.turn_id || `rt-${index}`,
    role: turn.role === "tutor" ? "tutor" : "student",
    text: turn.content,
    at: 0,
  }));
}

export function useTutorLearning({ taskId, studentId, restoreSessionId, runtimeClient }: UseTutorLearningOptions) {
  const [sessionId, setSessionId] = useState<string | undefined>(restoreSessionId);
  // ---- canonical Runtime 数据源（F7 Step 5：单一 ValidatedSessionSnapshot）----
  // spec §4.2/§4.3：允许的持久业务状态只有已验证 SessionSnapshot；解析失败保留
  // 最后一份合法快照并显示 recoverable protocol error，不部分更新、不回落 legacy。
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ValidatedSessionSnapshot | undefined>();
  const [protocolError, setProtocolError] = useState<string | undefined>();
  /** evidence 系统失败的瞬时提示（非 committed turn 失败——那类随快照 turn 派生）。 */
  const [runtimeFailureNotice, setRuntimeFailureNotice] = useState<string | undefined>();
  /** actor-first（spec §4.6）：evidence 成功响应的 snapshot 暂存于此，等当前
   *  actor 消费 evaluation 后由 adoptPendingEvaluationSnapshot() 原子采用。 */
  const pendingEvaluationSnapshotRef = useRef<ValidatedSessionSnapshot | undefined>(undefined);
  const runtimeSnapshotRef = useRef<ValidatedSessionSnapshot | undefined>(undefined);
  /** start 幂等键：同一挂载生命周期的重试复用同键（payload 相同 → Existing 回放）。 */
  const runtimeStartKeyRef = useRef<string | undefined>(undefined);

  const adoptRuntimeSnapshot = useCallback((snapshot: ValidatedSessionSnapshot): boolean => {
    if (snapshot.task_id !== taskId) {
      setProtocolError(`快照 task_id=${snapshot.task_id} 与会话任务 ${taskId} 不一致（fail closed）`);
      return false;
    }
    const operation = deriveRuntimeActiveOperation(snapshot);
    if (!operation.ok) {
      setProtocolError(`active_action 校验失败（fail closed）：${operation.reason}`);
      return false;
    }
    runtimeSnapshotRef.current = snapshot;
    pendingEvaluationSnapshotRef.current = undefined;
    setProtocolError(undefined);
    setRuntimeFailureNotice(undefined);
    setRuntimeSnapshot(snapshot);
    setSessionId(snapshot.session_id);
    setRevision(snapshot.revision);
    return true;
  }, [taskId]);

  /** 协议/HTTP 失败：ProtocolParseError 保留最后合法快照（recoverable）；其余走瞬时 error。 */
  const handleRuntimeError = useCallback((failure: unknown) => {
    if (failure instanceof ProtocolParseError) {
      setProtocolError(failure.message);
      return;
    }
    setError(failure instanceof Error ? failure.message : String(failure));
  }, []);

  /** actor 消费 evaluation 后的原子采用（spec §4.6 第 5 步；组件经 onEvaluation 回调触发）。 */
  const adoptPendingEvaluationSnapshot = useCallback(() => {
    const pending = pendingEvaluationSnapshotRef.current;
    if (!pending) return;
    pendingEvaluationSnapshotRef.current = undefined;
    adoptRuntimeSnapshot(pending);
  }, [adoptRuntimeSnapshot]);

  /** protocol error 的显式恢复：GET restore 重新对账（零教学副作用）。 */
  const retrySync = useCallback(async (): Promise<void> => {
    const current = runtimeSnapshotRef.current;
    if (!runtimeClient || !current) return;
    try {
      adoptRuntimeSnapshot(await runtimeClient.restore(current.session_id));
    } catch (failure) {
      handleRuntimeError(failure);
    }
  }, [runtimeClient, adoptRuntimeSnapshot, handleRuntimeError]);

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
   *  优先级：完成 > 错误恢复 > 启动/恢复 > 在途回合 > 待操作 > 等输入。
   *  canonical Runtime 链：workspaceActive 读 snapshot participation 的
   *  workspace_input（active_action 挂载门禁已由服务端 + 采用校验保证）；
   *  legacy 链保持 workspace_view.participation.mode 语义。 */
  const phase: TutorPhase = useMemo(() => {
    if (runtimeClient) {
      if (runtimeSnapshot?.completed) return "completed";
      if (protocolError || error) return "recovering";
      if (!runtimeSnapshot) return "starting";
      if (turnPending) return "thinking";
      if (runtimeSnapshot.views.participation.kind === "workspace_input" && runtimeSnapshot.active_action !== undefined) {
        return "workspaceActive";
      }
      return "awaitingInput";
    }
    if (completed || questionCompleted) return "completed";
    if (interrupted) return "interrupted";
    if (error) return "recovering";
    if (bootstrapPending || !sessionId) return "starting";
    if (turnPending) return "thinking";
    if (speechActive) return "speaking";
    if (workspaceView?.participation.mode === "operate") return "workspaceActive";
    return "awaitingInput";
  }, [runtimeClient, runtimeSnapshot, protocolError, completed, questionCompleted, interrupted, error, bootstrapPending, sessionId, turnPending, speechActive, workspaceView]);

  /** 进行中的操作步：canonical = snapshot.active_action 经 ExercisePlan/target
   *  门禁派生（adopt 已校验，此处同源重推导，零 cast）；legacy = 统一 View 的
   *  participation 槽（operate 态才有）。 */
  const activeOperation = useMemo(
    () => {
      if (runtimeClient) {
        if (!runtimeSnapshot) return undefined;
        const derived = deriveRuntimeActiveOperation(runtimeSnapshot);
        return derived.ok ? derived.operation : undefined;
      }
      return workspaceView?.participation.mode === "operate" ? workspaceView.participation.activeAction : undefined;
    },
    [runtimeClient, runtimeSnapshot, workspaceView],
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

  /** 学生回合统一入口（回答/提问/静默等六类输入共用，legacy 链）。 */

  /** canonical 输入链（spec §2.5）：前端只提交原始学生输入或显式 UI control，
   *  不提交任何由前端猜出的语义意图（intent 由后端 SemanticInterpreter 解释）。
   *  channel 是用户选择的交互入口：Coach assistance composer=assistance、
   *  mainline answer composer=mainline。 */
  const submitUtterance = useCallback(
    async (channel: "mainline" | "assistance", text: string): Promise<void> => {
      if (!runtimeClient) return;
      const current = runtimeSnapshotRef.current;
      if (!current) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      setTurnPending(true);
      try {
        adoptRuntimeSnapshot(await runtimeClient.submitStudentInput(
          current.session_id,
          { kind: "utterance", channel, text: trimmed },
          current.revision,
          newRuntimeRequestId(),
        ));
      } catch (turnError) {
        handleRuntimeError(turnError);
      } finally {
        setTurnPending(false);
      }
    },
    [runtimeClient, adoptRuntimeSnapshot, handleRuntimeError],
  );

  /** canonical 显式控制（confirm/continue/barge_in/return_to_mainline/retry_recovery/
   *  request_scaffold/request_rephrase——七值 typed control）。 */
  const submitControl = useCallback(
    async (command: StudentControlCommand): Promise<void> => {
      if (!runtimeClient) return;
      const current = runtimeSnapshotRef.current;
      if (!current) return;
      setTurnPending(true);
      try {
        adoptRuntimeSnapshot(await runtimeClient.submitStudentInput(
          current.session_id,
          { kind: "control", command },
          current.revision,
          newRuntimeRequestId(),
        ));
      } catch (turnError) {
        handleRuntimeError(turnError);
      } finally {
        setTurnPending(false);
      }
    },
    [runtimeClient, adoptRuntimeSnapshot, handleRuntimeError],
  );

  const submitStudentInput = useCallback(
    async (input: TutorStudentInput): Promise<void> => {
      if (runtimeClient) return;
      const activeSession = sessionIdRef.current;
      if (!activeSession) return;
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
    [appendTranscript, consumeTurn, runtimeClient],
  );

  /** 计划 §3 ActionRuntimeTransport.SubmitEvidence：evidence 送回服务端
   *  pinned template typed evaluator；返回 evaluation 更新 Action Runtime。
   *  canonical 链（spec §2.6/§4.6）：system failure 结构上无 evaluation——上抛
   *  （Frame markTransportFailure），绝不映射 wrong；evidence rejected/
   *  committed 返回真实 evaluation，且 snapshot 暂存待 actor 消费 evaluation
   *  后经 adoptPendingEvaluationSnapshot() 采用（actor-first 顺序）。 */
  const transport: ActionRuntimeTransport = useMemo(
    () => ({
      submitEvidence: async (request) => {
        if (runtimeClient) {
          const current = runtimeSnapshotRef.current;
          if (!current) throw new Error("runtime 会话未启动");
          const evidence = request.evidence[request.evidence.length - 1];
          const values: Record<string, string> = "values" in evidence && evidence.values !== undefined
            ? evidence.values
            : {};
          const result = await runtimeClient.submitActionEvidence(current.session_id, {
            evidence: {
              actionId: evidence.actionId,
              sourceStepId: evidence.sourceStepId,
              kind: evidence.kind,
              version: evidence.version,
              values,
            },
            expectedRevision: current.revision,
            // 幂等键复用 Frame 已管理的 submission key（同键重试幂等回放）。
            clientRequestId: request.idempotencyKey,
          });
          const submission = result.actionSubmission;
          if (submission.status === "evidence-rejected" || submission.status === "workspace-committed") {
            if (!isActionEvaluationResponse(submission.evaluation)) {
              throw new ProtocolParseError(["action_submission.evaluation 未通过 ActionEvaluationResponse runtime 校验"]);
            }
            pendingEvaluationSnapshotRef.current = result.snapshot;
            return { ...submission.evaluation, revision: result.snapshot.revision };
          }
          // 三类 system failure（revision-conflict/command-rejected/runtime-failure）：
          // 结构上禁 evaluation——不采用 snapshot、不评价，仅呈现可恢复失败。
          setRuntimeFailureNotice(`上一轮未生效（${submission.failure.failure_class}），请重试。`);
          throw new Error(`action evidence ${submission.status}: ${submission.failure.failure_class}`);
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
    [consumeTurn, runtimeClient],
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

  /** Runtime 链 start（显式 task_id pin；幂等键同挂载周期稳定）；legacy 链
   *  /experience 启动（或换讲法：switchFromSessionId）。 */
  const start = useCallback(
    async (options?: { switchFromSessionId?: string }): Promise<LearnExperienceResponse | undefined> => {
      setError(undefined);
      setProtocolError(undefined);
      setBootstrapPending(true);
      if (runtimeClient) {
        try {
          runtimeStartKeyRef.current ??= newRuntimeRequestId();
          adoptRuntimeSnapshot(await runtimeClient.start({
            taskId,
            studentId,
            clientRequestId: runtimeStartKeyRef.current,
          }));
        } catch (startError) {
          handleRuntimeError(startError);
        } finally {
          setBootstrapPending(false);
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
    [adoptExperience, studentId, taskId, runtimeClient, adoptRuntimeSnapshot, handleRuntimeError],
  );

  /** 刷新恢复：Runtime 链 GET verified rebuild（零模型调用）；legacy 链 GET
   *  学生安全视图 + pending voice 重播。
   *  VS1 REQ-08 语义保留：schema 非法 → "invalid"（recoverable error 显示，
   *  不静默重开、不回旧渲染链）；会话丢失 → "missing"（调用方按默认 Binding
   *  重开同一 Question）。Runtime 链另按 spec §2.4：409
   *  SESSION_VERSION_UNSUPPORTED → "invalid" + 明示重新开始，不回落 legacy。 */
  const restore = useCallback(async (targetSessionId: string): Promise<TutorRestoreOutcome> => {
    setError(undefined);
    setProtocolError(undefined);
    setBootstrapPending(true);
    setInterrupted(false);
    if (runtimeClient) {
      try {
        adoptRuntimeSnapshot(await runtimeClient.restore(targetSessionId));
        return "restored";
      } catch (restoreError) {
        if (restoreError instanceof ProtocolParseError) {
          setProtocolError(restoreError.message);
          return "invalid";
        }
        if (
          restoreError instanceof TutorRuntimeHttpError
          && restoreError.status === 404
          && restoreError.code === "SESSION_NOT_FOUND"
        ) {
          setBootstrapPending(false);
          return "missing";
        }
        if (
          restoreError instanceof TutorRuntimeHttpError
          && restoreError.status === 409
          && restoreError.code === "SESSION_VERSION_UNSUPPORTED"
        ) {
          setError("该会话来自旧版本运行时，请刷新页面重新开始本轮学习。");
          return "invalid";
        }
        handleRuntimeError(restoreError);
        return "invalid";
      } finally {
        setBootstrapPending(false);
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
  }, [applySession, speakTurn, runtimeClient, adoptRuntimeSnapshot, handleRuntimeError]);

  /** 整题完成：legacy 链关闭会话（session_completed）——Topic 学习进度由页面
   *  记录。Runtime 链 no-op：session_completed 属 v7 服务端事实（随快照
   *  completed 派生），前端禁调 legacy completeTutorSession。 */
  const finishQuestion = useCallback(async () => {
    if (runtimeClient) return;
    const activeSession = sessionIdRef.current;
    if (!activeSession) return;
    await api.completeTutorSession(activeSession, "finished").catch(() => undefined);
    setCompleted(true);
  }, [runtimeClient]);

  const replayNarration = useCallback(() => {
    void narration.replay();
  }, [narration]);

  /** canonical Runtime 派生面（spec §4.2：Coach transcript、Participation、
   *  Workspace、completed、active Action 均从单一 snapshot 派生）。 */
  const runtimeQuestion = useMemo<TutorQuestionView | undefined>(
    () => runtimeSnapshot
      ? { artifact_id: runtimeSnapshot.question.artifact_id, stem: runtimeSnapshot.question.stem, subquestions: [] }
      : undefined,
    [runtimeSnapshot],
  );
  const runtimeTranscript = useMemo(
    () => (runtimeSnapshot ? runtimeTranscriptEntries(runtimeSnapshot.views.coach_panel_view) : []),
    [runtimeSnapshot],
  );
  const runtimeTurnFailure = useMemo(() => {
    const turn = runtimeSnapshot?.turn;
    return turn && turn.status !== "committed" ? turn.failure?.failure_class : undefined;
  }, [runtimeSnapshot]);

  return {
    phase,
    sessionId,
    revision,
    experience,
    question: runtimeClient ? runtimeQuestion : question,
    alternatesAvailable,
    transcript: runtimeClient ? runtimeTranscript : transcript,
    workspaceView,
    activeOperation,
    /** canonical Runtime 数据源（runtimeClient 缺省时 undefined——legacy 链不消费）。 */
    runtimeSnapshot,
    runtimeParticipation: runtimeSnapshot?.views.participation,
    runtimeCoach: runtimeSnapshot?.views.coach_panel_view,
    runtimeWorkspace: runtimeSnapshot?.views.student_workspace_view,
    runtimePendingPresentation: runtimeSnapshot?.pending_presentation,
    runtimeCompleted: runtimeSnapshot?.completed ?? false,
    runtimeTurnFailure,
    runtimeFailureNotice,
    /** recoverable protocol error（保留最后一份合法 snapshot；retrySync 显式重对账）。 */
    protocolError,
    /** VS1 remediation-2：拍点只读展示（turn/restore 同源 state）。 */
    currentCheckpoint,
    /** VS1 remediation-2：话术呈现指针（瞬时；门/回看状态见 TutorPresentation）。 */
    presentation,
    questionCompleted,
    completed: runtimeClient ? (runtimeSnapshot?.completed ?? false) : completed,
    error,
    autoplayBlocked,
    transport,
    adopt,
    start,
    restore,
    submitStudentInput,
    submitUtterance,
    submitControl,
    adoptPendingEvaluationSnapshot,
    retrySync,
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

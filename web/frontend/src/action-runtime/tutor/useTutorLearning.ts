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
import { waitForPlaybackEndLegacy } from "../../presentation/audio/waitForPlaybackEnd";
import { NarrationController, type NarrationEnterResult, type NarrationUtterance } from "../../presentation/narration/NarrationController";
import {
  createTutorPresentationRuntime,
  type TutorPresentationRuntime,
} from "../../presentation/presentationRuntime/createTutorPresentationRuntime";
import type { PresentationRuntimePhase } from "../../presentation/presentationRuntime/types";
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
import {
  newRuntimeRequestId,
  ProtocolParseError,
  TutorRuntimeHttpError,
  type StudentBrowserInput,
  type StudentControlCommand,
  type TutorRuntimeClient,
  type ValidatedSessionSnapshot,
} from "../../api/tutorRuntimeClient";
import type { AdaptiveGenerationStatus } from "../../../../shared/tutorHttpProfile";
import { actionMachineRegistry } from "../registry";
import type { SolutionBoardView } from "../types";
import type { CoachPanelViewV1, SolutionBoardSurface, StudentWorkspaceViewHttp } from "../../presentation/canonicalView/canonicalViewTypes";
import { parseRenderGeometryV1 } from "../../presentation/canonicalView/renderGeometry";
import { presentationKeyOf } from "../../presentation/presentationRuntime/types";
import type { WorkspaceCommitSignal } from "../../presentation/presentationRuntime/workspaceCommitPort";
import type { StudentWorkspaceView } from "../../../../shared/studentWorkspace";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { TaskId } from "../../../../shared/contracts";

/** 计划 §3 ActionRuntimeTransport：evidence → {evaluation, tutorTurn}。 */
export interface ActionRuntimeTransport {
  submitEvidence(request: ActionEvaluationRequest): Promise<ActionEvaluationResponse>;
}

/**
 * F7 P2（S1 R1/R8）：generation 状态 view-model——单一来源 = 已验证快照的
 * 可选 generation 投影。服务端未投影（旧 projector）= "unprojected"，UI 不
 * 显示生成状态、不轮询；pending 期间只读轮询 GET snapshot（零模型调用）；
 * failed 提供「重新尝试」入口（走既有 control.retry_recovery，服务端以新
 * 预算创建新任务——生成生命周期规格 Failure semantics）。
 */
export type RuntimeGenerationVm =
  | { kind: "unprojected" }
  | { kind: "idle" }
  | { kind: "pending"; phase: "running" | "waiting_retry"; attempt: number; maxAttempts: number; retryAt?: string }
  | { kind: "failed"; errorClass: string; requestId: string };

function runtimeGenerationVmOf(generation: AdaptiveGenerationStatus | undefined): RuntimeGenerationVm {
  if (generation === undefined) return { kind: "unprojected" };
  if (generation.status === "idle") return { kind: "idle" };
  if (generation.status === "pending") {
    return {
      kind: "pending",
      phase: generation.phase,
      attempt: generation.attempt,
      maxAttempts: generation.max_attempts,
      ...(generation.retry_at !== undefined ? { retryAt: generation.retry_at } : {}),
    };
  }
  return { kind: "failed", errorClass: generation.error_class, requestId: generation.request_id };
}

/** generation pending 只读轮询的节奏（工程默认；waiting_retry 对齐 retry_at）。 */
const GENERATION_POLL_BASE_MS = 2000;
const GENERATION_POLL_MAX_MS = 15000;

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

/** canonical「这步没懂」话术（与参考实现 ActionRuntimeFrame 同文案）。 */
export const CONFUSED_MESSAGE = "我没听懂这一步，请换一种说法，并说明为什么这样做。";

// --------------------------------------------------------------------------- //
// F7 Step 8：录音 + 通道锁定 + ASR stale 防护（spec §2.9/§4.8；S1 交叉规则）
// --------------------------------------------------------------------------- //

/** 录音开始时锁定的通道与快照身份（不可变捕获——录音开始后 outcome/control
 *  导致的 revision 变化不得悄悄更新捕获值；ASR 结果按此核对后才可自动提交）。 */
export interface RecordingChannelCapture {
  readonly captureId: string;
  readonly channel: "mainline" | "assistance";
  readonly sessionId: string;
  readonly revision: number;
}

/** stale transcript 草稿（不自动提交；组件填入对应通道草稿并提示用户确认）。 */
export interface SpeechPendingTranscript {
  source: RecordingChannelCapture;
  channel: "mainline" | "assistance";
  text: string;
}

/** 录音通道在当前快照下是否合法：
 *  - mainline：answer_input 的独立 affordance（spec §4.8「不能共用一个 mic
 *    后猜意图」）——participation 离开 answer_input 即不再合法；
 *  - assistance：Coach 通道按合同可用（listen_only 仍开放，US-03）；
 *  - 完成态一律关闭。 */
function recordingChannelLegal(channel: "mainline" | "assistance", snapshot: ValidatedSessionSnapshot): boolean {
  if (snapshot.completed || snapshot.views.participation.kind === "read_only_completed") return false;
  return channel === "mainline"
    ? snapshot.views.participation.kind === "answer_input"
    : snapshot.views.coach_panel_view.assistance_available !== false;
}

// --------------------------------------------------------------------------- //
// 统一 UI view-model（复核裁定：数据源分派只发生在 controller 边界；
// Participation/Workspace/播放控件由单一 view-model 驱动，组件不得按
// Boolean(runtimeClient) 分两套 UI）
// --------------------------------------------------------------------------- //

/** 参与区控件（canonical kind 与 legacy 相位投影到同一控件词汇表）。 */
export type ParticipationControls =
  | { kind: "listen" }
  | { kind: "answer"; onSubmit: (text: string) => void }
  /** 唯一 typed CTA：canonical=control.confirm/continue（testId 供 e2e 锚点）；
   *  legacy=讲解门「明白，继续」（TopicTeachingConfirm 复合布局：恒挂确认组、
   *  answerVisible 时并行主线表单——原 actionEnd 行为零改动）。confused 仅
   *  legacy 讲解门形态携带（assistance 提问入口）。 */
  | {
      kind: "cta";
      label: string;
      onSubmit: () => void;
      testId?: string;
      understoodDisabled?: boolean;
      confusedDisabled?: boolean;
      confused?: () => void;
      answer?: { onSubmit: (text: string) => void };
    }
  | { kind: "inquiry"; canReturn: boolean; onReturn: () => void }
  | { kind: "workspace_wait" }
  | { kind: "completed" }
  | { kind: "none" };

/** 讲解播放组（统一 view-model；数据源分派在 controller 边界）：
 *  legacy=本地呈现管线（门/回看指针）；canonical=PresentationRuntime 执行
 *  状态投影（F7 Step 6——呈现由服务端 pending 驱动，无手动 advance）。 */
export type PlaybackControlsVm =
  | {
    source: "legacy";
    presentation: TutorPresentation;
    advance: () => void;
    replay: () => void;
    reviewPrevious: () => void;
    reviewFirst: () => void;
  }
  | {
    source: "canonical";
    phase: PresentationRuntimePhase;
    canInterrupt: boolean;
    canReplay: boolean;
    interrupt: () => void;
    /** autoplay 解锁（用户手势恢复；与 failure 的 retrySync/retry_recovery 分离）。 */
    resume: () => void;
    /** 纯回放缓存（零上报）。 */
    replay: () => void;
  };

/** pending board delivery 的呈现执行身份（与 controller presentationKeyOf
 *  同格式）+ 重呈现目标——三次复验 P1：presentation_only 恢复不推进
 *  workspace revision，Board 失败封禁/重呈现按执行身份绑定。 */
export interface BoardPresentationExecution {
  key: string;
  targets: readonly string[];
}

/** Workspace 呈现面（canonical=快照 student_workspace_view + render.geometry
 *  解析产物 + 真实 commit 信号注入面 + pending board 执行身份；legacy=统一
 *  View）。 */
export type WorkspaceSurfaceVm =
  | {
    source: "canonical";
    /** F7 P2：HTTP 投影 v1|v2（v2 携带 solution_board.fragments）。 */
    view: StudentWorkspaceViewHttp | undefined;
    /** render.geometry 运行时解析产物（F7 Step 7 production Canvas 数据源）。 */
    geometry: TopicGeometryModel | undefined;
    /** 真实完成信号（production Canvas commit ∧ Board reveal 稳定双结算）。 */
    commitSignal: WorkspaceCommitSignal | undefined;
    /** 当前 pending board delivery 的执行身份（非 board pending 时 undefined）。 */
    boardPresentation: BoardPresentationExecution | undefined;
    workspaceExecutionKey: string | undefined;
  }
  | { source: "legacy"; workspaceView: StudentWorkspaceView | undefined; completed: boolean };

/** ActionRuntimeFrame 绑定（canonical：actor-first 采用 + canonical board
 *  surface + 禁 Frame 私有 legacy 媒体）。 */
export interface ActiveActionFrameVm {
  transport: ActionRuntimeTransport;
  onEvaluation?: (result: ActionEvaluationResponse) => void;
  viewRevision?: number;
  /** legacy 统一 View 板书投影（V5 链，F8 退场；canonical 不消费）。 */
  boardView?: SolutionBoardView;
  /** canonical 板书面（= 快照 student_workspace_view.solution_board；页面经
   *  共享 SolutionBoardViewSurface 渲染进 Frame boardSurface 槽）。 */
  board?: SolutionBoardSurface;
  /** 外部 Tutor runtime 拥有媒体/coach 时为 true：Frame 零媒体创建（F7 Step 7
   *  裁定：不 new MediaSessionController/NarrationController；媒体实例唯一
   *  属主 = 外层 PresentationRuntime）。 */
  legacyMediaDisabled: boolean;
}

const SPEECH_PROFILE_VERSION = "tutor-zh-v1";

function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** legacy 映射：NarrationController.enter 细分结果 → 旧 `string | undefined`
 *  语义（playing → audioUrl；aborted/failed/异常 → undefined）。抽取自
 *  NarrationController 的返回细分（F7 Step 6），legacy 行为零改动。 */
async function enterNarrationForLegacy(
  narration: NarrationController,
  utterance: NarrationUtterance,
  autoplay: boolean,
): Promise<string | undefined> {
  const result: NarrationEnterResult | undefined = await narration.enter(utterance, undefined, autoplay).catch(() => undefined);
  return result && result.status === "playing" ? result.audioUrl : undefined;
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

function renderGeometrySegmentIds(geometry: Record<string, unknown> | null): readonly string[] {
  if (!geometry) return [];
  const segments = geometry["segments"];
  if (!Array.isArray(segments)) return [];
  return segments
    .filter((segment): segment is Record<string, unknown> => typeof segment === "object" && segment !== null)
    .map((segment) => segment["id"])
    .filter((id): id is string => typeof id === "string");
}

function renderGeometryPointIds(geometry: Record<string, unknown> | null): readonly string[] {
  if (!geometry) return [];
  const points = geometry["points"];
  if (!Array.isArray(points)) return [];
  return points
    .filter((point): point is Record<string, unknown> => typeof point === "object" && point !== null)
    .map((point) => point["id"])
    .filter((id): id is string => typeof id === "string");
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * active_action 派生（adopt 时校验 + 渲染时同源派生，零 cast）。spec §1.3 #8/#9
 * 前端侧全量 fail closed：
 * - `action_plan` 过既有 ExercisePlan runtime validator；
 * - `target_ids` ⊆ render geometry 段集；
 * - `student_view` 过 action machine registry（kind/version 可执行）且 actionId 一致；
 * - participation=workspace_input 时与 Coach awaiting_workspace 的 action_id/gate_id 对账；
 * - plan.world.revision 与 render.workspace_revision 对账；world.geometry 与 render
 *   geometry 内容一致（点/段 id + 坐标 + 端点深度相等——同源合成，spec §1.3 #9
 *   「ActionPlan geometry 与 render geometry 一致」；缺 geometry fail closed）。
 * 任一失败 → 快照整体拒绝采用（原子采用纪律），非「不挂载但采用」。
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
  const studentView = active.student_view;
  if (
    typeof studentView["actionId"] !== "string"
    || typeof studentView["kind"] !== "string"
    || typeof studentView["version"] !== "number"
  ) {
    return { ok: false, reason: "active_action.student_view 缺 actionId/kind/version" };
  }
  if (studentView["actionId"] !== active.action_id) {
    return { ok: false, reason: `student_view.actionId ${String(studentView["actionId"])} ≠ active_action.action_id ${active.action_id}` };
  }
  if (!actionMachineRegistry.supports(studentView["kind"], studentView["version"])) {
    return { ok: false, reason: `active_action.student_view（kind=${studentView["kind"]}, version=${String(studentView["version"])}）无已注册 action machine` };
  }
  const contract = active.action_plan.actions.find((action) => action.actionId === active.action_plan.currentActionId);
  if (!contract || contract.actionId !== active.action_id || contract.kind !== studentView.kind
    || contract.version !== studentView.version || !actionMachineRegistry.validate(contract)
    || stableJson(contract.input) !== stableJson(studentView.input)) {
    return { ok: false, reason: "student_view 与当前 ActionContract/input 不一致或 input 非法" };
  }
  const mainline = snapshot.views.coach_panel_view.mainline;
  if (mainline.kind !== "awaiting_workspace") return { ok: false, reason: "active_action 必须对应 Coach awaiting_workspace" };
  if (mainline.kind === "awaiting_workspace") {
    if (mainline.action_id !== active.action_id) {
      return { ok: false, reason: `Coach awaiting_workspace.action_id ${mainline.action_id} ≠ active_action.action_id ${active.action_id}` };
    }
    const participation = snapshot.views.participation;
    if (participation.kind === "workspace_input" && participation.gate_id !== undefined && mainline.gate_id !== participation.gate_id) {
      return { ok: false, reason: `participation.gate_id ${participation.gate_id} ≠ Coach awaiting_workspace.gate_id ${mainline.gate_id}` };
    }
  }
  if (active.action_plan.world.revision !== snapshot.render.workspace_revision) {
    return { ok: false, reason: `plan.world.revision ${active.action_plan.world.revision} ≠ render.workspace_revision ${snapshot.render.workspace_revision}` };
  }
  if (active.action_plan.world.geometry === undefined || snapshot.render.geometry === null) {
    return { ok: false, reason: "active_action 缺 geometry" };
  }
  if (active.action_plan.world.geometry !== undefined && snapshot.render.geometry !== null) {
    const planGeometry = active.action_plan.world.geometry;
    if (
      !sameIdSet(planGeometry.points.map((point) => point.id), renderGeometryPointIds(snapshot.render.geometry))
      || !sameIdSet(planGeometry.segments.map((segment) => segment.id), renderGeometrySegmentIds(snapshot.render.geometry))
    ) {
      return { ok: false, reason: "plan.world.geometry 与 render geometry 的点/段 id 集合不一致" };
    }
    if (stableJson(planGeometry) !== stableJson(snapshot.render.geometry)) {
      return { ok: false, reason: "plan.world.geometry 与 render geometry 内容不一致" };
    }
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
  const runtimeSnapshotRef = useRef<ValidatedSessionSnapshot | undefined>(undefined);
  const runtimeEpochRef = useRef(0);
  const runtimeScopeRef = useRef({ taskId, studentId, runtimeClient });
  if (runtimeScopeRef.current.taskId !== taskId || runtimeScopeRef.current.studentId !== studentId || runtimeScopeRef.current.runtimeClient !== runtimeClient) {
    runtimeScopeRef.current = { taskId, studentId, runtimeClient };
    runtimeEpochRef.current += 1;
  }
  const runtimeMountedRef = useRef(true);
  useEffect(() => {
    runtimeMountedRef.current = true;
    return () => { runtimeMountedRef.current = false; };
  }, []);
  /** start 幂等键：同一挂载生命周期的重试复用同键（payload 相同 → Existing 回放）。 */
  const runtimeStartKeyRef = useRef<string | undefined>(undefined);

  /** pending 输入幂等 token（spec §2.1/复核 P0-3）：controller 为一次逻辑操作
   *  创建 key；同 payload 重试复用同 key（网络断开时服务端可能已提交——同键
   *  幂等回放，不产生第二份事实）；只有确定响应（成功 / 4xx 含 drift）才释放。
   *  adapter 只传输 key，不决定其生命周期。 */
  interface PendingRuntimeInput { input: StudentBrowserInput; clientRequestId: string; sessionId: string; revision: number }
  const pendingInputRef = useRef<PendingRuntimeInput | undefined>(undefined);

  /** actor-first 暂存的 evidence 采用记录（复核 P0-5）：绑定提交身份，consume-once，
   *  拒绝旧 session / 迟到（低 revision）响应。 */
  interface PendingEvaluationAdoption {
    idempotencyKey: string;
    sessionId: string;
    actionId: string;
    sourceStepId: string;
    baseSessionRevision: number;
    baseActionRevision: number;
    snapshot: ValidatedSessionSnapshot;
    evaluation: ActionEvaluationResponse;
  }
  const pendingEvaluationRef = useRef<PendingEvaluationAdoption | undefined>(undefined);
  /** 最近一次 evidence 提交（迟到旧响应不得覆盖新提交的暂存）。 */
  const lastEvidenceSubmissionRef = useRef<{ clientRequestId: string } | undefined>(undefined);

  const adoptRuntimeSnapshot = useCallback((snapshot: ValidatedSessionSnapshot, expectedSessionId?: string, epoch = runtimeEpochRef.current): boolean => {
    if (!runtimeMountedRef.current || epoch !== runtimeEpochRef.current) return false;
    if (expectedSessionId && snapshot.session_id !== expectedSessionId) {
      setProtocolError("响应 session_id 与请求不一致（fail closed）");
      return false;
    }
    const previous = runtimeSnapshotRef.current;
    if (previous?.session_id === snapshot.session_id && snapshot.revision < previous.revision) return false;
    if (snapshot.task_id !== taskId) {
      setProtocolError(`快照 task_id=${snapshot.task_id} 与会话任务 ${taskId} 不一致（fail closed）`);
      return false;
    }
    const operation = deriveRuntimeActiveOperation(snapshot);
    if (!operation.ok) {
      setProtocolError(`active_action 校验失败（fail closed）：${operation.reason}`);
      return false;
    }
    // F7 Step 7：render.geometry 是 production Canvas 的渲染输入——非 null 而
    // 不可解析 = 快照不可用于 Workspace 呈现，整份拒绝（原子采用纪律；null =
    // 无图示任务，放行渲染占位）。
    if (snapshot.render.geometry !== null && parseRenderGeometryV1(snapshot.render.geometry) === undefined) {
      setProtocolError("render.geometry 无法解析为可渲染几何（fail closed）");
      return false;
    }
    runtimeSnapshotRef.current = snapshot;
    setProtocolError(undefined);
    setError(undefined);
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

  /** 确定性失败（4xx，含 payload drift）释放输入 token；5xx/网络/协议解析失败保留
   *  （服务端可能已提交——同 payload 重试必须同键幂等回放）。 */
  const isDefinitiveInputFailure = (failure: unknown): boolean =>
    failure instanceof TutorRuntimeHttpError && failure.status >= 400 && failure.status < 500;

  const sameBrowserInput = (left: StudentBrowserInput, right: StudentBrowserInput): boolean =>
    left.kind === right.kind && JSON.stringify(left) === JSON.stringify(right);

  const submitRuntimeInput = useCallback(async (input: StudentBrowserInput): Promise<void> => {
    if (!runtimeClient) return;
    const current = runtimeSnapshotRef.current;
    if (!current) return;
    const pending = pendingInputRef.current;
    const retry = pending && pending.sessionId === current.session_id && sameBrowserInput(pending.input, input);
    if (pending && !retry) {
      setProtocolError("上一输入结果尚未确认，请重试原输入并恢复同步");
      return;
    }
    const clientRequestId = retry
      ? pending.clientRequestId
      : newRuntimeRequestId();
    const operation = retry ? pending : { input, clientRequestId, sessionId: current.session_id, revision: current.revision };
    pendingInputRef.current = operation;
    const epoch = runtimeEpochRef.current;
    setTurnPending(true);
    try {
      const response = await runtimeClient.submitStudentInput(operation.sessionId, operation.input, operation.revision, clientRequestId);
      if (adoptRuntimeSnapshot(response, operation.sessionId, epoch) && pendingInputRef.current === operation) pendingInputRef.current = undefined;
    } catch (turnError) {
      if (epoch !== runtimeEpochRef.current) return;
      if (isDefinitiveInputFailure(turnError) && pendingInputRef.current === operation) pendingInputRef.current = undefined;
      handleRuntimeError(turnError);
    } finally {
      if (runtimeMountedRef.current && epoch === runtimeEpochRef.current) setTurnPending(false);
    }
  }, [runtimeClient, adoptRuntimeSnapshot, handleRuntimeError]);

  /** actor 消费 evaluation 后的原子采用（spec §4.6 第 5 步；组件经 onEvaluation
   *  回调触发）。consume-once；拒绝旧 session 与迟到（低 revision）响应。 */
  const adoptPendingEvaluationSnapshot = useCallback((evaluation?: ActionEvaluationResponse) => {
    const pending = pendingEvaluationRef.current;
    if (!pending) return;
    if (evaluation && evaluation !== pending.evaluation) return;
    pendingEvaluationRef.current = undefined;
    const current = runtimeSnapshotRef.current;
    if (!current || current.session_id !== pending.sessionId) return;
    if (current.active_action?.action_id !== pending.actionId || current.revision !== pending.baseSessionRevision) return;
    if (pending.snapshot.revision < current.revision) return;
    adoptRuntimeSnapshot(pending.snapshot, pending.sessionId);
  }, [adoptRuntimeSnapshot]);

  /** protocol error 的显式恢复：GET restore 重新对账（零教学副作用）。 */
  const retrySync = useCallback(async (): Promise<void> => {
    const current = runtimeSnapshotRef.current;
    if (!runtimeClient || !current) return;
    const epoch = runtimeEpochRef.current;
    try {
      adoptRuntimeSnapshot(await runtimeClient.restore(current.session_id), current.session_id, epoch);
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

  // ---- F7 Step 6：唯一 PresentationRuntime（canonical 链；spec §4.7）----
  // 创建/销毁走 effect（不在渲染期做副作用）。卸载顺序契约：先 dispose
  // controller 使执行失效——停播引发的 stopped/迟到 adapter 结果被丢弃，
  // 不误报 interrupted、不改服务端教学流程；再停媒体。StrictMode 的
  // setup→cleanup→setup 重建实例（快照对象身份守卫随 cleanup 复位以重驱动）。
  const [presentationPhase, setPresentationPhase] = useState<PresentationRuntimePhase>({ phase: "idle" });
  const [presentationRuntime, setPresentationRuntime] = useState<TutorPresentationRuntime | undefined>(undefined);
  const presentationRuntimeRef = useRef<TutorPresentationRuntime | undefined>(undefined);
  presentationRuntimeRef.current = presentationRuntime;
  const lastPresentationAdoptedRef = useRef<ValidatedSessionSnapshot | undefined>(undefined);

  useEffect(() => {
    if (!runtimeClient) return;
    const runtime = createTutorPresentationRuntime({
      client: runtimeClient,
      narration,
      media,
      adoptOutcomeSnapshot: (snapshot, expectedSessionId) => {
        // 跨会话迟到响应兜底（二次复验 P1-5）：outcome 响应属于请求发起时的
        // 会话；当前已采用其他会话（restore/重开）时整份拒绝——controller 的
        // epoch 守卫之外的第二道门。
        const current = runtimeSnapshotRef.current;
        if (current !== undefined && snapshot.session_id !== current.session_id) return false;
        return adoptRuntimeSnapshot(snapshot, expectedSessionId);
      },
      onProtocolAnomaly: (message) => { setProtocolError(message); },
      onNotice: (message) => { setRuntimeFailureNotice(message); },
      onStateChanged: (state) => { setPresentationPhase(state); },
    });
    setPresentationRuntime(runtime);
    return () => {
      runtime.dispose();
      setPresentationRuntime(undefined);
      lastPresentationAdoptedRef.current = undefined;
    };
  }, [runtimeClient, narration, media, adoptRuntimeSnapshot]);

  useEffect(() => {
    return () => {
      // 顺序兜底（幂等）：无论 effect 声明序如何，停播前 controller 必已失效。
      presentationRuntimeRef.current?.dispose();
      narration.stop();
      media.dispose();
    };
  }, [narration, media]);

  /** F7 Step 7：真实 commit 信号注入面（production Canvas + Board reveal 双
   *  结算经 workspaceSurface VM 下发；port 方法为闭包实现，无 this 绑定；
   *  onRealSourceActive → controller.retryAwaitingRealSignal——「先暂停、
   *  surface 后挂载」的恢复路径，复验 P1-2）。 */
  const workspaceCommitSignal = useMemo<WorkspaceCommitSignal | undefined>(() => {
    if (!presentationRuntime) return undefined;
    const port = presentationRuntime.commitPort;
    return {
      registerRealCommitSource: port.registerRealCommitSource,
      notifyRealCommitted: port.notifyRealCommitted,
      notifyRealSourceActive: () => presentationRuntime.controller.retryAwaitingRealSignal(),
    };
  }, [presentationRuntime]);

  // 已采用快照 → PresentationRuntime.adopt（唯一驱动口）。对象身份守卫：同一
  // 快照对象（StrictMode effect 重放）不重复 adopt；新对象由状态机按去重键
  // 分派（单次执行 / 幂等重发 / 暂停规则见 PresentationRuntimeController）。
  useEffect(() => {
    if (!runtimeClient || !presentationRuntime || !runtimeSnapshot) return;
    if (lastPresentationAdoptedRef.current === runtimeSnapshot) return;
    lastPresentationAdoptedRef.current = runtimeSnapshot;
    presentationRuntime.controller.adopt(runtimeSnapshot);
  }, [runtimeClient, presentationRuntime, runtimeSnapshot]);

  // ---- F7 P2（S1 R8 + s1-http-media-handshake 规格 Interfaces）：generation
  // pending 只读轮询。snapshot GET 只读（verified rebuild、零模型调用）；仅
  // pending 时轮询；退避并对齐 waiting_retry 的 retry_at；卸载/切会话/离开
  // pending 即停；迟到查询不得回退当前合法 revision（adopt 门禁已拒低
  // revision）。ProtocolParseError → recoverable protocol error 停轮；404/409
  // → 停轮并显式错误；网络/5xx → 保留最后合法快照按退避重试（不写 error——
  // 后台读失败不进入恢复态）。已提交未交付结果经同一 adopt 流程恢复呈现。
  useEffect(() => {
    const generation = runtimeSnapshot?.generation;
    if (!runtimeClient || !runtimeSnapshot || !generation || generation.status !== "pending") return;
    const sessionId = runtimeSnapshot.session_id;
    const epoch = runtimeEpochRef.current;
    let cancelled = false;
    let timer: number | undefined;
    const initialDelayMs = (): number => {
      if (generation.phase === "waiting_retry" && generation.retry_at !== undefined) {
        const retryAt = Date.parse(generation.retry_at);
        if (Number.isFinite(retryAt)) {
          return Math.max(GENERATION_POLL_BASE_MS, Math.min(retryAt - Date.now() + 250, GENERATION_POLL_MAX_MS));
        }
      }
      return GENERATION_POLL_BASE_MS;
    };
    const stillPending = (): boolean => {
      const current = runtimeSnapshotRef.current;
      return runtimeMountedRef.current
        && epoch === runtimeEpochRef.current
        && current !== undefined
        && current.session_id === sessionId
        && current.generation?.status === "pending";
    };
    const poll = async (delayMs: number): Promise<void> => {
      if (!stillPending() || cancelled) return;
      try {
        const fresh = await runtimeClient.restore(sessionId);
        if (cancelled || !stillPending()) return;
        if (adoptRuntimeSnapshot(fresh, sessionId, epoch)) return; // 新快照重触发本 effect 排下一轮
      } catch (failure) {
        if (cancelled || !stillPending()) return;
        if (failure instanceof ProtocolParseError) {
          setProtocolError(failure.message);
          return;
        }
        if (failure instanceof TutorRuntimeHttpError && (failure.status === 404 || failure.status === 409)) {
          handleRuntimeError(failure);
          return;
        }
        // 网络/5xx：退避后重试（下方统一排程）。
      }
      if (cancelled || !stillPending()) return;
      const nextDelayMs = Math.min(delayMs * 2, GENERATION_POLL_MAX_MS);
      timer = window.setTimeout(() => void poll(nextDelayMs), delayMs);
    };
    const firstDelayMs = initialDelayMs();
    timer = window.setTimeout(() => void poll(firstDelayMs), firstDelayMs);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [runtimeClient, runtimeSnapshot, adoptRuntimeSnapshot, handleRuntimeError]);

  // 浏览器阻止自动播放 → 沿用重播提示机制（不新造）；F7 P2（S1 裁定①）：
  // narration 因录音占用挂起（延迟起播）→ 状态面驱动提示。
  const [narrationHeldForCapture, setNarrationHeldForCapture] = useState(false);
  useEffect(() => {
    return media.subscribe((state) => {
      if (state.status === "blocked-by-autoplay") setAutoplayBlocked(true);
      setNarrationHeldForCapture(state.status === "held-for-capture");
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
        const url = await enterNarrationForLegacy(
          narration,
          {
            utteranceId: voice.action_id,
            spokenText: voice.text,
            cacheKey: `${SPEECH_PROFILE_VERSION}:${voice.voice_source ?? "approved-resource"}:${voice.text}`,
          },
          true,
        );
        let outcome: "completed" | "failed" = "completed";
        if (url && playingRef.current) {
          const playback = await waitForPlaybackEndLegacy(media, () => !playingRef.current);
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
      const url = await enterNarrationForLegacy(
        narration,
        {
          utteranceId: `${voice.action_id}:review`,
          spokenText: voice.text,
          cacheKey: `${SPEECH_PROFILE_VERSION}:${voice.voice_source ?? "approved-resource"}:${voice.text}`,
        },
        true,
      );
      if (url) {
        await waitForPlaybackEndLegacy(media, () => !playingRef.current);
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
   *  mainline answer composer=mainline。幂等 token 见 submitRuntimeInput。 */
  const submitUtterance = useCallback(
    async (channel: "mainline" | "assistance", text: string): Promise<void> => {
      const trimmed = text.trim();
      if (!trimmed) return;
      await submitRuntimeInput({ kind: "utterance", channel, text: trimmed });
    },
    [submitRuntimeInput],
  );

  /** canonical 显式控制（confirm/continue/barge_in/return_to_mainline/retry_recovery/
   *  request_scaffold/request_rephrase——七值 typed control）。 */
  const submitControl = useCallback(
    async (command: StudentControlCommand): Promise<void> => {
      await submitRuntimeInput({ kind: "control", command });
    },
    [submitRuntimeInput],
  );

  // ---- F7 Step 8：录音 + 通道锁定 + ASR（canonical 链；spec §2.9/§4.8）----
  const [speechAsrBusy, setSpeechAsrBusy] = useState(false);
  const activeSpeechCaptureRef = useRef<RecordingChannelCapture | undefined>(undefined);
  const consumedSpeechCaptureRef = useRef<RecordingChannelCapture | undefined>(undefined);
  const [speechPendingTranscript, setSpeechPendingTranscript] = useState<SpeechPendingTranscript | undefined>();
  const [speechNotice, setSpeechNotice] = useState<string | undefined>();

  /** 录音真正开始时锁定通道并捕获 {sessionId, revision}（不可变捕获——录音
   *  开始后 outcome/control 导致的 revision 变化不得悄悄更新捕获值）。
   *  通道在当前快照下不合法（mainline≠answer_input / assistance 关闭 / 完成
   *  态）或无快照时返回 undefined——该录音不得进入提交链。 */
  const lockRecordingChannel = useCallback(
    (channel: "mainline" | "assistance"): RecordingChannelCapture | undefined => {
      if (!runtimeClient) return undefined;
      const current = runtimeSnapshotRef.current;
      if (!current || !recordingChannelLegal(channel, current)) return undefined;
      const capture = { captureId: newRuntimeRequestId(), channel, sessionId: current.session_id, revision: current.revision };
      activeSpeechCaptureRef.current = capture;
      consumedSpeechCaptureRef.current = undefined;
      setSpeechAsrBusy(false);
      setSpeechPendingTranscript(undefined);
      return capture;
    },
    [runtimeClient],
  );

  const clearSpeechPendingTranscript = useCallback(() => { setSpeechPendingTranscript(undefined); }, []);
  const clearSpeechNotice = useCallback(() => { setSpeechNotice(undefined); }, []);

  /** ASR（observe-only，不产 intent）：经当前 client 的 POST /asr。非空
   *  transcript 自动提交前按录音开始时的捕获核对——session 未变、revision
   *  未变、原通道仍合法、ASR observed_revision 与捕获一致；任一不一致只把
   *  transcript 放入对应通道草稿（speechPendingTranscript，组件提示用户确认，
   *  不自动提交——S1 交叉规则）。权限/系统失败是可见提示，不记为学生错误。 */
  const transcribeRecording = useCallback(
    async (capture: RecordingChannelCapture, audio: { dataUrl: string; mimeType?: string; durationMs?: number }): Promise<void> => {
      if (!runtimeClient || activeSpeechCaptureRef.current !== capture || consumedSpeechCaptureRef.current === capture) return;
      consumedSpeechCaptureRef.current = capture;
      const isCurrentCapture = () => runtimeMountedRef.current && activeSpeechCaptureRef.current === capture;
      setSpeechAsrBusy(true);
      setSpeechNotice(undefined);
      try {
        const asr = await runtimeClient.transcribe(capture.sessionId, {
          audio: {
            dataUrl: audio.dataUrl,
            mimeType: audio.mimeType ?? "audio/webm",
            ...(audio.durationMs !== undefined ? { durationMs: audio.durationMs } : {}),
          },
          clientRequestId: newRuntimeRequestId(),
        });
        if (!isCurrentCapture()) return;
        const transcript = asr.transcript.trim();
        if (!transcript) {
          setSpeechNotice("没有听到内容，请再试一次或改用文字输入。");
          return;
        }
        // stale 防护：三重核对（当前快照 vs 捕获；ASR 观察身份 vs 捕获）。
        const current = runtimeSnapshotRef.current;
        const stale = current === undefined
          || current.session_id !== capture.sessionId
          || current.revision !== capture.revision
          || asr.sessionId !== capture.sessionId
          || asr.observedRevision !== capture.revision
          || !recordingChannelLegal(capture.channel, current);
        if (stale) {
          setSpeechPendingTranscript({ source: capture, channel: capture.channel, text: transcript });
          return;
        }
        await submitRuntimeInput({ kind: "utterance", channel: capture.channel, text: transcript });
      } catch (failure) {
        if (!isCurrentCapture() || runtimeSnapshotRef.current?.session_id !== capture.sessionId) return;
        if (failure instanceof ProtocolParseError) {
          // ASR 响应协议非法：recoverable protocol error（保留最后合法快照）。
          setProtocolError(failure.message);
          return;
        }
        // spec §2.1 错误表：ASR/音频/模型失败 = 系统失败，可见处理、不映射学生
        // 错误、不回落 legacy session API。
        if (failure instanceof TutorRuntimeHttpError) {
          switch (failure.code) {
            case "EMPTY_TRANSCRIPT":
              setSpeechNotice("没有听到内容，请再试一次或改用文字输入。"); return;
            case "AUDIO_TOO_LARGE":
              setSpeechNotice("录音太长了，请缩短后重试或改用文字输入。"); return;
            case "AUDIO_FORMAT_UNSUPPORTED":
              setSpeechNotice("当前浏览器录音格式不支持，请改用文字输入。"); return;
            case "ASR_UNAVAILABLE":
            case "MODEL_UNAVAILABLE":
              setSpeechNotice("语音识别暂不可用，请改用文字输入。"); return;
            case "ASR_TIMEOUT":
            case "MODEL_TIMEOUT":
              setSpeechNotice("语音识别超时，请重试或改用文字输入。"); return;
            default:
              setSpeechNotice("语音识别出现问题，请改用文字输入。"); return;
          }
        }
        setSpeechNotice("语音识别出现问题，请改用文字输入。");
      } finally {
        if (isCurrentCapture()) setSpeechAsrBusy(false);
      }
    },
    [runtimeClient, submitRuntimeInput],
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
          const active = current.active_action;
          if (!evidence || request.sessionId !== current.session_id || !active || evidence.actionId !== active.action_id
            || !isExercisePlan(active.action_plan) || request.exerciseId !== active.action_plan.exerciseId
            || evidence.sourceStepId !== active.action_plan.actions.find((action) => action.actionId === active.action_id)?.sourceStepId) {
            throw new ProtocolParseError(["evidence 请求与当前 session/action 不匹配"]);
          }
          const epoch = runtimeEpochRef.current;
          const values: Record<string, string> = "values" in evidence && evidence.values !== undefined
            ? evidence.values
            : {};
          // 幂等键复用 Frame 已管理的 submission key（同键重试幂等回放）。
          const clientRequestId = request.idempotencyKey;
          lastEvidenceSubmissionRef.current = { clientRequestId };
          const result = await runtimeClient.submitActionEvidence(current.session_id, {
            evidence: {
              actionId: evidence.actionId,
              sourceStepId: evidence.sourceStepId,
              kind: evidence.kind,
              version: evidence.version,
              values,
            },
            expectedRevision: current.revision,
            clientRequestId,
          });
          const submission = result.actionSubmission;
          const latest = runtimeSnapshotRef.current;
          if (!runtimeMountedRef.current || epoch !== runtimeEpochRef.current || latest?.session_id !== current.session_id
            || latest.active_action?.action_id !== evidence.actionId || latest.revision !== current.revision
            || lastEvidenceSubmissionRef.current?.clientRequestId !== clientRequestId) {
            throw new ProtocolParseError(["过期的 evidence 响应，禁止评价当前 actor"]);
          }
          const nextOperation = deriveRuntimeActiveOperation(result.snapshot);
          if (result.snapshot.session_id !== current.session_id || result.snapshot.task_id !== taskId
            || result.snapshot.revision < current.revision || !nextOperation.ok) {
            throw new ProtocolParseError(["evidence 响应快照不一致，禁止部分采用"]);
          }
          if (submission.status === "evidence-rejected" || submission.status === "workspace-committed") {
            if (!isActionEvaluationResponse(submission.evaluation)) {
              throw new ProtocolParseError(["action_submission.evaluation 未通过 ActionEvaluationResponse runtime 校验"]);
            }
            // actor-first（spec §4.6）：snapshot 暂存（绑定提交身份），等 actor 消费
            // evaluation 后由组件 onEvaluation 回调原子采用；迟到旧响应不得覆盖。
            const evaluation = { ...submission.evaluation, revision: submission.status === "evidence-rejected" ? request.revision : result.snapshot.render.workspace_revision };
            if (lastEvidenceSubmissionRef.current?.clientRequestId === clientRequestId) {
              pendingEvaluationRef.current = {
                idempotencyKey: clientRequestId,
                sessionId: current.session_id,
                actionId: evidence.actionId,
                sourceStepId: evidence.sourceStepId,
                baseSessionRevision: current.revision,
                baseActionRevision: request.revision,
                snapshot: result.snapshot,
                evaluation,
              };
            }
            // evaluation.revision 语义（复核 P0-4）：ActionRuntime/plan-world revision
            // 域——rejected 零事件 ⇒ actor 基线不变（request.revision）；committed ⇒
            // 服务端权威 workspace revision。session revision 不得直入 actor
            //（后端产正确 revision 登记为后续合同波裁定）。
            return evaluation;
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
    [consumeTurn, runtimeClient, taskId],
  );

  /** barge-in（canonical，Step 8 顺序固定，PLAN §3 Step 8）：
   *  ① 中断 Voice adapter（abort → 停播）；
   *  ② 上报 interrupted 并采用新 snapshot（interruptCurrentSettled 等待该
   *     outcome 被接受且响应快照成功采用）；
   *  ③ 再提交显式 control.barge_in（仅在 ② 接受并采用后；拒绝/网络失败/被丢弃时
   *     不提交，避免 stale revision 的 control）；
   *  ④ Navigator 新 sequence 随 control 响应快照进入同一 adopt 流程。
   *  无活跃可中断交付（生成中无活跃 delivery）→ 零 outcome、零 control，
   *  不伪造 interrupted（生成取消语义未冻结，本阶段不做）。 */
  const bargeIn = useCallback(async () => {
    if (runtimeClient) {
      const controller = presentationRuntime?.controller;
      if (!controller) return;
      const settle = await controller.interruptCurrentSettled();
      if (settle.status === "reported" && (settle.outcome === "interrupted" || settle.outcome === "presented")) {
        await submitControl("barge_in");
      }
      return;
    }
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
  }, [media, narration, runtimeClient, presentationRuntime, submitControl]);

  const resumeFromInterrupt = useCallback(() => setInterrupted(false), []);

  /**
   * F7 P2（R5 裁定时序）：**先 barge-in 再录音**——真实录音开始前完成
   * ①中断 Voice adapter ②interrupted outcome 上报并采用新 snapshot ③显式
   * control.barge_in（复用 bargeIn 的 ①②③ 链）；等待失败（回执拒绝/网络
   * 失败/采用失败）**不开始录音**（返回 false，给出可见提示）。无活跃可中断
   * 交付（idle/生成中无 delivery）时直接放行——录音与在播讲解的互斥由
   * interruptPlaybackOnStart（录音开始打断在播 narration，capture-first 兜底）
   * 与媒体 session 挂起规则（录音期间到达的 narration 停队首延迟起播）保证。
   * 录音通道/快照捕获仍发生在真实录音开始时（lockRecordingChannel——对
   * barge-in 后采用的新快照捕获最新 revision）。
   */
  const prepareRecordingStart = useCallback(async (): Promise<boolean> => {
    if (!runtimeClient) return true;
    const controller = presentationRuntime?.controller;
    if (!controller) return true;
    if (!controller.canInterrupt()) return true; // 无活跃可中断交付：直接按当前合法入口录音
    const settle = await controller.interruptCurrentSettled();
    if (settle.status === "reported" && (settle.outcome === "interrupted" || settle.outcome === "presented")) {
      await submitControl("barge_in"); // ③ 控制失败不阻断录音：ASR stale 防护兜底（捕获 revision 漂移 → 草稿）
      return true;
    }
    if (settle.status === "failed") {
      setRuntimeFailureNotice("打断没有成功，稍后再试录音，或先点「打断」重试。");
      return false;
    }
    return true; // no-active-delivery（竞态下自然结束）：无待打断交付，直接录音
  }, [runtimeClient, presentationRuntime, submitControl]);

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
        const epoch = ++runtimeEpochRef.current;
        try {
          runtimeStartKeyRef.current ??= newRuntimeRequestId();
          adoptRuntimeSnapshot(await runtimeClient.start({
            taskId,
            studentId,
            clientRequestId: runtimeStartKeyRef.current,
          }), undefined, epoch);
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
      const epoch = ++runtimeEpochRef.current;
      try {
        return adoptRuntimeSnapshot(await runtimeClient.restore(targetSessionId), targetSessionId, epoch) ? "restored" : "invalid";
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
    if (runtimeClient) {
      // canonical：纯回放缓存（零上报；actionId + 缓存 + 播放互斥由 adapter 核对）。
      const controller = presentationRuntime?.controller;
      const target = controller?.replayTarget();
      if (controller && target !== undefined) controller.replayVoice(target);
      return;
    }
    void narration.replay();
  }, [narration, runtimeClient, presentationRuntime]);

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

  /** F7 P2（S1 R1）：generation 状态 view-model（快照单一来源派生）。 */
  const runtimeGeneration = useMemo<RuntimeGenerationVm>(
    () => runtimeGenerationVmOf(runtimeSnapshot?.generation),
    [runtimeSnapshot],
  );

  /** failed 后的显式重新尝试（生成生命周期规格）：走既有 control.retry_recovery
   *  ——服务端以当前合法状态和新预算创建新任务，不修改旧失败记录。 */
  const retryGeneration = useCallback(() => { void submitControl("retry_recovery"); }, [submitControl]);

  // ---- 统一 UI view-model 派生（controller 边界完成数据源分派）----
  const mergedCompleted = runtimeClient
    ? (runtimeSnapshot?.completed ?? false)
    : (completed || questionCompleted);
  const operateActive = phase === "workspaceActive";

  /** 参与区：canonical kind / legacy 相位 → 同一控件词汇表。 */
  const participationControls: ParticipationControls = useMemo(() => {
    if (runtimeClient) {
      const kind = runtimeSnapshot?.views.participation.kind ?? "listen_only";
      if (runtimeSnapshot?.completed || kind === "read_only_completed") return { kind: "completed" };
      switch (kind) {
        case "confirm_input":
          return { kind: "cta", label: "确认", onSubmit: () => { void submitControl("confirm"); }, testId: "tutor-confirm-input", understoodDisabled: turnPending };
        case "continue_input":
          return { kind: "cta", label: "继续", onSubmit: () => { void submitControl("continue"); }, testId: "tutor-continue-input", understoodDisabled: turnPending };
        case "answer_input":
          return { kind: "answer", onSubmit: (text: string) => { void submitUtterance("mainline", text); } };
        case "temporarily_paused_for_inquiry":
          return {
            kind: "inquiry",
            canReturn: runtimeSnapshot?.views.coach_panel_view.inquiry.kind === "ready_to_return",
            onReturn: () => { void submitControl("return_to_mainline"); },
          };
        case "workspace_input":
          return { kind: "workspace_wait" };
        default:
          return { kind: "listen" };
      }
    }
    // legacy：teach 相位恒挂讲解确认组（awaitingContinue 前 understood 禁用）、
    // answerVisible 时并行主线表单——原 actionEnd 布局与禁用语义零改动。
    if (mergedCompleted) return { kind: "completed" };
    if (operateActive) return { kind: "none" };
    const answerVisible = !presentation.playing && !presentation.awaitingContinue && !turnPending && !error && Boolean(sessionId);
    return {
      kind: "cta",
      label: presentation.awaitingContinue ? "明白，继续" : "等待你的回应",
      onSubmit: advancePresentation,
      understoodDisabled: !presentation.awaitingContinue || presentation.reviewing || turnPending,
      confusedDisabled: turnPending || !sessionId,
      confused: () => { void submitStudentInput({ input_kind: "question_asked", text: CONFUSED_MESSAGE }); },
      ...(answerVisible ? { answer: { onSubmit: (text: string) => { void submitStudentInput({ input_kind: "reasoning_utterance", text }); } } } : {}),
    };
  }, [runtimeClient, runtimeSnapshot, mergedCompleted, operateActive, presentation.playing, presentation.awaitingContinue, presentation.reviewing, turnPending, error, sessionId, submitControl, submitUtterance, submitStudentInput, advancePresentation]);

  /** 讲解播放组（统一 view-model：legacy 本地管线 / canonical PresentationRuntime
   *  执行状态投影——F7 Step 6 填补增补 18 调整点 6 登记的 canonical 挂点）。 */
  const playbackControls = useMemo<PlaybackControlsVm | undefined>(() => {
    if (mergedCompleted || operateActive) return undefined;
    if (runtimeClient) {
      const controller = presentationRuntime?.controller;
      if (!controller) return undefined;
      const replayActionId = controller.replayTarget();
      return {
        source: "canonical",
        phase: presentationPhase,
        canInterrupt: presentationPhase.phase === "awaiting-gesture"
          || (presentationPhase.phase === "presenting" && presentationPhase.interruptible),
        canReplay: replayActionId !== undefined
          && runtimeSnapshot?.views.coach_panel_view.replay_available !== false,
        interrupt: () => controller.interruptCurrent(),
        resume: () => { void controller.resumeAfterGesture(); },
        replay: () => {
          if (replayActionId !== undefined) controller.replayVoice(replayActionId);
        },
      };
    }
    return {
      source: "legacy",
      presentation,
      advance: advancePresentation,
      replay: replayNarration,
      reviewPrevious: reviewPreviousNarration,
      reviewFirst: reviewFirstNarration,
    };
  }, [runtimeClient, runtimeSnapshot, presentationRuntime, presentationPhase, mergedCompleted, operateActive, presentation, advancePresentation, replayNarration, reviewPreviousNarration, reviewFirstNarration]);

  /** 当前 pending board delivery 的执行身份（F7 三次复验 P1：恢复重呈现按
   *  sequence 身份，不按 workspace revision）。F7 P2：board.explain 的呈现
   *  目标是 command_payload 引用的解释片段（EF-，plan/v4 冻结形状）；
   *  board.reveal-entry 仍为 target_ids（BE-）。 */
  const boardPresentation = useMemo<BoardPresentationExecution | undefined>(() => {
    const pending = runtimeSnapshot?.pending_presentation;
    const workspaceAction = pending?.action.workspace_action;
    if (!runtimeSnapshot || !pending || !workspaceAction || workspaceAction.surface !== "solution_board") {
      return undefined;
    }
    const targets = workspaceAction.capability === "board.explain" && typeof workspaceAction.command_payload === "string"
      ? [workspaceAction.command_payload]
      : workspaceAction.target_ids ?? [];
    return {
      key: presentationKeyOf(pending),
      targets,
    };
  }, [runtimeSnapshot]);

  /** Workspace 呈现面。 */
  const workspaceSurface: WorkspaceSurfaceVm = useMemo(
    () => (runtimeClient
      ? {
        source: "canonical",
        view: runtimeSnapshot?.views.student_workspace_view,
        geometry: runtimeSnapshot ? parseRenderGeometryV1(runtimeSnapshot.render.geometry) : undefined,
        commitSignal: workspaceCommitSignal,
        boardPresentation,
        workspaceExecutionKey: runtimeSnapshot?.pending_presentation?.action.kind === "workspace"
          ? presentationKeyOf(runtimeSnapshot.pending_presentation) : undefined,
      }
      : { source: "legacy", workspaceView, completed: mergedCompleted }),
    [runtimeClient, runtimeSnapshot, workspaceCommitSignal, boardPresentation, workspaceView, mergedCompleted],
  );

  /** Coach composer：提问通道（canonical=utterance(assistance)；legacy=question_asked）
   *  与可用性（canonical 由服务端 assistance_available 投影；legacy 恒开）。
   *  F7 Step 8：canonical 录音接通（coach mic=assistance 通道锁定；ASR 经当前
   *  client 的 /asr），mic 不再整体禁用（Step 5 迁移期 micSuppressed 退场）。 */
  const coachControls = useMemo(() => ({
    canHelp: !mergedCompleted && Boolean(sessionId) && (!runtimeClient || runtimeSnapshot?.views.coach_panel_view.assistance_available !== false),
    ask: (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (runtimeClient) {
        void submitUtterance("assistance", trimmed);
        return;
      }
      void submitStudentInput({ input_kind: "question_asked", text: trimmed });
    },
  }), [mergedCompleted, sessionId, runtimeClient, runtimeSnapshot, submitUtterance, submitStudentInput]);

  /** ActionRuntimeFrame 绑定。 */
  const activeActionFrame: ActiveActionFrameVm = useMemo(() => ({
    transport,
    ...(runtimeClient ? { onEvaluation: adoptPendingEvaluationSnapshot } : {}),
    viewRevision: runtimeClient ? runtimeSnapshot?.render.workspace_revision : workspaceView?.revision,
    ...(runtimeClient ? { board: runtimeSnapshot?.views.student_workspace_view.solution_board } : {}),
    ...(runtimeClient ? {} : { boardView: workspaceView?.solutionBoard }),
    legacyMediaDisabled: Boolean(runtimeClient),
  }), [transport, runtimeClient, runtimeSnapshot, workspaceView, adoptPendingEvaluationSnapshot]);

  /** restore 会话丢失策略：legacy 沿用 VS0 REQ-06 自动重开；canonical 先告知用户、
   *  由用户明确重开（spec §2.1：restore 404 不得静默 start）。 */
  const restartOnMissing = !runtimeClient;
  /** legacy 换讲法入口（canonical 无此形态）。 */
  const switchApproachAvailable = !runtimeClient && alternatesAvailable && Boolean(sessionId) && !mergedCompleted;
  /** legacy 打断入口；canonical=bargeIn 的 ①②③④ 链（Step 8：中断 adapter →
   *  interrupted outcome 结算并采用新 snapshot → 显式 control.barge_in → 等
   *  Navigator 新 sequence）。 */
  const bargeInAvailable = runtimeClient
    ? playbackControls?.source === "canonical" && playbackControls.canInterrupt
    : phase === "speaking" && !presentation.awaitingContinue && !presentation.reviewing;

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
    /** 统一 UI view-model（组件零 Boolean(runtimeClient) 分叉）。 */
    participationControls,
    playbackControls,
    workspaceSurface,
    coachControls,
    activeActionFrame,
    restartOnMissing,
    switchApproachAvailable,
    bargeInAvailable,
    /** F7 Step 8：外层 PresentationRuntime 媒体 session 唯一实例（Narration/
     *  MediaSessionController 属主）——recorder 共享同一 session（录音打断播放
     *  的互斥经 capture lease + stop("narration")），不新建第二媒体状态机。 */
    mediaSession: media,
    /** F7 Step 8：录音 + ASR + stale 防护（canonical 链；legacy 链保持零改动）。 */
    lockRecordingChannel,
    transcribeRecording,
    speechAsrBusy,
    speechPendingTranscript,
    clearSpeechPendingTranscript,
    speechNotice,
    clearSpeechNotice,
    /** canonical Runtime 数据源（runtimeClient 缺省时 undefined——legacy 链不消费）。 */
    runtimeSnapshot,
    runtimeParticipation: runtimeSnapshot?.views.participation,
    runtimeCoach: runtimeSnapshot?.views.coach_panel_view,
    runtimeWorkspace: runtimeSnapshot?.views.student_workspace_view,
    runtimePendingPresentation: runtimeSnapshot?.pending_presentation,
    /** F7 Step 6：PresentationRuntime 执行状态投影（瞬时；恢复真源是服务端快照）。 */
    runtimePresentationPhase: presentationPhase,
    runtimeCompleted: runtimeSnapshot?.completed ?? false,
    runtimeTurnFailure,
    runtimeFailureNotice,
    /** F7 P2（S1）：generation 状态 view-model + failed 重新尝试入口。 */
    runtimeGeneration,
    retryGeneration,
    /** F7 P2（S1 裁定①/R5）：媒体挂起状态 + 先 barge-in 再录音的录音前置门。 */
    narrationHeldForCapture,
    prepareRecordingStart,
    /** recoverable protocol error（保留最后一份合法 snapshot；retrySync 显式重对账）。 */
    protocolError,
    /** VS1 remediation-2：拍点只读展示（turn/restore 同源 state）。 */
    currentCheckpoint,
    /** VS1 remediation-2：话术呈现指针（瞬时；门/回看状态见 TutorPresentation）。 */
    presentation,
    questionCompleted,
    completed: mergedCompleted,
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

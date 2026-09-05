import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ActionCheckpointSnapshot,
  ActionEvaluationResponse,
  ActionPlanResponse,
  ExercisePlan,
} from "../../../../shared/actionRuntime";
import { api } from "../../api/client";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { MathText } from "../../components/math/MathText";
import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import type { EntityRef } from "../../geometry/interaction/events";
import type { InteractionView, TransientCanvasEmphasis } from "../../geometry/interaction/interaction-view";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import { StudentWorkspaceFrame } from "../workspace/StudentWorkspaceFrame";
import type { ActionRuntimeEvent } from "../../action-runtime/events";
import type { SolutionBoardView, TransientEmphasis } from "../../action-runtime/types";
import type { ActionRuntimeTransport } from "../../action-runtime/types";
import { useActionPageRuntime } from "../../action-runtime/react/useActionPageRuntime";
import { TopicCoachDockTrigger, TopicCoachPanel } from "../coach/TopicCoachPanel";
import { TopicTeachingConfirm, TopicTeachingPlayback } from "../coach/TopicTeachingControls";
import { useCoachController } from "../coach/useCoachController";
import { useTeacherSpeech } from "../narration/useTeacherSpeech";
import { getTrainingSyncQueue } from "../../persistence/training/trainingSyncQueue";
import { buildTrainingCheckpoint, buildTrainingResult } from "../../action-runtime/training/trainingRecords";
import { MediaSessionController } from "../audio/MediaSessionController";
import { COACH_MEDIA_PROTOCOL_VERSION } from "../../../../shared/coachMedia";

/** VS0 验收模式（?acceptance=1）：把当前 student-safe WorkspaceView 投影
 *  暴露到 window 供 Playwright 快照（ADR-009 基线证据）。View 本身就是
 *  前端渲染输入（无 hidden truth），因此不引入新的泄露面；无参数时不暴露。 */
const ACCEPTANCE_MODE = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).has("acceptance");

interface ActionRuntimeFrameProps {
  response: ActionPlanResponse;
  disabled?: boolean;
  local?: boolean;
  onEvaluation?: (result: ActionEvaluationResponse) => void | Promise<void>;
  onComplete?: () => void;
  /** Phase 5 UI 集成：Tutor 驱动时 evidence 走 TutorSession typed evaluator，
   *  且跳过 legacy practice checkpoint（Tutor 会话是唯一权威）。 */
  transport?: ActionRuntimeTransport;
  /** 提供时整体替换右侧指导栏（Tutor 体验渲染自己的对话栏，不出现第二个
   *  legacy Coach——回答/提问走 TutorLearningController）。 */
  railContent?: ReactNode;
  /** 波次 F 任务 3：提供时替换 dock 头像触发器（Tutor 体验用自己的头像 +
   *  预览气泡节点，三分支共享；Frame 内部 legacy 头像的预览源是
   *  coach.thread，tutor transport 模式恒空）。 */
  railTrigger?: ReactNode;
  /** 波次 E（教师反馈「topic coach dock 被抛弃了」）：受控 dock 开合——
   *  railContent 场景下调用方（Tutor 体验）持有与无工作台分支同一份
   *  railOpen 状态，dock 收起/展开跨分支一致；缺省回退 Frame 内部状态。 */
  railOpen?: boolean;
  onRailOpenChange?: (open: boolean) => void;
  /** VS1（mvp/vs-01 REQ-04）：统一 StudentWorkspaceView 的板书投影。
   *  提供时（Tutor 链路）板书面从服务端统一 View 渲染（hidden 行服务端
   *  已过滤、与画布同 revision）——操作回合板书不消失；缺省回退 Frame
   *  内部 plan.solutionBoardContexts 投影（practice 链路，L-08 Isolate）。
   *  F8 退场（legacy V5 专用）；canonical V6 不消费（用 boardSurface）。 */
  boardView?: SolutionBoardView;
  /** F7 Step 7：tutor 模式 canonical 板书槽（= 快照 student_workspace_view
   *  .solution_board 经共享 SolutionBoardViewSurface 渲染）。优先于
   *  boardView/内部投影——canonical Solution Board 唯一渲染面。 */
  boardSurface?: ReactNode;
  /** VS1：统一 View 的 revision（Frame 容器 data-view-revision；供验收
   *  断言两 surface 同 revision）。 */
  viewRevision?: number;
  /** VS1 remediation：提供时替换默认 FocusPrompt（plan.metadata.promptLatex
   *  的单行题干）——Tutor 链路传 LearnQuestionPrompt（stem+subquestions
   *  一体化）；practice 链路缺省不变。 */
  questionPrompt?: ReactNode;
  /** F7 canonical 链（外部 Tutor runtime 拥有媒体/coach）：Frame 零媒体创建
   *  （F7 Step 7 裁定：不 new MediaSessionController/NarrationController、
   *  关闭 legacy 讲解语音与 coach 通道；媒体实例唯一属主 = 外层
   *  PresentationRuntime）。 */
  legacyMediaDisabled?: boolean;
}

/** Split transient emphasis into the canvas channel (entities + teaching marks). */
function canvasEmphasisFrom(emphasis: TransientEmphasis | undefined): TransientCanvasEmphasis | undefined {
  if (!emphasis) return undefined;
  const entityIds = emphasis.targets.filter((t) => t.surface === "canvas" && t.kind === "entity").map((t) => t.id);
  const markIds = emphasis.targets.filter((t) => t.surface === "canvas" && t.kind === "teaching-mark").map((t) => t.id);
  if (!entityIds.length && !markIds.length) return undefined;
  return { key: emphasis.key, entityIds, markIds };
}

export interface SolutionBoardEmphasis {
  key: string;
  expressionIds: readonly string[];
}

/** Split transient emphasis into the SolutionBoard channel (expression ids). */
function boardEmphasisFrom(emphasis: TransientEmphasis | undefined): SolutionBoardEmphasis | undefined {
  if (!emphasis) return undefined;
  const expressionIds = emphasis.targets.filter((t) => t.surface === "solution-board" && t.kind === "expression").map((t) => t.id);
  return expressionIds.length ? { key: emphasis.key, expressionIds } : undefined;
}

export function ActionRuntimeFrame({ response, disabled, local, onEvaluation, onComplete, transport, railContent, railTrigger: railTriggerOverride, railOpen: railOpenProp, onRailOpenChange, boardView, boardSurface, viewRevision, questionPrompt, legacyMediaDisabled }: ActionRuntimeFrameProps) {
  // VS1：demonstration 形态独立渲染分支已删除——讲解演示内容由统一
  // StudentWorkspaceView 的 canvas/solutionBoard slice 驱动（服务端组合/
  // 披露投影），TutorLearnExperience 直接渲染只读面，不经本 Frame。
  const storageKey = `action-runtime-v3:${response.sessionId}:${response.plan.exerciseId}`;
  const localCheckpoint = useMemo(() => {
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      if (!stored) return undefined;
      const parsed = JSON.parse(stored) as ActionCheckpointSnapshot;
      return parsed.revision === response.plan.revision ? parsed : undefined;
    } catch {
      return undefined;
    }
  }, [storageKey, response.plan.revision]);
  const checkpoint = localCheckpoint && (!response.checkpoint || localCheckpoint.updatedAt > response.checkpoint.updatedAt)
    ? localCheckpoint
    : response.checkpoint;
  const { runtime, snapshot, view } = useActionPageRuntime(response.plan, checkpoint);
  const trainingAttemptCount = runtime.getTrainingSnapshot().attempts.length;
  const action = snapshot.plan.actions.find((item) => item.actionId === snapshot.currentActionId)!;
  const model = useMemo(
    () => view.canvas.geometry ? buildGeometryModel(view.canvas.geometry) : undefined,
    [view.canvas.geometry],
  );
  const submissionKeys = useRef(new Map<string, string>());
  const pendingSubmissions = useRef(new Set<string>());
  const currentRuntime = useRef(runtime);
  currentRuntime.current = runtime;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const completionNotified = useRef(false);
  const trainingCompletionNotified = useRef(false);
  const [internalRailOpen, setInternalRailOpen] = useState(false);
  const railOpen = railOpenProp ?? internalRailOpen;
  const setRailOpen = (open: boolean): void => {
    setInternalRailOpen(open);
    onRailOpenChange?.(open);
  };
  const [coachPreview, setCoachPreview] = useState<{ id: string; latex: string } | null>(null);
  const [coachUnread, setCoachUnread] = useState(false);
  // F7 Step 7（零媒体创建裁定）：canonical tutor 模式（legacyMediaDisabled，
  // 媒体实例唯一属主 = 外层 PresentationRuntime）本 Frame 不创建
  // MediaSessionController；legacy 链恒建（行为零改动）。
  const ownedMediaSession = useMemo(() => {
    if (legacyMediaDisabled) return undefined;
    return new MediaSessionController((mark) => {
      void api.reportVoiceTelemetry({
        version: COACH_MEDIA_PROTOCOL_VERSION,
        correlationId: mark.correlationId,
        sessionId: response.sessionId,
        owner: mark.owner,
        stage: mark.stage,
        browserTimeMs: mark.browserTimeMs,
      }).catch(() => undefined);
    });
  }, [response.sessionId, legacyMediaDisabled]);
  const teacherSpeech = useTeacherSpeech(snapshot.plan, action, ownedMediaSession, { disabled: legacyMediaDisabled });
  const { speechUrl, speaking, autoplayBlocked, replay: replaySpeech, speak: playSpeechUrl } = teacherSpeech;
  const lastPreviewId = useRef("");
  // ADR-005 §Layer Responsibilities: coach turn / recorder / live orchestration
  // is owned by the CoachController (via useCoachController), not this Frame.
  // The Frame is now presentation over `coach` + the workspace view.
  // legacyMediaDisabled（F7 canonical 链）：coach 通道同样归外部 Tutor runtime，
  // 不在本 Frame 暴露（rail 已被调用方替换，此处同时关闭 canHelp）。
  const coach = useCoachController({
    media: ownedMediaSession,
    canHelp: view.controls.canHelp && !legacyMediaDisabled,
    transport: snapshot.plan.runtimeCapabilities?.coachTurnTransport,
    local: Boolean(local),
    sessionId: response.sessionId,
    taskId: snapshot.plan.metadata.taskId,
    exerciseId: snapshot.plan.exerciseId,
    mode: snapshot.plan.mode,
    currentActionId: snapshot.currentActionId,
    instruction: action.instruction,
    runtime,
    playSpeechUrl,
  });

  useEffect(() => () => ownedMediaSession?.dispose(), [ownedMediaSession]);

  // VS0 验收模式：只读暴露当前 student-safe View（证据采集，见顶部注释）。
  useEffect(() => {
    if (!ACCEPTANCE_MODE) return;
    (window as unknown as { __acceptanceWorkspaceView?: unknown }).__acceptanceWorkspaceView = view;
  }, [view]);

  useEffect(() => {
    if (local) return;
    if (snapshot.status !== "submitting") return;
    const sourceStepId = action.sourceStepId;
    const evidence = snapshot.evidence.filter((item) => item.sourceStepId === sourceStepId);
    const key = `${response.sessionId}:${snapshot.revision}:${sourceStepId}:${JSON.stringify(evidence)}`;
    if (pendingSubmissions.current.has(key)) return;
    pendingSubmissions.current.add(key);
    const idempotencyKey = submissionKeys.current.get(key) || crypto.randomUUID();
    submissionKeys.current.set(key, idempotencyKey);
    const request = {
      sessionId: response.sessionId,
      exerciseId: snapshot.plan.exerciseId,
      sourceStepId,
      revision: snapshot.revision,
      evidence,
      idempotencyKey,
    };
    const submit = transport
      ? () => transport.submitEvidence(request)
      : () => api.evaluateAction(request);
    void submit().then(async (result) => {
      if (!mounted.current || currentRuntime.current !== runtime) return;
      runtime.applyEvaluation(result);
      await onEvaluation?.(result);
    }).catch(() => {
      if (mounted.current && currentRuntime.current === runtime) runtime.markTransportFailure();
    }).finally(() => pendingSubmissions.current.delete(key));
  }, [local, snapshot.status, snapshot.currentActionId, snapshot.revision, snapshot.evidence, response.sessionId, transport, onEvaluation]);

  useEffect(() => {
    if (local || transport) return;
    if (snapshot.plan.mode === "guided-practice") return;
    if (snapshot.evidence.length === 0) return;
    void api.checkpointAction({
      sessionId: response.sessionId,
      exerciseId: snapshot.plan.exerciseId,
      currentActionId: snapshot.currentActionId,
      completedActionIds: snapshot.completedActionIds,
      evidence: snapshot.evidence,
      revision: snapshot.revision,
    }).catch(() => undefined);
  }, [local, transport, response.sessionId, snapshot.completedActionIds.join("|"), snapshot.evidence.length, snapshot.revision]);

  useEffect(() => {
    if (snapshot.plan.mode !== "guided-practice" || action.validationPolicy !== "local-training") return;
    const queue = getTrainingSyncQueue();
    const training = runtime.getTrainingSnapshot();
    const complete = snapshot.status === "complete";
    const record = complete
      ? buildTrainingResult(response.sessionId, snapshot.plan, snapshot.completedActionIds, training)
      : buildTrainingCheckpoint(response.sessionId, snapshot.plan, snapshot.currentActionId, snapshot.completedActionIds, training);
    queue.enqueue(complete ? "result" : "checkpoint", record);
    if (snapshot.plan.runtimeCapabilities?.trainingSync === "local-only") return;
    void queue.flush((kind, payload) => api.uploadTrainingRecord(kind, payload)).then(() => {
      const delivered = !queue.snapshot().some((entry) => entry.record.recordId === record.recordId);
      if (complete && delivered && !trainingCompletionNotified.current) {
        trainingCompletionNotified.current = true;
        onComplete?.();
      }
    });
  }, [response.sessionId, snapshot.plan.mode, snapshot.plan.runtimeCapabilities?.trainingSync, snapshot.currentActionId, snapshot.completedActionIds.join("|"), snapshot.status, trainingAttemptCount, runtime, onComplete]);

  useEffect(() => {
    if (snapshot.plan.mode !== "guided-practice" || snapshot.plan.runtimeCapabilities?.trainingSync === "local-only") return;
    const flush = () => { void getTrainingSyncQueue().flush((kind, payload) => api.uploadTrainingRecord(kind, payload)); };
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [snapshot.plan.mode]);

  useEffect(() => {
    const trace = runtime.getTrace();
    const selectedEntities = trace.selectedObjectIds.map((id) => view.canvas.entities[id]).filter(Boolean);
    const localDraft: ActionCheckpointSnapshot = {
      currentActionId: snapshot.currentActionId,
      completedActionIds: snapshot.completedActionIds,
      evidence: snapshot.evidence,
      currentDraft: {
        selectedByKind: {
          points: selectedEntities.filter((entity) => entity.kind === "point").map((entity) => entity.id),
          lines: selectedEntities.filter((entity) => entity.kind === "line").map((entity) => entity.id),
          angles: selectedEntities.filter((entity) => entity.kind === "angle").map((entity) => entity.id),
        },
        answers: trace.answerDraft,
        activeSlotId: view.answer.activeSlotId,
      },
      revision: snapshot.revision,
      updatedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(storageKey, JSON.stringify(localDraft));
  }, [storageKey, snapshot.currentActionId, snapshot.completedActionIds, snapshot.evidence, snapshot.revision, view.canvas.selectedObjectIds, view.answer.activeSlotId, runtime]);

  useEffect(() => {
    if ((local || transport) && snapshot.status === "complete" && !completionNotified.current) {
      completionNotified.current = true;
      onComplete?.();
    }
  }, [local, transport, snapshot.status, onComplete]);

  // Peripheral awareness: while the coach drawer is collapsed, surface each new
  // piece of guidance as a transient 2-line preview bubble plus a persistent
  // unread dot on the avatar (cleared only when the student opens the drawer).
  useEffect(() => {
    if (railOpen) return;
    const latex = view.coach.actionPromptLatex;
    const id = `coach-guidance:${latex}`;
    if (latex && id !== lastPreviewId.current) {
      lastPreviewId.current = id;
      setCoachPreview({ id, latex });
      setCoachUnread(true);
    }
  }, [view.coach.actionPromptLatex, railOpen]);

  useEffect(() => {
    if (railOpen) return;
    const last = coach.thread[coach.thread.length - 1];
    if (last?.role === "coach" && last.id !== lastPreviewId.current) {
      lastPreviewId.current = last.id;
      setCoachPreview({ id: last.id, latex: last.text });
      setCoachUnread(true);
    }
  }, [coach.thread, railOpen]);

  // The preview bubble is fleeting (~6s); the unread dot is what persists.
  useEffect(() => {
    if (!coachPreview) return;
    const timer = window.setTimeout(() => setCoachPreview(null), 6000);
    return () => window.clearTimeout(timer);
  }, [coachPreview]);

  const send = (event: ActionRuntimeEvent) => {
    if (!disabled) runtime.send(event);
  };
  const openCoachRail = () => {
    setRailOpen(true);
    setCoachPreview(null);
    setCoachUnread(false);
  };
  const closeCoachRail = () => setRailOpen(false);

  // Translate the runtime's transient emphasis into surface-specific channels.
  // `view.transientEmphasis` is a stable reference between changes, so these
  // memos only recompute when a new highlight actually arrives.
  const canvasEmphasis = useMemo(() => canvasEmphasisFrom(view.transientEmphasis), [view.transientEmphasis]);
  const boardEmphasis = useMemo(() => boardEmphasisFrom(view.transientEmphasis), [view.transientEmphasis]);

  useEffect(() => {
    const key = view.transientEmphasis?.key;
    if (!key) return;
    const consume = () => runtime.consumeTransientEmphasis(key);
    const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(consume) : window.setTimeout(consume, 0);
    return () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      else window.clearTimeout(frame);
    };
  }, [view.transientEmphasis?.key, runtime]);

  const canvasView: InteractionView = {
    prompt: view.instruction,
    entities: Object.fromEntries(Object.values(view.canvas.entities).map((entity) => [entity.id, {
      ...entity,
      expected: false,
      visualState: entity.visualState === "correct" ? "correct" : entity.visualState,
    }])),
    selected: Object.values(view.canvas.entities)
      .filter((entity) => view.canvas.selectedObjectIds.includes(entity.id))
      .map((entity) => ({ kind: entity.kind, id: entity.id })),
    cursor: view.canvas.cursor === "crosshair" ? "crosshair" : view.canvas.cursor,
    canCancel: view.controls.canCancel,
    canGoBack: view.controls.canBack,
    emphasis: canvasEmphasis,
    preview: view.canvas.preview?.type === "parallel" && view.canvas.preview.throughPointId && view.canvas.preview.referenceLineId
      ? { type: "parallel-fixed", throughPointId: view.canvas.preview.throughPointId, referenceLineId: view.canvas.preview.referenceLineId }
      : view.canvas.preview?.type === "intersection"
        ? { type: "intersection-fixed", parallelLineId: view.canvas.preview.parallelLineId, carrierPointIds: view.canvas.preview.carrierPointIds }
        : undefined,
  };

  const isTeaching = snapshot.plan.mode === "learn";
  const currentActionIndex = snapshot.plan.actions.findIndex((item) => item.actionId === snapshot.currentActionId);
  const previousTeachingAction = currentActionIndex > 0 ? snapshot.plan.actions[currentActionIndex - 1] : undefined;
  const canAdvanceTeaching = snapshot.status !== "complete" && currentActionIndex < snapshot.plan.actions.length;
  const clickEntity = (entity: EntityRef) => {
    if (!isTeaching) send({ type: "OBJECT.SELECTED", objectKind: entity.kind, objectId: entity.id });
  };
  return (
    <FocusWorkspace
      ariaLabel="Action 驱动学习工作台"
      className="topic-runtime-frame"
      railOpen={railOpen}
      railTrigger={railTriggerOverride ?? (
        <TopicCoachDockTrigger
          avatarId={view.coach.avatarId}
          speaking={speaking}
          open={railOpen}
          unread={coachUnread}
          previewLatex={coachPreview?.latex}
          onOpen={openCoachRail}
        />
      )}
      prompt={questionPrompt ?? <><span>题目</span><div><h1><MathText value={snapshot.plan.metadata.promptLatex} /></h1></div></>}
      rail={railContent ?? (
        <TopicCoachPanel
          tone={view.coach.tone}
          avatarId={view.coach.avatarId}
          progress={{ label: isTeaching ? "教学拍点" : "当前动作", current: view.progress.current, total: view.progress.total }}
          title={snapshot.status === "complete" ? "本题讲解完成" : view.title}
          promptLatex={view.coach.actionPromptLatex}
          feedback={view.feedback}
          autoplayBlocked={autoplayBlocked}
          thread={coach.thread}
          canHelp={view.controls.canHelp}
          message={coach.studentMessage}
          onMessageChange={coach.setStudentMessage}
          onAsk={() => void coach.askCoach()}
          inputDisabled={coach.busy || coach.recording || coach.realtime.active}
          micDisabled={coach.busy || coach.realtime.active}
          recording={coach.recording}
          onToggleRecorder={() => void coach.toggleRecorder()}
          busy={coach.busy}
          onReplay={() => replaySpeech()}
          replayDisabled={!speechUrl}
          onClose={closeCoachRail}
          realtime={view.controls.canHelp && snapshot.plan.runtimeCapabilities?.liveCoach !== false && snapshot.plan.mode !== "assessment" ? <div className="topic-coach-realtime">
            <button type="button" className={`btn ${coach.realtime.active ? "btn-secondary" : "btn-primary"} topic-coach-realtime-toggle${coach.realtime.active ? " is-active" : ""}`} disabled={coach.realtime.connecting} aria-pressed={coach.realtime.active} onClick={() => { if (coach.realtime.active) coach.realtime.stop(); else void coach.realtime.start({ sessionId: local ? undefined : response.sessionId, taskId: local ? snapshot.plan.metadata.taskId : undefined, exerciseId: snapshot.plan.exerciseId, actionId: snapshot.currentActionId, mode: local ? "learn" : "guided-practice" }); }}><span className="material-symbols-outlined">{coach.realtime.active ? "call_end" : "forum"}</span>{coach.realtime.connecting ? "连接中…" : coach.realtime.active ? "结束对话" : "实时对话"}</button>
            {coach.realtime.active ? <p className="topic-coach-recording" role="status"><span />实时通话中，直接说话即可，说完会自动回答</p> : null}
            {coach.realtime.error ? <p className="topic-coach-recording" role="alert">{coach.realtime.error}</p> : null}
          </div> : null}
          footerControls={view.coach.agentCommand && snapshot.plan.mode === "guided-practice" ? <button type="button" className="btn btn-secondary" onClick={() => runtime.applyAgentCommand(view.coach.agentCommand!, true)}>确认执行老师建议</button> : null}
        />)}
      actionBarLeft={isTeaching
        ? <TopicTeachingPlayback
          positionCurrent={currentActionIndex + 1}
          positionTotal={snapshot.plan.actions.length}
          firstDisabled={disabled || (currentActionIndex === 0 && snapshot.status !== "complete")}
          onFirst={() => runtime.seekTeaching(snapshot.plan.actions[0].actionId)}
          previousDisabled={disabled || !previousTeachingAction}
          onPrevious={() => previousTeachingAction && runtime.seekTeaching(previousTeachingAction.actionId)}
          replayDisabled={!speechUrl}
          onReplay={() => replaySpeech()}
          nextDisabled={coach.busy || disabled || !canAdvanceTeaching}
          onNext={() => runtime.advanceTeaching()}
          pauseNote={snapshot.status === "complete" ? "讲解已完成" : "已暂停，等待学生回应后继续演示"}
        />
        : <ActionAnswerFields runtimeSend={send} disabled={disabled} view={view} />}
      actionEnd={
        isTeaching ? <TopicTeachingConfirm
          confusedDisabled={coach.busy || snapshot.status === "complete"}
          onConfused={() => void coach.askCoach({ message: "我没听懂这一步，请换一种说法，并说明为什么这样做。" })}
          understoodDisabled={coach.busy || disabled || snapshot.status === "complete"}
          understoodLabel={snapshot.status === "complete" ? "讲解完成" : "明白，继续"}
          onUnderstood={() => runtime.advanceTeaching()}
        /> : <div className="action-row">
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canBack || disabled} onClick={() => send({ type: "BACK" })}>撤销</button>
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canClear || disabled} onClick={() => send({ type: "CLEAR" })}>清空</button>
          {snapshot.status === "transport-error"
            ? <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => runtime.retrySubmission()}>重试提交</button>
            : <button type="button" className="btn btn-primary" disabled={!view.controls.canSubmit || disabled} onClick={() => send({ type: "SUBMIT" })}>{view.controls.isSubmitting ? "提交中…" : "确认"}</button>}
        </div>
      }
    >
      {/* VS1 remediation：双 surface 组合经由唯一 canonical
          StudentWorkspaceFrame（与讲解/完成阶段同一 bounds）；既有
          action-runtime-workspace 断言锚点与 data-* 透传保留。 */}
      <StudentWorkspaceFrame
        frameTestId="action-runtime-workspace"
        className="action-runtime-workspace"
        viewRevision={viewRevision}
        geometry={
          model
            ? <GeometryCanvasSurface model={model} view={canvasView} onClickEntity={clickEntity} modelVersion={snapshot.revision + snapshot.world.commandBatches.length} />
            : view.canvas.diagramAsset ? <img src={view.canvas.diagramAsset} alt="题目图形" /> : null
        }
        board={
          /* F7 Step 7：tutor canonical 板书槽优先（共享 canonical
             SolutionBoardViewSurface，与讲解/完成面同一渲染面）；VS0（ADR-009
             布局不变量 6）：无板书内容时渲染明确 empty surface。VS1：
             boardView（legacy 统一 View 板书投影）次之——legacy Tutor 链操作
             回合板书不消失；practice 链维持内部投影。 */
          boardSurface
            ?? (boardView
              ? (boardView.visibleExpressions.length
                  ? <SolutionBoardPanel board={boardView} />
                  : <section className="topic-answer-panel solution-board-panel is-empty" aria-label="解题板书（暂空）" data-testid="region-solution-board">
                      <div className="solution-board-document">
                        <p className="solution-board-empty-note">板书还没有开始——跟随老师的讲解逐步出现。</p>
                      </div>
                    </section>)
              : view.solutionBoard
                ? <SolutionBoardPanel board={view.solutionBoard} emphasis={boardEmphasis} />
                : <section className="topic-answer-panel solution-board-panel is-empty" aria-label="解题板书（暂空）" data-testid="region-solution-board">
                    <div className="solution-board-document">
                      <p className="solution-board-empty-note">板书还没有开始——跟随老师的讲解逐步出现。</p>
                    </div>
                  </section>)
        }
        overlay={
          /* Tutor transport（rail 被替换）时 wrong 反馈落工作区，不依赖 coach 栏。 */
          snapshot.status === "wrong" && snapshot.wrongMessage ? (
            <div className="topic-coach-message is-wrong" role="status" data-testid="runtime-wrong-feedback">
              <MathText value={snapshot.wrongMessage} block />
            </div>
          ) : undefined
        }
        dataAttributes={{
          "action-id": snapshot.currentActionId,
          "action-state": runtime.getTrace().actionState,
          "selected": runtime.getTrace().selectedObjectIds.join(","),
          "board": boardSurface
            ? "canonical"
            : boardView
              ? (boardView.visibleExpressions.length ? "content" : "empty")
              : view.solutionBoard ? "content" : "empty",
        }}
      />
    </FocusWorkspace>
  );
}

// Color-only highlight (no scale) so the board layout never shifts. The reduced
// motion variant is shorter and gentler; both avoid movement entirely.
const BOARD_EMPHASIS_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "rgba(24,183,183,0)", boxShadow: "0 0 0 0 rgba(24,183,183,0)" },
  { backgroundColor: "rgba(24,183,183,0.24)", boxShadow: "0 0 0 4px rgba(24,183,183,0.58)", offset: 0.35 },
  { backgroundColor: "rgba(24,183,183,0.14)", boxShadow: "0 0 0 2px rgba(24,183,183,0.32)", offset: 0.68 },
  { backgroundColor: "rgba(24,183,183,0)", boxShadow: "0 0 0 0 rgba(24,183,183,0)" },
];

const BOARD_EMPHASIS_KEYFRAMES_REDUCED: Keyframe[] = [
  { backgroundColor: "rgba(24,183,183,0)" },
  { backgroundColor: "rgba(24,183,183,0.12)" },
  { backgroundColor: "rgba(24,183,183,0)" },
];

export function SolutionBoardPanel({ board, emphasis }: { board: SolutionBoardView; emphasis?: SolutionBoardEmphasis }) {
  const currentRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const userScrolled = useRef(false);
  const previousCount = useRef(board.visibleExpressions.length);
  useEffect(() => {
    if (board.visibleExpressions.length !== previousCount.current && !userScrolled.current) {
      currentRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    previousCount.current = board.visibleExpressions.length;
  }, [board.visibleExpressions.length, board.currentExpressionId]);

  // Play the highlight once per NEW emphasis key. The effect depends only on
  // emphasis.key, so an ordinary re-render with the same key never restarts the
  // animation; a new key (next accepted expression) plays it again. The existing
  // isCurrent/isComplete semantics stay untouched — emphasis is a separate signal.
  useEffect(() => {
    if (!emphasis || !containerRef.current) return;
    const reduce = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    for (const id of emphasis.expressionIds) {
      const node = containerRef.current.querySelector<HTMLElement>(`[data-expression-id="${id}"]`);
      if (!node || typeof node.animate !== "function") continue;
      node.animate(reduce ? BOARD_EMPHASIS_KEYFRAMES_REDUCED : BOARD_EMPHASIS_KEYFRAMES, {
        duration: reduce ? 650 : 1100,
        easing: "ease-out",
      });
    }
  }, [emphasis?.key]);

  const emphasized = emphasis ? new Set(emphasis.expressionIds) : undefined;
  return (
    <section
      className="topic-answer-panel solution-board-panel"
      aria-label="解题板书"
      data-testid="region-solution-board"
      onWheel={() => { userScrolled.current = true; }}
      onTouchMove={() => { userScrolled.current = true; }}
    >
      <div className="solution-board-document" ref={containerRef}>
        {board.visibleExpressions.map((expression) => {
          const hasEmphasis = Boolean(emphasized?.has(expression.expressionId));
          return (
            <div
              key={expression.expressionId}
              ref={expression.isCurrent ? currentRef : undefined}
              className={`solution-board-line${expression.isCurrent ? " is-current" : ""}${expression.isComplete ? " is-complete" : ""}${hasEmphasis ? " is-emphasis" : ""}`}
              data-expression-id={expression.expressionId}
              data-source-step-id={expression.sourceStepId}
              data-emphasis-key={hasEmphasis ? emphasis?.key : undefined}
            >
              <MathText value={expression.latex} block />
            </div>
          );
        })}
      </div>
      <span className="sr-only" aria-live="polite">{board.announcement}</span>
    </section>
  );
}

export function ActionAnswerFields({ runtimeSend, disabled, view }: {
  runtimeSend: (event: ActionRuntimeEvent) => void;
  disabled?: boolean;
  view: ReturnType<ReturnType<typeof useActionPageRuntime>["runtime"]["getView"]>;
}) {
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => {
    const targetId = view.coach.focusTargetId || view.answer.activeSlotId
      || view.answer.slots.find((slot) => slot.kind !== "object")?.id;
    if (targetId) refs.current[targetId]?.focus();
  }, [view.coach.focusTargetId, view.answer.activeSlotId, view.actionId]);
  return <div className="topic-answer-inputs">{view.answer.slots.map((slot) => slot.options?.length ? (
    <div className="topic-choice-grid" key={slot.id}>{slot.options.map((option) => (
      <button key={option.value} type="button" className="btn btn-ghost" data-option-value={option.value} disabled={disabled} onClick={() => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: option.value })}><MathText value={option.labelLatex} /></button>
    ))}</div>
  ) : slot.kind === "object" ? null : (
    <label key={slot.id}><span>{slot.label}</span><input ref={(node) => { refs.current[slot.id] = node; }} id={`action-slot-${slot.id}`} aria-invalid={slot.status === "wrong"} disabled={disabled} inputMode={slot.kind === "number" ? "decimal" : undefined} value={slot.value} placeholder={slot.placeholder} onChange={(event) => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: event.target.value })} /></label>
  ))}</div>;
}

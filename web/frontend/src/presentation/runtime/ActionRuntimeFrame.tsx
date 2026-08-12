import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ActionCheckpointSnapshot,
  ActionEvaluationResponse,
  ActionPlanResponse,
  CoachAudioInput,
  CoachConversationTurn,
  CoachDirective,
  CoachTurnRequest,
} from "../../../../shared/actionRuntime";
import { api } from "../../api/client";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { MathText } from "../../components/math/MathText";
import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import type { EntityRef } from "../../geometry/interaction/events";
import type { InteractionView, TransientCanvasEmphasis } from "../../geometry/interaction/interaction-view";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import type { ActionRuntimeEvent } from "../../action-runtime/events";
import type { SolutionBoardView, TransientEmphasis } from "../../action-runtime/types";
import { useActionPageRuntime } from "../../action-runtime/react/useActionPageRuntime";
import { useRealtimeCoach } from "../coach/useRealtimeCoach";
import { useCoachRecorder } from "../coach/useCoachRecorder";
import { useTeacherSpeech } from "../narration/useTeacherSpeech";
import { getTrainingSyncQueue } from "../../persistence/training/trainingSyncQueue";
import { buildTrainingCheckpoint, buildTrainingResult } from "../../action-runtime/training/trainingRecords";
import { MediaSessionController, type AudioStreamHandle } from "../audio/MediaSessionController";
import { COACH_MEDIA_PROTOCOL_VERSION } from "../../../../shared/coachMedia";

interface ActionRuntimeFrameProps {
  response: ActionPlanResponse;
  disabled?: boolean;
  local?: boolean;
  onEvaluation?: (result: ActionEvaluationResponse) => void | Promise<void>;
  onComplete?: () => void;
}

interface CoachThreadMessage extends CoachConversationTurn {
  id: string;
  pending?: boolean;
  error?: boolean;
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

/** Decode a base64 string into a Uint8Array for MediaSource appendBuffer. */
function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function ActionRuntimeFrame({ response, disabled, local, onEvaluation, onComplete }: ActionRuntimeFrameProps) {
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
  const completionNotified = useRef(false);
  const trainingCompletionNotified = useRef(false);
  const coachAbortRef = useRef<AbortController | null>(null);
  const [coachBusy, setCoachBusy] = useState(false);
  const [studentMessage, setStudentMessage] = useState("");
  const [coachThread, setCoachThread] = useState<CoachThreadMessage[]>([]);
  const [railOpen, setRailOpen] = useState(false);
  const [coachPreview, setCoachPreview] = useState<{ id: string; latex: string } | null>(null);
  const [coachUnread, setCoachUnread] = useState(false);
  const mediaSession = useMemo(() => new MediaSessionController((mark) => {
    void api.reportVoiceTelemetry({
      version: COACH_MEDIA_PROTOCOL_VERSION,
      correlationId: mark.correlationId,
      sessionId: response.sessionId,
      owner: mark.owner,
      stage: mark.stage,
      browserTimeMs: mark.browserTimeMs,
    }).catch(() => undefined);
  }), [response.sessionId]);
  const teacherSpeech = useTeacherSpeech(snapshot.plan, action, mediaSession);
  const realtime = useRealtimeCoach(mediaSession);
  const { speechUrl, speaking, autoplayBlocked, replay: replaySpeech, speak: playSpeechUrl } = teacherSpeech;
  const lastPreviewId = useRef("");
  const recorder = useCoachRecorder({
    disabled: coachBusy || realtime.active,
    onAudio: (audio) => { void askCoach({ audio }); },
    onError: (text) => setCoachThread((current) => [...current, { id: crypto.randomUUID(), role: "coach", text, error: true }]),
  });
  const recording = recorder.recording;

  useEffect(() => () => mediaSession.dispose(), [mediaSession]);

  useEffect(() => {
    if (realtime.active) realtime.updateContext(action.actionId, action.instruction);
  }, [realtime.active, realtime.updateContext, action.actionId, action.instruction]);

  // Advancing to a new Action (or unmounting) cancels any in-flight coach turn
  // and its audio. This is also what lets a new turn preempt an old one.
  useEffect(() => {
    return () => {
      coachAbortRef.current?.abort();
      mediaSession.stop("coach-turn");
    };
  }, [action.actionId, mediaSession]);

  useEffect(() => {
    if (!realtime.transcript.length) return;
    setCoachThread((current) => {
      const liveIds = new Set(realtime.transcript.map((item) => item.id));
      return [
        ...current.filter((item) => !liveIds.has(item.id)),
        ...realtime.transcript.map((item) => ({ id: item.id, role: item.role, text: item.text })),
      ];
    });
  }, [realtime.transcript]);

  useEffect(() => {
    if (local) return;
    if (snapshot.status !== "submitting") return;
    const sourceStepId = action.sourceStepId;
    const evidence = snapshot.evidence.filter((item) => item.sourceStepId === sourceStepId);
    const key = `${response.sessionId}:${snapshot.revision}:${sourceStepId}:${evidence.map((item) => item.actionId).join(",")}`;
    const idempotencyKey = submissionKeys.current.get(key) || crypto.randomUUID();
    submissionKeys.current.set(key, idempotencyKey);
    void api.evaluateAction({
      sessionId: response.sessionId,
      exerciseId: snapshot.plan.exerciseId,
      sourceStepId,
      revision: snapshot.revision,
      evidence,
      idempotencyKey,
    }).then(async (result) => {
      runtime.applyEvaluation(result);
      await onEvaluation?.(result);
    }).catch(() => {
      runtime.markTransportFailure();
    });
  }, [local, snapshot.status, snapshot.currentActionId, snapshot.revision, snapshot.evidence, response.sessionId]);

  useEffect(() => {
    if (local) return;
    if (snapshot.plan.mode === "guided-practice") return;
    if (local || snapshot.evidence.length === 0) return;
    void api.checkpointAction({
      sessionId: response.sessionId,
      exerciseId: snapshot.plan.exerciseId,
      currentActionId: snapshot.currentActionId,
      completedActionIds: snapshot.completedActionIds,
      evidence: snapshot.evidence,
      revision: snapshot.revision,
    }).catch(() => undefined);
  }, [local, response.sessionId, snapshot.completedActionIds.join("|"), snapshot.evidence.length, snapshot.revision]);

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
    if (local && snapshot.status === "complete" && !completionNotified.current) {
      completionNotified.current = true;
      onComplete?.();
    }
  }, [local, snapshot.status, onComplete]);

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
    const last = coachThread[coachThread.length - 1];
    if (last?.role === "coach" && last.id !== lastPreviewId.current) {
      lastPreviewId.current = last.id;
      setCoachPreview({ id: last.id, latex: last.text });
      setCoachUnread(true);
    }
  }, [coachThread, railOpen]);

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

  const askCoach = async (input?: { message?: string; audio?: CoachAudioInput }) => {
    if (coachBusy || !view.controls.canHelp) return;
    const message = input?.message?.trim() || studentMessage.trim();
    if (!message && !input?.audio) return;
    runtime.recordAssistance(input?.message?.includes("没听懂") ? "hint" : "coach");
    const studentTurnId = crypto.randomUUID();
    const previousConversation = coachThread
      .filter((turn) => !turn.pending && !turn.error)
      .map(({ role, text }) => ({ role, text }));
    setCoachThread((current) => [...current, {
      id: studentTurnId,
      role: "student",
      text: message || "正在识别语音…",
      pending: Boolean(input?.audio),
    }]);
    setStudentMessage("");
    setCoachBusy(true);
    coachAbortRef.current?.abort();
    const abort = new AbortController();
    coachAbortRef.current = abort;
    const audioStreamRef = { current: null as AudioStreamHandle | null };
    try {
      const payload: CoachTurnRequest = {
        context: local
          ? { kind: "learn", taskId: snapshot.plan.metadata.taskId }
          : { kind: "practice", sessionId: response.sessionId },
        exerciseId: snapshot.plan.exerciseId,
        trace: runtime.getTrace(message || undefined),
        ...(message ? { studentMessage: message } : {}),
        ...(input?.audio ? { studentAudio: input.audio } : {}),
        conversation: previousConversation,
        synthesizeSpeech: true,
      };
      const coachTurnId = crypto.randomUUID();
      let coachStreamedText = "";
      let studentTranscript = "";
      const upsertCoachBubble = (text: string, pending: boolean) =>
        setCoachThread((current) => {
          const rest = current.filter((turn) => turn.id !== coachTurnId);
          return text ? [...rest, { id: coachTurnId, role: "coach" as const, text, pending }] : rest;
        });
      const markStudentTurn = (text: string) =>
        setCoachThread((current) => current.map((turn) => turn.id === studentTurnId ? { ...turn, text, pending: false } : turn));

      if (snapshot.plan.runtimeCapabilities?.coachTurnTransport === "stream") {
        let directive: CoachDirective | undefined;
        await api.streamActionCoach(payload, (event) => {
          if (event.type === "turn.transcript.delta") {
            if (event.role === "coach") { coachStreamedText += event.text; upsertCoachBubble(coachStreamedText, true); }
            else if (event.role === "student") studentTranscript = event.text;
          } else if (event.type === "turn.audio.delta") {
            // Feed each MP3 chunk into one incremental MediaSource stream so
            // playback starts on the first chunk — before the full answer lands.
            const handle = audioStreamRef.current ?? mediaSession.startAudioStream("coach-turn", { correlationId: event.correlationId });
            audioStreamRef.current = handle;
            handle.appendChunk(decodeBase64ToBytes(event.audioBase64));
          } else if (event.type === "turn.directive") {
            directive = event.directive;
          }
        }, abort.signal);
        audioStreamRef.current?.complete();
        if (abort.signal.aborted) return;
        if (!directive) throw new Error("Coach stream ended without a directive");
        upsertCoachBubble(directive.messageLatex, false);
        runtime.applyCoach(directive);
        markStudentTurn(studentTranscript || message || "语音提问");
      } else {
        const turnResponse = await api.conductActionCoach(payload, { signal: abort.signal });
        if (abort.signal.aborted) return;
        runtime.applyCoach(turnResponse.directive);
        setCoachThread((current) => [...current, { id: turnResponse.directive.directiveId, role: "coach" as const, text: turnResponse.directive.messageLatex }]);
        markStudentTurn(turnResponse.transcript || message || "语音提问");
        if (turnResponse.speech?.audioUrl) playSpeechUrl(turnResponse.speech.audioUrl);
      }
    } catch {
      if (abort.signal.aborted) return; // cancelled by a new turn / Action switch
      mediaSession.stop("coach-turn");
      const failure: CoachDirective = {
        directiveId: crypto.randomUUID(),
        messageLatex: "老师暂时没有连上。我们先停在这一步，稍后可以再问一次。",
        spokenText: "老师暂时没有连上。我们先停在这一步，稍后可以再问一次。",
        tone: "prompt",
        highlightObjectIds: [],
        suggestedActionId: action.actionId,
      };
      runtime.applyCoach(failure);
      setCoachThread((current) => [
        ...current.map((turn) => turn.id === studentTurnId ? { ...turn, pending: false, error: Boolean(input?.audio) } : turn),
        { id: failure.directiveId, role: "coach", text: failure.messageLatex, error: true },
      ]);
    } finally {
      setCoachBusy(false);
    }
  };

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
      railTrigger={
        <button
          type="button"
          className={`topic-coach-dock-avatar${speaking ? " is-speaking" : ""}`}
          aria-label={railOpen ? "陪练老师" : "展开陪练老师"}
          aria-expanded={railOpen}
          onClick={openCoachRail}
        >
          <span className="material-symbols-outlined">{view.coach.avatarId}</span>
          {coachUnread ? <span className="topic-coach-dock-unread" aria-hidden /> : null}
          {coachPreview ? (
            <span className="topic-coach-dock-preview" role="status" aria-live="polite">
              <MathText value={coachPreview.latex} />
            </span>
          ) : null}
        </button>
      }
      prompt={<><span>题目</span><div><h1><MathText value={snapshot.plan.metadata.promptLatex} /></h1></div></>}
      rail={
        <aside className={`topic-coach-panel tone-${view.coach.tone}`} aria-label="陪练老师" aria-live="polite">
          <div className="topic-coach-header">
            <span className="topic-coach-avatar material-symbols-outlined">{view.coach.avatarId}</span>
            <div><small>{isTeaching ? "教学拍点" : "当前动作"} {view.progress.current}/{view.progress.total}</small><strong>{snapshot.status === "complete" ? "本题讲解完成" : view.title}</strong></div>
            <button type="button" className="topic-coach-sound" aria-label="重播老师语音" disabled={!speechUrl} onClick={() => replaySpeech()}><span className="material-symbols-outlined">volume_up</span></button>
            <button type="button" className="topic-coach-close" aria-label="收起指导栏" onClick={closeCoachRail}><span className="material-symbols-outlined">right_panel_close</span></button>
          </div>
          <div className="topic-coach-bubble" aria-label="当前 Action 讲解"><MathText value={view.coach.actionPromptLatex} block /></div>
          {autoplayBlocked ? <p className="topic-coach-recording" role="status">浏览器已阻止自动播放，请点右上角扬声器开始朗读。</p> : null}
          {coachThread.length ? <div className="topic-coach-thread" aria-label="答疑对话">{coachThread.map((turn) => (
            <div key={turn.id} className={`topic-coach-turn is-${turn.role}${turn.pending ? " is-pending" : ""}${turn.error ? " is-error" : ""}`}>
              <small>{turn.role === "student" ? "学生" : "老师"}</small>
              {turn.role === "coach" ? <MathText value={turn.text} /> : <p>{turn.text}</p>}
            </div>
          ))}</div> : null}
          {view.controls.canHelp && snapshot.plan.runtimeCapabilities?.liveCoach !== false && snapshot.plan.mode !== "assessment" ? <div className="topic-coach-realtime">
            <button type="button" className={`btn ${realtime.active ? "btn-secondary" : "btn-primary"} topic-coach-realtime-toggle${realtime.active ? " is-active" : ""}`} disabled={realtime.connecting} aria-pressed={realtime.active} onClick={() => { if (realtime.active) realtime.stop(); else void realtime.start({ sessionId: local ? undefined : response.sessionId, taskId: local ? snapshot.plan.metadata.taskId : undefined, exerciseId: snapshot.plan.exerciseId, actionId: snapshot.currentActionId, mode: local ? "learn" : "guided-practice" }); }}><span className="material-symbols-outlined">{realtime.active ? "call_end" : "forum"}</span>{realtime.connecting ? "连接中…" : realtime.active ? "结束对话" : "实时对话"}</button>
            {realtime.active ? <p className="topic-coach-recording" role="status"><span />实时通话中，直接说话即可，说完会自动回答</p> : null}
            {realtime.error ? <p className="topic-coach-recording" role="alert">{realtime.error}</p> : null}
          </div> : null}
          {view.controls.canHelp ? <div className="topic-coach-composer">
            <label className="topic-coach-question"><span className="sr-only">向老师提问</span><input value={studentMessage} placeholder="文字或语音问老师" disabled={coachBusy || recording || realtime.active} onKeyDown={(event) => { if (event.key === "Enter") void askCoach(); }} onChange={(event) => setStudentMessage(event.target.value)} /></label>
            <button type="button" className={`topic-coach-mic${recording ? " is-recording" : ""}`} aria-label={recording ? "结束录音" : "语音提问"} disabled={coachBusy || realtime.active} onClick={() => void recorder.toggle()}><span className="material-symbols-outlined">{recording ? "stop_circle" : "mic"}</span></button>
            <button type="button" className="topic-coach-send" aria-label="发送问题" disabled={coachBusy || recording || realtime.active || !studentMessage.trim()} onClick={() => void askCoach()}><span className="material-symbols-outlined">send</span></button>
          </div> : null}
          {recording ? <p className="topic-coach-recording" role="status"><span />正在听，点停止后发送（最长 45 秒）</p> : null}
          {coachBusy ? <p className="topic-coach-thinking" role="status">老师正在结合当前解题状态回答…</p> : null}
          {view.coach.agentCommand && snapshot.plan.mode === "guided-practice" ? <button type="button" className="btn btn-secondary" onClick={() => runtime.applyAgentCommand(view.coach.agentCommand!, true)}>确认执行老师建议</button> : null}
        </aside>
      }
      actionBarLeft={isTeaching
        ? <div className="topic-action-playback" role="group" aria-label="Action 播放面板">
          <button type="button" className="topic-action-playback-button" aria-label="回到第一个 Action" title="回到第一个 Action" disabled={disabled || (currentActionIndex === 0 && snapshot.status !== "complete")} onClick={() => runtime.seekTeaching(snapshot.plan.actions[0].actionId)}><span className="material-symbols-outlined">first_page</span></button>
          <button type="button" className="topic-action-playback-button" aria-label="上一个 Action" title="上一个 Action" disabled={disabled || !previousTeachingAction} onClick={() => previousTeachingAction && runtime.seekTeaching(previousTeachingAction.actionId)}><span className="material-symbols-outlined">skip_previous</span></button>
          <span className="topic-action-playback-position"><strong>Action {currentActionIndex + 1}</strong><small>/ {snapshot.plan.actions.length}</small></span>
          <button type="button" className="topic-action-playback-button" aria-label="重播当前 Action 讲解" title="重播当前 Action 讲解" disabled={!speechUrl} onClick={() => replaySpeech()}><span className="material-symbols-outlined">replay</span></button>
          <button type="button" className="topic-action-playback-button is-primary" aria-label="下一个 Action" title="播放到下一个 Action" disabled={coachBusy || disabled || !canAdvanceTeaching} onClick={() => runtime.advanceTeaching()}><span className="material-symbols-outlined">skip_next</span></button>
          <span className="topic-teaching-pause"><span className="material-symbols-outlined">pause_circle</span>{snapshot.status === "complete" ? "讲解已完成" : "已暂停，等待学生回应后继续演示"}</span>
        </div>
        : <ActionAnswerFields runtimeSend={send} disabled={disabled} view={view} />}
      actionEnd={
        isTeaching ? <div className="action-row topic-teaching-controls">
          <button type="button" className="btn btn-ghost" disabled={coachBusy || snapshot.status === "complete"} onClick={() => void askCoach({ message: "我没听懂这一步，请换一种说法，并说明为什么这样做。" })}>这步没懂</button>
          <button type="button" className="btn btn-primary" disabled={coachBusy || disabled || snapshot.status === "complete"} onClick={() => runtime.advanceTeaching()}>{snapshot.status === "complete" ? "讲解完成" : "明白，继续"}</button>
        </div> : <div className="action-row">
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canBack || disabled} onClick={() => send({ type: "BACK" })}>撤销</button>
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canClear || disabled} onClick={() => send({ type: "CLEAR" })}>清空</button>
          {snapshot.status === "transport-error"
            ? <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => runtime.retrySubmission()}>重试提交</button>
            : <button type="button" className="btn btn-primary" disabled={!view.controls.canSubmit || disabled} onClick={() => send({ type: "SUBMIT" })}>{view.controls.isSubmitting ? "提交中…" : "确认"}</button>}
        </div>
      }
    >
      <div
        className={`practice-canvas-zone topic-practice-canvas action-runtime-workspace ${view.solutionBoard ? "" : "has-no-board"}`}
        data-testid="action-runtime-workspace"
        data-action-id={snapshot.currentActionId}
        data-action-state={runtime.getTrace().actionState}
        data-selected={runtime.getTrace().selectedObjectIds.join(",")}
      >
        <div className="artifact-math-object has-diagram">
          <section className="artifact-diagram-stage">
            {model ? <GeometryCanvasSurface model={model} view={canvasView} onClickEntity={clickEntity} modelVersion={snapshot.revision + snapshot.world.commandBatches.length} /> : view.canvas.diagramAsset ? <img src={view.canvas.diagramAsset} alt="题目图形" /> : null}
          </section>
        </div>
        {view.solutionBoard ? <SolutionBoardPanel board={view.solutionBoard} emphasis={boardEmphasis} /> : null}
      </div>
    </FocusWorkspace>
  );
}

// Color-only highlight (no scale) so the board layout never shifts. The reduced
// motion variant is shorter and gentler; both avoid movement entirely.
const BOARD_EMPHASIS_KEYFRAMES: Keyframe[] = [
  { backgroundColor: "rgba(24,183,183,0)", boxShadow: "0 0 0 0 rgba(24,183,183,0)" },
  { backgroundColor: "rgba(24,183,183,0.16)", boxShadow: "0 0 0 3px rgba(24,183,183,0.5)", offset: 0.4 },
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
        duration: reduce ? 500 : 900,
        easing: "ease-out",
      });
    }
  }, [emphasis?.key]);

  const emphasized = emphasis ? new Set(emphasis.expressionIds) : undefined;
  return (
    <section
      className="topic-answer-panel solution-board-panel"
      aria-label="解题过程"
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
      <button key={option.value} type="button" className="btn btn-ghost" disabled={disabled} onClick={() => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: option.value })}><MathText value={option.labelLatex} /></button>
    ))}</div>
  ) : slot.kind === "object" ? null : (
    <label key={slot.id}><span>{slot.label}</span><input ref={(node) => { refs.current[slot.id] = node; }} id={`action-slot-${slot.id}`} aria-invalid={slot.status === "wrong"} disabled={disabled} inputMode={slot.kind === "number" ? "decimal" : undefined} value={slot.value} placeholder={slot.placeholder} onChange={(event) => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: event.target.value })} /></label>
  ))}</div>;
}

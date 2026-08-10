import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActionCheckpointSnapshot, ActionEvaluationResponse, ActionPlanResponse } from "../../../../shared/actionRuntime";
import { api } from "../../api/client";
import { FocusWorkspace } from "../../components/layout/FocusWorkspace";
import { MathText } from "../../components/math/MathText";
import { buildGeometryModel } from "../../geometry/adapters/topicGeometryModel";
import type { EntityRef } from "../../geometry/interaction/events";
import type { InteractionView } from "../../geometry/interaction/interaction-view";
import { GeometryCanvasSurface } from "../../geometry/react/GeometryCanvas";
import type { ActionRuntimeEvent } from "../events";
import type { ExerciseStepView, StepRecordTokenView } from "../types";
import { useActionPageRuntime } from "./useActionPageRuntime";

interface ActionRuntimeFrameProps {
  response: ActionPlanResponse;
  disabled?: boolean;
  local?: boolean;
  onEvaluation?: (result: ActionEvaluationResponse) => void | Promise<void>;
  onComplete?: () => void;
}

export function ActionRuntimeFrame({ response, disabled, local, onEvaluation, onComplete }: ActionRuntimeFrameProps) {
  const storageKey = `action-runtime-v2:${response.sessionId}:${response.plan.exerciseId}`;
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
  const action = snapshot.plan.actions.find((item) => item.actionId === snapshot.currentActionId)!;
  const model = useMemo(
    () => view.canvas.geometry ? buildGeometryModel(view.canvas.geometry) : undefined,
    [view.canvas.geometry],
  );
  const submissionKeys = useRef(new Map<string, string>());
  const [coachBusy, setCoachBusy] = useState(false);
  const [studentMessage, setStudentMessage] = useState("");

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
    if (local && snapshot.status === "complete") onComplete?.();
  }, [local, snapshot.status, onComplete]);

  const send = (event: ActionRuntimeEvent) => {
    if (!disabled) runtime.send(event);
  };
  const askCoach = async () => {
    if (coachBusy || !view.controls.canHelp) return;
    setCoachBusy(true);
    try {
      if (local) {
        runtime.applyCoach({
          directiveId: crypto.randomUUID(),
          messageLatex: action.coach?.nextActionLatex || action.coach?.entryLatex || `先只完成当前动作：${action.instruction}`,
          tone: "explain",
          highlightObjectIds: runtime.getTrace().selectedObjectIds,
          suggestedActionId: action.actionId,
        });
        return;
      }
      const result = await api.askActionCoach({
        sessionId: response.sessionId,
        exerciseId: snapshot.plan.exerciseId,
        trace: runtime.getTrace(studentMessage),
        studentMessage: studentMessage.trim() || undefined,
      });
      runtime.applyCoach(result.directive);
      if (result.directive.agentCommand && snapshot.plan.mode === "learn") runtime.applyAgentCommand(result.directive.agentCommand);
      setStudentMessage("");
    } catch {
      runtime.applyCoach({
        directiveId: crypto.randomUUID(),
        messageLatex: "老师暂时没有连上，你可以继续完成当前动作。",
        tone: "prompt",
        highlightObjectIds: [],
        suggestedActionId: action.actionId,
      });
    } finally {
      setCoachBusy(false);
    }
  };

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
    preview: view.canvas.preview?.type === "parallel" && view.canvas.preview.throughPointId && view.canvas.preview.referenceLineId
      ? { type: "parallel-fixed", throughPointId: view.canvas.preview.throughPointId, referenceLineId: view.canvas.preview.referenceLineId }
      : view.canvas.preview?.type === "intersection"
        ? { type: "intersection-fixed", parallelLineId: view.canvas.preview.parallelLineId, carrierPointIds: view.canvas.preview.carrierPointIds }
        : undefined,
  };

  const clickEntity = (entity: EntityRef) => send({ type: "OBJECT.SELECTED", objectKind: entity.kind, objectId: entity.id });
  const enabledEntities = Object.values(view.canvas.entities).filter((entity) => entity.enabled);
  return (
    <FocusWorkspace
      ariaLabel="Action 驱动学习工作台"
      className="topic-runtime-frame"
      prompt={<><span>题目</span><div><h1><MathText value={snapshot.plan.metadata.promptLatex} /></h1></div></>}
      rail={
        <aside className={`topic-coach-panel tone-${view.coach.tone}`} aria-label="陪练老师" aria-live="polite">
          <div className="topic-coach-header">
            <span className="topic-coach-avatar material-symbols-outlined">{view.coach.avatarId}</span>
            <div><small>当前动作 {view.progress.current}/{view.progress.total}</small><strong>{view.title}</strong></div>
          </div>
          <div className="topic-coach-bubble"><MathText value={view.coach.messageLatex} block /></div>
          {view.controls.canHelp ? <label className="topic-coach-question"><span className="sr-only">向老师提问</span><input value={studentMessage} placeholder="告诉老师你卡在哪里" onChange={(event) => setStudentMessage(event.target.value)} /></label> : null}
          {view.controls.canHelp ? <button type="button" className="btn btn-ghost" disabled={coachBusy} onClick={() => void askCoach()}>{coachBusy ? "老师思考中…" : "我需要提示"}</button> : null}
          {view.coach.agentCommand && snapshot.plan.mode === "guided-practice" ? <button type="button" className="btn btn-secondary" onClick={() => runtime.applyAgentCommand(view.coach.agentCommand!, true)}>确认执行老师建议</button> : null}
        </aside>
      }
      actionEnd={
        <div className="action-row">
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canBack || disabled} onClick={() => send({ type: "BACK" })}>撤销</button>
          <button type="button" className="btn btn-ghost" disabled={!view.controls.canClear || disabled} onClick={() => send({ type: "CLEAR" })}>清空</button>
          {snapshot.status === "transport-error"
            ? <button type="button" className="btn btn-primary" disabled={disabled} onClick={() => runtime.retrySubmission()}>重试提交</button>
            : <button type="button" className="btn btn-primary" disabled={!view.controls.canSubmit || disabled} onClick={() => send({ type: "SUBMIT" })}>{view.controls.isSubmitting ? "提交中…" : "确认"}</button>}
        </div>
      }
    >
      <div
        className="practice-canvas-zone topic-practice-canvas action-runtime-workspace"
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
        <ExerciseStepsPanel
          steps={view.answer.steps}
          activeControls={(
            <div className="exercise-step-active-controls">
              {enabledEntities.length ? (
                <div className="topic-geometry-entity-row" role="group" aria-label="当前可选对象">
                  {enabledEntities.map((entity) => <button key={entity.id} type="button" className="topic-geometry-entity-chip" disabled={disabled} onClick={() => clickEntity({ kind: entity.kind, id: entity.id })}>{entity.id}</button>)}
                </div>
              ) : null}
              <ActionAnswerFields runtimeSend={send} disabled={disabled} view={view} />
            </div>
          )}
        />
      </div>
    </FocusWorkspace>
  );
}

function StepRecordSlot({ label, value }: { label: string; value?: string }) {
  return (
    <span className={`step-record-slot ${value ? "is-filled" : ""}`} aria-label={`${label}${value ? `：${value}` : "，待填写"}`}>
      {value || "\u00a0"}
    </span>
  );
}

function StepRecord({ tokens }: { tokens: StepRecordTokenView[] }) {
  return (
    <p className="step-record">
      {tokens.map((token, index) => token.kind === "text"
        ? <span key={`${index}:${token.text}`}>{token.text}</span>
        : <StepRecordSlot key={token.slotId} label={token.label} value={token.value} />)}
    </p>
  );
}

function ExerciseStepsPanel({ steps, activeControls }: { steps: ExerciseStepView[]; activeControls: ReactNode }) {
  return (
    <section className="topic-answer-panel exercise-steps-panel" aria-labelledby="exercise-steps-title">
      <header className="exercise-steps-header">
        <div><small>整题过程</small><h2 id="exercise-steps-title">解题步骤</h2></div>
        <span>{steps.filter((step) => step.status === "complete").length}/{steps.length}</span>
      </header>
      <ol className="exercise-steps-list">
        {steps.map((step, index) => (
          <li key={step.sourceStepId} className={`exercise-step is-${step.status}`} aria-current={step.status === "active" ? "step" : undefined}>
            <div className="exercise-step-marker">{step.status === "complete" ? "✓" : index + 1}</div>
            <div className="exercise-step-content">
              <header><strong>{step.title}</strong><small>{step.status === "complete" ? "已完成" : step.status === "active" ? "进行中" : "待完成"}</small></header>
              {step.record ? <StepRecord tokens={step.record} /> : <MathText value={step.instruction} block />}
              {step.summary ? <div className="exercise-step-summary">{step.summary}</div> : null}
              {step.status === "active" ? activeControls : null}
            </div>
          </li>
        ))}
      </ol>
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
    if (view.coach.focusTargetId) refs.current[view.coach.focusTargetId]?.focus();
  }, [view.coach.focusTargetId]);
  return <div className="topic-answer-inputs">{view.answer.slots.map((slot) => slot.options?.length ? (
    <div className="topic-choice-grid" key={slot.id}>{slot.options.map((option) => (
      <button key={option.value} type="button" className="btn btn-ghost" disabled={disabled} onClick={() => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: option.value })}><MathText value={option.labelLatex} /></button>
    ))}</div>
  ) : slot.kind === "object" ? null : (
    <label key={slot.id}><span>{slot.label}</span><input ref={(node) => { refs.current[slot.id] = node; }} id={`action-slot-${slot.id}`} aria-invalid={slot.status === "wrong"} disabled={disabled} inputMode={slot.kind === "number" ? "decimal" : undefined} value={slot.value} placeholder={slot.placeholder} onChange={(event) => runtimeSend({ type: "ANSWER.CHANGED", slotId: slot.id, value: event.target.value })} /></label>
  ))}</div>;
}

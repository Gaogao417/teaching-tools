import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  LearningProjectionSpec,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { FocusWorkspace } from "../components/layout/FocusWorkspace";
import { ExerciseRuntimeHost } from "./practice/ExerciseRuntimeHost";
import { TopicRuntimeFrame } from "../components/exercises/topicPractice/TopicRuntimeFrame";
import { isTopicAnswerAccepted } from "../../../shared/topicPractice";
import { topicNodeByTaskId } from "../../../shared/similarityLearningMap";

const EMPTY_DRAFT: ClientDraftState = { selections: {}, inputs: {} };

function runtimeAtStep(projection: LearningProjectionSpec, stepIndex: number): ExerciseRuntimeSpec {
  const active = projection.steps[stepIndex];
  const completedIds = projection.steps.slice(0, stepIndex).map((step) => step.stepId);
  const runtime = projection.sampleRuntime;
  return {
    ...runtime,
    runtimeState: {
      ...runtime.runtimeState,
      currentStepId: active.stepId,
      completedStepIds: completedIds,
    },
    instance: {
      ...runtime.instance,
      flow: {
        ...runtime.instance.flow,
        currentStepId: active.stepId,
        steps: runtime.instance.flow.steps.map((step) => ({
          ...step,
          status: completedIds.includes(step.id) ? "done" : step.id === active.stepId ? "active" : "locked",
        })),
      },
      guide: {
        ...runtime.instance.guide,
        stepItems: runtime.instance.guide.stepItems.map((step) => ({
          ...step,
          status: completedIds.includes(step.stepId) ? "done" : step.stepId === active.stepId ? "active" : "locked",
        })),
      },
      scene: runtime.instance.scene.topicWorkspace ? {
        ...runtime.instance.scene,
        topicWorkspace: {
          ...runtime.instance.scene.topicWorkspace,
          activeStepId: active.stepId,
          completedStepIds: completedIds,
          guidedMode: true,
        },
      } : runtime.instance.scene,
    },
  };
}

export function LearnPage() {
  const { taskId } = useParams<{ taskId: TaskId }>();
  const navigate = useNavigate();
  const { focusedTask, setFocusedTaskId, studentName } = useOutletContext<WorkspaceOutletContext>();
  const [projection, setProjection] = useState<LearningProjectionSpec | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [draft, setDraft] = useState<ClientDraftState>(EMPTY_DRAFT);
  const [topicPhase, setTopicPhase] = useState<"answering" | "correct_pause" | "wrong_feedback">("answering");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const inertRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!taskId) return;
    setFocusedTaskId(taskId);
    setActiveStepIndex(0);
    setDraft(EMPTY_DRAFT);
    setTopicPhase("answering");
    let cancelled = false;
    api.getLearningProjection(taskId)
      .then((result) => !cancelled && setProjection(result))
      .catch(() => !cancelled && setProjection(null));
    return () => { cancelled = true; };
  }, [setFocusedTaskId, taskId]);

  useEffect(() => {
    if (!taskId || !studentName || !topicNodeByTaskId(taskId)) return;
    void api.recordSimilarityLearnProgress(taskId, studentName, "in_progress").catch(() => undefined);
  }, [studentName, taskId]);

  const recordLearnCompleted = (lastStepId?: string) => {
    if (!taskId || !studentName || !topicNodeByTaskId(taskId)) return;
    void api.recordSimilarityLearnProgress(taskId, studentName, "completed", lastStepId).catch(() => undefined);
  };

  useEffect(() => {
    if (inertRef.current) inertRef.current.inert = true;
  }, [projection, activeStepIndex]);

  const runtime = useMemo(
    () => projection ? runtimeAtStep(projection, activeStepIndex) : null,
    [activeStepIndex, projection],
  );
  const activeStep = projection?.steps[activeStepIndex];

  if (!projection || !runtime || !activeStep) {
    return (
      <section className="ks-state-page">
        <span className="eyebrow">学习投影</span>
        <h1>正在准备示范场景</h1>
        <p>系统正在生成一份可复用的确定性教学实例。</p>
      </section>
    );
  }

  const isLast = activeStepIndex === projection.steps.length - 1;

  if (runtime.instance.engineKind === "topic-practice") {
    const contract = runtime.instance.scene.topicWorkspace?.contracts[runtime.runtimeState.currentStepId];
    const submitTopicStep = (submittedPayload?: string) => {
      let value = draft.inputs["topic-answer"] || "";
      if (submittedPayload) {
        try {
          const submitted = JSON.parse(submittedPayload) as { inputs?: Record<string, string> };
          value = submitted.inputs?.["topic-answer"] || value;
        } catch {
          // The action dock and workspace both use JSON payloads; keep the live draft as a safe fallback.
        }
      }
      if (!contract || !isTopicAnswerAccepted(value, contract.acceptedAnswers)) {
        setTopicPhase("wrong_feedback");
        return;
      }
      setTopicPhase("correct_pause");
      window.setTimeout(() => {
        if (isLast) {
          recordLearnCompleted(activeStep.stepId);
          navigate(`/practice/${projection.taskId}`);
          return;
        }
        setActiveStepIndex((index) => index + 1);
        setDraft(EMPTY_DRAFT);
        setTopicPhase("answering");
      }, 500);
    };

    return (
      <div className="ks-focus-page">
        <TopicRuntimeFrame
          runtime={runtime}
          phase={topicPhase}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
          showGuide
          disabled={topicPhase === "correct_pause"}
          onClear={() => { setDraft(EMPTY_DRAFT); setTopicPhase("answering"); }}
          onSubmit={(_stepId, value) => submitTopicStep(value)}
        />
      </div>
    );
  }

  return (
    <div className="ks-focus-page ks-learn-page">
      <FocusWorkspace
        ariaLabel="示范学习工作台"
        prompt={
          <>
            <span>示范题</span>
            <div><h1>{runtime.instance.prompt}</h1></div>
          </>
        }
        rail={
          <>
            <div className="ks-focus-rail-eyebrow">
              学习目标 · 步骤 {activeStepIndex + 1}/{projection.steps.length}
            </div>
            <div className="ks-focus-rail-objective">{projection.objective}</div>
            <div className="ks-focus-rail-action">{activeStep.title}</div>
            <div className="ks-focus-rail-narration">{activeStep.narration}</div>
            {activeStep.actionLabel ? <div className="ks-learn-action-callout">{activeStep.actionLabel}</div> : null}

            <div className="ks-step-progress" style={{ marginTop: "var(--space-3)" }}>
              {projection.steps.map((step, index) => (
                <span key={step.stepId} style={{ display: "inline-flex", alignItems: "center" }}>
                  <button
                    type="button"
                    className={`ks-step-node ${index < activeStepIndex ? "is-done" : index === activeStepIndex ? "is-current" : ""}`}
                    aria-current={index === activeStepIndex ? "step" : undefined}
                    aria-label={step.title}
                    onClick={() => setActiveStepIndex(index)}
                  >
                    {index < activeStepIndex ? "✓" : index + 1}
                  </button>
                  {index < projection.steps.length - 1 ? (
                    <span className={`ks-step-connector ${index < activeStepIndex ? "is-done" : ""}`} />
                  ) : null}
                </span>
              ))}
            </div>
          </>
        }
        actionBarLeft={
          <span className="ks-focus-rail-action">
            {activeStep.actionLabel || activeStep.title}
          </span>
        }
        actionEnd={
          <>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={!activeStepIndex}
              onClick={() => setActiveStepIndex((index) => index - 1)}
            >
              上一步
            </button>
            <button
              className="btn btn-primary"
              type="button"
              onClick={() => {
                if (isLast) {
                  recordLearnCompleted(activeStep.stepId);
                  navigate(`/practice/${projection.taskId}`);
                } else {
                  setActiveStepIndex((index) => index + 1);
                }
              }}
            >
              {isLast ? "开始训练" : activeStep.nextLabel || "下一步"}
            </button>
          </>
        }
      >
        <div ref={inertRef} aria-label="只读教学场景">
          <ExerciseRuntimeHost
            runtime={runtime}
            sessionPhase="answering"
            draft={EMPTY_DRAFT}
            setDraft={() => undefined}
            inputRefs={inputRefs}
            onSubmit={() => undefined}
            onClear={() => undefined}
            readOnly
          />
        </div>
      </FocusWorkspace>
    </div>
  );
}

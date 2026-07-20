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
    const submitTopicStep = () => {
      const value = draft.inputs["topic-answer"] || "";
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
      <div className="ks-practice-page ks-topic-learn-page">
        <main className="ks-practice-main">
          <TopicRuntimeFrame
            runtime={runtime}
            phase={topicPhase}
            draft={draft}
            setDraft={setDraft}
            inputRefs={inputRefs}
            showGuide
            disabled={topicPhase === "correct_pause"}
            onClear={() => { setDraft(EMPTY_DRAFT); setTopicPhase("answering"); }}
            onSubmit={() => submitTopicStep()}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="ks-learn-page">
      <header className="ks-learn-header">
        <div>
          <span className="eyebrow">学习 · {focusedTask?.title || projection.taskId}</span>
          <h1>{projection.objective}</h1>
        </div>
        <span className="ks-step-counter">{String(activeStepIndex + 1).padStart(2, "0")} / {String(projection.steps.length).padStart(2, "0")}</span>
      </header>

      <main className="ks-learn-stage">
        <section className="ks-learn-object">
          <div className="ks-learn-prompt">
            <span>示范题</span>
            <p>{runtime.instance.prompt}</p>
          </div>
          <div className="ks-runtime-readonly" ref={inertRef} aria-label="只读教学场景">
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
        </section>

        <aside className="ks-learn-instruction">
          <span className="ks-learn-step-label">当前动作</span>
          <h2>{activeStep.title}</h2>
          <p>{activeStep.narration}</p>
          {activeStep.actionLabel ? <div className="ks-learn-action-callout">{activeStep.actionLabel}</div> : null}

          <ol className="ks-learn-step-list">
            {projection.steps.map((step, index) => (
              <li key={step.stepId} className={index === activeStepIndex ? "current" : index < activeStepIndex ? "done" : ""}>
                <button type="button" onClick={() => setActiveStepIndex(index)}>
                  <span>{index < activeStepIndex ? "✓" : index + 1}</span>
                  <strong>{step.title}</strong>
                </button>
              </li>
            ))}
          </ol>

          <div className="ks-learn-controls">
            <button className="btn btn-ghost" type="button" disabled={!activeStepIndex} onClick={() => setActiveStepIndex((index) => index - 1)}>
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
          </div>
        </aside>
      </main>
    </div>
  );
}

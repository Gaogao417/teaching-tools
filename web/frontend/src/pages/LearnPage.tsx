import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
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
import { topicNodeByTaskId } from "../../../shared/similarityLearningMap";
import type { ExercisePlan } from "../../../shared/actionRuntime";
import { ActionRuntimeFrame } from "../action-runtime/react/ActionRuntimeFrame";
import { actionMachineRegistry } from "../action-runtime/registry";
import { TutorLearnExperience } from "./learn/TutorLearnExperience";
import type { TutorExperienceResponse } from "../../../shared/tutorExperience";

const EMPTY_DRAFT: ClientDraftState = { selections: {}, inputs: {} };
const ACTION_RUNTIME_V2_ENABLED = import.meta.env.VITE_ACTION_RUNTIME_V2 !== "false";
/** Phase 5 UI 集成：/learn/:taskId 先问 /experience；tutor 分流到 Tutor 工作台。 */
type ExperienceMode = "pending" | "tutor" | "legacy";

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
  const [searchParams] = useSearchParams();
  const restoreSessionId = searchParams.get("session") ?? undefined;
  const { focusedTask, setFocusedTaskId, studentName } = useOutletContext<WorkspaceOutletContext>();
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("pending");
  const [experienceError, setExperienceError] = useState<string | undefined>();
  const [experienceNonce, setExperienceNonce] = useState(0);
  const [tutorInitial, setTutorInitial] = useState<TutorExperienceResponse | undefined>();
  /** /experience 有副作用（创建会话）：每个 taskId+nonce 只允许问一次
   *  （StrictMode 效应双跑也不重复建会话；结果交给组件采用）。 */
  const experienceAskedRef = useRef("");
  const [projection, setProjection] = useState<LearningProjectionSpec | null>(null);
  const [actionPlan, setActionPlan] = useState<ExercisePlan | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [draft, setDraft] = useState<ClientDraftState>(EMPTY_DRAFT);
  const [topicPhase, setTopicPhase] = useState<"answering" | "correct_pause" | "wrong_feedback">("answering");
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const inertRef = useRef<HTMLDivElement | null>(null);

  // Phase 5 UI 集成：/experience 是学习入口权威——kind=tutor 分流到 Tutor
  // 工作台；kind=legacy 才装载原 LearningProjection/ActionPlan。fail-closed
  // 错误（Binding stale 等 409/403）显示错误面 + 重试，不静默回 legacy。
  useEffect(() => {
    if (!taskId) return;
    setFocusedTaskId(taskId);
    setActiveStepIndex(0);
    setDraft(EMPTY_DRAFT);
    setTopicPhase("answering");
    setExperienceMode("pending");
    setExperienceError(undefined);
    setProjection(null);
    setActionPlan(null);
  }, [setFocusedTaskId, taskId]);

  useEffect(() => {
    if (!taskId || !studentName || restoreSessionId) return;
    const askKey = `${studentName}:${taskId}:${experienceNonce}`;
    if (experienceAskedRef.current === askKey) return;
    experienceAskedRef.current = askKey;
    api.startLearnExperience(taskId, { studentId: studentName })
      .then((result) => {
        if (result.kind === "tutor") {
          setTutorInitial(result);
          setExperienceMode("tutor");
        } else {
          setExperienceMode("legacy");
        }
      })
      .catch((error: unknown) => {
        // fail closed：/experience 明确报错（409/403/…）不静默回 legacy——
        // legacy 题面可能与绑定 Question 不同，静默切换等于换题。
        setExperienceError(error instanceof Error ? error.message : String(error));
      });
  }, [studentName, taskId, restoreSessionId, experienceNonce]);

  useEffect(() => {
    if (!taskId || experienceMode !== "legacy") return;
    let cancelled = false;
    api.getLearningProjection(taskId)
      .then((result) => !cancelled && setProjection(result))
      .catch(() => !cancelled && setProjection(null));
    if (ACTION_RUNTIME_V2_ENABLED) {
      api.getLearningActionPlan(taskId)
        .then((result) => !cancelled && setActionPlan(result))
        .catch(() => !cancelled && setActionPlan(null));
    }
    return () => { cancelled = true; };
  }, [experienceMode, taskId]);

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

  if (experienceMode === "tutor" || restoreSessionId) {
    return (
      <TutorLearnExperience
        key={`${taskId}:${tutorInitial?.session_id ?? restoreSessionId ?? "restore"}`}
        taskId={taskId!}
        studentId={studentName}
        restoreSessionId={restoreSessionId}
        initial={tutorInitial}
        onLegacy={() => setExperienceMode("legacy")}
      />
    );
  }

  if (experienceError && experienceMode !== "legacy") {
    return (
      <section className="ks-state-page">
        <span className="eyebrow">学习入口</span>
        <h1>暂时无法打开这道题的一对一学习</h1>
        <p role="alert">{experienceError}</p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setExperienceError(undefined);
            setExperienceMode("pending");
            // 重新触发 /experience（studentName/taskId 不变时靠 key 重挂）。
            setExperienceNonce((nonce) => nonce + 1);
          }}
        >
          重试
        </button>
      </section>
    );
  }

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
    if (actionPlan && actionPlan.actions.every((action) => actionMachineRegistry.supports(action.kind, action.version))) {
      return (
        <div className="ks-focus-page">
          <ActionRuntimeFrame
            response={{ sessionId: `learn:${projection.taskId}`, plan: actionPlan }}
            local
            onComplete={() => {
              recordLearnCompleted(actionPlan.actions[actionPlan.actions.length - 1]?.sourceStepId);
            }}
          />
        </div>
      );
    }
    const contract = runtime.instance.scene.topicWorkspace?.contracts[runtime.runtimeState.currentStepId];
    const submitTopicStep = async (submittedPayload?: string) => {
      let value = draft.inputs["topic-answer"] || "";
      if (submittedPayload) {
        try {
          const submitted = JSON.parse(submittedPayload) as { inputs?: Record<string, string> };
          value = submitted.inputs?.["topic-answer"] || value;
        } catch {
          // The action dock and workspace both use JSON payloads; keep the live draft as a safe fallback.
        }
      }
      if (!contract || !value.trim()) return;
      let result;
      try {
        result = await api.submitLearningAction(projection.taskId, contract.id, value);
      } catch {
        setTopicPhase("wrong_feedback");
        return;
      }
      if (result.evaluation === "wrong") {
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
          onSubmit={(_stepId, value) => { void submitTopicStep(value); }}
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

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
import { ActionRuntimeFrame } from "../presentation/runtime/ActionRuntimeFrame";
import { actionMachineRegistry } from "../action-runtime/registry";
import { AcceptanceDiagnostics, type AcceptanceRouteKind } from "../presentation/acceptance/AcceptanceDiagnostics";
import { TutorLearnExperience } from "./learn/TutorLearnExperience";
import { tutorRuntimeHttp, TutorRuntimeHttpError } from "../api/tutorRuntimeClient";
import type { TutorExperienceResponse } from "../../../shared/tutorExperience";

const EMPTY_DRAFT: ClientDraftState = { selections: {}, inputs: {} };
/** F7：runtime availability（golden task + TUTOR_VNEXT_ROOT 挂载）→ LearnPage
 *  仅为 canonical TutorLearnExperience 选择 TutorRuntimeClient 数据源（不选
 *  页面、不选 UI 模式）。四态：pending 未裁定 / yes canonical / no legacy
 *  （含 vnext namespace 未挂载的 404——部署级迁移关闭）/ error 探测失败
 *  （显式错误 + 重试，不静默回落 legacy，spec §2.2）。 */
type RuntimeAvailability = "pending" | "yes" | "no" | "error";
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
  /** VS0 REQ-04：?acceptance=1 打开只读验收诊断（非生产学生功能）。 */
  const acceptanceMode = searchParams.get("acceptance") === "1";
  const { focusedTask, setFocusedTaskId, studentName } = useOutletContext<WorkspaceOutletContext>();
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>("pending");
  const [availabilityState, setRuntimeAvailability] = useState<RuntimeAvailability>("pending");
  const [availabilityTaskId, setAvailabilityTaskId] = useState<string>();
  const runtimeAvailability = availabilityTaskId === taskId ? availabilityState : "pending";
  const [availabilityError, setAvailabilityError] = useState<string | undefined>();
  const [availabilityNonce, setAvailabilityNonce] = useState(0);
  const availabilityAskedRef = useRef("");
  const [experienceError, setExperienceError] = useState<string | undefined>();
  const [experienceNonce, setExperienceNonce] = useState(0);
  /** VS0 REQ-06：tutor 尝试后回退 legacy（restore 失败重启返回 legacy）才置
   *  true；直接无 Binding 的 legacy 路由不算 fallback。 */
  const [legacyFallback, setLegacyFallback] = useState(false);
  const [tutorInitial, setTutorInitial] = useState<TutorExperienceResponse | undefined>();
  /** /experience 有副作用（创建会话）：每个 taskId+nonce 只允许问一次
   *  （StrictMode 效应双跑也不重复建会话；结果交给组件采用）。 */
  const experienceAskedRef = useRef("");
  const [projection, setProjection] = useState<LearningProjectionSpec | null>(null);
  /** VS0 REQ-03：legacy 投影加载失败（任务不存在等）→ 显式 unsupported，
   *  不用无限“正在准备示范场景”伪装。 */
  const [projectionError, setProjectionError] = useState<string | undefined>();
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
    setLegacyFallback(false);
    setProjection(null);
    setProjectionError(undefined);
    setActionPlan(null);
  }, [setFocusedTaskId, taskId]);

  // F7：runtime availability 优先裁定（golden task → canonical Runtime 数据源；
  //  只选择 client，不选择页面/UI 模式）。未裁定前不启动旧 /experience
  //  （避免建旧会话与 canonical 并存的双会话竞态）。
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    setAvailabilityTaskId(taskId);
    setRuntimeAvailability("pending");
    setAvailabilityError(undefined);
    availabilityAskedRef.current = taskId;
    tutorRuntimeHttp.availability(taskId)
      .then((result) => { if (!cancelled) setRuntimeAvailability(result.enabled ? "yes" : "no"); })
      .catch((failure: unknown) => {
        if (cancelled) return;
        // 404 = /api/vnext 未挂载（部署级迁移关闭）→ 按 route policy 进 legacy；
        // 其余失败（网络/5xx/协议漂移）显式错误，不静默回落（spec §2.2）。
        if (failure instanceof TutorRuntimeHttpError && failure.status === 404) {
          setRuntimeAvailability("no");
          return;
        }
        setAvailabilityError(failure instanceof Error ? failure.message : String(failure));
        setRuntimeAvailability("error");
      });
    return () => { cancelled = true; };
  }, [taskId, availabilityNonce]);

  useEffect(() => {
    if (!taskId || !studentName || restoreSessionId || runtimeAvailability !== "no") return;
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
  }, [studentName, taskId, restoreSessionId, experienceNonce, runtimeAvailability]);

  useEffect(() => {
    if (!taskId || experienceMode !== "legacy") return;
    let cancelled = false;
    api.getLearningProjection(taskId)
      .then((result) => {
        if (cancelled) return;
        setProjection(result);
        setProjectionError(undefined);
      })
      .catch((error: unknown) => {
        // VS0 REQ-03：legacy 投影失败（404 等）显式进入 unsupported，不用
        // 无限 loading 表达失败。
        if (!cancelled) setProjectionError(error instanceof Error ? error.message : String(error));
      });
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

  /** VS0 REQ-06：route kind 可断言（pending/tutor-vnext/legacy），供
   *  ?acceptance=1 诊断与 e2e 断言新链/legacy/失败三分。 */
  const routeKind: AcceptanceRouteKind = experienceMode === "tutor" || restoreSessionId
    ? "tutor-vnext"
    : experienceMode === "legacy" ? "legacy" : "pending";
  const diagnostics = acceptanceMode && taskId ? (
    <AcceptanceDiagnostics
      taskId={taskId}
      route={routeKind}
      fallbackOccurred={legacyFallback}
    />
  ) : null;

  // F7：availability 探测失败 → 显式错误 + 重试（不静默回 legacy；G7 验收环境
  //  TUTOR_VNEXT_ROOT 恒开，探测失败即环境故障）。
  if (runtimeAvailability === "error") {
    return (
      <section className="ks-state-page" data-testid="page-lifecycle" data-lifecycle="error">
        <span className="eyebrow">学习入口</span>
        <h1>暂时无法确认这道题的学习通道</h1>
        <p role="alert" data-testid="runtime-availability-error">{availabilityError}</p>
        <button
          className="btn btn-primary"
          type="button"
          data-testid="runtime-availability-retry"
          onClick={() => {
            setAvailabilityError(undefined);
            setRuntimeAvailability("pending");
            availabilityAskedRef.current = "";
            setAvailabilityNonce((nonce) => nonce + 1);
          }}
        >
          重试
        </button>
      </section>
    );
  }

  // F7：runtime 可用 → canonical TutorLearnExperience（注入 TutorRuntimeClient
  //  数据源；原地收敛不建新页面；fail-closed 由 hook 错误面呈现，不静默回
  //  legacy）。restore 场景必须等 availability 裁定后再分派（不乐观渲染——
  //  legacy session 不得送入 V7 restore）。
  if (taskId && studentName && runtimeAvailability === "yes") {
    return (
      <TutorLearnExperience
        key={`runtime:${taskId}:${restoreSessionId ?? "start"}`}
        taskId={taskId}
        studentId={studentName}
        restoreSessionId={restoreSessionId}
        runtimeClient={tutorRuntimeHttp}
        onLegacy={() => undefined}
      />
    );
  }

  // availability 未裁定的 restore 场景：等待分派（不创建任何会话、不猜测链路）。
  if (taskId && studentName && restoreSessionId && runtimeAvailability === "pending") {
    return (
      <section className="ks-state-page" data-testid="page-lifecycle" data-lifecycle="loading">
        <span className="eyebrow">学习会话</span>
        <h1>正在恢复学习会话</h1>
        <p>系统正在确认会话版本并恢复到你的学习位置。</p>
      </section>
    );
  }

  if (experienceMode === "tutor" || restoreSessionId) {
    return (
      // 诊断条由 TutorLearnExperience 自渲染（sessionId/revision 是它的会话事实，
      // 比本页的 pending 快照更真）——本页不重复输出第二份。
      <TutorLearnExperience
        key={`${taskId}:${tutorInitial?.session_id ?? restoreSessionId ?? "restore"}`}
        taskId={taskId!}
        studentId={studentName}
        restoreSessionId={restoreSessionId}
        initial={tutorInitial}
        acceptanceMode={acceptanceMode}
        fallbackOccurred={legacyFallback}
        onLegacy={() => {
          setLegacyFallback(true);
          setExperienceMode("legacy");
        }}
      />
    );
  }

  if (experienceError && experienceMode !== "legacy") {
    return (
      <>
        {diagnostics}
        <section className="ks-state-page" data-testid="page-lifecycle" data-lifecycle="error">
          <span className="eyebrow">学习入口</span>
          <h1>暂时无法打开这道题的一对一学习</h1>
          <p role="alert" data-testid="page-lifecycle-error-detail">{experienceError}</p>
          <button
            className="btn btn-primary"
            type="button"
            data-testid="page-lifecycle-retry"
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
      </>
    );
  }

  // VS0 REQ-03：legacy 路由投影失败 → UnsupportedContent（无 Binding 且无
  // legacy 内容 = 该 task 不支持任何学习体验）。
  if (experienceMode === "legacy" && projectionError) {
    return (
      <>
        {diagnostics}
        <section className="ks-state-page" data-testid="page-lifecycle" data-lifecycle="unsupported">
          <span className="eyebrow">学习入口</span>
          <h1>这道题暂时不支持在线学习</h1>
          <p role="alert" data-testid="page-lifecycle-unsupported-reason">{projectionError}</p>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/")}>回到任务列表</button>
        </section>
      </>
    );
  }

  if (!projection || !runtime || !activeStep) {
    return (
      <>
        {diagnostics}
        <section className="ks-state-page" data-testid="page-lifecycle" data-lifecycle="loading">
          <span className="eyebrow">学习投影</span>
          <h1>正在准备示范场景</h1>
          <p>系统正在生成一份可复用的确定性教学实例。</p>
        </section>
      </>
    );
  }

  const isLast = activeStepIndex === projection.steps.length - 1;

  if (runtime.instance.engineKind === "topic-practice") {
    if (actionPlan && actionPlan.actions.every((action) => actionMachineRegistry.supports(action.kind, action.version))) {
      return (
        <>
          {diagnostics}
          <div className="ks-focus-page" data-testid="page-lifecycle" data-lifecycle="ready">
            <ActionRuntimeFrame
              response={{ sessionId: `learn:${projection.taskId}`, plan: actionPlan }}
              local
              onComplete={() => {
                recordLearnCompleted(actionPlan.actions[actionPlan.actions.length - 1]?.sourceStepId);
              }}
            />
          </div>
        </>
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
      <>
        {diagnostics}
        <div className="ks-focus-page" data-testid="page-lifecycle" data-lifecycle="ready">
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
      </>
    );
  }

  return (
    <>
      {diagnostics}
      <div className="ks-focus-page ks-learn-page" data-testid="page-lifecycle" data-lifecycle="ready">
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
    </>
  );
}

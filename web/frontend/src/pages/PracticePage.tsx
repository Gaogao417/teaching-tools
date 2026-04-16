import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FeedbackEffectKey,
  PracticeSessionSnapshot,
  ResultSnapshot,
  TaskHistoryItem,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { findTaskPath, formatSeconds } from "../components/layout/workspaceUtils";
import { currentStep } from "./practice/runtime/sceneUtils";
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId } from "../utils/storage";
import { ExerciseRuntimeHost, GuidePanel, FeedbackController } from "./practice/ExerciseRuntimeHost";
import { PracticeEffectsLayer, usePracticeFeedback } from "./practice/feedback";

const AUTO_ADVANCE_DELAY = 700;
const CHART_LIMIT = 10;

type PracticeSession = PracticeSessionSnapshot;

function emptyDraft(): ClientDraftState {
  return {
    selections: {},
    inputs: {},
    transientFeedback: [],
  };
}

function average(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function bestFromHistory(history: TaskHistoryItem[]) {
  return history.length ? Math.min(...history.map((item) => item.elapsedMs)) : null;
}

function avgFromHistory(history: TaskHistoryItem[]) {
  return average(history.slice(-5).map((item) => item.elapsedMs));
}

function feedbackKind(runtime?: ExerciseRuntimeSpec, fallback: FeedbackEffectKey = "correct"): FeedbackEffectKey {
  const cue = runtime?.instance.feedback.correct[0]?.key;
  return cue === "wrong" || cue === "finish" || cue === "correct" ? cue : fallback;
}

export function PracticePage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: TaskId }>();
  const { studentName, requestAuth, focusedTask, tree, setTopNavContent } = useOutletContext<WorkspaceOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdFromUrl = searchParams.get("sessionId");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [draft, setDraft] = useState<ClientDraftState>(emptyDraft());
  const [modalSnapshot, setModalSnapshot] = useState<ResultSnapshot | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { effectKind, triggerFeedback, prefersReducedMotion } = usePracticeFeedback();

  const runtime = session?.runtime;
  const taskPath = useMemo(() => findTaskPath(taskId, tree), [taskId, tree]);
  const step = runtime ? currentStep(runtime) : null;
  const activeStepIndex = runtime
    ? runtime.instance.guide.stepItems.findIndex((item) => item.stepId === runtime.runtimeState.currentStepId)
    : -1;
  const currentStepNumber = activeStepIndex >= 0 ? activeStepIndex + 1 : null;

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!taskId || !studentName) {
      setSession(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const boot = async () => {
      setLoading(true);
      try {
        const historyResponse = await api.getTaskHistory(taskId, studentName, CHART_LIMIT).catch(() => null);
        if (!cancelled && historyResponse) {
          setHistory(historyResponse.items);
        }

        const restoreId = sessionIdFromUrl || getStoredSessionId(taskId);
        if (restoreId) {
          try {
            const restored = await api.restorePractice(restoreId);
            if (cancelled) return;
            setSession(restored);
            setStoredSessionId(taskId, restored.sessionId);
            if (sessionIdFromUrl !== restored.sessionId) {
              setSearchParams({ sessionId: restored.sessionId }, { replace: true });
            }
            return;
          } catch {
            clearStoredSessionId(taskId);
          }
        }

        const started = await api.startPractice(taskId, studentName);
        if (cancelled) return;
        setSession(started);
        setStoredSessionId(taskId, started.sessionId);
        setSearchParams({ sessionId: started.sessionId }, { replace: true });
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [taskId, studentName, sessionIdFromUrl, setSearchParams]);

  useEffect(() => {
    if (!session || session.phase === "group_finished") return;
    const timer = window.setInterval(() => {
      setSession((current) => {
        if (!current || current.phase === "group_finished") return current;
        return { ...current, elapsedMs: current.elapsedMs + 100 };
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [session?.sessionId, session?.phase]);

  useEffect(() => {
    setDraft(emptyDraft());
  }, [runtime?.instance.instanceId, runtime]);

  const refreshHistory = async (nextTaskId: TaskId, nextStudentName: string) => {
    const historyResponse = await api.getTaskHistory(nextTaskId, nextStudentName, CHART_LIMIT).catch(() => null);
    if (historyResponse) {
      setHistory(historyResponse.items);
    }
  };

  const startNewSession = useCallback(async () => {
    if (!taskId) return;
    if (!studentName) {
      requestAuth();
      return;
    }
    setLoading(true);
    try {
      clearStoredSessionId(taskId);
      setIsHistoryOpen(false);
      setModalSnapshot(null);
      const started = await api.startPractice(taskId, studentName);
      setSession(started);
      setDraft(emptyDraft());
      setStoredSessionId(taskId, started.sessionId);
      setSearchParams({ sessionId: started.sessionId }, { replace: true });
      await refreshHistory(taskId, studentName);
    } finally {
      setLoading(false);
    }
  }, [requestAuth, setSearchParams, studentName, taskId]);

  const scheduleAdvance = (sessionId: string) => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(async () => {
      const restored = await api.restorePractice(sessionId);
      setSession(restored);
    }, AUTO_ADVANCE_DELAY);
  };

  const finishPractice = async (currentSession: PracticeSession) => {
    const finished = await api.finishPractice(currentSession.sessionId);
    setModalSnapshot(finished.resultSnapshot);
    clearStoredSessionId(currentSession.taskId);
    await refreshHistory(currentSession.taskId, currentSession.studentName);
    triggerFeedback("finish");
  };

  const submitRuntimeAction = async (action: { type: "submit" | "clear"; stepId?: string; value?: string; targetId?: string }) => {
    const currentSession = sessionRef.current;
    const currentRuntime = currentSession?.runtime;
    if (!currentSession || !currentRuntime) return;

    const response = await api.submitRuntimeAction(currentSession.sessionId, currentRuntime.instance.instanceId, {
      type: action.type,
      stepId: action.stepId,
      value: action.value,
      targetId: action.targetId,
    });

    if (action.type === "clear") {
      setDraft(emptyDraft());
      return;
    }

    const nextSession: PracticeSession = {
      ...currentSession,
      currentIndex:
        response.phase === "correct_pause" && response.nextIndex > currentSession.currentIndex
          ? currentSession.currentIndex
          : response.nextIndex,
      phase: response.phase,
      runtime: response.runtime,
    };

    setSession(nextSession);

    if (response.evaluation === "wrong") {
      const restored = await api.restorePractice(currentSession.sessionId);
      setSession({ ...restored, phase: restored.phase, runtime: restored.runtime });
      triggerFeedback("wrong");
      return;
    }

    triggerFeedback(feedbackKind(response.runtime));

    if (response.phase === "correct_pause") {
      scheduleAdvance(currentSession.sessionId);
      return;
    }

    if (response.phase === "group_finished") {
      await finishPractice(nextSession);
      return;
    }

    const restored = await api.restorePractice(currentSession.sessionId);
    setSession(restored);
    setDraft(emptyDraft());
  };

  const practiceTopNav = useMemo(() => {
    if (!taskId || !studentName) return null;

    return (
      <div className="ks-session-header">
        <div className="ks-session-header-copy">
          <span className="ks-session-kicker">Task</span>
          <h1>{focusedTask?.title || "Preparing practice"}</h1>
        </div>

        <div className="ks-session-header-right">
          <div className="ks-session-timer-pill" aria-label="Session elapsed time">
            <span className="material-symbols-outlined">timer</span>
            <strong className="font-mono-timer">
              {loading || !session || !runtime || !step || !currentStepNumber ? "--:--" : formatSeconds(session.elapsedMs)}
            </strong>
          </div>

          <div className="ks-session-header-actions">
            <button
              className="ks-nav-action"
              type="button"
              title="View History"
              aria-pressed={isHistoryOpen}
              onClick={() => setIsHistoryOpen((current) => !current)}
            >
              <span className="material-symbols-outlined">history</span>
            </button>
            <button className="ks-nav-action" type="button" title="Back to Home" onClick={() => navigate("/")}>
              <span className="material-symbols-outlined">home</span>
            </button>
            <button className="ks-nav-action" type="button" title="Retry Session" onClick={() => void startNewSession()}>
              <span className="material-symbols-outlined">refresh</span>
            </button>
            <button className="ks-nav-action" type="button" title="Stop Session" disabled>
              <span className="material-symbols-outlined">stop_circle</span>
            </button>
          </div>
        </div>
      </div>
    );
  }, [
    focusedTask?.title,
    loading,
    navigate,
    runtime,
    session,
    startNewSession,
    studentName,
    taskId,
    isHistoryOpen,
    currentStepNumber,
    step,
  ]);

  useEffect(() => {
    setTopNavContent(practiceTopNav ? { content: practiceTopNav, tone: "practice" } : null);
  }, [practiceTopNav, setTopNavContent]);

  useEffect(() => () => setTopNavContent(null), [setTopNavContent]);

  useEffect(() => {
    setIsHistoryOpen(false);
  }, [taskId]);

  useEffect(() => {
    if (!isHistoryOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsHistoryOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isHistoryOpen]);

  if (!taskId) {
    return (
      <section className="panel workspace-panel scholar-panel">
        <div className="detail-head">
          <h2>Task not found</h2>
          <p className="text-muted">Return to the learning path and choose an available challenge.</p>
        </div>
      </section>
    );
  }

  if (!studentName) {
    return (
      <section className="panel workspace-panel workspace-lock-panel scholar-panel">
        <div className="detail-head">
          <div className="eyebrow">Training Locked</div>
          <h2>Add a student name before starting practice</h2>
          <p>The route is ready, but the app needs a student identity before it can create, restore, and save runtime sessions.</p>
        </div>
        <div className="action-row">
          <button className="btn btn-primary" type="button" onClick={requestAuth}>
            Set Student Name
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/")}>
            Back to Overview
          </button>
        </div>
      </section>
    );
  }

  if (loading || !session || !runtime) {
    return (
      <section className="panel workspace-panel scholar-panel">
        <div className="detail-head">
          <div className="eyebrow">Preparing Runtime</div>
          <h2>Loading the current practice environment</h2>
          <p className="text-muted">The app first tries to restore an active session, then creates a fresh group if nothing is in progress.</p>
        </div>
      </section>
    );
  }

  if (!step || !currentStepNumber) {
    return null;
  }

  const selectAction = step.allowedActions.find((action) => action.type === "select");
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const selected = selectAction?.type === "select" ? draft.selections[selectAction.target] || [] : [];
  const canSubmitOrderedSelection =
    selectAction?.type === "select" && selectAction.selectionKind === "ordered" ? selected.length >= 2 : true;

  return (
    <div className={`ks-practice-page practice-route effect-${effectKind || "idle"}`}>
      <PracticeEffectsLayer effectKind={effectKind} reducedMotion={prefersReducedMotion} />

      <main className="ks-practice-main">
        <div className="ks-practice-body">
          <div className="ks-practice-left">
            <section className="ks-problem-prompt-card">
              <div className="ks-problem-glow" aria-hidden="true" />
              <div className="ks-problem-content">
                <div className="ks-problem-kicker-row">
                  <span className="ks-problem-kicker">Current Prompt</span>
                  <span className="ks-problem-step-pill">Step {currentStepNumber}</span>
                </div>
                <h2>{runtime.instance.prompt}</h2>
                <p>{step.goal || runtime.instance.guide.hint || focusedTask?.summary}</p>
              </div>

              <div className="ks-problem-actions">
                <button
                  className="ks-clear-action"
                  type="button"
                  title="Clear Canvas"
                  onClick={() => void submitRuntimeAction({ type: "clear", targetId: clearAction?.target || step.id })}
                >
                  <span className="material-symbols-outlined">restart_alt</span>
                </button>

                <button className="ks-secondary-action" type="button" title="Skip Action" disabled>
                  <span className="material-symbols-outlined">skip_next</span>
                </button>

                <button
                  className="ks-submit-action"
                  type="button"
                  title="Submit Answer"
                  disabled={!submitAction || !canSubmitOrderedSelection}
                  onClick={() =>
                    submitAction &&
                    submitRuntimeAction({
                      type: "submit",
                      stepId: submitAction.stepId,
                      value: JSON.stringify({
                        selections: draft.selections,
                        inputs: draft.inputs,
                      }),
                    })
                  }
                >
                  <span className="material-symbols-outlined">check_circle</span>
                </button>
              </div>
            </section>

            <ExerciseRuntimeHost
              runtime={runtime}
              sessionPhase={session.phase}
              draft={draft}
              setDraft={setDraft}
              inputRefs={inputRefs}
              onSubmit={(action) => void submitRuntimeAction({ type: "submit", ...action })}
              onClear={(target) => void submitRuntimeAction({ type: "clear", targetId: target })}
            />
          </div>

          <GuidePanel
            runtime={runtime}
            sessionPhase={session.phase}
            taskGroup={taskPath?.chapter.name}
            taskLabel={focusedTask?.title}
          />
        </div>
      </main>

      <FeedbackController runtime={runtime} sessionPhase={session.phase} />

      {isHistoryOpen && (
        <HistoryModal
          history={history}
          taskTitle={focusedTask?.title || runtime.instance.taskId}
          studentName={studentName}
          color={focusedTask?.color || "#5148d7"}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}

      {modalSnapshot && (
        <CompletionModal
          snapshot={modalSnapshot}
          onRetry={() => void startNewSession()}
          onResult={() => navigate(`/result/${session.sessionId}`)}
        />
      )}
    </div>
  );
}

function HistoryModal({
  history,
  taskTitle,
  studentName,
  color,
  onClose,
}: {
  history: TaskHistoryItem[];
  taskTitle: string;
  studentName: string;
  color: string;
  onClose: () => void;
}) {
  const best = bestFromHistory(history);
  const avg = avgFromHistory(history);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="panel ks-history-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Practice history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ks-history-modal-head">
          <div>
            <div className="eyebrow">History</div>
            <h2>{taskTitle}</h2>
            <p className="text-muted">{studentName}'s recent results for this task.</p>
          </div>
          <button className="ks-nav-action" type="button" title="Close history" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="metric-grid ks-history-metrics">
          <div>
            <span>Total runs</span>
            <strong>{history.length || "--"}</strong>
          </div>
          <div>
            <span>Best time</span>
            <strong>{formatSeconds(best)}</strong>
          </div>
          <div>
            <span>Average</span>
            <strong>{formatSeconds(avg)}</strong>
          </div>
        </div>

        {history.length ? (
          <>
            <Chart points={history} color={color} />
            <div className="ks-history-list">
              {history.slice().reverse().map((item) => (
                <article key={item.clearedAt} className="ks-history-row">
                  <div className="ks-history-row-copy">
                    <strong>{formatSeconds(item.elapsedMs)}</strong>
                    <span>{new Date(item.clearedAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="ks-history-row-meta">
                    <span>{Math.round(item.firstTryAccuracy * 100)}% first try</span>
                    <span>{item.problemCount} problems</span>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="ks-history-empty">
            <span className="material-symbols-outlined">history</span>
            <p>No history yet for this task.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CompletionModal({
  snapshot,
  onRetry,
  onResult,
}: {
  snapshot: ResultSnapshot;
  onRetry: () => void;
  onResult: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modern-completion-modal scholar-completion-modal">
        <div className="eyebrow">Challenge Complete</div>
        <h2>{snapshot.title}</h2>
        <p>{snapshot.copy}</p>
        <div className="metric-grid">
          <div>
            <span>Session time</span>
            <strong>{formatSeconds(snapshot.elapsedMs)}</strong>
          </div>
          <div>
            <span>Best time</span>
            <strong>{formatSeconds(snapshot.bestMs)}</strong>
          </div>
          <div>
            <span>Average</span>
            <strong>{formatSeconds(snapshot.avgMs)}</strong>
          </div>
          <div>
            <span>First-try accuracy</span>
            <strong>{Math.round(snapshot.firstTryAccuracy * 100)}%</strong>
          </div>
        </div>
        <Chart points={snapshot.history} color={snapshot.color} />
        <div className="action-row">
          <button className="btn btn-secondary" type="button" onClick={onRetry}>
            Practice Again
          </button>
          <button className="btn btn-primary" type="button" onClick={onResult}>
            View Result
          </button>
        </div>
      </div>
    </div>
  );
}

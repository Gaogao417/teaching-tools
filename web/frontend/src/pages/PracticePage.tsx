import { useEffect, useRef, useState } from "react";
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
import { formatSeconds } from "../components/layout/workspaceUtils";
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId } from "../utils/storage";
import { ExerciseRuntimeHost } from "./practice/ExerciseRuntimeHost";
import { PracticeEffectsLayer, usePracticeFeedback } from "./practice/feedback";

const AUTO_ADVANCE_DELAY = 700;
const CHART_LIMIT = 10;

type PracticeSession = PracticeSessionSnapshot;

type FeedbackState = {
  tone: "idle" | "success" | "error";
  title: string;
  body: string;
};

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

function accuracyDots(attempts: number) {
  const filled = Math.max(1, Math.min(5, 5 - attempts));
  return Array.from({ length: 5 }, (_, index) => index < filled);
}

export function PracticePage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: TaskId }>();
  const { studentName, requestAuth } = useOutletContext<WorkspaceOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdFromUrl = searchParams.get("sessionId");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [draft, setDraft] = useState<ClientDraftState>(emptyDraft());
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: "idle",
    title: "Active Challenge",
    body: "Complete the current runtime step from the main workspace.",
  });
  const [modalSnapshot, setModalSnapshot] = useState<ResultSnapshot | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { effectKind, triggerFeedback, prefersReducedMotion } = usePracticeFeedback();

  const runtime = session?.runtime;

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
    setFeedback((current) => {
      if (!runtime || current.tone !== "success") return current;
      return {
        tone: "idle",
        title: "Active Challenge",
        body: runtime.instance.guide.hint || runtime.instance.prompt,
      };
    });
  }, [runtime?.instance.instanceId, runtime]);

  const refreshHistory = async (nextTaskId: TaskId, nextStudentName: string) => {
    const historyResponse = await api.getTaskHistory(nextTaskId, nextStudentName, CHART_LIMIT).catch(() => null);
    if (historyResponse) {
      setHistory(historyResponse.items);
    }
  };

  const startNewSession = async () => {
    if (!taskId) return;
    if (!studentName) {
      requestAuth();
      return;
    }
    setLoading(true);
    try {
      clearStoredSessionId(taskId);
      setModalSnapshot(null);
      const started = await api.startPractice(taskId, studentName);
      setSession(started);
      setDraft(emptyDraft());
      setStoredSessionId(taskId, started.sessionId);
      setSearchParams({ sessionId: started.sessionId }, { replace: true });
      await refreshHistory(taskId, studentName);
      setFeedback({
        tone: "idle",
        title: "Active Challenge",
        body: "A fresh challenge group is now active.",
      });
    } finally {
      setLoading(false);
    }
  };

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
    setFeedback({
      tone: "success",
      title: "Challenge Complete",
      body: "The result snapshot is ready in the same runtime workspace.",
    });
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
      setFeedback({
        tone: "idle",
        title: "Canvas Cleared",
        body: "The workspace draft was reset while the session stayed active.",
      });
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
      setFeedback({
        tone: "error",
        title: "Try Again",
        body: response.runtime?.instance.guide.hint || "Review the current guide step and adjust the input in the canvas.",
      });
      triggerFeedback("wrong");
      return;
    }

    setFeedback({
      tone: "success",
      title: response.phase === "answering" ? "Step Solved" : "Answer Accepted",
      body:
        response.phase === "correct_pause"
          ? "The runtime is advancing to the next prompt."
          : response.phase === "group_finished"
            ? "The active challenge group is complete."
            : "Continue in the workspace to finish the next step.",
    });
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

  const dots = accuracyDots(runtime?.runtimeState.attempts || 0);

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

  return (
    <div className={`ks-practice-page practice-route effect-${effectKind || "idle"}`}>
      <PracticeEffectsLayer effectKind={effectKind} reducedMotion={prefersReducedMotion} />

      <header className="ks-session-subbar">
        <div className="ks-session-subbar-left">
          <div className="ks-session-timer">
            <span className="material-symbols-outlined">timer</span>
            <span className="font-mono-timer">{formatSeconds(session.elapsedMs)}</span>
          </div>
          <div className="ks-session-divider" />
          <div className="ks-session-accuracy">
            <span>Accuracy</span>
            <div className="ks-accuracy-dots">
              {dots.map((filled, index) => (
                <div key={index} className={`ks-accuracy-dot ${filled ? "filled" : ""}`} />
              ))}
            </div>
          </div>
        </div>

        <div className="ks-session-subbar-right">
          <span className="ks-session-task-label">{runtime.instance.taskId}</span>
          <span className="ks-session-badge">{feedback.title}</span>
        </div>
      </header>

      <main className="ks-practice-main">
        <div className="ks-practice-column">
          <section className="ks-problem-prompt-card">
            <div className="ks-problem-glow" aria-hidden="true" />
            <h2>
              Solve the active runtime prompt for <span>c</span>.
            </h2>
            <p>
              {runtime.instance.prompt} Use the guided workflow on the right and the workspace below to submit the current answer.
              <span className="ks-inline-formula-note"> a² + b² = c² </span>
            </p>
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
      </main>

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

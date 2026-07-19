import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FeedbackEffectKey,
  PracticeSessionSnapshot,
  TaskHistoryItem,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { formatSeconds } from "../components/layout/workspaceUtils";
import { currentStep } from "./practice/runtime/sceneUtils";
import { clearStoredSessionId, getStoredSessionId, setStoredSessionId } from "../utils/storage";
import { ExerciseRuntimeHost, GuideHUD, FeedbackController } from "./practice/ExerciseRuntimeHost";
import { RuntimeActionDock } from "./practice/runtime/RuntimeActionDock";
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
  const { studentName, requestAuth, focusedTask, setTopNavContent, setNavigationGuard } = useOutletContext<WorkspaceOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdFromUrl = searchParams.get("sessionId");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [draft, setDraft] = useState<ClientDraftState>(emptyDraft());
  const advanceTimer = useRef<number | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { effectKind, triggerFeedback, prefersReducedMotion } = usePracticeFeedback();

  const runtime = session?.runtime;
  const step = runtime ? currentStep(runtime) : null;
  const activeStepIndex = runtime
    ? runtime.instance.guide.stepItems.findIndex((item) => item.stepId === runtime.runtimeState.currentStepId)
    : -1;
  const currentStepNumber = activeStepIndex >= 0 ? activeStepIndex + 1 : null;
  const hasDraft = useMemo(
    () => Object.values(draft.inputs).some((value) => value.trim()) || Object.values(draft.selections).some((value) => value.length),
    [draft],
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!hasDraft) {
      setNavigationGuard(null);
      return;
    }
    const guard = () => window.confirm("当前答案尚未提交，离开后将丢失这部分草稿。确定离开吗？");
    setNavigationGuard(guard);
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      setNavigationGuard(null);
    };
  }, [hasDraft, setNavigationGuard]);

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
    clearStoredSessionId(currentSession.taskId);
    await refreshHistory(currentSession.taskId, currentSession.studentName);
    window.setTimeout(() => {
      navigate(`/review/${currentSession.taskId}?sessionId=${finished.resultSnapshot.sessionId}`, { replace: true });
    }, AUTO_ADVANCE_DELAY);
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
      <div className="ks-practice-session-tools">
        <button
          className="ks-nav-action"
          type="button"
          title="查看训练历史"
          aria-pressed={isHistoryOpen}
          onClick={() => setIsHistoryOpen((current) => !current)}
        >
          <span className="material-symbols-outlined">history</span>
        </button>
      </div>
    );
  }, [
    loading,
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
      <section className="panel workspace-panel">
        <div className="detail-head">
          <h2>没有找到这项学习内容</h2>
          <p className="text-muted">请返回学习模式并重新选择内容。</p>
        </div>
      </section>
    );
  }

  if (!studentName) {
    return (
      <section className="panel workspace-panel workspace-lock-panel">
        <div className="detail-head">
          <div className="eyebrow">训练尚未开始</div>
          <h2>设置学生姓名后再开始训练</h2>
          <p>学生身份用于保存未完成的训练和之后的复盘记录。</p>
        </div>
        <div className="action-row">
          <button className="btn btn-primary" type="button" onClick={requestAuth}>
            设置学生姓名
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate(`/learn/${taskId}`)}>
            返回学习
          </button>
        </div>
      </section>
    );
  }

  if (loading || !session || !runtime) {
    return (
      <section className="panel workspace-panel">
        <div className="detail-head">
          <div className="eyebrow">正在准备训练</div>
          <h2>正在恢复当前进度</h2>
          <p className="text-muted">如果没有未完成记录，系统会创建一组新题。</p>
        </div>
      </section>
    );
  }

  if (!step || !currentStepNumber) {
    return null;
  }

  const solvedCount = Math.min(
    session.instanceCount,
    session.currentIndex + (session.phase === "correct_pause" || session.phase === "group_finished" ? 1 : 0),
  );

  return (
    <div className={`ks-practice-page practice-route effect-${effectKind || "idle"}`}>
      <PracticeEffectsLayer effectKind={effectKind} reducedMotion={prefersReducedMotion} />

      <main className="ks-practice-main">
        <header className="ks-practice-hud">
          <div className="ks-practice-progress-copy">
            <strong>{String(session.currentIndex + 1).padStart(2, "0")} / {String(session.instanceCount).padStart(2, "0")}</strong>
            <span>当前题目</span>
          </div>
          <div className="ks-practice-hud-stats">
            <span><strong>{solvedCount}</strong> 正确</span>
            <span><strong>{session.instanceCount - solvedCount}</strong> 剩余</span>
            <span className="font-mono-timer"><strong>{formatSeconds(session.elapsedMs)}</strong></span>
          </div>
          <div className="ks-practice-hud-actions">
            <button type="button" onClick={() => (!hasDraft || window.confirm("重置会清空当前草稿并开始一组新题，确定继续吗？")) && void startNewSession()}><span className="material-symbols-outlined">restart_alt</span>重置</button>
            <button type="button" onClick={() => (!hasDraft || window.confirm("当前答案尚未提交，确定退出训练吗？")) && navigate(`/learn/${session.taskId}`)}><span className="material-symbols-outlined">close</span>退出</button>
          </div>
        </header>

        <section className="ks-runtime-stage">
          <div className="ks-prompt-line">
            <span>题目</span>
            <div><h1>{runtime.instance.prompt}</h1><p>{step.goal}</p></div>
            <small>步骤 {currentStepNumber}</small>
          </div>

          <div className="ks-runtime-stage-canvas">
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
          <GuideHUD runtime={runtime} sessionPhase={session.phase} />
        </section>

        <RuntimeActionDock
          runtime={runtime}
          draft={draft}
          disabled={session.phase === "correct_pause" || session.phase === "group_finished"}
          onClear={(target) => void submitRuntimeAction({ type: "clear", targetId: target })}
          onSubmit={(stepId, value) => void submitRuntimeAction({ type: "submit", stepId, value })}
        />
      </main>

      <FeedbackController runtime={runtime} sessionPhase={session.phase} />

      {isHistoryOpen && (
        <HistoryModal
          history={history}
          taskTitle={focusedTask?.title || runtime.instance.taskId}
          studentName={studentName}
          color={focusedTask?.color || "#1F64FF"}
          onClose={() => setIsHistoryOpen(false)}
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
        <div className="eyebrow">训练历史</div>
            <h2>{taskTitle}</h2>
            <p className="text-muted">{studentName} 在当前内容上的最近训练。</p>
          </div>
          <button className="ks-nav-action" type="button" title="Close history" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="metric-grid ks-history-metrics">
          <div>
            <span>训练次数</span>
            <strong>{history.length || "--"}</strong>
          </div>
          <div>
            <span>最佳用时</span>
            <strong>{formatSeconds(best)}</strong>
          </div>
          <div>
            <span>平均用时</span>
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
                    <span>首次正确 {Math.round(item.firstTryAccuracy * 100)}%</span>
                    <span>{item.problemCount} 题</span>
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

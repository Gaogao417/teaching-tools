import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FeedbackEffectKey,
  Problem,
  ResultSnapshot,
  Side,
  TaskHistoryItem,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import { clearStoredSessionId, getStoredSessionId, getStudentName, setStoredSessionId } from "../utils/storage";
import { PracticeEffectsLayer, usePracticeFeedback } from "./practice/feedback";
import { ExerciseRuntimeHost } from "./practice/ExerciseRuntimeHost";

const AUTO_ADVANCE_DELAY = 700;
const CHART_LIMIT = 10;
const TASK_COLOR: Record<TaskId, string> = {
  meaning: "#b85c38",
  ratioToSide: "#1f8a70",
  guidedSolve: "#d97706",
};

type PracticeSession = {
  sessionId: string;
  taskId: TaskId;
  studentName: string;
  problems: Problem[];
  currentIndex: number;
  elapsedMs: number;
  phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  runtime?: ExerciseRuntimeSpec;
};

function emptyDraft(): ClientDraftState {
  return {
    selections: {},
    inputs: {},
    transientFeedback: [],
  };
}

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
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

function taskOrderLabel(taskId: TaskId) {
  if (taskId === "meaning") return "第 1 组";
  if (taskId === "ratioToSide") return "第 2 组";
  return "第 3 组";
}

function feedbackKind(runtime?: ExerciseRuntimeSpec, fallback: FeedbackEffectKey = "correct"): FeedbackEffectKey {
  const cue = runtime?.instance.feedback.correct[0]?.key;
  return cue === "wrong" || cue === "finish" || cue === "correct" ? cue : fallback;
}

export function PracticePage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: TaskId }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [draft, setDraft] = useState<ClientDraftState>(emptyDraft());
  const [feedback, setFeedback] = useState<{ tone: "idle" | "success" | "error"; title: string; body: string }>({
    tone: "idle",
    title: "准备开始",
    body: "左侧负责操作，右侧负责引导。",
  });
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);
  const [modalSnapshot, setModalSnapshot] = useState<ResultSnapshot | null>(null);
  const advanceTimer = useRef<number | null>(null);
  const sessionRef = useRef<PracticeSession | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const { effectKind, triggerFeedback, prefersReducedMotion } = usePracticeFeedback();

  const problem = session ? session.problems[session.currentIndex] ?? null : null;
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
    const studentName = getStudentName();
    if (!taskId || !studentName) {
      navigate("/");
      return;
    }

    const sessionIdFromUrl = searchParams.get("sessionId");
    const stored = getStoredSessionId(taskId);
    const restoreId = sessionIdFromUrl || stored;

    const boot = async () => {
      setLoading(true);
      try {
        const historyResponse = await api.getTaskHistory(taskId, studentName, CHART_LIMIT).catch(() => null);
        if (historyResponse) {
          setHistory(historyResponse.items);
        }

        if (restoreId) {
          const restored = await api.restorePractice(restoreId);
          setSession({ ...restored, phase: restored.phase, runtime: restored.runtime });
          setStoredSessionId(taskId, restored.sessionId);
          setSearchParams({ sessionId: restored.sessionId }, { replace: true });
          return;
        }

        const started = await api.startPractice(taskId, studentName);
        setSession({
          ...started,
          currentIndex: 0,
          elapsedMs: 0,
          phase: "answering",
          runtime: started.runtime,
        });
        setStoredSessionId(taskId, started.sessionId);
        setSearchParams({ sessionId: started.sessionId }, { replace: true });
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, [navigate, searchParams, setSearchParams, taskId]);

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
    setHoveredSide(null);
  }, [problem?.id]);

  const refreshHistory = async (nextTaskId: TaskId, studentName: string) => {
    const historyResponse = await api.getTaskHistory(nextTaskId, studentName, CHART_LIMIT).catch(() => null);
    if (historyResponse) {
      setHistory(historyResponse.items);
    }
  };

  const startNewSession = async () => {
    if (!taskId) return;
    const studentName = getStudentName();
    if (!studentName) {
      navigate("/");
      return;
    }
    setLoading(true);
    try {
      clearStoredSessionId(taskId);
      setModalSnapshot(null);
      const started = await api.startPractice(taskId, studentName);
      setSession({
        ...started,
        currentIndex: 0,
        elapsedMs: 0,
        phase: "answering",
        runtime: started.runtime,
      });
      setDraft(emptyDraft());
      setStoredSessionId(taskId, started.sessionId);
      setSearchParams({ sessionId: started.sessionId }, { replace: true });
      await refreshHistory(taskId, studentName);
      setFeedback({ tone: "idle", title: "已重新开始", body: "新一组题目已生成。" });
    } finally {
      setLoading(false);
    }
  };

  const scheduleAdvance = (sessionId: string) => {
    if (advanceTimer.current) window.clearTimeout(advanceTimer.current);
    advanceTimer.current = window.setTimeout(async () => {
      const restored = await api.restorePractice(sessionId);
      setSession({ ...restored, phase: restored.phase, runtime: restored.runtime });
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
      title: "本组已完成",
      body: "成绩面板已生成，可继续练习或查看详细结果。",
    });
  };

  const submitRuntimeAction = async (action: { type: "submit" | "clear"; stepId?: string; value?: string; targetId?: string }) => {
    const currentSession = sessionRef.current;
    const currentProblem = currentSession ? currentSession.problems[currentSession.currentIndex] : null;
    if (!currentSession || !currentProblem) return;

    const response = await api.submitRuntimeAction(currentSession.sessionId, currentProblem.id, {
      type: action.type,
      stepId: action.stepId,
      value: action.value,
      targetId: action.targetId,
    });

    if (action.type === "clear") {
      setDraft(emptyDraft());
      setFeedback({ tone: "idle", title: "已清空", body: "左侧草稿已清空。" });
      return;
    }

    const nextSession: PracticeSession = {
      ...currentSession,
      problems: currentSession.problems,
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
        title: "再试一次",
        body: response.runtime?.instance.guide.hint || "回到左侧再检查一步。",
      });
      triggerFeedback("wrong");
      return;
    }

    setFeedback({
      tone: "success",
      title: response.phase === "answering" ? "当前步骤正确" : "回答正确",
      body:
        response.phase === "correct_pause"
          ? "左侧操作已正确，稍后自动进入下一题。"
          : response.phase === "group_finished"
            ? "本组已完成。"
            : "继续在左侧完成下一步。",
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
    setSession({ ...restored, phase: restored.phase, runtime: restored.runtime });
    setDraft(emptyDraft());
  };

  const currentProgress = session ? `${session.currentIndex + 1} / ${session.problems.length}` : "--";
  const historyPoints = history.map((item) => ({ elapsedMs: item.elapsedMs, clearedAt: item.clearedAt }));
  const bestMs = bestFromHistory(history);
  const avgMs = avgFromHistory(history);

  if (loading || !session || !problem || !runtime) {
    return (
      <div className="page-shell">
        <section className="panel">加载中…</section>
      </div>
    );
  }

  return (
    <div className={`page-shell practice-route effect-${effectKind || "idle"}`}>
      <section className="panel practice-port-shell">
        <PracticeEffectsLayer effectKind={effectKind} reducedMotion={prefersReducedMotion} />
        <div className="practice-modern-shell">
          <header className="practice-modern-topbar">
            <div className="practice-modern-actions">
              <button className="ghost-btn" type="button" onClick={() => navigate("/")}>
                返回首页
              </button>
              <button className="secondary-btn" type="button" onClick={() => void startNewSession()}>
                重新开始本组
              </button>
            </div>

            <div className="practice-modern-progress">
              <div className="practice-modern-progress-head">
                <div>
                  <div className="eyebrow">{taskOrderLabel(session.taskId)}</div>
                  <h1>{runtime.instance.guide.banner}</h1>
                </div>
                <div className="practice-modern-progress-copy">第 {currentProgress} 题</div>
              </div>
              <div className="practice-modern-dots" aria-hidden="true">
                {session.problems.map((item, index) => {
                  const cls =
                    index < session.currentIndex ? "done" : index === session.currentIndex ? "active" : "pending";
                  return <span key={item.id} className={`practice-modern-dot ${cls}`} />;
                })}
              </div>
              <div className="practice-modern-mini-stats">
                <article className="practice-modern-stat">
                  <span>当前耗时</span>
                  <strong>{formatSeconds(session.elapsedMs)}</strong>
                </article>
                <article className="practice-modern-stat">
                  <span>本组最佳</span>
                  <strong>{formatSeconds(bestMs)}</strong>
                </article>
                <article className="practice-modern-stat">
                  <span>最近平均</span>
                  <strong>{formatSeconds(avgMs)}</strong>
                </article>
              </div>
            </div>
          </header>

          <div className="practice-modern-main">
            <ExerciseRuntimeHost
              problem={problem}
              runtime={runtime}
              sessionPhase={session.phase}
              draft={draft}
              setDraft={setDraft}
              inputRefs={inputRefs}
              hoveredSide={hoveredSide}
              onHoverSide={setHoveredSide}
              onSubmit={(action) => void submitRuntimeAction({ type: "submit", ...action })}
              onClear={(target) => void submitRuntimeAction({ type: "clear", targetId: target })}
            />
          </div>

          <div className="practice-modern-bottom">
            <div className={`practice-feedback-card ${feedback.tone}`}>
              <strong>{feedback.title}</strong>
              <p>{feedback.body}</p>
              <span className={`practice-inline-status ${feedback.tone}`}>{runtime.instance.guide.hint}</span>
            </div>

            <div className="practice-coach-card">
              <div className="practice-section-head">
                <strong>提示</strong>
                <span>下一步提示</span>
              </div>
              <p>{runtime.instance.guide.hint || runtime.instance.prompt}</p>
            </div>

            <div className="practice-history-card">
              <div className="practice-section-head">
                <strong>耗时折线</strong>
                <span>最近 {Math.min(history.length, CHART_LIMIT)} 次记录</span>
              </div>
              <Chart points={historyPoints} color={TASK_COLOR[session.taskId]} />
            </div>
          </div>
        </div>
      </section>

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
      <div className="modern-completion-modal">
        <div className="eyebrow">本组完成</div>
        <h2>{snapshot.title}</h2>
        <p>{snapshot.copy}</p>
        <div className="metric-grid">
          <div><span>本次耗时</span><strong>{formatSeconds(snapshot.elapsedMs)}</strong></div>
          <div><span>本组最佳</span><strong>{formatSeconds(snapshot.bestMs)}</strong></div>
          <div><span>最近平均</span><strong>{formatSeconds(snapshot.avgMs)}</strong></div>
          <div><span>首次正确率</span><strong>{Math.round(snapshot.firstTryAccuracy * 100)}%</strong></div>
        </div>
        <Chart points={snapshot.history} color={snapshot.color} />
        <div className="action-row">
          <button className="secondary-btn" type="button" onClick={onRetry}>
            再练一组
          </button>
          <button className="primary-btn" type="button" onClick={onResult}>
            查看详细结果
          </button>
        </div>
      </div>
    </div>
  );
}

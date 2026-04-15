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
  const { studentName, requestAuth } = useOutletContext<WorkspaceOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const sessionIdFromUrl = searchParams.get("sessionId");
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [draft, setDraft] = useState<ClientDraftState>(emptyDraft());
  const [feedback, setFeedback] = useState<FeedbackState>({
    tone: "idle",
    title: "准备开始",
    body: "左侧负责操作，右侧负责引导。",
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
        title: "继续作答",
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
      setFeedback({ tone: "idle", title: "已重新开始", body: "新的一组题目已经生成。" });
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
      title: "本组已完成",
      body: "结果层已经生成，你可以继续训练或查看详细结果。",
    });
  };

  const submitRuntimeAction = async (action: { type: "submit" | "clear"; stepId?: string; value?: string; targetId?: string }) => {
    const currentSession = sessionRef.current;
    const currentRuntime = currentSession?.runtime;
    if (!currentSession || !currentRuntime) return;

    const response = await api.submitRuntimeAction(
      currentSession.sessionId,
      currentRuntime.instance.instanceId,
      {
        type: action.type,
        stepId: action.stepId,
        value: action.value,
        targetId: action.targetId,
      },
    );

    if (action.type === "clear") {
      setDraft(emptyDraft());
      setFeedback({ tone: "idle", title: "已清空", body: "左侧草稿已经清空。" });
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
          ? "左侧操作已经正确，稍后自动进入下一题。"
          : response.phase === "group_finished"
            ? "本组已经完成。"
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
    setSession(restored);
    setDraft(emptyDraft());
  };

  const currentProgress = session ? `${session.currentIndex + 1} / ${session.instanceCount}` : "--";
  const bestMs = bestFromHistory(history);
  const avgMs = avgFromHistory(history);

  if (!taskId) {
    return (
      <section className="panel workspace-panel">
        <div className="detail-head">
          <h2>未找到训练任务</h2>
          <p className="text-muted">请先从左侧导航树选择一个任务。</p>
        </div>
      </section>
    );
  }

  if (!studentName) {
    return (
      <section className="panel workspace-panel workspace-lock-panel">
        <div className="detail-head">
          <div className="eyebrow">Training Locked</div>
          <h2>填写姓名后才能开始或恢复训练</h2>
          <p>当前任务链接已经就绪，但系统还不能记录你的历史和 session。输入姓名后，这个工作区会直接恢复到可训练状态。</p>
        </div>
        <div className="action-row">
          <button className="btn btn-primary" type="button" onClick={requestAuth}>
            现在填写姓名
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => navigate("/")}>
            回到任务概览
          </button>
        </div>
      </section>
    );
  }

  if (loading || !session || !runtime) {
    return (
      <section className="panel workspace-panel">
        <div className="detail-head">
          <h2>正在准备训练环境</h2>
          <p className="text-muted">系统会优先尝试恢复进行中的 session，否则自动生成一组新题。</p>
        </div>
      </section>
    );
  }

  return (
    <div className={`workspace-route-panel practice-route effect-${effectKind || "idle"}`}>
      <div className="practice-progress-track" aria-hidden="true">
        <div
          className="practice-progress-fill"
          style={{ width: `${session ? (session.currentIndex / session.instanceCount) * 100 : 0}%` }}
        />
      </div>

      <section className="practice-port-shell">
        <PracticeEffectsLayer effectKind={effectKind} reducedMotion={prefersReducedMotion} />

        <div className="practice-immersive-shell">
          <header className="practice-ambient-topbar">
            <div className="practice-ambient-left">
              <button className="btn btn-ghost btn-circle" type="button" onClick={() => navigate("/")} title="回到任务概览">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </button>
              <button className="btn btn-ghost btn-circle" type="button" onClick={() => void startNewSession()} title="重新开始本组">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </button>
            </div>

            <div className="practice-ambient-right" aria-label="练习状态">
              <div className="stat-pill-group">
                <span className="stat-pill-main">进度 <strong>{currentProgress}</strong></span>
                <span className="stat-pill-sub">{formatSeconds(session.elapsedMs)}</span>
              </div>
            </div>
          </header>

          <div className="practice-immersive-main">
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
          <div>
            <span>本次耗时</span>
            <strong>{formatSeconds(snapshot.elapsedMs)}</strong>
          </div>
          <div>
            <span>本组最佳</span>
            <strong>{formatSeconds(snapshot.bestMs)}</strong>
          </div>
          <div>
            <span>最近平均</span>
            <strong>{formatSeconds(snapshot.avgMs)}</strong>
          </div>
          <div>
            <span>首次正确率</span>
            <strong>{Math.round(snapshot.firstTryAccuracy * 100)}%</strong>
          </div>
        </div>
        <Chart points={snapshot.history} color={snapshot.color} />
        <div className="action-row">
          <button className="btn btn-secondary" type="button" onClick={onRetry}>
            再练一组
          </button>
          <button className="btn btn-primary" type="button" onClick={onResult}>
            查看详细结果
          </button>
        </div>
      </div>
    </div>
  );
}

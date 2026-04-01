import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AnswerPayload,
  GuidedSolveProblem,
  Problem,
  Role,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import { TriangleStage } from "../components/TriangleStage";
import { clearStoredSessionId, getStoredSessionId, getStudentName, setStoredSessionId } from "../utils/storage";

const AUTO_ADVANCE_DELAY = 700;

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

type LocalState = {
  numeratorRole: Role | "";
  denominatorRole: Role | "";
  placements: Record<"AB" | "BC" | "AC", string>;
  guidedRatio: Record<string, string>;
  guidedThird: string;
  guidedFinal: { numerator: string; denominator: string };
};

const emptyLocalState: LocalState = {
  numeratorRole: "",
  denominatorRole: "",
  placements: { AB: "", BC: "", AC: "" },
  guidedRatio: {},
  guidedThird: "",
  guidedFinal: { numerator: "", denominator: "" },
};

export function PracticePage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: TaskId }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [session, setSession] = useState<{
    sessionId: string;
    taskId: TaskId;
    studentName: string;
    problems: Problem[];
    currentIndex: number;
    elapsedMs: number;
    phase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  } | null>(null);
  const [feedback, setFeedback] = useState("");
  const [loading, setLoading] = useState(true);
  const [localState, setLocalState] = useState<LocalState>(emptyLocalState);
  const [modalSnapshot, setModalSnapshot] = useState<null | Awaited<ReturnType<typeof api.finishPractice>>["resultSnapshot"]>(null);
  const advanceTimer = useRef<number | null>(null);

  useEffect(() => {
    const studentName = getStudentName();
    if (!studentName || !taskId) {
      navigate("/");
      return;
    }
    const sessionIdFromUrl = searchParams.get("sessionId");
    const stored = getStoredSessionId(taskId);
    const restoreId = sessionIdFromUrl || stored;

    const boot = async () => {
      setLoading(true);
      try {
        if (restoreId) {
          const restored = await api.restorePractice(restoreId);
          setSession(restored);
          setStoredSessionId(taskId, restored.sessionId);
          setSearchParams({ sessionId: restored.sessionId }, { replace: true });
        } else {
          const started = await api.startPractice(taskId, studentName);
          setSession({ ...started, currentIndex: 0, elapsedMs: 0, phase: "answering" });
          setStoredSessionId(taskId, started.sessionId);
          setSearchParams({ sessionId: started.sessionId }, { replace: true });
        }
      } finally {
        setLoading(false);
      }
    };

    void boot();
  }, [navigate, searchParams, setSearchParams, taskId]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) {
        window.clearTimeout(advanceTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!session || session.phase === "group_finished") return;
    const timer = window.setInterval(() => {
      setSession((current) =>
        current
          ? {
              ...current,
              elapsedMs: current.elapsedMs + 100,
            }
          : current,
      );
    }, 100);
    return () => window.clearInterval(timer);
  }, [session?.sessionId, session?.phase]);

  const problem = useMemo(() => {
    if (!session) return null;
    return session.problems[session.currentIndex] || null;
  }, [session]);

  useEffect(() => {
    setLocalState(emptyLocalState);
  }, [problem?.id]);

  const handleRoleClick = (role: Role) => {
    if (!problem || problem.type !== "meaning") return;
    if (!localState.numeratorRole) {
      setLocalState((current) => ({ ...current, numeratorRole: role }));
      return;
    }
    if (!localState.denominatorRole) {
      const payload: AnswerPayload = {
        type: "meaning",
        numeratorRole: localState.numeratorRole,
        denominatorRole: role,
      };
      void submit(payload);
    }
  };

  const submit = async (payload: AnswerPayload) => {
    if (!session || !problem) return;
    const response = await api.submitAnswer(session.sessionId, problem.id, payload);
    const nextProblems = session.problems.map((item) => (item.id === response.problemState.id ? response.problemState : item));
    setSession((current) =>
      current
        ? {
            ...current,
            problems: nextProblems,
            currentIndex: response.phase === "correct_pause" && !response.allSolved ? current.currentIndex : response.nextIndex,
            phase: response.phase,
          }
        : current,
    );
    setFeedback(response.correct ? "回答正确" : response.hint || "请再试一次");
    if (response.phase === "correct_pause") {
      advanceTimer.current = window.setTimeout(async () => {
        const restored = await api.restorePractice(session.sessionId);
        setSession(restored);
      }, AUTO_ADVANCE_DELAY);
    }
    if (response.phase === "group_finished") {
      const finished = await api.finishPractice(session.sessionId);
      setModalSnapshot(finished.resultSnapshot);
      clearStoredSessionId(session.taskId);
    }
  };

  const submitRatio = () => {
    void submit({
      type: "ratioToSide",
      placements: localState.placements,
    });
  };

  const submitGuided = (stepKey: "ratio" | "third" | "final") => {
    if (stepKey === "ratio") {
      void submit({
        type: "guidedSolve",
        stepKey,
        value: localState.guidedRatio,
      });
      return;
    }
    if (stepKey === "third") {
      void submit({
        type: "guidedSolve",
        stepKey,
        value: { third: localState.guidedThird },
      });
      return;
    }
    void submit({
      type: "guidedSolve",
      stepKey,
      value: localState.guidedFinal,
    });
  };

  if (loading || !session || !problem) {
    return <div className="page-shell"><section className="panel">加载中…</section></div>;
  }

  const progress = `${session.currentIndex + 1} / ${session.problems.length}`;

  return (
    <div className="page-shell">
      <section className="panel practice-panel">
        <div className="practice-topbar">
          <div>
            <div className="eyebrow">{session.studentName}</div>
            <h1>{problem.type === "meaning" ? "第 1 组" : problem.type === "ratioToSide" ? "第 2 组" : "第 3 组"}</h1>
          </div>
          <div className="top-stats">
            <span>题号 {progress}</span>
            <span>状态 {session.phase}</span>
            <span>耗时 {formatSeconds(session.elapsedMs)}</span>
          </div>
        </div>

        <div className="practice-layout">
          <div className="canvas-card">
            <div className="action-banner">{feedback || "先观察题目，再开始作答。"}</div>
            <TriangleStage problem={problem} onRoleClick={handleRoleClick} />
          </div>

          <div className="panel-side">
            {problem.type === "meaning" && (
              <div className="question-stage">
                <h2>求 {problem.target.toUpperCase()} {problem.referenceAngle}</h2>
                <div className="fraction-card">
                  <div>{localState.numeratorRole || "分子边 ?"}</div>
                  <div className="fraction-bar" />
                  <div>{localState.denominatorRole || "分母边 ?"}</div>
                </div>
                <p className="muted-copy">点击三角形边，按顺序选择分子边和分母边。</p>
              </div>
            )}

            {problem.type === "ratioToSide" && (
              <div className="question-stage">
                <h2>
                  {problem.target.toUpperCase()} {problem.referenceAngle} = {problem.ratio.numerator}/{problem.ratio.denominator}
                </h2>
                <div className="input-grid">
                  {problem.ui.edges.map((edge) => (
                    <label key={edge}>
                      <span>{edge}</span>
                      <input
                        value={localState.placements[edge]}
                        onChange={(event) =>
                          setLocalState((current) => ({
                            ...current,
                            placements: { ...current.placements, [edge]: event.target.value },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <button className="primary-btn" type="button" onClick={submitRatio}>
                  提交答案
                </button>
              </div>
            )}

            {problem.type === "guidedSolve" && (
              <GuidedPanel problem={problem} localState={localState} setLocalState={setLocalState} submitGuided={submitGuided} />
            )}
          </div>
        </div>
      </section>

      {modalSnapshot && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="eyebrow">本组完成</div>
            <h2>{modalSnapshot.title}</h2>
            <p>{modalSnapshot.copy}</p>
            <div className="metric-grid">
              <div><span>本次耗时</span><strong>{formatSeconds(modalSnapshot.elapsedMs)}</strong></div>
              <div><span>本组最佳</span><strong>{formatSeconds(modalSnapshot.bestMs)}</strong></div>
              <div><span>最近平均</span><strong>{formatSeconds(modalSnapshot.avgMs)}</strong></div>
              <div><span>首次正确率</span><strong>{Math.round(modalSnapshot.firstTryAccuracy * 100)}%</strong></div>
            </div>
            <div className="action-row">
              <button className="secondary-btn" type="button" onClick={() => navigate(`/practice/${session.taskId}`)}>
                再来一组
              </button>
              <button className="primary-btn" type="button" onClick={() => navigate(`/result/${session.sessionId}`)}>
                查看结果
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GuidedPanel({
  problem,
  localState,
  setLocalState,
  submitGuided,
}: {
  problem: GuidedSolveProblem;
  localState: LocalState;
  setLocalState: Dispatch<SetStateAction<LocalState>>;
  submitGuided: (stepKey: "ratio" | "third" | "final") => void;
}) {
  const currentStep =
    (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) || "final";

  return (
    <div className="question-stage">
      <h2>求 {problem.target.toUpperCase()} {problem.referenceAngle}</h2>
      <p className="muted-copy">
        已知 {problem.given.map((item) => `${item.edge}=${item.value}`).join("，")}
      </p>

      <div className="step-list">
        <div className={`step-card ${currentStep === "ratio" ? "active" : ""}`}>
          <strong>第 2 步：写最简 z 比</strong>
          <div className="input-grid">
            {problem.given.map((item) => (
              <label key={item.role}>
                <span>{item.role}</span>
                <input
                  value={localState.guidedRatio[item.role] || ""}
                  onChange={(event) =>
                    setLocalState((current) => ({
                      ...current,
                      guidedRatio: { ...current.guidedRatio, [item.role]: event.target.value },
                    }))
                  }
                />
              </label>
            ))}
          </div>
          <button className="secondary-btn" type="button" onClick={() => submitGuided("ratio")} disabled={currentStep !== "ratio"}>
            提交这一步
          </button>
        </div>

        <div className={`step-card ${currentStep === "third" ? "active" : ""}`}>
          <strong>第 3 步：补第三边</strong>
          <label>
            <span>第三边</span>
            <input
              value={localState.guidedThird}
              onChange={(event) => setLocalState((current) => ({ ...current, guidedThird: event.target.value }))}
            />
          </label>
          <button className="secondary-btn" type="button" onClick={() => submitGuided("third")} disabled={currentStep !== "third"}>
            提交这一步
          </button>
        </div>

        <div className={`step-card ${currentStep === "final" ? "active" : ""}`}>
          <strong>第 4 步：代回目标三角比</strong>
          <div className="fraction-inline">
            <input
              value={localState.guidedFinal.numerator}
              onChange={(event) =>
                setLocalState((current) => ({
                  ...current,
                  guidedFinal: { ...current.guidedFinal, numerator: event.target.value },
                }))
              }
            />
            <span>/</span>
            <input
              value={localState.guidedFinal.denominator}
              onChange={(event) =>
                setLocalState((current) => ({
                  ...current,
                  guidedFinal: { ...current.guidedFinal, denominator: event.target.value },
                }))
              }
            />
          </div>
          <button className="primary-btn" type="button" onClick={() => submitGuided("final")} disabled={currentStep !== "final"}>
            提交答案
          </button>
        </div>
      </div>
    </div>
  );
}

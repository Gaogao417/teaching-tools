import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import type {
  ResultProblemReview,
  ResultSnapshot,
  SceneSpec,
  StructuredAnswer,
  TaskHistoryItem,
  TaskId,
} from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { formatSeconds } from "../components/layout/workspaceUtils";

function answerText(answer?: StructuredAnswer) {
  if (!answer) return "—";
  if (answer.display) return answer.display;
  const selections = Object.values(answer.selections || {}).flat().filter(Boolean);
  const inputs = Object.entries(answer.inputs || {}).filter(([, value]) => value);
  return [
    selections.length ? `选择：${selections.join(" → ")}` : "",
    inputs.length ? inputs.map(([key, value]) => `${key} = ${value}`).join("；") : "",
  ].filter(Boolean).join("；") || "—";
}

function submittedText(raw?: string) {
  if (!raw) return "—";
  try {
    return answerText(JSON.parse(raw) as StructuredAnswer);
  } catch {
    return raw;
  }
}

function SceneReplay({ scene }: { scene?: SceneSpec }) {
  if (!scene) return null;
  if (scene.sceneKind !== "triangle") {
    return <div className="ks-review-scene-placeholder"><span className="material-symbols-outlined">deployed_code</span>本题场景已随结果快照保存</div>;
  }
  const triangle = scene.entities.find((entity) => entity.kind === "triangle");
  const vertices = scene.entities.filter((entity) => entity.kind === "vertex");
  const edges = scene.entities.filter((entity) => entity.kind === "edge");
  if (!triangle || triangle.kind !== "triangle") return null;
  const vertexMap = Object.fromEntries(vertices.map((vertex) => [vertex.id, vertex]));
  return (
    <div className="ks-review-scene">
      <svg viewBox="0 0 460 340" role="img" aria-label="本题场景回放">
        <polygon points={Object.values(triangle.vertices).map((point) => `${point.x},${point.y}`).join(" ")} />
        {edges.map((edge) => {
          if (edge.kind !== "edge") return null;
          const from = vertexMap[edge.from];
          const to = vertexMap[edge.to];
          if (!from || from.kind !== "vertex" || !to || to.kind !== "vertex") return null;
          return <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} />;
        })}
        {vertices.map((vertex) => vertex.kind === "vertex" ? <text key={vertex.id} x={vertex.x - 12} y={vertex.y + 6}>{vertex.label}</text> : null)}
      </svg>
    </div>
  );
}

function ProblemDebrief({ problem }: { problem: ResultProblemReview }) {
  const submissions = problem.attemptLog.filter((attempt) => attempt.actionType === "submit");
  return (
    <article className="ks-problem-debrief">
      <header>
        <span>题目 {String(problem.index + 1).padStart(2, "0")}</span>
        <div><h3>{problem.diagnosisTitle || problem.prompt}</h3><p>{problem.coachingCopy}</p></div>
      </header>
      <div className="ks-problem-debrief-grid">
        <SceneReplay scene={problem.scene} />
        <div className="ks-answer-compare">
          <div><span>本轮答案</span><p>{answerText(problem.actualAnswer)}</p></div>
          <div><span>参考答案</span><p>{answerText(problem.expectedAnswer)}</p></div>
        </div>
      </div>
      <details>
        <summary>查看逐步提交记录</summary>
        <div className="ks-attempt-log">
          {submissions.map((attempt, index) => (
            <div key={`${attempt.createdAt}-${index}`} className={attempt.evaluation}>
              <span>{attempt.evaluation === "correct" ? "通过" : attempt.evaluation === "wrong" ? "需修正" : "继续"}</span>
              <p>{attempt.stepTitle || attempt.stepId || "当前步骤"}</p>
              <small>{submittedText(attempt.submittedValue)}</small>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

export function ReviewPage() {
  const { taskId } = useParams<{ taskId: TaskId }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { studentName, focusedTask, setFocusedTaskId } = useOutletContext<WorkspaceOutletContext>();
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [snapshot, setSnapshot] = useState<ResultSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const requestedSessionId = searchParams.get("sessionId");

  useEffect(() => {
    if (taskId) setFocusedTaskId(taskId);
  }, [taskId, setFocusedTaskId]);

  useEffect(() => {
    if (!taskId || !studentName) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setDetailsOpen(false);
    api.getTaskHistory(taskId, studentName, 30)
      .then(async (response) => {
        if (cancelled) return;
        setHistory(response.items);
        const sessionId = requestedSessionId || response.items[response.items.length - 1]?.sessionId;
        if (!sessionId) return setSnapshot(null);
        const result = await api.getResult(sessionId);
        if (!cancelled) {
          setSnapshot(result);
          if (requestedSessionId !== sessionId) setSearchParams({ sessionId }, { replace: true });
        }
      })
      .catch(() => !cancelled && setSnapshot(null))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [requestedSessionId, setSearchParams, studentName, taskId]);

  const needsReview = useMemo(
    () => snapshot?.problemReviews?.filter((problem) => !problem.firstTryCorrect) || [],
    [snapshot],
  );
  const coreProblem = needsReview[0];

  if (loading) return <section className="ks-state-page"><span className="eyebrow">复盘</span><h1>正在生成本轮结论</h1></section>;

  if (!snapshot) {
    return (
      <section className="ks-state-page">
        <span className="eyebrow">复盘</span>
        <h1>完成一次训练后，这里会生成行动建议</h1>
        <p>复盘不会开始新的计时，也不会修改训练草稿。</p>
        <button className="btn btn-primary" type="button" onClick={() => taskId && navigate(`/practice/${taskId}`)}>开始训练</button>
      </section>
    );
  }

  return (
    <div className="ks-review-page">
      <section className="ks-debrief-hero">
        <div className="ks-debrief-context"><span className="eyebrow">训练结算</span><p>{focusedTask?.title || snapshot.title}</p></div>
        <div className="ks-debrief-score"><strong>{snapshot.firstTryCorrectCount} <span>/ {snapshot.problemCount}</span></strong><p>正确率 {Math.round(snapshot.firstTryAccuracy * 100)}% · 用时 {formatSeconds(snapshot.elapsedMs)}</p></div>

        <div className={`ks-core-diagnosis ${coreProblem ? "has-issue" : "is-clean"}`}>
          <span>{coreProblem ? "本轮最值得复盘" : "本轮表现"}</span>
          <h1>{coreProblem?.diagnosisTitle || "所有题目均为首次完成"}</h1>
          <p>{coreProblem?.coachingCopy || "当前判断顺序稳定，可以提高难度或减少提示依赖。"}</p>
        </div>

        <div className="ks-debrief-actions">
          <button className="btn btn-primary" type="button" onClick={() => navigate(`/practice/${snapshot.taskId}`)}>再练一组</button>
          {needsReview.length ? <button className="btn btn-secondary" type="button" onClick={() => setDetailsOpen(true)}>复盘这 {needsReview.length} 道错题</button> : <button className="btn btn-secondary" type="button" onClick={() => navigate(`/learn/${snapshot.taskId}`)}>回看方法</button>}
        </div>
      </section>

      {detailsOpen && (
        <section className="ks-review-depth">
          <header><div><span className="eyebrow">深度复盘</span><h2>只处理本轮薄弱动作</h2></div><button type="button" onClick={() => setDetailsOpen(false)}>收起</button></header>
          <div className="ks-problem-debrief-list">{needsReview.map((problem) => <ProblemDebrief key={problem.instanceId} problem={problem} />)}</div>

          <div className="ks-review-history-layer">
            <div>
              <span className="eyebrow">第二层信息</span>
              <h2>训练趋势与历史记录</h2>
              <label>选择训练记录<select value={snapshot.sessionId} onChange={(event) => setSearchParams({ sessionId: event.target.value })}>{history.slice().reverse().map((item) => <option key={item.sessionId} value={item.sessionId}>{new Date(item.clearedAt).toLocaleString("zh-CN")} · {Math.round(item.firstTryAccuracy * 100)}%</option>)}</select></label>
            </div>
            <Chart points={snapshot.history} color="#1F64FF" />
          </div>
        </section>
      )}
    </div>
  );
}

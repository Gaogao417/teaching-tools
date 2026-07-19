import { useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { ResultSnapshot, TaskId } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { formatSeconds } from "../components/layout/workspaceUtils";

export function ResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { setFocusedTaskId } = useOutletContext<WorkspaceOutletContext>();
  const [snapshot, setSnapshot] = useState<ResultSnapshot | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getResult(sessionId)
      .then((result) => {
        setSnapshot(result);
        setFocusedTaskId(result.taskId as TaskId);
        navigate(`/review/${result.taskId}?sessionId=${result.sessionId}`, { replace: true });
      })
      .catch(console.error);
  }, [navigate, sessionId, setFocusedTaskId]);

  if (!snapshot) {
    return (
      <section className="panel workspace-panel">
        <div className="detail-head">
          <div className="eyebrow">Session Result</div>
          <h2>Loading the latest result snapshot</h2>
          <p className="text-muted">Results stay inside the same workspace shell so students can move directly back into practice.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel workspace-panel workspace-result-panel">
      <div className="detail-head">
        <div className="eyebrow">{snapshot.studentName}</div>
        <h2>{snapshot.title}</h2>
        <p>{snapshot.copy}</p>
        <div className="action-row">
          <span className="pill">{snapshot.groupLabel}</span>
          <span className="pill">{snapshot.problemCount} problems cleared</span>
        </div>
      </div>

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

      <div className="workspace-overview-grid">
        <article className="info-card">
          <div className="detail-head">
            <span className="eyebrow">Trend</span>
            <h3>Training curve</h3>
          </div>
          <Chart points={snapshot.history} color={snapshot.color} />
        </article>

        <article className="info-card">
          <div className="detail-head">
            <span className="eyebrow">Summary</span>
            <h3>What changed</h3>
          </div>
          <div className="metric-grid">
            <div>
              <span>Correct on first try</span>
              <strong>
                {snapshot.firstTryCorrectCount}/{snapshot.problemCount}
              </strong>
            </div>
            <div>
              <span>Delta vs previous</span>
              <strong>
                {snapshot.deltaVsPreviousMs === null ? "--" : `${snapshot.deltaVsPreviousMs > 0 ? "+" : "-"}${formatSeconds(Math.abs(snapshot.deltaVsPreviousMs))}`}
              </strong>
            </div>
            <div>
              <span>Started at</span>
              <strong>{new Date(snapshot.startedAt).toLocaleString("zh-CN")}</strong>
            </div>
            <div>
              <span>Cleared at</span>
              <strong>{new Date(snapshot.clearedAt).toLocaleString("zh-CN")}</strong>
            </div>
          </div>
        </article>
      </div>

      <div className="action-row">
        <button className="btn btn-secondary" type="button" onClick={() => navigate(`/practice/${snapshot.taskId}`)}>
          Practice Again
        </button>
        <button className="btn btn-primary" type="button" onClick={() => navigate("/")}>
          Back to Overview
        </button>
      </div>
    </section>
  );
}

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
    api.getResult(sessionId).then((result) => {
      setSnapshot(result);
      setFocusedTaskId(result.taskId as TaskId);
    }).catch(console.error);
  }, [sessionId, setFocusedTaskId]);

  if (!snapshot) {
    return (
      <section className="panel workspace-panel">
        <div className="detail-head">
          <h2>正在加载结果详情</h2>
          <p className="text-muted">结果仍然会显示在同一个工作区壳层内。</p>
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
      </div>

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

      <article className="info-card">
        <h3>训练走势</h3>
        <Chart points={snapshot.history} color={snapshot.color} />
      </article>

      <div className="action-row">
        <button className="btn btn-secondary" type="button" onClick={() => navigate(`/practice/${snapshot.taskId}`)}>
          再练一组
        </button>
        <button className="btn btn-primary" type="button" onClick={() => navigate("/")}>
          返回工作区
        </button>
      </div>
    </section>
  );
}

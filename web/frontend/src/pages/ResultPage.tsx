import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ResultSnapshot } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

export function ResultPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<ResultSnapshot | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getResult(sessionId).then(setSnapshot).catch(console.error);
  }, [sessionId]);

  if (!snapshot) {
    return <div className="page-shell"><section className="panel panel-pad">加载结果中…</section></div>;
  }

  return (
    <div className="page-shell">
      <section className="panel result-page">
        <div className="eyebrow">{snapshot.studentName}</div>
        <h1>{snapshot.title}</h1>
        <p>{snapshot.copy}</p>

        <div className="metric-grid">
          <div><span>本次耗时</span><strong>{formatSeconds(snapshot.elapsedMs)}</strong></div>
          <div><span>本组最佳</span><strong>{formatSeconds(snapshot.bestMs)}</strong></div>
          <div><span>最近平均</span><strong>{formatSeconds(snapshot.avgMs)}</strong></div>
          <div><span>首次正确率</span><strong>{Math.round(snapshot.firstTryAccuracy * 100)}%</strong></div>
        </div>

        <Chart points={snapshot.history} color={snapshot.color} />

        <div className="action-row">
          <button className="btn btn-secondary" type="button" onClick={() => navigate(`/practice/${snapshot.taskId}`)}>
            再练一组
          </button>
          <button className="btn btn-primary" type="button" onClick={() => navigate("/")}>
            返回首页
          </button>
        </div>
      </section>
    </div>
  );
}

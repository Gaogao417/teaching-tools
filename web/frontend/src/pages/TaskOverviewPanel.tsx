import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { TaskHistoryResponse } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { formatSeconds } from "../components/layout/workspaceUtils";
import { getStoredSessionId } from "../utils/storage";

export function TaskOverviewPanel() {
  const navigate = useNavigate();
  const { focusedTask, studentName, isStudentReady, requestAuth } = useOutletContext<WorkspaceOutletContext>();
  const [history, setHistory] = useState<TaskHistoryResponse | null>(null);

  useEffect(() => {
    if (!focusedTask || !studentName) {
      setHistory(null);
      return;
    }

    api.getTaskHistory(focusedTask.id, studentName).then(setHistory).catch(() => {
      setHistory({ taskId: focusedTask.id, studentName, items: [] });
    });
  }, [focusedTask, studentName]);

  const metrics = useMemo(() => {
    const items = history?.items || [];
    return {
      count: items.length,
      best: items.length ? Math.min(...items.map((item) => item.elapsedMs)) : null,
      avg: items.length ? items.reduce((sum, item) => sum + item.elapsedMs, 0) / items.length : null,
      latest: items.length ? items[items.length - 1].elapsedMs : null,
    };
  }, [history]);

  if (!focusedTask) {
    return (
      <section className="panel workspace-panel">
        <div className="surface-canvas">
          <h2 className="canvas-title">学生练习工作台</h2>
          <p className="text-muted">请点击左上角的菜单开始选择任务</p>
        </div>
      </section>
    );
  }

  const hasStoredSession = isStudentReady ? Boolean(getStoredSessionId(focusedTask.id)) : false;

  return (
    <section className="panel workspace-panel">
      <div className="workspace-panel-head">
        <div className="detail-head">
          <div className="eyebrow">{focusedTask.difficulty}</div>
          <h2>{focusedTask.title}</h2>
          <p>{focusedTask.summary}</p>
        </div>
        <div className="workspace-cta-card">
          <strong>{hasStoredSession ? "当前任务有未完成训练" : "准备开始新的训练组"}</strong>
          <p className="text-muted">
            {isStudentReady ? "点击后会进入同一个工作区中的训练主体。" : "先填写姓名，系统才能记录你的历史和恢复进度。"}
          </p>
          <div className="action-row">
            <button
              className="btn btn-primary"
              type="button"
              disabled={!isStudentReady}
              onClick={() => {
                if (!isStudentReady) {
                  requestAuth();
                  return;
                }
                navigate(`/practice/${focusedTask.id}`);
              }}
            >
              {hasStoredSession ? "继续训练" : "开始训练"}
            </button>
            {!isStudentReady && (
              <button className="btn btn-secondary" type="button" onClick={requestAuth}>
                先填写姓名
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="workspace-overview-grid">
        <article className="info-card">
          <h3>样题预览</h3>
          <p>{focusedTask.sample.prompt}</p>
        </article>

        <article className="info-card">
          <h3>训练概览</h3>
          {isStudentReady ? (
            <div className="metric-grid">
              <div>
                <span>累计训练</span>
                <strong>{metrics.count ? `${metrics.count} 次` : "--"}</strong>
              </div>
              <div>
                <span>本组最佳</span>
                <strong>{formatSeconds(metrics.best)}</strong>
              </div>
              <div>
                <span>最近平均</span>
                <strong>{formatSeconds(metrics.avg)}</strong>
              </div>
              <div>
                <span>最近一次</span>
                <strong>{formatSeconds(metrics.latest)}</strong>
              </div>
            </div>
          ) : (
            <p className="text-muted">填写姓名后才能查看当前学生的训练历史。</p>
          )}
        </article>
      </div>

      <article className="info-card">
        <h3>解题步骤</h3>
        <ol className="steps-list">
          {focusedTask.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="info-card">
        <h3>训练历史</h3>
        {isStudentReady ? (
          <>
            <Chart points={history?.items || []} color={focusedTask.color || "#b85c38"} />
            <div className="history-list">
              {(history?.items || []).slice().reverse().map((item) => (
                <div key={item.clearedAt} className="history-row">
                  <span>{new Date(item.clearedAt).toLocaleString("zh-CN")}</span>
                  <strong>{formatSeconds(item.elapsedMs)}</strong>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-muted">工作区会保留任务地图，但个人历史只在身份确认后读取。</p>
        )}
      </article>
    </section>
  );
}

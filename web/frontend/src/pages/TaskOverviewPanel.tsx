import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import type { TaskId } from "../../../shared/contracts";
import type { TaskHistoryResponse } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { formatSeconds } from "../components/layout/workspaceUtils";
import { getStoredSessionId } from "../utils/storage";

export function TaskOverviewPanel() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: TaskId }>();
  const { focusedTask, studentName, isStudentReady, requestAuth, setFocusedTaskId } = useOutletContext<WorkspaceOutletContext>();
  const [history, setHistory] = useState<TaskHistoryResponse | null>(null);

  useEffect(() => {
    if (taskId) setFocusedTaskId(taskId);
  }, [setFocusedTaskId, taskId]);

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
          <div className="eyebrow">The Kinetic Scholar</div>
          <h2 className="canvas-title">Choose a task from the learning map</h2>
          <p className="text-muted">Open the sidebar to preview the prompt, inspect the solution path, and start a live runtime session.</p>
        </div>
      </section>
    );
  }

  const hasStoredSession = isStudentReady ? Boolean(getStoredSessionId(focusedTask.id)) : false;

  return (
    <section className="panel workspace-panel">
      <div className="workspace-panel-head ks-learn-hero">
        <div className="detail-head">
          <div className="eyebrow">Learn · {focusedTask.difficulty}</div>
          <h2>{focusedTask.title}</h2>
          <p>{focusedTask.summary}</p>
          <div className="action-row">
            <span className="pill">概念讲解</span>
            <span className="pill">{focusedTask.steps.length} 步方法</span>
          </div>
        </div>

        <div className="workspace-cta-card ks-learn-next-card">
          <div className="detail-head">
            <span className="eyebrow">学完以后</span>
            <strong>{hasStoredSession ? "继续未完成的训练" : "用一组题检验是否真正掌握"}</strong>
          </div>
          <p className="text-muted">
            {isStudentReady
              ? "训练模式会收起完整解法，只保留当前动作、计时和必要反馈。"
              : "先设置学生姓名，系统才能保存训练和复盘记录。"}
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
                设置学生姓名
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="workspace-overview-grid">
        <article className="info-card">
          <div className="detail-head">
            <span className="eyebrow">概念入口</span>
            <h3>先看问题长什么样</h3>
          </div>
          <p>{focusedTask.sample.prompt}</p>
        </article>

        <article className="info-card">
          <div className="detail-head">
            <span className="eyebrow">学习记录</span>
            <h3>目前掌握情况</h3>
          </div>
          {isStudentReady ? (
            <div className="metric-grid">
              <div>
                <span>训练次数</span>
                <strong>{metrics.count || "--"}</strong>
              </div>
              <div>
                <span>最佳用时</span>
                <strong>{formatSeconds(metrics.best)}</strong>
              </div>
              <div>
                <span>平均用时</span>
                <strong>{formatSeconds(metrics.avg)}</strong>
              </div>
              <div>
                <span>最近一次</span>
                <strong>{formatSeconds(metrics.latest)}</strong>
              </div>
            </div>
          ) : (
            <p className="text-muted">设置学生姓名后，可以保存训练并比较前后变化。</p>
          )}
        </article>
      </div>

      <article className="info-card">
        <div className="detail-head">
          <span className="eyebrow">方法</span>
          <h3>完整解题路径</h3>
        </div>
        <ol className="steps-list">
          {focusedTask.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="info-card">
        <div className="detail-head">
          <span className="eyebrow">回顾</span>
          <h3>最近训练趋势</h3>
        </div>
        {isStudentReady ? (
          <>
            <Chart points={history?.items || []} color={focusedTask.color || "#1F64FF"} />
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
          <p className="text-muted">设置学生姓名后，这里会显示最近训练趋势。</p>
        )}
      </article>
    </section>
  );
}

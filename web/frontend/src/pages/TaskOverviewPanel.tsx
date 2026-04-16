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
      <section className="panel workspace-panel scholar-panel scholar-empty-panel">
        <div className="surface-canvas scholar-empty-state">
          <div className="eyebrow">The Kinetic Scholar</div>
          <h2 className="canvas-title">Choose a task from the learning map</h2>
          <p className="text-muted">Open the sidebar to preview the prompt, inspect the solution path, and start a live runtime session.</p>
        </div>
      </section>
    );
  }

  const hasStoredSession = isStudentReady ? Boolean(getStoredSessionId(focusedTask.id)) : false;

  return (
    <section className="panel workspace-panel scholar-panel">
      <div className="workspace-panel-head scholar-hero-grid">
        <div className="detail-head scholar-hero-copy">
          <div className="eyebrow">{focusedTask.difficulty}</div>
          <h2>{focusedTask.title}</h2>
          <p>{focusedTask.summary}</p>
          <div className="scholar-pill-row">
            <span className="pill">Engine {focusedTask.engineKind}</span>
            <span className="pill">{focusedTask.steps.length} step path</span>
          </div>
        </div>

        <div className="workspace-cta-card scholar-cta-card">
          <div className="scholar-cta-header">
            <span className="scholar-cta-kicker">Session Control</span>
            <strong>{hasStoredSession ? "Resume the current run" : "Start a fresh guided session"}</strong>
          </div>
          <p className="text-muted">
            {isStudentReady
              ? "Launch the current runtime shell with the same routes, restore flow, and result tracking."
              : "Set a student name first so the app can restore unfinished sessions and attach history."}
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
              {hasStoredSession ? "Resume Session" : "Start Session"}
            </button>
            {!isStudentReady && (
              <button className="btn btn-secondary" type="button" onClick={requestAuth}>
                Set Student Name
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="workspace-overview-grid">
        <article className="info-card scholar-info-card">
          <div className="scholar-card-head">
            <span className="scholar-card-kicker">Prompt</span>
            <h3>Sample challenge</h3>
          </div>
          <p>{focusedTask.sample.prompt}</p>
        </article>

        <article className="info-card scholar-info-card">
          <div className="scholar-card-head">
            <span className="scholar-card-kicker">Performance</span>
            <h3>Student snapshot</h3>
          </div>
          {isStudentReady ? (
            <div className="metric-grid">
              <div>
                <span>Total runs</span>
                <strong>{metrics.count || "--"}</strong>
              </div>
              <div>
                <span>Best time</span>
                <strong>{formatSeconds(metrics.best)}</strong>
              </div>
              <div>
                <span>Average</span>
                <strong>{formatSeconds(metrics.avg)}</strong>
              </div>
              <div>
                <span>Latest run</span>
                <strong>{formatSeconds(metrics.latest)}</strong>
              </div>
            </div>
          ) : (
            <p className="text-muted">Set a student name to load history and compare this task against previous runs.</p>
          )}
        </article>
      </div>

      <article className="info-card scholar-info-card">
        <div className="scholar-card-head">
          <span className="scholar-card-kicker">Roadmap</span>
          <h3>Solution path</h3>
        </div>
        <ol className="steps-list">
          {focusedTask.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>

      <article className="info-card scholar-info-card">
        <div className="scholar-card-head">
          <span className="scholar-card-kicker">Trend</span>
          <h3>Practice history</h3>
        </div>
        {isStudentReady ? (
          <>
            <Chart points={history?.items || []} color={focusedTask.color || "#5148d7"} />
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
          <p className="text-muted">The catalog remains visible, but history is only available after identity is confirmed.</p>
        )}
      </article>
    </section>
  );
}

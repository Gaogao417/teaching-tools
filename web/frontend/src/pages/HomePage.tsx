import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TaskHistoryResponse, TaskNode, TaskTreeResponse } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import { getStudentName, setStudentName } from "../utils/storage";

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

export function HomePage() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TaskTreeResponse | null>(null);
  const [studentNameValue, setStudentNameValue] = useState(getStudentName());
  const [savedStudentName, setSavedStudentNameState] = useState(getStudentName());
  const [selectedTaskId, setSelectedTaskId] = useState("meaning");
  const [history, setHistory] = useState<TaskHistoryResponse | null>(null);

  useEffect(() => {
    api.getTaskTree().then(setTree).catch(console.error);
  }, []);

  const selectedTask = useMemo(() => {
    return tree?.grades[0]?.chapters[0]?.tasks.find((task) => task.id === selectedTaskId) || null;
  }, [tree, selectedTaskId]);

  useEffect(() => {
    if (!selectedTask || !savedStudentName) {
      setHistory(null);
      return;
    }
    api.getTaskHistory(selectedTask.id, savedStudentName).then(setHistory).catch(() => {
      setHistory({ taskId: selectedTask.id, studentName: savedStudentName, items: [] });
    });
  }, [selectedTask, savedStudentName]);

  const metrics = useMemo(() => {
    const items = history?.items || [];
    return {
      count: items.length,
      best: items.length ? Math.min(...items.map((item) => item.elapsedMs)) : null,
      avg: items.length ? items.reduce((sum, item) => sum + item.elapsedMs, 0) / items.length : null,
      latest: items.length ? items[items.length - 1].elapsedMs : null,
    };
  }, [history]);

  const saveName = () => {
    const trimmed = studentNameValue.trim();
    setStudentName(trimmed);
    setSavedStudentNameState(trimmed);
  };

  return (
    <div className="page-shell">
      <section className="panel hero-panel">
        <div>
          <div className="eyebrow">三角比速度训练</div>
          <h1>选择课程任务</h1>
          <p className="muted-copy">先填写学生姓名，再选择任务并开始练习。</p>
        </div>
        <div className="student-bar">
          <input
            value={studentNameValue}
            onChange={(event) => setStudentNameValue(event.target.value)}
            placeholder="请输入学生姓名"
          />
          <button className="secondary-btn" type="button" onClick={saveName}>
            保存姓名
          </button>
        </div>
      </section>

      <section className="home-grid">
        <aside className="panel nav-panel">
          <h2>任务导航</h2>
          {tree?.grades.map((grade) => (
            <div key={grade.id} className="tree-block">
              <div className="tree-grade">{grade.name}</div>
              {grade.chapters.map((chapter) => (
                <div key={chapter.id} className="tree-chapter">
                  <div className="tree-chapter-title">{chapter.name}</div>
                  <div className="tree-list">
                    {chapter.tasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className={`tree-task ${task.id === selectedTaskId ? "active" : ""}`}
                        onClick={() => setSelectedTaskId(task.id)}
                      >
                        {task.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </aside>

        {selectedTask && (
          <section className="panel detail-panel">
            <div className="detail-head">
              <div className="eyebrow">{selectedTask.difficulty}</div>
              <h2>{selectedTask.title}</h2>
              <p>{selectedTask.summary}</p>
            </div>

            <div className="card-grid">
              <article className="info-card">
                <h3>样题预览</h3>
                <p>{selectedTask.sample.prompt}</p>
              </article>
              <article className="info-card">
                <h3>训练概览</h3>
                <div className="metric-grid">
                  <div><span>累计练习</span><strong>{metrics.count ? `${metrics.count} 次` : "--"}</strong></div>
                  <div><span>本组最佳</span><strong>{formatSeconds(metrics.best)}</strong></div>
                  <div><span>最近平均</span><strong>{formatSeconds(metrics.avg)}</strong></div>
                  <div><span>最近一次</span><strong>{formatSeconds(metrics.latest)}</strong></div>
                </div>
              </article>
            </div>

            <article className="info-card">
              <h3>解题步骤</h3>
              <ol className="steps-list">
                {selectedTask.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>

            <article className="info-card">
              <h3>训练历史</h3>
              <Chart points={history?.items || []} color={selectedTask.color || "#b85c38"} />
              <div className="history-list">
                {(history?.items || []).slice().reverse().map((item) => (
                  <div key={item.clearedAt} className="history-row">
                    <span>{new Date(item.clearedAt).toLocaleString("zh-CN")}</span>
                    <strong>{formatSeconds(item.elapsedMs)}</strong>
                  </div>
                ))}
              </div>
            </article>

            <div className="action-row">
              <button
                className="primary-btn"
                disabled={!savedStudentName}
                onClick={() => navigate(`/practice/${selectedTask.id}`)}
              >
                开始练习
              </button>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

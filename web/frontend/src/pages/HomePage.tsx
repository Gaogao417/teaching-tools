import { KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChapterNode, GradeNode, TaskHistoryResponse, TaskNode, TaskTreeResponse } from "../../../shared/contracts";
import { api } from "../api/client";
import { Chart } from "../components/Chart";
import { getStudentName, setStudentName } from "../utils/storage";

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

function findFirstTask(tree: TaskTreeResponse | null) {
  return tree?.grades[0]?.chapters[0]?.tasks[0] || null;
}

function findTaskPath(taskId: string, tree: TaskTreeResponse | null) {
  if (!tree) return null;
  for (const grade of tree.grades) {
    for (const chapter of grade.chapters) {
      const task = chapter.tasks.find((item) => item.id === taskId);
      if (task) {
        return { grade, chapter, task };
      }
    }
  }
  return null;
}

export function HomePage() {
  const navigate = useNavigate();
  const [tree, setTree] = useState<TaskTreeResponse | null>(null);
  const storedStudentName = getStudentName();
  const [studentNameValue, setStudentNameValue] = useState(storedStudentName);
  const [savedStudentName, setSavedStudentNameState] = useState(storedStudentName);
  const [selectedTaskId, setSelectedTaskId] = useState("meaning");
  const [history, setHistory] = useState<TaskHistoryResponse | null>(null);
  const [expandedGradeIds, setExpandedGradeIds] = useState<string[]>([]);
  const [expandedChapterIds, setExpandedChapterIds] = useState<string[]>([]);

  useEffect(() => {
    api.getTaskTree().then(setTree).catch(console.error);
  }, []);

  useEffect(() => {
    if (!tree) return;
    const firstTask = findFirstTask(tree);
    const currentPath = findTaskPath(selectedTaskId, tree);
    const nextPath = currentPath || (firstTask ? findTaskPath(firstTask.id, tree) : null);
    if (!currentPath && firstTask) {
      setSelectedTaskId(firstTask.id);
    }
    if (!nextPath) return;
    setExpandedGradeIds((current) => (current.length ? current : [nextPath.grade.id]));
    setExpandedChapterIds((current) => (current.length ? current : [nextPath.chapter.id]));
  }, [selectedTaskId, tree]);

  const selectedTask = useMemo(() => {
    return findTaskPath(selectedTaskId, tree)?.task || null;
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
    if (!trimmed) return;
    setStudentName(trimmed);
    setSavedStudentNameState(trimmed);
    setStudentNameValue(trimmed);
  };

  const handleNameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    saveName();
  };

  const toggleExpanded = (id: string, current: string[]) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id];

  const toggleGrade = (gradeId: string) => {
    setExpandedGradeIds((current) => toggleExpanded(gradeId, current));
  };

  const toggleChapter = (chapterId: string) => {
    setExpandedChapterIds((current) => toggleExpanded(chapterId, current));
  };

  const selectTask = (gradeId: string, chapterId: string, taskId: string) => {
    setSelectedTaskId(taskId);
    setExpandedGradeIds((current) => (current.includes(gradeId) ? current : [...current, gradeId]));
    setExpandedChapterIds((current) => (current.includes(chapterId) ? current : [...current, chapterId]));
  };

  const renderTaskButton = (grade: GradeNode, chapter: ChapterNode, task: TaskNode) => (
    <button
      key={task.id}
      type="button"
      className={`tree-node tree-task ${task.id === selectedTaskId ? "active" : ""}`}
      onClick={() => selectTask(grade.id, chapter.id, task.id)}
    >
      <span className="tree-label">
        <span className="tree-arrow tree-dot">•</span>
        <span>{task.title}</span>
      </span>
      <span className="tree-meta">{task.difficulty}</span>
    </button>
  );

  return (
    <div className="page-shell">
      <section className="panel hero-panel">
        <div>
          <div className="eyebrow">三角比速度训练</div>
          <h1>选择课程任务</h1>
          <p className="text-muted">先填写学生姓名，再选择任务并开始练习。</p>
        </div>
        <div className="student-bar">
          <input
            value={studentNameValue}
            onChange={(event) => setStudentNameValue(event.target.value)}
            onKeyDown={handleNameKeyDown}
            placeholder="请输入学生姓名后按回车"
          />
          <button className="btn btn-secondary" type="button" onClick={saveName} disabled={!studentNameValue.trim()}>
            保存姓名
          </button>
          <span className="student-hint">
            {savedStudentName ? `当前学生：${savedStudentName}` : "输入姓名并按回车后即可开始练习"}
          </span>
        </div>
      </section>

      <section className="home-grid">
        <aside className="panel nav-panel">
          <div className="tree-header">
            <h2>任务导航</h2>
          </div>
          <div className="tree-body">
            {tree?.grades.map((grade) => {
              const gradeExpanded = expandedGradeIds.includes(grade.id);
              return (
                <section key={grade.id} className="tree-block">
                  <button type="button" className="tree-node tree-grade" onClick={() => toggleGrade(grade.id)}>
                    <span className="tree-label">
                      <span className="tree-arrow">{gradeExpanded ? "▾" : "▸"}</span>
                      <span>{grade.name}</span>
                    </span>
                  </button>

                  {gradeExpanded && (
                    <div className="tree-branch">
                      {grade.chapters.map((chapter) => {
                        const chapterExpanded = expandedChapterIds.includes(chapter.id);
                        return (
                          <section key={chapter.id} className="tree-chapter">
                            <button
                              type="button"
                              className="tree-node tree-chapter-title"
                              onClick={() => toggleChapter(chapter.id)}
                            >
                              <span className="tree-label">
                                <span className="tree-arrow">{chapterExpanded ? "▾" : "▸"}</span>
                                <span>{chapter.name}</span>
                              </span>
                            </button>

                            {chapterExpanded && (
                              <div className="tree-branch tree-task-list">
                                {chapter.tasks.map((task) => renderTaskButton(grade, chapter, task))}
                              </div>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        </aside>

        {selectedTask ? (
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
                className="btn btn-primary"
                disabled={!savedStudentName}
                onClick={() => navigate(`/practice/${selectedTask.id}`)}
              >
                开始练习
              </button>
            </div>
          </section>
        ) : (
          <section className="panel detail-panel">
            <div className="detail-head">
              <h2>请先选择任务</h2>
              <p className="text-muted">当前没有可用任务，或任务树尚未加载完成。</p>
            </div>
          </section>
        )}
      </section>
    </div>
  );
}

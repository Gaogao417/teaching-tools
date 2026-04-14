import type { FocusEvent, MouseEvent } from "react";
import type { TaskId, TaskTreeResponse } from "../../../../shared/contracts";

type PreviewHandler = (taskId: TaskId, element: HTMLElement) => void;

type Props = {
  tree: TaskTreeResponse | null;
  focusedTaskId: TaskId | null;
  activeTaskId: TaskId | null;
  expandedGradeIds: string[];
  expandedChapterIds: string[];
  onToggleGrade: (gradeId: string) => void;
  onToggleChapter: (chapterId: string) => void;
  onSelectTask: (gradeId: string, chapterId: string, taskId: TaskId) => void;
  onPreviewOpen: PreviewHandler;
  onPreviewClose: () => void;
  isStudentReady: boolean;
};

function taskButtonState(taskId: TaskId, focusedTaskId: TaskId | null, activeTaskId: TaskId | null) {
  const isFocused = taskId === focusedTaskId;
  const isActive = taskId === activeTaskId;
  return `${isFocused ? "active" : ""} ${isActive ? "tree-task-live" : ""}`.trim();
}

export function SidebarNav({
  tree,
  focusedTaskId,
  activeTaskId,
  expandedGradeIds,
  expandedChapterIds,
  onToggleGrade,
  onToggleChapter,
  onSelectTask,
  onPreviewOpen,
  onPreviewClose,
  isStudentReady,
}: Props) {
  const openPreviewFromEvent = (taskId: TaskId, event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    onPreviewOpen(taskId, event.currentTarget);
  };

  return (
    <div className="workspace-sidebar-shell">
      <div className="tree-header">
        <h2>任务导航</h2>
      </div>

      <div className="tree-body">
        {tree?.grades.map((grade) => {
          const gradeExpanded = expandedGradeIds.includes(grade.id);
          return (
            <section key={grade.id} className="tree-block">
              <button type="button" className="tree-node tree-grade" onClick={() => onToggleGrade(grade.id)}>
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
                          onClick={() => onToggleChapter(chapter.id)}
                        >
                          <span className="tree-label">
                            <span className="tree-arrow">{chapterExpanded ? "▾" : "▸"}</span>
                            <span>{chapter.name}</span>
                          </span>
                        </button>

                        {chapterExpanded && (
                          <div className="tree-branch tree-task-list">
                            {chapter.tasks.map((task) => (
                              <button
                                key={task.id}
                                type="button"
                                className={`tree-node tree-task ${taskButtonState(task.id, focusedTaskId, activeTaskId)}`}
                                onClick={() => onSelectTask(grade.id, chapter.id, task.id)}
                                onMouseEnter={(event) => openPreviewFromEvent(task.id, event)}
                                onMouseLeave={onPreviewClose}
                                onFocus={(event) => openPreviewFromEvent(task.id, event)}
                                onBlur={onPreviewClose}
                                aria-current={task.id === activeTaskId ? "page" : undefined}
                              >
                                <span className="tree-label">
                                  <span className="tree-arrow tree-dot">•</span>
                                  <span>{task.title}</span>
                                </span>
                                <span className="tree-meta">{task.difficulty}</span>
                              </button>
                            ))}
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
    </div>
  );
}

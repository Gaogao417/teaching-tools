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
  onOpenSimilarityMap: () => void;
};

function taskButtonState(taskId: TaskId, focusedTaskId: TaskId | null, activeTaskId: TaskId | null) {
  const isFocused = taskId === focusedTaskId;
  const isActive = taskId === activeTaskId;
  return `${isFocused ? "active" : ""} ${isActive ? "live" : ""}`.trim();
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
  onOpenSimilarityMap,
}: Props) {
  const openPreviewFromEvent = (taskId: TaskId, event: MouseEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) => {
    onPreviewOpen(taskId, event.currentTarget);
  };

  return (
    <div className="ks-sidebar-shell">
      <div className="ks-sidebar-main">
        <h3 className="ks-sidebar-label">Learning Path</h3>

        <nav className="ks-sidebar-nav">
          <div className="ks-sidebar-section">
            <button type="button" className="ks-sidebar-root">
              <span className="ks-sidebar-root-left">
                <span className="material-symbols-outlined ks-sidebar-root-icon active">folder_open</span>
                <span>Curriculum</span>
              </span>
              <span className="material-symbols-outlined ks-sidebar-chevron expanded">chevron_right</span>
            </button>

            <div className="ks-sidebar-children">
              {tree?.grades.map((grade) => {
                const gradeExpanded = expandedGradeIds.includes(grade.id);

                return (
                  <div key={grade.id} className="ks-sidebar-chapter">
                    <button type="button" className="ks-sidebar-chapter-title" onClick={() => onToggleGrade(grade.id)}>
                      <span>{grade.name}</span>
                      <span className={`material-symbols-outlined ks-sidebar-chevron ${gradeExpanded ? "expanded" : ""}`}>chevron_right</span>
                    </button>

                    {gradeExpanded ? (
                      <div className="ks-sidebar-task-list">
                        {grade.chapters.map((chapter) => {
                          const chapterExpanded = expandedChapterIds.includes(chapter.id);
                          return (
                            <div key={chapter.id} className="ks-sidebar-chapter">
                              <button type="button" className="ks-sidebar-chapter-title" onClick={() => onToggleChapter(chapter.id)}>
                                <span>{chapter.name}</span>
                                <span className={`material-symbols-outlined ks-sidebar-chevron ${chapterExpanded ? "expanded" : ""}`}>chevron_right</span>
                              </button>

                              {chapterExpanded ? (
                                <div className="ks-sidebar-task-list">
                                  {chapter.id === "chapter-similarity" ? (
                                    <button type="button" className="ks-sidebar-task ks-sidebar-map-entry" onClick={onOpenSimilarityMap}>
                                      <span className="material-symbols-outlined">account_tree</span>
                                      打开相似学习图谱
                                    </button>
                                  ) : chapter.tasks.map((task) => (
                                    <button
                                      key={task.id}
                                      type="button"
                                      className={`ks-sidebar-task ${taskButtonState(task.id, focusedTaskId, activeTaskId)}`}
                                      onClick={() => onSelectTask(grade.id, chapter.id, task.id)}
                                      onMouseEnter={(event) => openPreviewFromEvent(task.id, event)}
                                      onMouseLeave={onPreviewClose}
                                      onFocus={(event) => openPreviewFromEvent(task.id, event)}
                                      onBlur={onPreviewClose}
                                    >
                                      {task.title}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ks-sidebar-section">
            <button type="button" className="ks-sidebar-root active">
              <span className="ks-sidebar-root-left">
                <span className="material-symbols-outlined ks-sidebar-root-icon">history</span>
                <span>Practice History</span>
              </span>
              <span className="material-symbols-outlined ks-sidebar-chevron">chevron_right</span>
            </button>
          </div>
        </nav>
      </div>

      <div className="ks-sidebar-footer">
        <button type="button" className="ks-sidebar-footer-link">
          <span className="material-symbols-outlined ks-sidebar-root-icon">group</span>
          <span>{isStudentReady ? "Students" : "Students"}</span>
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, matchPath, useLocation, useNavigate } from "react-router-dom";
import type { TaskId } from "../../../../shared/contracts";
import { TASK_DEFINITIONS } from "../../../../shared/tasks";
import { api } from "../../api/client";
import { AuthModal } from "../common/AuthModal";
import { SidebarNav } from "./SidebarNav";
import { TaskPreviewPopover } from "./TaskPreviewPopover";
import type { WorkspaceOutletContext, WorkspaceTopNavState } from "./workspaceContext";
import { findFirstTask, findTaskPath, getTaskNode } from "./workspaceUtils";
import { clearStoredSessionId, getStudentName, setStudentName as persistStudentName } from "../../utils/storage";

type PreviewState = {
  taskId: TaskId;
  anchorRect: DOMRect;
};

function avatarLabel(studentName: string) {
  if (!studentName.trim()) return "KS";
  const parts = studentName.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

export function WorkspaceShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previewCloseTimer = useRef<number | null>(null);
  const [tree, setTree] = useState<Awaited<ReturnType<typeof api.getTaskTree>> | null>(null);
  const [focusedTaskId, setFocusedTaskIdState] = useState<TaskId | null>(null);
  const [expandedGradeIds, setExpandedGradeIds] = useState<string[]>([]);
  const [expandedChapterIds, setExpandedChapterIds] = useState<string[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [isNavDrawerOpen, setIsNavDrawerOpen] = useState(false);
  const [studentName, setStudentNameState] = useState(() => getStudentName());
  const [studentNameDraft, setStudentNameDraft] = useState(() => getStudentName());
  const [isAuthOpen, setIsAuthOpen] = useState(() => !getStudentName());
  const [topNavContent, setTopNavContent] = useState<WorkspaceTopNavState | null>(null);

  const practiceMatch = matchPath("/practice/:taskId", location.pathname);
  const activeTaskId = (practiceMatch?.params.taskId as TaskId | undefined) || null;

  useEffect(() => {
    api.getTaskTree().then(setTree).catch(console.error);
  }, []);

  useEffect(() => {
    if (!tree) return;
    const firstTask = findFirstTask(tree);
    const nextFocused = activeTaskId || focusedTaskId || firstTask?.id || null;
    if (!nextFocused) return;
    if (nextFocused !== focusedTaskId) {
      setFocusedTaskIdState(nextFocused);
    }
  }, [tree, focusedTaskId, activeTaskId]);

  useEffect(() => {
    if (!tree || !focusedTaskId) return;
    const nextPath = findTaskPath(focusedTaskId, tree);
    if (!nextPath) return;
    setExpandedGradeIds((current) => (current.includes(nextPath.grade.id) ? current : [...current, nextPath.grade.id]));
    setExpandedChapterIds((current) =>
      current.includes(nextPath.chapter.id) ? current : [...current, nextPath.chapter.id],
    );
  }, [tree, focusedTaskId]);

  useEffect(() => {
    if (!activeTaskId) return;
    setPreviewState(null);
  }, [activeTaskId]);

  useEffect(() => {
    if (!studentName.trim()) {
      setIsAuthOpen(true);
    }
  }, [studentName]);

  useEffect(() => {
    return () => {
      if (previewCloseTimer.current) {
        window.clearTimeout(previewCloseTimer.current);
      }
    };
  }, []);

  const focusedTask = useMemo(() => getTaskNode(focusedTaskId, tree), [focusedTaskId, tree]);
  const previewTask = useMemo(() => getTaskNode(previewState?.taskId || null, tree), [previewState, tree]);
  const contentRect = contentRef.current?.getBoundingClientRect() || null;

  const setFocusedTaskId = useCallback((taskId: TaskId) => {
    setFocusedTaskIdState(taskId);
  }, []);

  const toggleGrade = (gradeId: string) => {
    setExpandedGradeIds((current) =>
      current.includes(gradeId) ? current.filter((item) => item !== gradeId) : [...current, gradeId],
    );
  };

  const toggleChapter = (chapterId: string) => {
    setExpandedChapterIds((current) =>
      current.includes(chapterId) ? current.filter((item) => item !== chapterId) : [...current, chapterId],
    );
  };

  const handleSelectTask = (gradeId: string, chapterId: string, taskId: TaskId) => {
    setFocusedTaskIdState(taskId);
    setExpandedGradeIds((current) => (current.includes(gradeId) ? current : [...current, gradeId]));
    setExpandedChapterIds((current) => (current.includes(chapterId) ? current : [...current, chapterId]));
    setIsNavDrawerOpen(false);
    navigate("/");
  };

  const cancelPreviewClose = () => {
    if (previewCloseTimer.current) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = null;
    }
  };

  const handlePreviewOpen = (taskId: TaskId, element: HTMLElement) => {
    if (taskId === activeTaskId) return;
    cancelPreviewClose();
    setPreviewState({ taskId, anchorRect: element.getBoundingClientRect() });
  };

  const handlePreviewClose = () => {
    cancelPreviewClose();
    previewCloseTimer.current = window.setTimeout(() => {
      setPreviewState(null);
    }, 120);
  };

  const submitAuth = () => {
    const trimmed = studentNameDraft.trim();
    if (!trimmed) return;
    if (studentName && studentName !== trimmed) {
      for (const taskId of Object.keys(TASK_DEFINITIONS) as TaskId[]) {
        clearStoredSessionId(taskId);
      }
    }
    persistStudentName(trimmed);
    setStudentNameState(trimmed);
    setStudentNameDraft(trimmed);
    setIsAuthOpen(false);
  };

  const requestAuth = useCallback(() => {
    setStudentNameDraft(studentName);
    setIsAuthOpen(true);
  }, [studentName]);

  const outletContext: WorkspaceOutletContext = {
    tree,
    focusedTaskId,
    focusedTask,
    activeTaskId,
    studentName,
    isStudentReady: Boolean(studentName),
    requestAuth,
    setFocusedTaskId,
    setTopNavContent,
  };

  const sidebar = (
    <SidebarNav
      tree={tree}
      focusedTaskId={focusedTaskId}
      activeTaskId={activeTaskId}
      expandedGradeIds={expandedGradeIds}
      expandedChapterIds={expandedChapterIds}
      onToggleGrade={toggleGrade}
      onToggleChapter={toggleChapter}
      onSelectTask={handleSelectTask}
      onPreviewOpen={handlePreviewOpen}
      onPreviewClose={handlePreviewClose}
      isStudentReady={Boolean(studentName)}
    />
  );

  const isPracticeTopNav = topNavContent?.tone === "practice";

  return (
    <div className={`ks-app-shell ${isPracticeTopNav ? "is-practice-session" : ""}`}>
      <header className={`ks-top-nav ${isPracticeTopNav ? "is-practice" : ""}`}>
        <div className="ks-top-nav-left">
          <button className="ks-icon-button ks-top-nav-menu" type="button" onClick={() => setIsNavDrawerOpen(true)} title="Open navigation">
            <span className="material-symbols-outlined">menu</span>
          </button>
        </div>

        <div className={`ks-top-nav-center ${isPracticeTopNav ? "is-practice-fill" : ""}`}>{topNavContent?.content || null}</div>

        <div className="ks-top-nav-right">
          <button className="ks-icon-button" type="button" title="Notifications">
            <span className="material-symbols-outlined">notifications</span>
          </button>
          <button className="ks-icon-button" type="button" onClick={requestAuth} title="Settings">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button className="ks-avatar-button" type="button" onClick={requestAuth} title={studentName || "Set student name"}>
            <span>{avatarLabel(studentName)}</span>
          </button>
        </div>
      </header>

      <div className="ks-app-body">
        <main className="ks-content-area" ref={contentRef}>
          <Outlet context={outletContext} />
        </main>
      </div>

      {isNavDrawerOpen && (
        <div className="workspace-drawer-backdrop" role="presentation" onClick={() => setIsNavDrawerOpen(false)}>
          <div className="panel workspace-drawer ks-mobile-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}

      <TaskPreviewPopover
        task={previewTask}
        anchorRect={previewState?.anchorRect || null}
        contentRect={contentRect}
        onMouseEnter={cancelPreviewClose}
        onMouseLeave={handlePreviewClose}
      />

      <AuthModal
        open={isAuthOpen}
        value={studentNameDraft}
        onChange={setStudentNameDraft}
        onSubmit={submitAuth}
        canDismiss={Boolean(studentName)}
        onDismiss={() => setIsAuthOpen(false)}
      />
    </div>
  );
}

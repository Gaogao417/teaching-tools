import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, matchPath, useLocation } from "react-router-dom";
import type { TaskId } from "../../../../shared/contracts";
import { api } from "../../api/client";
import { AuthModal } from "../common/AuthModal";
import { SidebarNav } from "./SidebarNav";
import { TaskPreviewPopover } from "./TaskPreviewPopover";
import type { WorkspaceOutletContext } from "./workspaceContext";
import { findFirstTask, findTaskPath, getTaskNode } from "./workspaceUtils";
import { clearStoredSessionId, getStudentName, setStudentName as persistStudentName } from "../../utils/storage";

type PreviewState = {
  taskId: TaskId;
  anchorRect: DOMRect;
};

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 980px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 980px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobile;
}

export function WorkspaceShell() {
  const location = useLocation();
  const isMobile = useIsMobile();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const previewCloseTimer = useRef<number | null>(null);
  const [tree, setTree] = useState<Awaited<ReturnType<typeof api.getTaskTree>> | null>(null);
  const [focusedTaskId, setFocusedTaskIdState] = useState<TaskId | null>(null);
  const [expandedGradeIds, setExpandedGradeIds] = useState<string[]>([]);
  const [expandedChapterIds, setExpandedChapterIds] = useState<string[]>([]);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [studentName, setStudentNameState] = useState(() => getStudentName());
  const [studentNameDraft, setStudentNameDraft] = useState(() => getStudentName());
  const [isAuthOpen, setIsAuthOpen] = useState(() => !getStudentName());

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
    if (isMobile) {
      setIsMobileDrawerOpen(false);
    }
  };

  const cancelPreviewClose = () => {
    if (previewCloseTimer.current) {
      window.clearTimeout(previewCloseTimer.current);
      previewCloseTimer.current = null;
    }
  };

  const handlePreviewOpen = (taskId: TaskId, element: HTMLElement) => {
    if (isMobile || taskId === activeTaskId) return;
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
      clearStoredSessionId("meaning");
      clearStoredSessionId("ratioToSide");
      clearStoredSessionId("guidedSolve");
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

  return (
    <div className="workspace-app">
      <header className="workspace-topbar">
        <div className="workspace-topbar-copy">
          <div className="eyebrow">Unified Workspace</div>
          <h1>三角比高频训练工作区</h1>
          <p className="text-muted">统一浏览任务、进入训练，并在同一壳层内查看结果。</p>
        </div>

        <div className="workspace-topbar-actions">
          <button className="btn btn-ghost workspace-drawer-trigger" type="button" onClick={() => setIsMobileDrawerOpen(true)}>
            打开任务树
          </button>
          <div className="student-lockup">
            <span className="student-lockup-label">当前学生</span>
            <strong>{studentName || "未填写姓名"}</strong>
          </div>
          {!activeTaskId && (
            <button className="btn btn-secondary" type="button" onClick={requestAuth}>
              {studentName ? "重新填写姓名" : "填写姓名"}
            </button>
          )}
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="panel workspace-sidebar">{sidebar}</aside>
        <main className="workspace-content" ref={contentRef}>
          <Outlet context={outletContext} />
        </main>
      </div>

      {isMobile && isMobileDrawerOpen && (
        <div className="workspace-drawer-backdrop" role="presentation" onClick={() => setIsMobileDrawerOpen(false)}>
          <div className="panel workspace-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
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

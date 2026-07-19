import { useLocation } from "react-router-dom";
import type { TaskId } from "../../../../shared/contracts";

type LearningMode = "learn" | "practice" | "review";

const MODES: Array<{ id: LearningMode; label: string; icon: string }> = [
  { id: "learn", label: "学习", icon: "menu_book" },
  { id: "practice", label: "训练", icon: "target" },
  { id: "review", label: "复盘", icon: "insights" },
];

function modeFromPath(pathname: string): LearningMode {
  if (pathname.startsWith("/practice/")) return "practice";
  if (pathname.startsWith("/review/") || pathname.startsWith("/result/")) return "review";
  return "learn";
}

export function LearningModeNav({ taskId, isStudentReady, onNeedStudent, onNavigate }: {
  taskId: TaskId | null;
  isStudentReady: boolean;
  onNeedStudent: () => void;
  onNavigate: (path: string) => void;
}) {
  const location = useLocation();
  const activeMode = modeFromPath(location.pathname);

  const openMode = (mode: LearningMode) => {
    if (!taskId) return;
    if ((mode === "practice" || mode === "review") && !isStudentReady) {
      onNeedStudent();
      return;
    }
    onNavigate(`/${mode}/${taskId}`);
  };

  return (
    <nav className="ks-mode-nav" aria-label="学习模式">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          className={`ks-mode-tab ${activeMode === mode.id ? "is-active" : ""}`}
          type="button"
          aria-current={activeMode === mode.id ? "page" : undefined}
          disabled={!taskId}
          onClick={() => openMode(mode.id)}
        >
          <span className="material-symbols-outlined">{mode.icon}</span>
          <span>{mode.label}</span>
        </button>
      ))}
    </nav>
  );
}

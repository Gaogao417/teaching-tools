import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
import { PracticePage } from "./pages/PracticePage";
import { ResultPage } from "./pages/ResultPage";
import { TaskOverviewPanel } from "./pages/TaskOverviewPanel";
import { ReviewPage } from "./pages/ReviewPage";
import { LearnPage } from "./pages/LearnPage";
import { SimilarityLearningMapPage } from "./pages/SimilarityLearningMapPage";
// fe-prep（2026-08-28）：canonical view/v1 fixtures 驱动的 dev/test harness
// 页——顶层注册（不进 WorkspaceShell、无 API 依赖、不触 /learn 数据流）；
// 非产品路径，F6 真实链接入后删除或降级为诊断页（fe-prep exit report 登记）。
import { CanonicalViewHarnessPage } from "./pages/dev/CanonicalViewHarnessPage";

export default function App() {
  return (
    <>
    {import.meta.env.VITE_TEACH_REVIEW === "1" && (
      <div role="status" style={{ position: "fixed", top: "64px", left: 0, right: 0, zIndex: 100, padding: "8px 20px", fontSize: "13px", background: "#fff3cd", color: "#664d03", textAlign: "center" }}>
        教研试讲 · 待审核草稿 · 可直接说出理解或疑问，无需逐步答题
      </div>
    )}
    {import.meta.env.VITE_TEACH_REVIEW === "1" && <div aria-hidden="true" style={{ height: "38px", flexShrink: 0 }} />}
    <Routes>
      <Route path="/" element={<WorkspaceShell />}>
        <Route index element={<TaskOverviewPanel />} />
        <Route path="map/similarity" element={<SimilarityLearningMapPage />} />
        <Route path="learn/:taskId" element={<LearnPage />} />
        <Route path="practice/:taskId" element={<PracticePage />} />
        <Route path="review/:taskId" element={<ReviewPage />} />
        <Route path="result/:sessionId" element={<ResultPage />} />
      </Route>
      <Route path="/tasks" element={<Navigate to="/" replace />} />
      <Route path="/__fe-prep__/canonical-view" element={<CanonicalViewHarnessPage />} />
    </Routes>
    </>
  );
}

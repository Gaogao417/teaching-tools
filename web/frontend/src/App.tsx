import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
import { PracticePage } from "./pages/PracticePage";
import { ResultPage } from "./pages/ResultPage";
import { TaskOverviewPanel } from "./pages/TaskOverviewPanel";
import { ReviewPage } from "./pages/ReviewPage";
import { LearnPage } from "./pages/LearnPage";
import { SimilarityLearningMapPage } from "./pages/SimilarityLearningMapPage";
import PocPage from "./poc/geometry-actions/PocPage";

export default function App() {
  return (
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
      {/* Isolated POC: functional geometry-actions architecture. No app shell. */}
      <Route path="/poc/geometry-actions" element={<PocPage />} />
    </Routes>
  );
}

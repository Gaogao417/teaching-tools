import { Navigate, Route, Routes } from "react-router-dom";
import { WorkspaceShell } from "./components/layout/WorkspaceShell";
import { PracticePage } from "./pages/PracticePage";
import { ResultPage } from "./pages/ResultPage";
import { TaskOverviewPanel } from "./pages/TaskOverviewPanel";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<WorkspaceShell />}>
        <Route index element={<TaskOverviewPanel />} />
        <Route path="practice/:taskId" element={<PracticePage />} />
        <Route path="result/:sessionId" element={<ResultPage />} />
      </Route>
      <Route path="/tasks" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

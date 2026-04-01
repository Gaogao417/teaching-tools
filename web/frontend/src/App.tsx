import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "./pages/HomePage";
import { PracticePage } from "./pages/PracticePage";
import { ResultPage } from "./pages/ResultPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/tasks" element={<Navigate to="/" replace />} />
      <Route path="/practice/:taskId" element={<PracticePage />} />
      <Route path="/result/:sessionId" element={<ResultPage />} />
    </Routes>
  );
}

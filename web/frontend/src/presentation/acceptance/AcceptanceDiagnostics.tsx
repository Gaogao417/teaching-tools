/**
 * VS0 验收诊断条（mvp/vs-00 REQ-04）：`?acceptance=1` 时渲染的只读诊断。
 *
 * 只暴露路由/会话/revision/fallback 状态四类事实——不含 hidden canonical
 * nodes、reasoning hypothesis 或任何答案真值（字段白名单）。它不是生产
 * 学生功能：无 acceptance 查询参数时整个组件不渲染。
 */
export type AcceptanceRouteKind = "pending" | "tutor-vnext" | "legacy";

export interface AcceptanceDiagnosticsProps {
  taskId: string;
  route: AcceptanceRouteKind;
  sessionId?: string;
  viewRevision?: number;
  /** tutor 尝试后回退 legacy（restore 失败等）时为 true；直接无 Binding 的
   *  legacy 路由不算 fallback。fail-closed 错误不设 true（未发生回退）。 */
  fallbackOccurred?: boolean;
}

const ROUTE_LABELS: Record<AcceptanceRouteKind, string> = {
  pending: "route: pending（入口决策中）",
  "tutor-vnext": "route: tutor-vnext",
  legacy: "route: legacy",
};

export function AcceptanceDiagnostics({ taskId, route, sessionId, viewRevision, fallbackOccurred }: AcceptanceDiagnosticsProps) {
  return (
    <aside
      className="acceptance-diagnostics"
      data-testid="acceptance-diagnostics"
      data-task-id={taskId}
      data-route={route}
      data-session-id={sessionId ?? ""}
      data-view-revision={viewRevision ?? ""}
      data-fallback={String(Boolean(fallbackOccurred))}
      aria-label="验收诊断（仅测试）"
    >
      <strong>VS0 验收诊断</strong>
      <dl>
        <div><dt>taskId</dt><dd>{taskId}</dd></div>
        <div><dt>route</dt><dd>{ROUTE_LABELS[route]}</dd></div>
        <div><dt>sessionId</dt><dd>{sessionId ?? "—"}</dd></div>
        <div><dt>viewRevision</dt><dd>{viewRevision ?? "—"}</dd></div>
        <div><dt>fallback</dt><dd>{fallbackOccurred ? "occurred" : "none"}</dd></div>
      </dl>
    </aside>
  );
}

/**
 * fe-prep（2026-08-28；2026-08-29 复验修复 P2）：同 session 的 Workspace
 * 与 Coach 投影一致性检查（ADR-010 不变量 4：Panel、Participation、
 * Workspace 来自同一 session/revision）。纯函数——harness 页与（未来）
 * F6/F7 组合层复用；不一致必须显式失败，不得静默各渲染各的。
 *
 * 比较键是 **session_id + revision 双键**（2026-08-29 复验 P2 修复：只比
 * revision 会放过"不同 session 恰好同 revision"的错配投影——两投影必须
 * 来自同一 session 的同一 revision 才算一致）。
 */
export interface RevisionedProjection {
  readonly session_id: string;
  readonly revision: number;
}

/**
 * 任一侧缺席 → null（无从比较，不判失败）；两侧 session_id 与 revision 均
 * 一致 → true；任一键不一致 → false（调用方必须停止组合渲染并显示
 * region-error，两个 surface 均不得渲染——fail closed）。
 */
export function checkProjectionRevisionConsistency(
  workspace: RevisionedProjection | null,
  coach: RevisionedProjection | null,
): boolean | null {
  if (workspace === null || coach === null) return null;
  return workspace.session_id === coach.session_id && workspace.revision === coach.revision;
}

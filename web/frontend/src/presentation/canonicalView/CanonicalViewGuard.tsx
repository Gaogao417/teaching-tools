/**
 * fe-prep（2026-08-28）：canonical View 的防御性渲染闸门。
 *
 * - 解析成功 → 渲染 children(view)（纯 View→UI）；
 * - 解析失败 → role="alert" 的 region-error 明确失败面（ADR-009 六区域
 *   之一），**不渲染任何 payload 内容、不回显 payload 派生文本**（学生
 *   安全：负例中的答案真值键/文本必须零出现）；完整 issues 仅进
 *   console.error 供开发诊断。
 */
import type { ReactNode } from "react";

import type { CanonicalParseResult } from "./parseCanonicalView";

export interface CanonicalViewGuardProps<T> {
  /** 失败面归属（如 "student-workspace-view"），与 view/v1 合同名对齐。 */
  scope: string;
  result: CanonicalParseResult<T>;
  children: (view: T) => ReactNode;
}

export function CanonicalViewGuard<T>({ scope, result, children }: CanonicalViewGuardProps<T>) {
  if (result.ok) {
    return <>{children(result.view)}</>;
  }
  if (import.meta.env.DEV) {
    console.error(`[canonical-view-guard] ${scope} 校验失败：`, result.issues);
  }
  return (
    <section
      className="canonical-view-guard"
      role="alert"
      aria-label="视图校验失败"
      data-testid="region-error"
      data-guard-scope={scope}
      data-issue-count={result.issues.length}
    >
      <p>学生安全视图校验失败，已停止渲染（{scope}，{result.issues.length} 项问题）。</p>
      <p>内容不可用时显示此提示，不展示未经校验的内容。</p>
    </section>
  );
}

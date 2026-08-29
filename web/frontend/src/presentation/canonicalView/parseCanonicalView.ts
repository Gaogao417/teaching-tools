/**
 * fe-prep（2026-08-28）：view/v1 三合同的 fail-closed 解析入口。
 *
 * renderer/页面不得直接把未知 JSON 当 View 渲染：一切输入先经 canonical
 * Zod safeParse（与 backend 合同 parity 门禁同一份 schema），失败时返回
 * 结构化 issues（由 CanonicalViewGuard 呈现为 region-error，不渲染内容、
 * 不回显 payload 文本）。fixtures 与（F6/F7 后的）真实 response 走同一
 * 入口——本轨不接真实 response。
 */
import {
  coachPanelViewV1Schema,
  mainlineParticipationV1Schema,
  studentWorkspaceViewV1Schema,
} from "../../../../shared/canonical/schemas";
import type {
  CoachPanelViewV1,
  MainlineParticipationV1,
  StudentWorkspaceViewV1,
} from "./canonicalViewTypes";

export type CanonicalParseResult<T> =
  | { readonly ok: true; readonly view: T }
  | { readonly ok: false; readonly issues: readonly string[] };

function parseWith<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } }, input: unknown): CanonicalParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, view: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
  };
}

/** StudentWorkspaceView v1 fail-closed 解析（truth-leak/slice-revision 负例在此拒绝）。 */
export function parseStudentWorkspaceView(input: unknown): CanonicalParseResult<StudentWorkspaceViewV1> {
  return parseWith(studentWorkspaceViewV1Schema, input);
}

/** CoachPanelView v1 fail-closed 解析（untyped mainline 负例在此拒绝）。 */
export function parseCoachPanelView(input: unknown): CanonicalParseResult<CoachPanelViewV1> {
  return parseWith(coachPanelViewV1Schema, input);
}

/** MainlineParticipation v1 fail-closed 解析（unknown kind 负例在此拒绝）。 */
export function parseMainlineParticipation(input: unknown): CanonicalParseResult<MainlineParticipationV1> {
  return parseWith(mainlineParticipationV1Schema, input);
}

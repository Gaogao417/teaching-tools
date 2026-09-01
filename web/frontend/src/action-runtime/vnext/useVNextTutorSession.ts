/**
 * F7 — vNext 学生会话 hook（唯一前端状态组装点；复用 ADR-009 canonical
 * owner 位 useTutorLearning 的 vNext 后继，不并行旧链状态）。
 *
 * 纪律（f7-scope-ledger / fe-prep 对接面 1/6）：
 * - 一切视图输入经 parseCanonicalView fail-closed 解析（不绕过 parse 直喂
 *   组件）；Workspace 与 Coach 须同 session 同 revision（双键一致性检查，
 *   不一致不渲染任一 surface）；
 * - answer 草稿/提交 busy 是前端瞬时状态；教学事实只来自服务端响应；
 * - refresh/reconnect 走 GET restore（服务端 rebuilt state），不本地推导。
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  vnextApi,
  VNextApiError,
  type VNextIntentKind,
  type VNextSessionResponse,
} from "../../api/vnextTutorClient";
import {
  checkProjectionRevisionConsistency,
} from "../../presentation/canonicalView/projectionRevisionConsistency";
import {
  parseCoachPanelView,
  parseStudentWorkspaceView,
} from "../../presentation/canonicalView/parseCanonicalView";
import type { CoachPanelViewV1, StudentWorkspaceViewV1 } from "../../presentation/canonicalView/canonicalViewTypes";

function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof VNextApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "NETWORK", message: error.message };
  return { code: "NETWORK", message: String(error) };
}

export interface VNextParsedSession {
  readonly sessionId: string;
  readonly revision: number;
  readonly workspaceRevision: number;
  readonly completed: boolean;
  readonly assessment: boolean;
  readonly workspaceView: StudentWorkspaceViewV1;
  readonly coachView: CoachPanelViewV1;
  readonly lastFailure?: { category: string; failure_class: string; message?: string };
}

export interface VNextTutorSessionState {
  readonly phase: "loading" | "ready" | "recovering" | "fatal";
  readonly sessionId?: string;
  readonly question?: { stem: string };
  readonly geometry?: unknown;
  readonly session?: VNextParsedSession;
  /** fail-closed 解析/一致性失败（region-error 语义；不回显 payload）。 */
  readonly parseIssues?: readonly string[];
  /** 传输/服务端错误（含 404 会话丢失——可重开）。 */
  readonly error?: { code: string; message: string };
  readonly busy: boolean;
  /** 上一轮的显式教学失败（revision_conflict 等——可恢复提示）。 */
  readonly lastTurnFailure?: { failure_class: string; message: string };
}

interface ParsedOk {
  sessionId: string;
  revision: number;
  workspaceRevision: number;
  completed: boolean;
  assessment: boolean;
  workspaceView: StudentWorkspaceViewV1;
  coachView: CoachPanelViewV1;
  lastFailure?: { category: string; failure_class: string; message?: string };
}

/** 响应 → fail-closed 解析 + 双键一致性；任何失败返回 issues（不渲染半套视图）。 */
function parseSessionResponse(response: VNextSessionResponse): { ok: true; value: ParsedOk } | { ok: false; issues: string[] } {
  const workspace = parseStudentWorkspaceView(response.views.student_workspace_view);
  if (!workspace.ok) return { ok: false, issues: [`student_workspace_view: ${workspace.issues.join("; ")}`] };
  const coach = parseCoachPanelView(response.views.coach_panel_view);
  if (!coach.ok) return { ok: false, issues: [`coach_panel_view: ${coach.issues.join("; ")}`] };
  const consistent = checkProjectionRevisionConsistency(
    { session_id: workspace.view.session_id, revision: workspace.view.revision },
    { session_id: coach.view.session_id, revision: coach.view.revision },
  );
  if (consistent === false) {
    return {
      ok: false,
      issues: [
        `projection revision mismatch: workspace ${workspace.view.session_id}@${workspace.view.revision} vs coach ${coach.view.session_id}@${coach.view.revision}`,
      ],
    };
  }
  return {
    ok: true,
    value: {
      sessionId: response.session_id,
      revision: response.revision,
      workspaceRevision: response.views.status.workspace_revision,
      completed: response.completed,
      assessment: response.assessment,
      workspaceView: workspace.view,
      coachView: coach.view,
      lastFailure: response.views.status.last_failure,
    },
  };
}

export function useVNextTutorSession(input: { taskId: string; studentId: string; restoreSessionId?: string }) {
  const [state, setState] = useState<VNextTutorSessionState>({ phase: "loading", busy: false });
  const startedRef = useRef(false);
  const busyRef = useRef(false);

  const applyResponse = useCallback((response: VNextSessionResponse, extra?: { question?: { stem: string }; geometry?: unknown }) => {
    const parsed = parseSessionResponse(response);
    if (!parsed.ok) {
      busyRef.current = false;
      setState((prev) => ({ ...prev, phase: "fatal", busy: false, parseIssues: parsed.issues }));
      return;
    }
    busyRef.current = false;
    setState((prev) => ({
      phase: "ready",
      sessionId: response.session_id,
      // 静态题面（question/geometry）只在 start/restore 响应携带；intent 轮
      // 响应不带——保留前值，不因轮次响应清空题图。
      question: extra?.question ?? (response.question ? { stem: response.question.stem } : undefined) ?? prev.question,
      geometry: extra?.geometry ?? response.geometry ?? prev.geometry,
      session: parsed.value,
      busy: false,
      lastTurnFailure: response.turn?.failure,
    }));
  }, []);

  const start = useCallback(
    async (options: { assessment?: boolean } = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setState((prev) => ({ ...prev, busy: true, error: undefined, parseIssues: undefined }));
      try {
        const response = await vnextApi.start({ studentId: input.studentId, ...(options.assessment ? { assessment: true } : {}) });
        applyResponse(response);
      } catch (error) {
        busyRef.current = false;
        setState((prev) => ({
          ...prev,
          phase: "fatal",
          busy: false,
          error: toErrorInfo(error),
        }));
      }
    },
    [applyResponse, input.studentId],
  );

  const restore = useCallback(
    async (sessionId: string): Promise<"ok" | "missing" | "invalid"> => {
      if (busyRef.current) return "ok";
      busyRef.current = true;
      setState((prev) => ({ ...prev, busy: true, error: undefined, parseIssues: undefined }));
      try {
        const response = await vnextApi.restore(sessionId);
        applyResponse(response);
        busyRef.current = false;
        return "ok";
      } catch (error) {
        busyRef.current = false;
        if (error instanceof VNextApiError && error.status === 404) {
          setState((prev) => ({ ...prev, busy: false }));
          return "missing";
        }
        setState((prev) => ({
          ...prev,
          phase: "recovering",
          busy: false,
          error: toErrorInfo(error),
        }));
        return "invalid";
      }
    },
    [applyResponse],
  );

  const submitIntent = useCallback(
    async (intentKind: VNextIntentKind, text?: string) => {
      const current = state.session;
      if (!current || busyRef.current) return;
      busyRef.current = true;
      setState((prev) => ({ ...prev, busy: true, error: undefined, parseIssues: undefined }));
      try {
        const response = await vnextApi.submitIntent(current.sessionId, {
          intentKind,
          ...(text !== undefined ? { text } : {}),
          expectedRevision: current.revision,
        });
        applyResponse(response);
      } catch (error) {
        busyRef.current = false;
        setState((prev) => ({
          ...prev,
          busy: false,
          error: toErrorInfo(error),
        }));
      }
    },
    [applyResponse, state.session],
  );

  const submitWorkspaceCommand = useCallback(
    async (command: { surface: "geometry" | "solution_board"; capability: string; targetIds: string[]; params?: Record<string, unknown> }) => {
      const current = state.session;
      if (!current || busyRef.current) return;
      busyRef.current = true;
      setState((prev) => ({ ...prev, busy: true, error: undefined, parseIssues: undefined }));
      try {
        const response = await vnextApi.submitWorkspaceCommand(current.sessionId, {
          surface: command.surface,
          capability: command.capability,
          targetIds: command.targetIds,
          expectedWorkspaceRevision: current.workspaceRevision,
          ...(command.params !== undefined ? { params: command.params } : {}),
        });
        applyResponse(response);
      } catch (error) {
        busyRef.current = false;
        setState((prev) => ({
          ...prev,
          busy: false,
          error: toErrorInfo(error),
        }));
      }
    },
    [applyResponse, state.session],
  );

  useEffect(() => {
    if (startedRef.current || !input.studentId) return;
    startedRef.current = true;
    if (input.restoreSessionId) {
      void restore(input.restoreSessionId).then((outcome) => {
        if (outcome === "missing") void start();
      });
      return;
    }
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input.studentId]);

  return { state, start, restore, submitIntent, submitWorkspaceCommand };
}

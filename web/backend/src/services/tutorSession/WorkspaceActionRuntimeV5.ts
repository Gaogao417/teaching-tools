/**
 * WorkspaceActionRuntimeV5（F3 — Workspace 状态转换内核；ADR-008 §4 抽象签名）。
 *
 *     ExecutePresentation:  (state, WorkspaceSurfaceAction)       → Result<Transition>
 *     ExecuteStudentCommand:(state, StudentWorkspaceCommand)      → Result<Transition>
 *
 * 纯函数（不触 db）：validator（canonical Zod + capability 注册表 + target/
 * mode/truth 边界 + Geometry 内核 dry-run）与 reducer 在此合流——效果应用复用
 * WorkspaceRuntimeReducerV5.applyWorkspaceEffect（与重建同一函数，结构性保证）。
 *
 * 产出 = 待追加事件批（issued/intent + outcome）+ next state（fold）；持久化由
 * WorkspaceSessionRuntimeV5 经 F2 kernel.append 真实提交路径完成。
 *
 * 拒绝语义（f3-scope-ledger）：
 * - student command 的拒绝是学生输入事实：返回 intent+outcome(rejected) 事件对
 *   （零状态效果、零 revision 推进）；
 * - tutor WSA 校验失败是编排方缺陷（F6 记 presentation_failed）：不产事件。
 */
import type { z } from "zod";
import {
  actionOutcomeV1Schema,
  studentWorkspaceCommandV1Schema,
  workspaceSurfaceActionV1Schema,
} from "../../../../shared/canonical";
import type {
  PendingStudentCommandBody,
  PendingTutorActionPayload,
  WorkspaceFold,
} from "./WorkspaceRuntimeReducerV5";
import {
  applyWorkspaceEffect,
  WorkspaceTransitionRejectedError,
} from "./WorkspaceRuntimeReducerV5";
import { resolveWorkspaceCapability } from "./WorkspaceCapabilityRegistryV5";
import type { WorkspacePresentationCatalogV5 } from "./WorkspacePresentationCatalogV5";

export type WorkspaceSurfaceActionV5 = z.infer<typeof workspaceSurfaceActionV1Schema>;
export type StudentWorkspaceCommandV5 = z.infer<typeof studentWorkspaceCommandV1Schema>;

export type StudentOutcomeKind = z.infer<typeof actionOutcomeV1Schema>["outcome"];

export interface WorkspaceIssuedEventPlan {
  /** workspace_surface_action_issued payload（canonical 事件形状，envelope 由 store 组装）。 */
  issuedPayload: PendingTutorActionPayload;
  outcomePayload: {
    action_id: string;
    action_kind: "workspace_surface" | "student_command";
    outcome: StudentOutcomeKind;
    resulting_revision?: number;
    message?: string;
  };
}

export interface WorkspaceStudentCommandEventPlan {
  /** student_intent_recorded payload（含 workspace_command 内嵌）。 */
  intentPayload: {
    intent_kind: "submit_workspace_command";
    client_request_id: string;
    workspace_command: PendingStudentCommandBody;
  };
  outcomePayload: {
    action_id: string;
    action_kind: "student_command";
    outcome: StudentOutcomeKind;
    resulting_revision?: number;
    message?: string;
  };
}

export type WorkspacePresentationExecution =
  | {
      status: "completed";
      nextFold: WorkspaceFold;
      changed: boolean;
      resultingRevision: number;
      events: WorkspaceIssuedEventPlan;
    }
  | { status: "rejected"; reason: string };

export type WorkspaceStudentCommandExecution =
  | {
      status: "completed";
      nextFold: WorkspaceFold;
      changed: boolean;
      resultingRevision: number;
      events: WorkspaceStudentCommandEventPlan;
    }
  | {
      /** 拒绝：canonical 合法时 intent+outcome(rejected) 事实入流，零状态效果；canonical 非法零事实。 */
      status: "rejected";
      reason: string;
      events?: WorkspaceStudentCommandEventPlan;
    };

function canonicalErrors(errors: readonly string[]): string {
  return `canonical 校验失败：${errors.join("; ")}`;
}

/** ExecutePresentation（origin=tutor；ADR-008 不变量 1）。 */
export function executeWorkspacePresentationV5(args: {
  fold: WorkspaceFold;
  catalog: WorkspacePresentationCatalogV5;
  action: unknown;
}): WorkspacePresentationExecution {
  const canonical = workspaceSurfaceActionV1Schema.safeParse(args.action);
  if (!canonical.success) {
    return {
      status: "rejected",
      reason: canonicalErrors(canonical.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)),
    };
  }
  const action = canonical.data;
  if (action.session_id !== args.fold.state.session_id) {
    return { status: "rejected", reason: `action.session_id ${action.session_id} 与会话不符` };
  }
  const spec = resolveWorkspaceCapability(action.capability, action.surface, "tutor");
  if (!spec) {
    return { status: "rejected", reason: `capability 未登记或 origin/surface 不匹配：tutor:${action.surface}:${action.capability}` };
  }
  const issuedPayload: PendingTutorActionPayload = {
    action_id: action.action_id,
    decision_id: action.decision_id,
    ...(action.beat_id !== undefined ? { beat_id: action.beat_id } : {}),
    surface: action.surface,
    capability: action.capability,
    ...(action.target_ids !== undefined ? { target_ids: action.target_ids } : {}),
    ...(action.command_payload !== undefined ? { command_payload: action.command_payload } : {}),
    reveal_scope: action.reveal_scope,
    ...(action.presentation_only !== undefined ? { presentation_only: action.presentation_only } : {}),
  };
  try {
    const applied = applyWorkspaceEffect({
      fold: args.fold,
      catalog: args.catalog,
      spec,
      action: issuedPayload,
    });
    const resultingRevision = applied.changed ? args.fold.state.revision + 1 : args.fold.state.revision;
    return {
      status: "completed",
      nextFold: { ...applied.fold, state: { ...applied.fold.state, revision: resultingRevision } },
      changed: applied.changed,
      resultingRevision,
      events: {
        issuedPayload,
        outcomePayload: {
          action_id: action.action_id,
          action_kind: "workspace_surface",
          outcome: "completed",
          ...(applied.changed ? { resulting_revision: resultingRevision } : {}),
        },
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceTransitionRejectedError) {
      return { status: "rejected", reason: error.reason };
    }
    throw error;
  }
}

/** ExecuteStudentCommand（origin=student；stale/幂等校验入口）。 */
export function executeStudentWorkspaceCommandV5(args: {
  fold: WorkspaceFold;
  catalog: WorkspacePresentationCatalogV5;
  command: unknown;
}): WorkspaceStudentCommandExecution {
  const canonical = studentWorkspaceCommandV1Schema.safeParse(args.command);
  if (!canonical.success) {
    // canonical 拒绝时无法组装合法 intent 内嵌——零事实（不入流）。
    return {
      status: "rejected",
      reason: canonicalErrors(canonical.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)),
    };
  }
  const command = canonical.data;
  const commandBody: PendingStudentCommandBody = {
    command_id: command.command_id,
    surface: command.surface,
    capability: command.capability,
    target_ids: command.target_ids,
    ...(command.params !== undefined ? { params: command.params } : {}),
    expected_workspace_revision: command.expected_workspace_revision,
    client_command_id: command.client_command_id,
  };
  const intentPayload = {
    intent_kind: "submit_workspace_command" as const,
    client_request_id: command.client_command_id,
    workspace_command: commandBody,
  };
  const reject = (reason: string): WorkspaceStudentCommandExecution => ({
    status: "rejected",
    reason,
    events: {
      intentPayload,
      outcomePayload: { action_id: command.command_id, action_kind: "student_command", outcome: "rejected", message: reason },
    },
  });

  if (command.session_id !== args.fold.state.session_id) {
    return reject(`command.session_id ${command.session_id} 与会话不符`);
  }
  // 乐观并发：expected_workspace_revision ≠ 当前 → stale 拒绝（不静默覆盖）。
  if (command.expected_workspace_revision !== args.fold.state.revision) {
    return reject(
      `stale_revision：expected_workspace_revision=${command.expected_workspace_revision} 但当前 workspace revision=${args.fold.state.revision}`,
    );
  }
  const spec = resolveWorkspaceCapability(command.capability, command.surface, "student");
  if (!spec) {
    return reject(`capability 未登记或 origin/surface 不匹配：student:${command.surface}:${command.capability}`);
  }
  try {
    const applied = applyWorkspaceEffect({
      fold: args.fold,
      catalog: args.catalog,
      spec,
      action: commandBody,
    });
    const resultingRevision = applied.changed ? args.fold.state.revision + 1 : args.fold.state.revision;
    return {
      status: "completed",
      nextFold: { ...applied.fold, state: { ...applied.fold.state, revision: resultingRevision } },
      changed: applied.changed,
      resultingRevision,
      events: {
        intentPayload,
        outcomePayload: {
          action_id: command.command_id,
          action_kind: "student_command",
          outcome: "completed",
          ...(applied.changed ? { resulting_revision: resultingRevision } : {}),
        },
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceTransitionRejectedError) {
      return reject(error.reason);
    }
    throw error;
  }
}

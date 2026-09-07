/**
 * F7 Step 6 Geometry / Board adapter（ledger 增补 20 偏差 1/2）。
 *
 * 完成判据 = workspaceCommitPort 的**真实** commit 信号（同 executionKey、同 session 且
 * revision ≥ delivery.workspace_revision——服务端在 delivery 前已应用语义，
 * workspace_revision 是应用回执）+ 快照数据级对账（target 存在/高亮）。
 * 真实信号源未注册（Step 7 接入前）→ awaiting-real-signal 暂停，不上报。
 * 过渡呈现面（文字列表）的 rAF 通知永不满足本等待（见 workspaceCommitPort）。
 */
import type { PendingPresentationDelivery, PresentationAdapterResult, PresentationToolAdapter } from "../types";
import { presentationKeyOf } from "../types";
import type { WorkspaceCommitPort } from "../workspaceCommitPort";

export interface WorkspaceSurfaceAdapterDependencies {
  commitPort: WorkspaceCommitPort;
  waitTimeoutMs?: number;
}

type WorkspaceAction = NonNullable<PendingPresentationDelivery["action"]["workspace_action"]>;

interface TargetCheck {
  ok: boolean;
  message?: string;
}

function verifyGeometryTargets(
  action: WorkspaceAction,
  canvasElements: readonly { element_id: string; highlighted?: boolean }[],
): TargetCheck {
  const targets = action.target_ids ?? [];
  if (targets.length === 0) return { ok: true };
  const byId = new Map(canvasElements.map((element) => [element.element_id, element]));
  const missing = targets.filter((target) => !byId.has(target));
  if (missing.length > 0) {
    return { ok: false, message: `geometry target_ids not present in workspace view canvas: ${missing.join(", ")}` };
  }
  if (action.reveal_scope === "target_highlight") {
    const notHighlighted = targets.filter((target) => byId.get(target)?.highlighted !== true);
    if (notHighlighted.length > 0) {
      return { ok: false, message: `reveal_scope=target_highlight but targets not highlighted: ${notHighlighted.join(", ")}` };
    }
  }
  return { ok: true };
}

function verifyBoardTargets(
  action: WorkspaceAction,
  groups: readonly { entries: readonly { entry_id: string; state: string }[] }[],
): TargetCheck {
  const targets = action.target_ids ?? [];
  if (targets.length === 0) return { ok: true };
  const entryIds = new Set(groups.flatMap((group) => group.entries.map((entry) => entry.entry_id)));
  const missing = targets.filter((target) => !entryIds.has(target));
  if (missing.length > 0) {
    return { ok: false, message: `solution_board target_ids not present in workspace view board: ${missing.join(", ")}` };
  }
  return { ok: true };
}

async function presentWorkspaceSurface(
  surface: "geometry" | "solution_board",
  delivery: PendingPresentationDelivery,
  snapshotCanvasElements: readonly { element_id: string; highlighted?: boolean }[],
  snapshotBoardGroups: readonly { entries: readonly { entry_id: string; state: string }[] }[],
  dependencies: WorkspaceSurfaceAdapterDependencies,
  abort: AbortSignal,
): Promise<PresentationAdapterResult> {
  const action = delivery.action.workspace_action!;
  // 1. 真实完成信号源未接（Step 7 前）：暂停，不上报 presented。
  if (!dependencies.commitPort.hasRealCommitSource()) {
    return { outcome: "awaiting-real-signal" };
  }
  // 2. 数据级对账：服务端在 delivery 前已应用 workspace 语义——目标必须已在
  //    同快照 student_workspace_view 生效（target 缺失 = illegal_target）。
  const check = surface === "geometry"
    ? verifyGeometryTargets(action, snapshotCanvasElements)
    : verifyBoardTargets(action, snapshotBoardGroups);
  if (!check.ok) {
    return { outcome: "failed", failureClass: "illegal_target", message: check.message };
  }
  // 3. 同一执行的完成证据；其他执行/无 pending 视图的同 revision 通知不放行。
  const wait = await dependencies.commitPort.waitForCommit(delivery.session_id, delivery.workspace_revision ?? 0, {
    executionKey: presentationKeyOf(delivery),
    abort,
    ...(dependencies.waitTimeoutMs !== undefined ? { timeoutMs: dependencies.waitTimeoutMs } : {}),
  });
  if (wait === "aborted") return { outcome: "interrupted" };
  if (wait === "timeout") {
    return { outcome: "failed", failureClass: "timeout", message: `${surface} commit not observed within timeout` };
  }
  return { outcome: "presented" };
}

export function createGeometryPresentationAdapter(dependencies: WorkspaceSurfaceAdapterDependencies): PresentationToolAdapter {
  return {
    supports(action) {
      return action.kind === "workspace"
        && action.workspace_action !== undefined
        && action.workspace_action.surface === "geometry"
        && action.workspace_action.capability === "geometry.construct";
    },
    async present({ delivery, snapshot, abort }) {
      return presentWorkspaceSurface(
        "geometry",
        delivery,
        snapshot.views.student_workspace_view.canvas.elements,
        snapshot.views.student_workspace_view.solution_board.groups,
        dependencies,
        abort,
      );
    },
  };
}

export function createBoardPresentationAdapter(dependencies: WorkspaceSurfaceAdapterDependencies): PresentationToolAdapter {
  return {
    supports(action) {
      return action.kind === "workspace"
        && action.workspace_action !== undefined
        && action.workspace_action.surface === "solution_board"
        && action.workspace_action.capability === "board.reveal-entry";
    },
    async present({ delivery, snapshot, abort }) {
      return presentWorkspaceSurface(
        "solution_board",
        delivery,
        snapshot.views.student_workspace_view.canvas.elements,
        snapshot.views.student_workspace_view.solution_board.groups,
        dependencies,
        abort,
      );
    },
  };
}

/**
 * F7 P3（A' 轨 T2 / FM-7-5 裁定：注册 adapter）：geometry.emphasize——对既有
 * 实体的高亮/强调（工具目录 presentation-tool-catalog/v1 冻结条目：surface=
 * geometry、effect_class=highlight、reveal_scope_ceiling=target_highlight、
 * 参数 emphasis steady|pulse 经 command_payload 携带）。
 *
 * 呈现链（零新视觉状态）：服务端 delivery 前已应用高亮语义 → student_workspace_
 * view.canvas.elements[].highlighted → Step 7 display-only visualState（
 * StudentWorkspaceViewSurface.visualStateFor → "selected"）。完成判据与
 * geometry.construct 同链：真实 commit 信号（同执行身份 + workspace_revision）
 * + 数据级对账——target 必须已在同快照 canvas 中且（reveal_scope=
 * target_highlight）highlighted=true；emphasis 参数不参与完成判定（steady/
 * pulse 是展示细化，不改变「目标已被强调」的可见事实）。
 *
 * B 轨前置（如实登记，不伪造端到端）：geometry.emphasize 尚未进入服务端
 * SessionPinnedCapabilityRegistry / WorkspaceRuntimeReducer / View 投影
 * （highlighted 位）与模型可见目录交集（IntentCompiler 对 highlight 类
 * fail closed）。在前者落地前，本 adapter 仅由合成 delivery 测试锁定行为；
 * 漏网投递因 view 无 highlighted 位 fail closed（illegal_target），不误报
 * presented。
 */
export function createGeometryEmphasizePresentationAdapter(dependencies: WorkspaceSurfaceAdapterDependencies): PresentationToolAdapter {
  return {
    supports(action) {
      return action.kind === "workspace"
        && action.workspace_action !== undefined
        && action.workspace_action.surface === "geometry"
        && action.workspace_action.capability === "geometry.emphasize";
    },
    async present({ delivery, snapshot, abort }) {
      const action = delivery.action.workspace_action!;
      // 高亮语义必须有目标：空 target_ids 无法验证「已被强调可见」→ fail closed。
      if ((action.target_ids ?? []).length === 0) {
        return {
          outcome: "failed",
          failureClass: "illegal_target",
          message: "geometry.emphasize requires target_ids (highlight of an existing entity)",
        };
      }
      return presentWorkspaceSurface(
        "geometry",
        delivery,
        snapshot.views.student_workspace_view.canvas.elements,
        snapshot.views.student_workspace_view.solution_board.groups,
        dependencies,
        abort,
      );
    },
  };
}

/**
 * F7 P2（S1 R7 / 动态板书规格）：board.explain adapter——工具名与参数形状以
 * B 的 generation/v1 presentation-tool-spec 目录为准（tool_id=board.explain；
 * plan/v4 冻结形状：workspace_action.capability="board.explain"、
 * command_payload=EF- 片段引用、reveal_scope>none）。完成判据与 reveal-entry
 * 同链：真实 commit 信号（同执行身份 + workspace_revision）+ 数据级对账——
 * EF 引用必须解析到同快照 student_workspace_view（view/v2）中已 applied 的
 * fragment；planned-only 内容不进学生可见 View（保存≠可见），未解析即
 * illegal_target fail closed。
 */
export function createBoardExplainPresentationAdapter(dependencies: WorkspaceSurfaceAdapterDependencies): PresentationToolAdapter {
  return {
    supports(action) {
      return action.kind === "workspace"
        && action.workspace_action !== undefined
        && action.workspace_action.surface === "solution_board"
        && action.workspace_action.capability === "board.explain";
    },
    async present({ delivery, snapshot, abort }) {
      const action = delivery.action.workspace_action!;
      const fragmentId = action.command_payload;
      if (!dependencies.commitPort.hasRealCommitSource()) {
        return { outcome: "awaiting-real-signal" };
      }
      const board = snapshot.views.student_workspace_view.solution_board;
      const fragments = "fragments" in board ? board.fragments ?? [] : [];
      if (typeof fragmentId !== "string" || !fragments.some((fragment) => fragment.fragment_id === fragmentId)) {
        return {
          outcome: "failed",
          failureClass: "illegal_target",
          message: `board.explain content source ${JSON.stringify(fragmentId)} does not resolve to an applied fragment in the student workspace view`,
        };
      }
      const wait = await dependencies.commitPort.waitForCommit(delivery.session_id, delivery.workspace_revision ?? 0, {
        executionKey: presentationKeyOf(delivery),
        abort,
        ...(dependencies.waitTimeoutMs !== undefined ? { timeoutMs: dependencies.waitTimeoutMs } : {}),
      });
      if (wait === "aborted") return { outcome: "interrupted" };
      if (wait === "timeout") {
        return { outcome: "failed", failureClass: "timeout", message: "solution_board explain fragment commit not observed within timeout" };
      }
      return { outcome: "presented" };
    },
  };
}

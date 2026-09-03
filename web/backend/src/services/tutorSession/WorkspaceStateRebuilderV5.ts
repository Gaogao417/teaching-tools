/**
 * WorkspaceStateRebuilder（F3 — Workspace 状态转换内核）。
 *
 * 对应 ADR-008 §4 RuntimeStateRebuilder 的 workspace 侧：Pinned Plan（session
 * pin，由 F2 verifyCommittedStreamV5 对账）+ 有序 committed v5 events
 * → 同一领域 fold（foldWorkspaceV5Events，与在线共用）→ canonical state/v1
 * 校验。只在启动 / 恢复 / 对账时使用（在线主链不经此）。
 *
 * Fail closed 叠加（F2 六类损坏 + workspace 流不变量 + catalog pin）：
 * - F2 verifyCommittedStreamV5：SCHEMA_ISOLATION / MISSING_SESSION_START /
 *   EVENT_GAP / CORRUPT_EVENT / REVISION_INCONSISTENT / HASH_MISMATCH；
 * - catalog pin 对账（R2 2026-08-31，R0 §4 冻结口径）：session_started 携带
 *   workspace_catalog_pin 且恢复方 catalog 重算 digest 不符（schema version /
 *   content hash / entry count / taskId 任一）→ HASH_MISMATCH fail closed；
 *   流无 pin（无法对账的旧流）同样拒绝——resume 不接受未经对账的任意 catalog，
 *   不得回退为「接受但不校验」；
 * - foldWorkspaceV5Events：WORKSPACE_STREAM_INVARIANT（孤儿完成 / resulting_revision
 *   违反恰 +1 或不变 / stale 内嵌 / 批间污染 / 重复注册 / 未登记 capability /
 *   含执行器必拒效果）；
 * - 折叠结果过不了 canonical workspaceRuntimeStateV1Schema → fail closed。
 *
 * 语义比较（G3 对账入口）：白名单 = 空集（显式声明——state/v1 全持久语义，
 * 对齐 F2 state 层条款；任何未来忽略字段须先在 f3-scope-ledger 与此处登记）。
 */
import { workspaceRuntimeStateV1Schema } from "../../../../shared/canonical";
import { verifyCommittedStreamV5, type RebuildV5Options } from "./RuntimeStateRebuilderV5";
import { TutorSessionIntegrityError } from "./TutorSessionEventV5";
import {
  foldWorkspaceV5Events,
  WorkspaceRuntimeReducerError,
  type WorkspaceFold,
  type WorkspaceRuntimeStateV5,
} from "./WorkspaceRuntimeReducerV5";
import {
  computeWorkspaceCatalogDigest,
  type WorkspacePresentationCatalogV5,
  type WorkspaceSeedOverlay,
} from "./WorkspacePresentationCatalogV5";

export interface WorkspaceRebuildResult extends WorkspaceFold {
  /** 参与折叠的 canonical 事件数（对账/调试）。 */
  eventCount: number;
  /** 已折叠的最大事件 sequence（在线侧增量补折游标）。 */
  lastSequence: number;
}

/**
 * catalog pin 对账（R0 §4 resume 规则）：session_started 的 pin 与恢复方
 * catalog 重算值任一不符 → HASH_MISMATCH fail closed。
 * F7 Step 3 起导出：rebuildWorkspaceRuntimeStateV6 复用同一对账（v5/v6 同口径）。
 */
export function reconcileWorkspaceCatalogPin(
  sessionId: string,
  catalog: WorkspacePresentationCatalogV5,
  startedPayload: Record<string, unknown>,
): void {
  const pin = startedPayload.workspace_catalog_pin as
    | { catalog_schema_version?: unknown; content_hash?: unknown; entry_count?: unknown }
    | undefined;
  if (pin === undefined) {
    throw new TutorSessionIntegrityError(
      "HASH_MISMATCH",
      `session ${sessionId}: session_started 不含 workspace_catalog_pin——无法对账的 catalog 不得恢复（R2 硬边界：resume 不接受未经对账的任意 catalog）`,
      1,
    );
  }
  const recomputedHash = computeWorkspaceCatalogDigest(catalog);
  const failures: string[] = [];
  if (pin.catalog_schema_version !== catalog.schemaVersion) {
    failures.push(`catalog_schema_version ${String(pin.catalog_schema_version)} ≠ ${catalog.schemaVersion}`);
  }
  if (pin.content_hash !== recomputedHash) {
    failures.push(`content_hash ${String(pin.content_hash)} ≠ 重算 ${recomputedHash}`);
  }
  if (pin.entry_count !== undefined && pin.entry_count !== catalog.boardEntries.length) {
    failures.push(`entry_count ${String(pin.entry_count)} ≠ ${catalog.boardEntries.length}`);
  }
  const pinnedTaskId = startedPayload.task_id;
  if (typeof pinnedTaskId === "string" && pinnedTaskId !== catalog.taskId) {
    failures.push(`task/Plan 不符：session_started.task_id=${pinnedTaskId} ≠ catalog.taskId=${catalog.taskId}`);
  }
  if (failures.length) {
    throw new TutorSessionIntegrityError(
      "HASH_MISMATCH",
      `session ${sessionId}: workspace catalog pin 对账失败（${failures.join("; ")}）`,
      1,
    );
  }
}

/** 重建 WorkspaceRuntimeState（含折叠上下文——executor 世界组合输入）。 */
export function rebuildWorkspaceRuntimeStateV5(
  sessionId: string,
  catalog: WorkspacePresentationCatalogV5,
  seed?: WorkspaceSeedOverlay,
  options?: RebuildV5Options,
): WorkspaceRebuildResult {
  const { events } = verifyCommittedStreamV5(sessionId, options);
  reconcileWorkspaceCatalogPin(sessionId, catalog, events[0].payload);
  let fold: WorkspaceFold;
  try {
    fold = foldWorkspaceV5Events(events, catalog, seed);
  } catch (error) {
    if (error instanceof WorkspaceRuntimeReducerError) {
      // workspace 流不变量属 corruption 家族（不得默认跳过/部分重建）。
      throw new TutorSessionIntegrityError("CORRUPT_EVENT", `[${error.code}] ${error.message}`, error.sequence);
    }
    throw error;
  }
  const canonical = workspaceRuntimeStateV1Schema.safeParse(fold.state);
  if (!canonical.success) {
    throw new TutorSessionIntegrityError(
      "CORRUPT_EVENT",
      `rebuilt workspace state fails canonical state/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      events[events.length - 1]?.sequence,
    );
  }
  return { ...fold, eventCount: events.length, lastSequence: events[events.length - 1]?.sequence ?? 1 };
}

/** state 层语义忽略白名单（空集，显式声明；登记义务见文件头）。 */
export const SEMANTICALLY_IGNORED_WORKSPACE_STATE_FIELDS: readonly string[] = [];

export interface WorkspaceSemanticComparison {
  equal: boolean;
  differences: readonly string[];
}

/** 语义比较两个 WorkspaceRuntimeState：白名单外任何差异都判 unequal。 */
export function compareWorkspaceStatesSemantically(
  left: WorkspaceRuntimeStateV5,
  right: WorkspaceRuntimeStateV5,
): WorkspaceSemanticComparison {
  const differences: string[] = [];
  const compare = (path: string, a: unknown, b: unknown): void => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      differences.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    }
  };
  compare("session_id", left.session_id, right.session_id);
  compare("revision", left.revision, right.revision);
  compare("geometry.committed_element_ids", left.geometry.committed_element_ids, right.geometry.committed_element_ids);
  compare("geometry.draft_element_ids", left.geometry.draft_element_ids, right.geometry.draft_element_ids);
  compare("geometry.interaction_mode", left.geometry.interaction_mode, right.geometry.interaction_mode);
  compare(
    "solution_board.entries",
    left.solution_board.entries.map((entry) => [entry.entry_id, entry.visibility, entry.attempt_state, entry.presentation_group ?? null]),
    right.solution_board.entries.map((entry) => [entry.entry_id, entry.visibility, entry.attempt_state, entry.presentation_group ?? null]),
  );
  compare(
    "solution_board.canonical_path_entry_ids",
    left.solution_board.canonical_path_entry_ids ?? null,
    right.solution_board.canonical_path_entry_ids ?? null,
  );
  return { equal: differences.length === 0, differences };
}

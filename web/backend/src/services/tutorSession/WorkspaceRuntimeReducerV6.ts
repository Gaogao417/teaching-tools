/**
 * WorkspaceRuntimeReducer v6（F7 Step 3 — v6 事件流的 workspace fold）。
 *
 * State = f(catalog + 有序 committed v6 events) 的纯函数；输出与在线/重建
 * 语义和 v5 fold 完全同构（G3：无第二条 workspace state machine）：
 * - **保留分支委托** `applyWorkspaceV5Event`（gate_evaluated / policy_decision_
 *   made / student_intent_recorded / action_outcome_recorded{student_command} /
 *   session_completed——canonical payload 逐字节同 v5，结构 adapter 只读复用）；
 * - **presentation 家族**（v6 新事件面，ADR-011）：
 *   - `presentation_sequence_planned`：登记计划 actions（WeakMap lineage——
 *     不进 canonical state、不参与语义比较，只作 fold 累加器；不可变复制纪律
 *     同 TutorRuntimeStateReducerV6 P1-1）；
 *   - `presentation_action_applied`：按 sequence_id+ordinal 解析计划内 workspace
 *     action → `applyWorkspaceEffect`（tutor-origin capability + 决策因果 + 五重
 *     校验同一执行点）→ 落效果并按 `resulting_workspace_revision` 对账推进
 *     revision（changed ⇒ 恰 +1；presentation-only ⇒ 等于当前——违反即流损坏）；
 *     applied 幂等锁（同 ordinal 二次 applied = corruption）；
 *   - validated / delivered / outcome_recorded / superseded / student_input_
 *     recorded：零 workspace 状态效果（服务端应用 ≠ 浏览器完成；已应用语义
 *     不因 interrupted/failed/superseded 回滚——PLAN.md §2.2）；
 *   - voice kind 的 planned action 不在此 fold 落效果（voice 无权威状态转移）。
 *
 * 与 v5 流的隔离：本 fold 只消费 v6 事件；v5 专属事件（workspace_surface_
 * action_issued 等）不会出现在 v6 流中（canonical 词表隔离）。
 */
import { workspaceRuntimeStateV1Schema } from "../../../../shared/canonical";
import type { StoredV6Event, V6PresentationOrderedAction } from "./TutorSessionEventV6";
import { verifyCommittedStream } from "./kernel/RuntimeStateRebuilderCore";
import { readSessionEvents } from "./kernel/TutorSessionStoreCore";
import { makeV6SessionCodec, type V6RegistryProvider } from "./RuntimeStateRebuilderV6";
import { TutorSessionIntegrityV6Error } from "./TutorSessionEventV6";
import {
  applyWorkspaceEffect,
  applyWorkspaceV5Event,
  initialWorkspaceFold,
  WorkspaceRuntimeReducerError,
  WorkspaceTransitionRejectedError,
  type PendingTutorActionPayload,
  type WorkspaceFold,
} from "./WorkspaceRuntimeReducerV5";
import { resolveWorkspaceCapability } from "./WorkspaceCapabilityRegistryV5";
import {
  reconcileWorkspaceCatalogPin,
  type WorkspaceRebuildResult,
} from "./WorkspaceStateRebuilderV5";
import type { WorkspacePresentationCatalogV5, WorkspaceSeedOverlay } from "./WorkspacePresentationCatalogV5";

/** planned 序列的 fold 记忆（跨事件：planned → applied 解析 + 幂等锁）。 */
interface V6WorkspaceLineage {
  readonly sequences: ReadonlyMap<string, {
    actions: readonly V6PresentationOrderedAction[];
    beatId: string;
    appliedOrdinals: ReadonlySet<number>;
  }>;
}

const foldLineageByFold = new WeakMap<object, V6WorkspaceLineage>();

function lineageOf(fold: WorkspaceFold): V6WorkspaceLineage {
  return foldLineageByFold.get(fold) ?? { sequences: new Map() };
}

function withLineage(fold: WorkspaceFold, lineage: V6WorkspaceLineage): WorkspaceFold {
  foldLineageByFold.set(fold, lineage);
  return fold;
}

/** v6 事件 → v5 fold 的只读结构 adapter（保留分支 payload 逐字节同 v5）。 */
function asV5Event(event: StoredV6Event): Parameters<typeof applyWorkspaceV5Event>[1] {
  return event as unknown as Parameters<typeof applyWorkspaceV5Event>[1];
}

/**
 * 单事件归约（纯函数：返回新 fold，不修改入参）。事件须已过 canonical v6 校验。
 * presentation 分支之外的保留分支委托 v5 fold（同一裁剪/账本推导）。
 */
export function applyWorkspaceV6Event(
  fold: WorkspaceFold,
  event: StoredV6Event,
  catalog: WorkspacePresentationCatalogV5,
): WorkspaceFold {
  const lineage = lineageOf(fold);
  switch (event.event_type) {
    case "presentation_sequence_planned": {
      const payload = event.payload as unknown as { sequence_id: string; beat_id: string; actions: V6PresentationOrderedAction[] };
      if (lineage.sequences.has(payload.sequence_id)) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation sequence ${payload.sequence_id} is registered twice in the workspace fold`,
          event.sequence,
        );
      }
      const sequences = new Map(lineage.sequences);
      sequences.set(payload.sequence_id, { actions: payload.actions, beatId: payload.beat_id, appliedOrdinals: new Set<number>() });
      const delegated = applyWorkspaceV5Event(fold, asV5Event(event), catalog);
      return withLineage(delegated, { sequences });
    }
    case "presentation_action_applied": {
      const ref = event.payload as unknown as {
        sequence_id: string;
        ordinal: number;
        action_id: string;
        kind: "voice" | "workspace";
        resulting_workspace_revision?: number;
      };
      const sequence = lineage.sequences.get(ref.sequence_id);
      if (!sequence) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation_action_applied references unregistered sequence ${ref.sequence_id}`,
          event.sequence,
        );
      }
      if (ref.kind !== "workspace") {
        // voice 无权威状态转移：applied 事实零 workspace 效果（canonically voice
        // 不携带 resulting_workspace_revision；防御性复核）。
        return applyWorkspaceV6Passthrough(fold, event, catalog, lineage);
      }
      const planned = sequence.actions.find((action) => action.ordinal === ref.ordinal);
      if (!planned || planned.kind !== "workspace" || !planned.workspace_action || planned.workspace_action.action_id !== ref.action_id) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation_action_applied ref ${ref.action_id}@${ref.ordinal} does not match a planned workspace action of ${ref.sequence_id}`,
          event.sequence,
        );
      }
      if (sequence.appliedOrdinals.has(ref.ordinal)) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation workspace action ${ref.action_id}@${ref.ordinal} of ${ref.sequence_id} is applied twice in the workspace fold`,
          event.sequence,
        );
      }
      const plannedBeatId = sequence.beatId;
      const action: PendingTutorActionPayload = {
        action_id: planned.workspace_action.action_id,
        decision_id: planned.workspace_action.decision_id,
        ...(plannedBeatId !== undefined ? { beat_id: plannedBeatId } : {}),
        surface: planned.workspace_action.surface,
        capability: planned.workspace_action.capability,
        ...(planned.workspace_action.target_ids !== undefined ? { target_ids: [...planned.workspace_action.target_ids] } : {}),
        ...(planned.workspace_action.command_payload !== undefined ? { command_payload: planned.workspace_action.command_payload } : {}),
        reveal_scope: planned.workspace_action.reveal_scope,
        ...(planned.workspace_action.presentation_only !== undefined ? { presentation_only: planned.workspace_action.presentation_only } : {}),
      };
      const spec = resolveWorkspaceCapability(action.capability, action.surface, "tutor");
      if (!spec) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation workspace action ${ref.action_id}: capability 未登记或 origin/surface 不匹配：tutor:${action.surface}:${action.capability}`,
          event.sequence,
        );
      }
      let applied: { fold: WorkspaceFold; changed: boolean };
      try {
        applied = applyWorkspaceEffect({ fold, catalog, spec, action });
      } catch (error) {
        if (error instanceof WorkspaceTransitionRejectedError) {
          throw new WorkspaceRuntimeReducerError(
            "WORKSPACE_STREAM_INVARIANT",
            `committed 流含执行器必拒的 presentation action ${ref.action_id}：${error.reason}`,
            event.sequence,
          );
        }
        throw error;
      }
      const expectedRevision = applied.changed ? fold.state.revision + 1 : fold.state.revision;
      if (ref.resulting_workspace_revision !== expectedRevision) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `presentation action ${ref.action_id} resulting_workspace_revision=${String(ref.resulting_workspace_revision)} ≠ 期望 ${expectedRevision}（恰 +1 或不变语义）`,
          event.sequence,
        );
      }
      applied.fold.state.revision = expectedRevision;
      const sequences = new Map(lineage.sequences);
      sequences.set(ref.sequence_id, {
        actions: sequence.actions,
        beatId: sequence.beatId,
        appliedOrdinals: new Set([...sequence.appliedOrdinals, ref.ordinal]),
      });
      return withLineage(applied.fold, { sequences });
    }
    default:
      return applyWorkspaceV6Passthrough(fold, event, catalog, lineage);
  }
}

/** 保留分支 / 零效果 presentation 分支：委托 v5 fold（default 分支零状态效果）。 */
function applyWorkspaceV6Passthrough(
  fold: WorkspaceFold,
  event: StoredV6Event,
  catalog: WorkspacePresentationCatalogV5,
  lineage: V6WorkspaceLineage,
): WorkspaceFold {
  return withLineage(applyWorkspaceV5Event(fold, asV5Event(event), catalog), lineage);
}

/**
 * 全量折叠：session_started 起步（catalog+seed 初始 state + gate ledger 播种）
 * + 逐事件归约。与 v5 foldWorkspaceV5Events 同构。
 */
export function foldWorkspaceV6Events(
  events: readonly StoredV6Event[],
  catalog: WorkspacePresentationCatalogV5,
  seed?: WorkspaceSeedOverlay,
): WorkspaceFold {
  if (events.length === 0) {
    throw new WorkspaceRuntimeReducerError("WORKSPACE_STREAM_INVARIANT", "committed event stream is empty");
  }
  if (events[0].event_type !== "session_started") {
    throw new WorkspaceRuntimeReducerError(
      "WORKSPACE_STREAM_INVARIANT",
      `first committed event must be session_started, got ${events[0].event_type}`,
      events[0].sequence,
    );
  }
  let fold = initialWorkspaceFold(
    events[0].session_id,
    catalog,
    seed,
    events[0].payload as unknown as Parameters<typeof initialWorkspaceFold>[3],
  );
  for (const event of events.slice(1)) {
    fold = applyWorkspaceV6Event(fold, event, catalog);
  }
  return fold;
}

/** 轻量读取（canonical 全形状；不做 verified rebuild——rebuild 入口自带）。 */
export function readTutorSessionEventsV6(sessionId: string, registryProvider: V6RegistryProvider): StoredV6Event[] {
  return readSessionEvents(makeV6SessionCodec(registryProvider), sessionId) as unknown as StoredV6Event[];
}

/** 重建 WorkspaceRuntimeState（verified stream + catalog pin 对账 + v6 fold + canonical 收口）。 */
export function rebuildWorkspaceRuntimeStateV6(
  sessionId: string,
  catalog: WorkspacePresentationCatalogV5,
  registryProvider: V6RegistryProvider,
  seed?: WorkspaceSeedOverlay,
): WorkspaceRebuildResult {
  const codec = makeV6SessionCodec(registryProvider);
  const { events } = verifyCommittedStream(codec, sessionId) as unknown as { events: StoredV6Event[] };
  reconcileWorkspaceCatalogPin(sessionId, catalog, events[0].payload);
  let fold: WorkspaceFold;
  try {
    fold = foldWorkspaceV6Events(events, catalog, seed);
  } catch (error) {
    if (error instanceof WorkspaceRuntimeReducerError) {
      throw new TutorSessionIntegrityV6Error("CORRUPT_EVENT", `[${error.code}] ${error.message}`, error.sequence);
    }
    throw error;
  }
  const canonical = workspaceRuntimeStateV1Schema.safeParse(fold.state);
  if (!canonical.success) {
    throw new TutorSessionIntegrityV6Error(
      "CORRUPT_EVENT",
      `rebuilt workspace state fails canonical state/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      events[events.length - 1]?.sequence,
    );
  }
  return { ...fold, eventCount: events.length, lastSequence: events[events.length - 1]?.sequence ?? 1 };
}

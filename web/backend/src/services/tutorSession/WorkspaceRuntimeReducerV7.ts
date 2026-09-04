/**
 * WorkspaceRuntimeReducer v7（F7 Step 4 — v7 事件流的 workspace fold）。
 *
 * State = f(catalog + 有序 committed v7 events) 的纯函数；输出与在线/重建
 * 语义和 v5/v6 fold 完全同构（G3：无第二条 workspace state machine）：
 * - **保留分支委托** `applyWorkspaceV5Event`（gate_evaluated / policy_decision_
 *   made / action_outcome_recorded{student_command} / session_completed——
 *   canonical payload 逐字节同 v5，结构 adapter 只读复用；v7 的
 *   student_intent_recorded 无 workspace_command 内嵌，该委托分支对命令零效果，
 *   命令注册由下方 v7 新分支接管）；
 * - **v7 新分支** `student_workspace_command_recorded`：登记学生来源权威
 *   WorkspaceCommand 事实（pendingStudentCommands[command_id] = 命令体 + 观察
 *   时 workspace revision——completed 回执的 stale/批间污染检查沿用 v5 语义）；
 *   命令体按统一命名桥接：payload.client_request_id → PendingStudentCommandBody.
 *   client_command_id（值同源，F3 执行面不变）；
 * - **presentation 家族**（v6 同款）：planned 登记（WeakMap lineage）；applied
 *   按 sequence_id+ordinal 解析计划内 workspace action → applyWorkspaceEffect
 *   → resulting_workspace_revision 对账（changed ⇒ 恰 +1；presentation-only ⇒
 *   等于当前）；validated/delivered/outcome/superseded/student_input_recorded
 *   零 workspace 状态效果。
 */
import { workspaceRuntimeStateV1Schema } from "../../../../shared/canonical";
import type { StoredV7Event, V7PresentationOrderedAction, V7StudentWorkspaceCommandRecordedPayload } from "./TutorSessionEventV7";
import { verifyCommittedStream } from "./kernel/RuntimeStateRebuilderCore";
import { readSessionEvents } from "./kernel/TutorSessionStoreCore";
import { makeV7SessionCodec, type V7RegistryProvider } from "./RuntimeStateRebuilderV7";
import { TutorSessionIntegrityV7Error } from "./TutorSessionEventV7";
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
interface V7WorkspaceLineage {
  readonly sequences: ReadonlyMap<string, {
    actions: readonly V7PresentationOrderedAction[];
    beatId: string;
    appliedOrdinals: ReadonlySet<number>;
  }>;
}

const foldLineageByFold = new WeakMap<object, V7WorkspaceLineage>();

function lineageOf(fold: WorkspaceFold): V7WorkspaceLineage {
  return foldLineageByFold.get(fold) ?? { sequences: new Map() };
}

function withLineage(fold: WorkspaceFold, lineage: V7WorkspaceLineage): WorkspaceFold {
  foldLineageByFold.set(fold, lineage);
  return fold;
}

/** v7 事件 → v5 fold 的只读结构 adapter（保留分支 payload 逐字节同 v5）。 */
function asV5Event(event: StoredV7Event): Parameters<typeof applyWorkspaceV5Event>[1] {
  return event as unknown as Parameters<typeof applyWorkspaceV5Event>[1];
}

/**
 * 单事件归约（纯函数：返回新 fold，不修改入参）。事件须已过 canonical v7 校验。
 * presentation/命令分支之外的保留分支委托 v5 fold（同一裁剪/账本推导）。
 */
export function applyWorkspaceV7Event(
  fold: WorkspaceFold,
  event: StoredV7Event,
  catalog: WorkspacePresentationCatalogV5,
): WorkspaceFold {
  const lineage = lineageOf(fold);
  switch (event.event_type) {
    case "student_workspace_command_recorded": {
      // v7 两条输入因果链：学生命令事实经独立事件登记（不再经 intent 内嵌）。
      // pending 注册形状沿用 v5 语义（observedRevision 支撑 completed 回执的
      // stale/批间污染检查）；client_request_id → client_command_id 为统一命名
      // 桥接（值同源）。
      const command = event.payload as unknown as V7StudentWorkspaceCommandRecordedPayload;
      if (fold.context.pendingStudentCommands.has(command.command_id)) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `student command ${command.command_id} is registered twice in the workspace fold`,
          event.sequence,
        );
      }
      const body = {
        command_id: command.command_id,
        surface: command.surface,
        capability: command.capability,
        target_ids: command.target_ids,
        ...(command.params !== undefined ? { params: command.params } : {}),
        expected_workspace_revision: command.expected_workspace_revision,
        client_command_id: command.client_request_id,
      };
      const context = {
        ...fold.context,
        pendingStudentCommands: new Map([
          ...fold.context.pendingStudentCommands,
          [command.command_id, { command: body, observedRevision: fold.state.revision }],
        ]),
      };
      return withLineage({ state: fold.state, context }, lineage);
    }
    case "presentation_sequence_planned": {
      const payload = event.payload as unknown as { sequence_id: string; beat_id: string; actions: V7PresentationOrderedAction[] };
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
        // voice 无权威状态转移：applied 事实零 workspace 效果（防御性复核）。
        return applyWorkspaceV7Passthrough(fold, event, catalog, lineage);
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
      return applyWorkspaceV7Passthrough(fold, event, catalog, lineage);
  }
}

/** 保留分支 / 零效果 presentation 分支：委托 v5 fold（default 分支零状态效果）。 */
function applyWorkspaceV7Passthrough(
  fold: WorkspaceFold,
  event: StoredV7Event,
  catalog: WorkspacePresentationCatalogV5,
  lineage: V7WorkspaceLineage,
): WorkspaceFold {
  return withLineage(applyWorkspaceV5Event(fold, asV5Event(event), catalog), lineage);
}

/**
 * 全量折叠：session_started 起步（catalog+seed 初始 state + gate ledger 播种）
 * + 逐事件归约。与 v5/v6 foldWorkspace 同构。
 */
export function foldWorkspaceV7Events(
  events: readonly StoredV7Event[],
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
    fold = applyWorkspaceV7Event(fold, event, catalog);
  }
  return fold;
}

/** 轻量读取（canonical 全形状；不做 verified rebuild——rebuild 入口自带）。 */
export function readTutorSessionEventsV7(sessionId: string, registryProvider: V7RegistryProvider): StoredV7Event[] {
  return readSessionEvents(makeV7SessionCodec(registryProvider), sessionId) as unknown as StoredV7Event[];
}

/** 重建 WorkspaceRuntimeState（verified stream + catalog pin 对账 + v7 fold + canonical 收口）。 */
export function rebuildWorkspaceRuntimeStateV7(
  sessionId: string,
  catalog: WorkspacePresentationCatalogV5,
  registryProvider: V7RegistryProvider,
  seed?: WorkspaceSeedOverlay,
): WorkspaceRebuildResult {
  const codec = makeV7SessionCodec(registryProvider);
  const { events } = verifyCommittedStream(codec, sessionId) as unknown as { events: StoredV7Event[] };
  reconcileWorkspaceCatalogPin(sessionId, catalog, events[0].payload);
  let fold: WorkspaceFold;
  try {
    fold = foldWorkspaceV7Events(events, catalog, seed);
  } catch (error) {
    if (error instanceof WorkspaceRuntimeReducerError) {
      throw new TutorSessionIntegrityV7Error("CORRUPT_EVENT", `[${error.code}] ${error.message}`, error.sequence);
    }
    throw error;
  }
  const canonical = workspaceRuntimeStateV1Schema.safeParse(fold.state);
  if (!canonical.success) {
    throw new TutorSessionIntegrityV7Error(
      "CORRUPT_EVENT",
      `rebuilt workspace state fails canonical state/v1 validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
      events[events.length - 1]?.sequence,
    );
  }
  return { ...fold, eventCount: events.length, lastSequence: events[events.length - 1]?.sequence ?? 1 };
}

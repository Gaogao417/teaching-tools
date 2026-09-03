/**
 * V6SessionSnapshot（F7 Step 3 — V6 服务层快照投影）。
 *
 * PLAN.md Step 3 编排环第 5 步「生成统一 SessionSnapshot 和 pending delivery」
 * 的服务层落点：**HTTP 线格式统一属 Step 4**（web/shared Zod profile + 端点集），
 * 本模块只定义编排器对内/对测试的快照语义面：
 * - views：委托 UnifiedViewProjectionV5（单一 projector，零第二真相——v6
 *   state/events 经只读结构 adapter 进入，保留分支 payload 与 v5 逐字节同形）；
 * - pending_presentation：canonical `presentation-delivery/v1` 全形状（Zod
 *   校验——本投影是该合同的第一个真实生产者；workspace 交付携带 applied 的
 *   workspace_revision 回执；cursor 非 awaiting_browser 时缺省）；
 * - active_action：委托 ActiveActionProjector（action_template → materializer
 *   projection → active_action 保留链）。
 */
import type { z } from "zod";
import { presentationDeliveryV1Schema } from "../../../../shared/canonical";
import type { StoredV6Event } from "../tutorSession/TutorSessionEventV6";
import type { TutorRuntimeStateV6 } from "../tutorSession/TutorRuntimeStateReducerV6";
import { projectUnifiedViews, type UnifiedProjection } from "./UnifiedViewProjectionV5";
import type { ActiveAction } from "./ActiveActionProjector";
import type { NavigatorPlanV5 } from "../tutorNavigator/NavigatorPlanV5";
import type { WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";
import type { WorkspaceRuntimeStateV5 } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { StoredV5Event } from "../tutorSession/TutorSessionEventV5";
import type { TutorRuntimeStateV5 } from "../tutorSession/TutorRuntimeStateReducerV5";

export type V6PendingPresentation = z.infer<typeof presentationDeliveryV1Schema>;

export interface V6SessionSnapshot {
  readonly schema: "tutor-session-snapshot/v6-service";
  readonly session_id: string;
  readonly task_id: string;
  readonly revision: number;
  readonly teaching_phase: NonNullable<TutorRuntimeStateV6["teaching_cursor"]["phase"]>;
  readonly completed: boolean;
  readonly presentation_cursor: TutorRuntimeStateV6["presentation_cursor"];
  readonly views: UnifiedProjection;
  readonly active_action?: ActiveAction;
  readonly pending_presentation?: V6PendingPresentation;
}

/** planned 序列事实的窄形状（committed payload；canonical 已校验）。 */
interface PlannedSequenceFact {
  sequence_id: string;
  beat_id: string;
  actions: Array<{ ordinal: number; kind: "voice" | "workspace"; voice_action?: unknown; workspace_action?: unknown }>;
}

/** 从 committed 流投影 pending delivery（cursor awaiting_browser 时）。 */
export function projectPendingPresentation(args: {
  sessionId: string;
  events: readonly StoredV6Event[];
  cursor: TutorRuntimeStateV6["presentation_cursor"];
  revision: number;
}): V6PendingPresentation | undefined {
  if (args.cursor.status !== "awaiting_browser") return undefined;
  const cursor = args.cursor;
  let planned: PlannedSequenceFact | undefined;
  let appliedRevision: number | undefined;
  for (const event of args.events) {
    if (event.event_type === "presentation_sequence_planned") {
      const payload = event.payload as unknown as PlannedSequenceFact;
      if (payload.sequence_id === cursor.sequence_id) planned = payload;
      continue;
    }
    if (event.event_type === "presentation_action_applied") {
      const payload = event.payload as unknown as { sequence_id: string; ordinal: number; action_id: string; resulting_workspace_revision?: number };
      if (payload.sequence_id === cursor.sequence_id && payload.ordinal === cursor.ordinal && payload.action_id === cursor.action_id) {
        appliedRevision = payload.resulting_workspace_revision;
      }
    }
  }
  if (!planned) {
    throw new Error(`pending cursor references unregistered presentation sequence ${cursor.sequence_id} (corrupt stream)`);
  }
  const action = planned.actions.find((candidate) => candidate.ordinal === cursor.ordinal);
  if (!action) {
    throw new Error(`pending cursor ordinal ${cursor.ordinal} is outside planned sequence ${cursor.sequence_id} (corrupt stream)`);
  }
  const delivery = {
    schema: "ai_teaching_presentation_delivery/v1" as const,
    session_id: args.sessionId,
    sequence_id: cursor.sequence_id,
    ordinal: cursor.ordinal,
    action_id: cursor.action_id,
    action: { kind: action.kind, ...(action.kind === "voice" ? { voice_action: action.voice_action } : { workspace_action: action.workspace_action }) },
    session_revision: args.revision,
    ...(action.kind === "workspace" ? { workspace_revision: appliedRevision } : {}),
  };
  const canonical = presentationDeliveryV1Schema.safeParse(delivery);
  if (!canonical.success) {
    throw new Error(
      `pending presentation fails canonical delivery validation: ${canonical.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return canonical.data;
}

/** 三视图 + status 投影（v6 state/events 经只读结构 adapter 复用同一 projector）。 */
export function projectV6Views(args: {
  sessionId: string;
  tutorState: TutorRuntimeStateV6;
  workspaceState: WorkspaceRuntimeStateV5;
  events: readonly StoredV6Event[];
  plan: NavigatorPlanV5;
  catalog: WorkspacePresentationCatalogV5;
  factEntryIds: ReadonlyMap<string, string>;
  sessionRevision: number;
}): UnifiedProjection {
  return projectUnifiedViews({
    sessionId: args.sessionId,
    tutorState: args.tutorState as unknown as TutorRuntimeStateV5,
    workspaceState: args.workspaceState,
    events: args.events as unknown as readonly StoredV5Event[],
    plan: args.plan,
    catalog: args.catalog,
    factEntryIds: args.factEntryIds,
    sessionRevision: args.sessionRevision,
  });
}

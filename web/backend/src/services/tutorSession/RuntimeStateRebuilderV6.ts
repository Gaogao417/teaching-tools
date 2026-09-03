/**
 * RuntimeStateRebuilder v6 + V6 session codec 装配（F7 Step 2 — V6 Session Kernel）。
 *
 * 版本无关完整性内核（kernel/RuntimeStateRebuilderCore.ts）的 v6 装配：
 * - 会话行 event_schema ≠ 'v6'（含 v5 历史会话）→ SESSION_VERSION_UNSUPPORTED
 *   （spec §2.4 restore 409 集成员；V5 会话不迁移、不伪装，保留 reader 到 F8）；
 * - fold context（session-pinned capability registry）经 registryProvider 从已
 *   提交 session_started pin 确定性重导出——provider 负责与 workspace_catalog_pin
 *   对账（生产装配见 tutorOrchestration/TutorTaskBindingResolver；测试注入合成
 *   registry）。append 与 rebuild 同一 provider、同一裁决（在线=重放）。
 */
import type { SessionKernelCodec } from "./kernel/sessionKernelCodec";
import { rebuildSessionState, verifyCommittedStream, type RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { tutorRuntimeStateV2Schema, tutorSessionEventV6Schema } from "../../../../shared/canonical";
import {
  TutorSessionEventStoreV6Error,
  TutorSessionIntegrityV6Error,
  V6_CAUSATION_REQUIRED,
  V6_EVENT_SCHEMA_CONST,
  type StoredV6Event,
  type V6IntegrityErrorCode,
  type V6StoreErrorCode,
} from "./TutorSessionEventV6";
import {
  applyV6Event,
  foldCommittedV6Events,
  initialStateFromSessionStartedV6,
  type TutorRuntimeStateV6,
  type V6FoldContext,
} from "./TutorRuntimeStateReducerV6";
import { compareTutorRuntimeStatesSemantically } from "./RuntimeStateSemanticComparatorV5";

/** session-pinned registry 解析器：从 session_started payload 重导出 fold context。 */
export type V6RegistryProvider = (sessionStartedPayload: Record<string, unknown>) => V6FoldContext;

export function makeV6SessionCodec(registryProvider: V6RegistryProvider): SessionKernelCodec<TutorRuntimeStateV6, V6FoldContext> {
  return {
    eventSchemaColumn: "v6",
    eventSchemaConst: V6_EVENT_SCHEMA_CONST,
    causationRequired: V6_CAUSATION_REQUIRED as ReadonlySet<string>,
    storeSchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    integritySchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    makeStoreError: (code, message) => new TutorSessionEventStoreV6Error(code as V6StoreErrorCode, message),
    makeIntegrityError: (code, message, relatedSequence) =>
      new TutorSessionIntegrityV6Error(code as V6IntegrityErrorCode, message, relatedSequence),
    eventEnvelopeSchema: tutorSessionEventV6Schema,
    stateSchema: tutorRuntimeStateV2Schema,
    applyEvent: (state, event, ctx) => applyV6Event(state, event as unknown as StoredV6Event, ctx),
    foldCommitted: (events, ctx) => foldCommittedV6Events(events as unknown as readonly StoredV6Event[], ctx),
    initialStateFromSessionStarted: (event) => initialStateFromSessionStartedV6(event as unknown as StoredV6Event),
    resolveFoldContext: (sessionStartedPayload) => registryProvider(sessionStartedPayload),
    compareStates: (left, right) =>
      compareTutorRuntimeStatesSemantically(
        left as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
        right as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
      ),
  };
}

export interface VerifiedCommittedStreamV6 {
  session: import("./kernel/sessionKernelTypes").SessionRow;
  events: StoredV6Event[];
  sessionStartedPayload: Record<string, unknown>;
}

export interface V6Rebuilder {
  verifyCommittedStreamV6(sessionId: string, options?: RebuildOptions): VerifiedCommittedStreamV6;
  rebuildTutorRuntimeStateV6(sessionId: string, options?: RebuildOptions): TutorRuntimeStateV6;
}

/** v6 rebuilder 工厂（registryProvider 注入；测试可用合成 registry）。 */
export function createV6Rebuilder(registryProvider: V6RegistryProvider): V6Rebuilder {
  const codec = makeV6SessionCodec(registryProvider);
  return {
    verifyCommittedStreamV6: (sessionId, options) =>
      verifyCommittedStream(codec, sessionId, options) as unknown as VerifiedCommittedStreamV6,
    rebuildTutorRuntimeStateV6: (sessionId, options) => rebuildSessionState(codec, sessionId, options),
  };
}

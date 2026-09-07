/**
 * RuntimeStateRebuilder v9 + V9 session codec 装配（F7 RT4 — 生成生命周期波）。
 *
 * 版本无关完整性内核（kernel/RuntimeStateRebuilderCore.ts）的 v9 装配：
 * - 会话行 event_schema ≠ 'v9'（含 v5/v6/v7 历史会话）→ SESSION_VERSION_UNSUPPORTED
 *   （restore 409 集成员；v7 reader 保留给历史测试/诊断，不迁移、不伪装）；
 * - fold context 与 v7 同型（session-pinned capability registry）；
 *   registryProvider 复用 TutorTaskBindingResolver.v7RegistryProvider；
 * - state 收口判定 = tutorRuntimeStateV4Schema（生成族跨事件不变量在
 *   TutorRuntimeStateReducerV9 内强制；canonical superRefine 兜底）。
 */
import type { SessionKernelCodec } from "./kernel/sessionKernelCodec";
import { rebuildSessionState, verifyCommittedStream, type RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { tutorRuntimeStateV4Schema, tutorSessionEventV9Schema } from "../../../../shared/canonical";
import {
  TutorSessionEventStoreV9Error,
  TutorSessionIntegrityV9Error,
  V9_CAUSATION_REQUIRED,
  V9_EVENT_SCHEMA_CONST,
  type StoredV9Event,
  type V9IntegrityErrorCode,
  type V9StoreErrorCode,
} from "./TutorSessionEventV9";
import {
  applyV9Event,
  foldCommittedV9Events,
  initialStateFromSessionStartedV9,
  type TutorRuntimeStateV9,
  type V9FoldContext,
} from "./TutorRuntimeStateReducerV9";
import { compareTutorRuntimeStatesSemantically } from "./RuntimeStateSemanticComparatorV5";

/** session-pinned registry 解析器（与 v7 同型：从 session_started payload 重导出）。 */
export type V9RegistryProvider = (sessionStartedPayload: Record<string, unknown>) => V9FoldContext;

export function makeV9SessionCodec(registryProvider: V9RegistryProvider): SessionKernelCodec<TutorRuntimeStateV9, V9FoldContext> {
  return {
    eventSchemaColumn: "v9",
    eventSchemaConst: V9_EVENT_SCHEMA_CONST,
    causationRequired: V9_CAUSATION_REQUIRED as ReadonlySet<string>,
    storeSchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    integritySchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    makeStoreError: (code, message) => new TutorSessionEventStoreV9Error(code as V9StoreErrorCode, message),
    makeIntegrityError: (code, message, relatedSequence) =>
      new TutorSessionIntegrityV9Error(code as V9IntegrityErrorCode, message, relatedSequence),
    eventEnvelopeSchema: tutorSessionEventV9Schema,
    stateSchema: tutorRuntimeStateV4Schema,
    applyEvent: (state, event, ctx) => applyV9Event(state as TutorRuntimeStateV9, event as unknown as StoredV9Event, ctx),
    foldCommitted: (events, ctx) => foldCommittedV9Events(events as unknown as readonly StoredV9Event[], ctx),
    initialStateFromSessionStarted: (event) => initialStateFromSessionStartedV9(event as unknown as StoredV9Event),
    resolveFoldContext: (sessionStartedPayload) => registryProvider(sessionStartedPayload),
    compareStates: (left, right) =>
      compareTutorRuntimeStatesSemantically(
        left as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
        right as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
      ),
  };
}

export interface VerifiedCommittedStreamV9 {
  session: import("./kernel/sessionKernelTypes").SessionRow;
  events: StoredV9Event[];
  sessionStartedPayload: Record<string, unknown>;
}

export interface V9Rebuilder {
  verifyCommittedStreamV9(sessionId: string, options?: RebuildOptions): VerifiedCommittedStreamV9;
  rebuildTutorRuntimeStateV9(sessionId: string, options?: RebuildOptions): TutorRuntimeStateV9;
}

/** v9 rebuilder 工厂（registryProvider 注入；测试可用合成 registry）。 */
export function createV9Rebuilder(registryProvider: V9RegistryProvider): V9Rebuilder {
  const codec = makeV9SessionCodec(registryProvider);
  return {
    verifyCommittedStreamV9: (sessionId, options) =>
      verifyCommittedStream(codec, sessionId, options) as unknown as VerifiedCommittedStreamV9,
    rebuildTutorRuntimeStateV9: (sessionId, options) => rebuildSessionState(codec, sessionId, options),
  };
}

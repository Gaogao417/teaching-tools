/**
 * RuntimeStateRebuilder v7 + V7 session codec 装配（F7 Step 4 — V7 Session Kernel）。
 *
 * 版本无关完整性内核（kernel/RuntimeStateRebuilderCore.ts）的 v7 装配：
 * - 会话行 event_schema ≠ 'v7'（含 v5/v6 历史会话）→ SESSION_VERSION_UNSUPPORTED
 *   （spec §2.4 restore 409 集成员；新生产 restore 只服务 v7——v6 reader 保留给
 *   历史测试/诊断/内部审计，v5 继续旧 API 到 F8；均不迁移、不伪装）；
 * - fold context（session-pinned capability registry）经 registryProvider 从已
 *   提交 session_started pin 确定性重导出——provider 负责与 workspace_catalog_pin
 *   （assessment ⇒ locked 变体 hash）+ session_mode 双重对账；append 与 rebuild
 *   同一 provider、同一裁决（在线=重放）。
 */
import type { SessionKernelCodec } from "./kernel/sessionKernelCodec";
import { rebuildSessionState, verifyCommittedStream, type RebuildOptions } from "./kernel/RuntimeStateRebuilderCore";
import { tutorRuntimeStateV2Schema, tutorSessionEventV7Schema } from "../../../../shared/canonical";
import {
  TutorSessionEventStoreV7Error,
  TutorSessionIntegrityV7Error,
  V7_CAUSATION_REQUIRED,
  V7_EVENT_SCHEMA_CONST,
  type StoredV7Event,
  type V7IntegrityErrorCode,
  type V7StoreErrorCode,
} from "./TutorSessionEventV7";
import {
  applyV7Event,
  foldCommittedV7Events,
  initialStateFromSessionStartedV7,
  type TutorRuntimeStateV7,
  type V7FoldContext,
} from "./TutorRuntimeStateReducerV7";
import { compareTutorRuntimeStatesSemantically } from "./RuntimeStateSemanticComparatorV5";

/** session-pinned registry 解析器：从 session_started payload 重导出 fold context。 */
export type V7RegistryProvider = (sessionStartedPayload: Record<string, unknown>) => V7FoldContext;

export function makeV7SessionCodec(registryProvider: V7RegistryProvider): SessionKernelCodec<TutorRuntimeStateV7, V7FoldContext> {
  return {
    eventSchemaColumn: "v7",
    eventSchemaConst: V7_EVENT_SCHEMA_CONST,
    causationRequired: V7_CAUSATION_REQUIRED as ReadonlySet<string>,
    storeSchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    integritySchemaMismatchCode: "SESSION_VERSION_UNSUPPORTED",
    makeStoreError: (code, message) => new TutorSessionEventStoreV7Error(code as V7StoreErrorCode, message),
    makeIntegrityError: (code, message, relatedSequence) =>
      new TutorSessionIntegrityV7Error(code as V7IntegrityErrorCode, message, relatedSequence),
    eventEnvelopeSchema: tutorSessionEventV7Schema,
    stateSchema: tutorRuntimeStateV2Schema,
    applyEvent: (state, event, ctx) => applyV7Event(state, event as unknown as StoredV7Event, ctx),
    foldCommitted: (events, ctx) => foldCommittedV7Events(events as unknown as readonly StoredV7Event[], ctx),
    initialStateFromSessionStarted: (event) => initialStateFromSessionStartedV7(event as unknown as StoredV7Event),
    resolveFoldContext: (sessionStartedPayload) => registryProvider(sessionStartedPayload),
    compareStates: (left, right) =>
      compareTutorRuntimeStatesSemantically(
        left as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
        right as unknown as Parameters<typeof compareTutorRuntimeStatesSemantically>[0],
      ),
  };
}

export interface VerifiedCommittedStreamV7 {
  session: import("./kernel/sessionKernelTypes").SessionRow;
  events: StoredV7Event[];
  sessionStartedPayload: Record<string, unknown>;
}

export interface V7Rebuilder {
  verifyCommittedStreamV7(sessionId: string, options?: RebuildOptions): VerifiedCommittedStreamV7;
  rebuildTutorRuntimeStateV7(sessionId: string, options?: RebuildOptions): TutorRuntimeStateV7;
}

/** v7 rebuilder 工厂（registryProvider 注入；测试可用合成 registry）。 */
export function createV7Rebuilder(registryProvider: V7RegistryProvider): V7Rebuilder {
  const codec = makeV7SessionCodec(registryProvider);
  return {
    verifyCommittedStreamV7: (sessionId, options) =>
      verifyCommittedStream(codec, sessionId, options) as unknown as VerifiedCommittedStreamV7,
    rebuildTutorRuntimeStateV7: (sessionId, options) => rebuildSessionState(codec, sessionId, options),
  };
}

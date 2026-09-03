/**
 * RuntimeStateRebuilder v5（F2 — Event / Revision / Replay 内核）。
 *
 * 对应 09-target-architecture 的 TutorRuntimeStateRebuilder 抽象：
 * `Pinned Plan（session pin）+ TutorSessionEvent[] → TutorRuntimeState`。
 * 只在启动 / 恢复 / 对账时使用（在线主链不经此）。
 *
 * F7 Step 2：完整性校验逻辑已抽成版本无关内核（kernel/RuntimeStateRebuilderCore.
 * ts）；本文件是 v5 薄委托层——导出面与 fail closed 语义逐字保留：
 * - SCHEMA_ISOLATION：会话行 event_schema ≠ v5；
 * - MISSING_SESSION_START：流为空或首事件不是 session_started；
 * - EVENT_GAP：sequence 必须从 1 起连续（跳号=存储损坏）；
 * - CORRUPT_EVENT：payload_json 非法 JSON，或组装后过不了 canonical v5 Zod；
 * - REVISION_INCONSISTENT：recorded_revision 违反 store 的精确分配语义；
 * - HASH_MISMATCH：会话行 TP pin 与 session_started payload 不符，或调用方
 *   expectedPin 与事件流 pin 不符；
 * - REDUCER_INVARIANT：折叠结果过不了 canonical state/v1 校验（防御性收口）。
 */
import { rebuildSessionState, verifyCommittedStream } from "./kernel/RuntimeStateRebuilderCore";
import { V5_SESSION_CODEC } from "./TutorSessionEventStoreV5";
import type { SessionRowV5 } from "./TutorSessionEventStoreV5";
import type { V5ArtifactRefLike, V5SessionStartedPayload, StoredV5Event } from "./TutorSessionEventV5";
import type { TutorRuntimeStateV5 } from "./TutorRuntimeStateReducerV5";

export interface RebuildV5Options {
  /** 恢复方声明的期望 TP pin（artifact_id/version/content_hash 三元组对账）。 */
  expectedTutorPlanRef?: V5ArtifactRefLike;
  /** 从指定 sequence 之后截断重建（默认全量；对账/调试用）。 */
  throughSequence?: number;
}

export interface VerifiedCommittedStream {
  session: SessionRowV5;
  events: StoredV5Event[];
  sessionStartedPayload: V5SessionStartedPayload;
}

/**
 * 读取并完整校验 committed 事件流（gap / corruption / revision 单调 / pin 对账）。
 * 返回 canonical 事件数组（reducer 与对账工具共用的输入）。
 */
export function verifyCommittedStreamV5(sessionId: string, options?: RebuildV5Options): VerifiedCommittedStream {
  return verifyCommittedStream(V5_SESSION_CODEC, sessionId, options) as unknown as VerifiedCommittedStream;
}

/**
 * 重建 TutorRuntimeState：Pinned Plan（session pin）+ 有序 committed events
 * → 同一领域 reducer（foldCommittedV5Events）→ canonical state/v1 校验。
 */
export function rebuildTutorRuntimeStateV5(sessionId: string, options?: RebuildV5Options): TutorRuntimeStateV5 {
  return rebuildSessionState(V5_SESSION_CODEC, sessionId, options);
}

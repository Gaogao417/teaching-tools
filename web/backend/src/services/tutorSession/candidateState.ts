/**
 * Canonical candidate state（Phase 5 完整收口计划 §3）。
 *
 * 删除手工拼接 `stateForDecision`：决策（模型提案 / deterministic / fallback）
 * 必须以「已提交事件 + 本轮 pending 对齐事实」的唯一 canonical 投影为视角，
 * 否则降级路径读不到本轮 incorrect / self-correction / progression，产生
 * B1 族簿记错误（TS-7004/TS-7075：confirm.assisted_progress 误判、阶梯
 * 耗尽不进 repair）。
 *
 * 实现即全量投影：pending 批按 store 规则预指派 sequence（当前最大值起
 * 严格递增）与 state_revision（提交后 revision，同批共享），复用
 * projectRuntimeState 纯函数——与 append 后 replay 读到的状态逐字段一致。
 */
import type { PendingV2Event, StoredV2Event } from "./TutorSessionEvent";
import { projectRuntimeState, type TutorRuntimeState } from "./TutorRuntimeStateProjection";
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";

/** 「已提交事件 + pending 批」的 canonical 决策视角（纯函数，不落库）。 */
export function projectCandidateState(
  plan: TutorPlanV2Payload,
  events: readonly StoredV2Event[],
  pendingBatch: readonly PendingV2Event[],
): TutorRuntimeState {
  if (!pendingBatch.length) return projectRuntimeState(plan, events);
  const base = events.at(-1)?.sequence ?? 0;
  const revision = (events.at(-1)?.state_revision ?? 0) + 1;
  const sessionId = events[0]?.session_id ?? "";
  const materialized = pendingBatch.map((event, index): StoredV2Event => {
    const sequence = base + index + 1;
    return {
      ...event,
      schema: "ai_teaching_tutor_session_event/v3",
      session_id: sessionId,
      sequence,
      state_revision: revision,
      idempotency_key: `candidate:${sessionId}:${sequence}`,
    };
  });
  return projectRuntimeState(plan, [...events, ...materialized]);
}

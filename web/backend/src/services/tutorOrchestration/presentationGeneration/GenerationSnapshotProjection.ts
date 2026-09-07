/**
 * GenerationSnapshotProjection（F7 RT4 — S1 冻结字段的生成状态投影）。
 *
 * S1 冻结（f7-s1-interface-package §1）：snapshot 携带 generation（idle|
 * pending{running|waiting_retry, attempt/max_attempts, retry_at?}|failed
 * {error_class 含 RETRY_EXHAUSTED}）+ scope（canonical TeachingScopeRef 或
 * null；pending/failed 必有 scope）；不下发 epoch/reservation_revision/
 * input_digest/presenter_pin/私有判分——严格拒绝多余字段（shared
 * adaptivePresentationSnapshotFieldsSchema 判定）。
 *
 * 边界（S1 §1「当前在线边界」）：在线 parseSessionSnapshotHttp 仍拒绝候选新
 * 字段——组合字段 schema+projector+前端 decoder 属联合接线（P3，A/B 同一版本）。
 * 本模块是**服务端投影真源**：输入 state/v4，输出冻结字段形状；联合接线时
 * snapshot envelope 增补这两个字段并沿用同一判定（不再另造 DTO）。
 */
import { adaptivePresentationSnapshotFieldsSchema } from "../../../../../shared/tutorHttpProfile";
import type { TutorRuntimeStateV9 } from "../../tutorSession/TutorRuntimeStateReducerV9";

/** S1 冻结字段形状（shared schema 推导；A 的 decoder 与本投影同一真源）。 */
export type AdaptiveGenerationSnapshotFields = {
  generation:
    | { status: "idle" }
    | { status: "pending"; request_id: string; phase: "running" | "waiting_retry"; attempt: number; max_attempts: number; retry_at?: string }
    | { status: "failed"; request_id: string; attempt: number; max_attempts: number; error_class: string };
  scope: unknown;
};

/**
 * state/v4 → S1 冻结字段。投影只读 state（GET/snapshot 只读：不预约、不重试、
 * 不触发模型）；字段经 shared schema 判定（越界字段/未知状态 = fail closed）。
 */
export function projectGenerationSnapshotFields(state: TutorRuntimeStateV9): AdaptiveGenerationSnapshotFields {
  const slot = state.generation_slot;
  let fields: AdaptiveGenerationSnapshotFields;
  if (slot.status === "idle") {
    fields = { generation: { status: "idle" }, scope: null };
  } else {
    const record = state.generation_requests.find((candidate) => candidate.request_id === slot.request_id);
    if (!record) {
      throw new Error(
        `generation slot ${slot.status} carries request ${slot.request_id} with no matching request record (corrupt state; fail closed)`,
      );
    }
    if (slot.status === "pending") {
      if (record.status !== "pending" || record.phase === undefined) {
        throw new Error(
          `pending slot for ${record.request_id} does not match a pending record with phase (corrupt state; fail closed)`,
        );
      }
      fields = {
        generation: {
          status: "pending",
          request_id: record.request_id,
          phase: record.phase,
          attempt: record.attempt,
          max_attempts: record.max_attempts,
          ...(record.phase === "waiting_retry" && record.retry_at !== undefined ? { retry_at: record.retry_at } : {}),
        },
        scope: record.scope,
      };
    } else {
      if (record.status !== "failed" || record.error_class === undefined) {
        throw new Error(
          `failed slot for ${record.request_id} does not match a failed record with error_class (corrupt state; fail closed)`,
        );
      }
      fields = {
        generation: {
          status: "failed",
          request_id: record.request_id,
          attempt: record.attempt,
          max_attempts: record.max_attempts,
          error_class: record.error_class,
        },
        scope: record.scope,
      };
    }
  }
  const parsed = adaptivePresentationSnapshotFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    throw new Error(
      `generation snapshot projection fails the frozen S1 field schema: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")} (fail closed; not projected)`,
    );
  }
  return parsed.data as AdaptiveGenerationSnapshotFields;
}

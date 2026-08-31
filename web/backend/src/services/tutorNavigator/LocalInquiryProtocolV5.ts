/**
 * LocalInquiryProtocolV5（F5 — 2026-08-31 R1 结构化补全；用户拍板 2）。
 *
 * ADR-007 §3/约束 + 09:1288/09:1413：未预见问题在批准图与资源边界内生成
 * **session-local、可丢弃**的 LocalInquiryProtocol；不回写 Approved TutorPlan。
 * 本模块是 09 `LocalInquiryProtocolBuilder.Propose` 的确定性实现：
 *
 * - **六要素**（09:1288 逐字段）：sourcePlan（TP ref，与 session pin 对账）/
 *   anchorFactIds（∈ Pinned RG）/ anchorInferenceIds / beats（LBT- 命名空间）/
 *   transitions（from→LBT- 或 BT-=return_beat_id）/ returnBeatId / 
 *   expiresWithSession（恒 true——session-local 协议定义上必弃，任何"持久
 *   local 协议"都应走 artifact 发布成 PR-，R0 §3 收紧）。
 * - **LPR-/LBT- 命名空间**（id-registry 已登记）：与 Approved PR-/BT- 构造性
 *   隔离；本地 LBT- beat 不出现在任何主线事件字段（beat_id 均为 BT-，由
 *   canonical pattern 强制）。
 * - **边界校验 fail closed**（`LocalInquiryBoundaryError`，语义对齐 09
 *   `LocalInquiryBoundaryExceeded`）：锚点/graph_fact_refs 必须在 Pinned RG
 *   内；resource_ids 必须在 Pinned Plan resources 内；source_plan 必须与
 *   session pin（tutor_plan_ref 三元组）对账；return_beat_id 必须是 mainline
 *   beat；beats 的 support_boundary.may_reveal_answer 必须为 false。
 * - **事件化可重建**：协议结构只随 `policy_decision_made(open_inquiry,
 *   无 inquiry_protocol_id)` 的 payload.local_inquiry_protocol 出现一次；
 *   重放经 `findLocalInquiryProtocol(events, inquiry_id)` 从决策事件反查恢复
 *   完整结构（开协议→步进→return 全程由 committed events 重建）。
 * - **确定性**：同一 (plan, anchorBeat, sessionId, sequence) 重复构建得到逐
 *   字节相同的协议对象（G5 决定论的输入）。
 *
 * Voice/Workspace 呈现不做（F6）。
 */
import type { StoredV5Event, V5LocalInquiryProtocolPayload } from "../tutorSession/TutorSessionEventV5";
import { regionInferenceIds, type NavigatorBeatView, type NavigatorPlanV5 } from "./NavigatorPlanV5";

/** 边界越界（fail closed）——语义对齐 09 TutorSessionError.LocalInquiryBoundaryExceeded。 */
export class LocalInquiryBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalInquiryBoundaryError";
  }
}

export interface LocalInquiryBuildInput {
  readonly plan: NavigatorPlanV5;
  /** 打开 local inquiry 的主线 Beat（锚点 + 返回点来源）。 */
  readonly anchorBeat: NavigatorBeatView;
  readonly sessionId: string;
  /** 触发 sequence（LPR id 派生，保证确定性 + 会话内唯一）。 */
  readonly sequence: number;
  readonly inquiryId: string;
}

function localProtocolId(sessionId: string, sequence: number): string {
  return `LPR-${sessionId}-${String(sequence).padStart(4, "0")}`;
}

/**
 * 在批准边界内生成 session-local LocalInquiryProtocol（六要素全量）。
 * Beats 由锚点事实确定性派生（≤3 步，对齐 TutorNavigatorV5 的
 * MAX_LOCAL_INQUIRY_STEPS bound）：LBT-01 对齐确认 → LBT-02 锚点上重建推理 →
 * LBT-03 返回前自查；support boundary 全程保守（不 reveal 答案/中间结论）。
 */
export function buildLocalInquiryProtocol(input: LocalInquiryBuildInput): V5LocalInquiryProtocolPayload {
  const { plan, anchorBeat, sessionId, sequence } = input;
  const anchors = [...anchorBeat.graph_fact_refs];
  if (anchors.length === 0) {
    throw new LocalInquiryBoundaryError(
      `anchor beat ${anchorBeat.beat_id} has no graph_fact_refs; a local protocol without anchors cannot be boundary-checked (fail closed)`,
    );
  }
  const anchorInferenceIds = regionInferenceIds(plan, anchors);
  const resourceIds = [...anchorBeat.resource_ids];

  const protocol: V5LocalInquiryProtocolPayload = {
    local_protocol_id: localProtocolId(sessionId, sequence),
    source_plan: { ...plan.tutor_plan_ref },
    anchor_fact_ids: anchors,
    ...(anchorInferenceIds.length > 0 ? { anchor_inference_ids: anchorInferenceIds } : {}),
    beats: [
      {
        beat_id: "LBT-01",
        purpose: `重新对齐：确认 ${anchors.join("、")} 的既有理解`,
        graph_fact_refs: anchors,
        cognitive_activity: "recall",
        completion_evidence: { evidence_kind: "student_confirmation" },
        participation: "answer",
        pacing: { wait_policy: "bounded_wait", max_wait_seconds: 120 },
        ...(resourceIds.length > 0 ? { resource_ids: resourceIds } : {}),
        support_boundary: { may_reveal_answer: false, may_reveal_intermediate: false, max_support: "orient" },
      },
      {
        beat_id: "LBT-02",
        purpose: `在锚定事实上重建推理（学生主导表达 ${anchors.join("、")} 的联系）`,
        graph_fact_refs: anchors,
        cognitive_activity: "relate",
        completion_evidence: { evidence_kind: "student_answer" },
        participation: "answer",
        pacing: { wait_policy: "bounded_wait", max_wait_seconds: 180 },
        ...(resourceIds.length > 0 ? { resource_ids: resourceIds } : {}),
        support_boundary: { may_reveal_answer: false, may_reveal_intermediate: false, max_support: "foreground" },
      },
      {
        beat_id: "LBT-03",
        purpose: "返回主线前自查：能否说明当前结论的依据",
        graph_fact_refs: anchors,
        cognitive_activity: "explain",
        completion_evidence: { evidence_kind: "student_confirmation" },
        participation: "continue",
        pacing: { wait_policy: "student_driven" },
        ...(resourceIds.length > 0 ? { resource_ids: resourceIds } : {}),
        support_boundary: { may_reveal_answer: false, may_reveal_intermediate: false, max_support: "name_strategy" },
      },
    ],
    transitions: [
      { from_beat: "LBT-01", to_beat: "LBT-02", on: "evidence_collected" },
      { from_beat: "LBT-02", to_beat: "LBT-03", on: "evidence_collected" },
      { from_beat: "LBT-03", to_beat: anchorBeat.beat_id, on: "gate_satisfied" },
      { from_beat: "LBT-02", to_beat: anchorBeat.beat_id, on: "timeout" },
    ],
    return_beat_id: anchorBeat.beat_id,
    expires_with_session: true,
  };
  assertLocalInquiryProtocolBoundary(plan, protocol);
  return protocol;
}

/**
 * 边界校验（R0 §3 分层表「实现」行；schema 无法跨 artifact 引用，由本层
 * fail closed）：锚点/beat 引用 ∈ Pinned RG；资源 ∈ Pinned Plan resources；
 * source_plan 与 session pin 对账；return_beat_id ∈ mainline；本地 LBT- id
 * 唯一且不与 PR-/BT- 混用；may_reveal_answer=false；expires_with_session=true。
 */
export function assertLocalInquiryProtocolBoundary(
  plan: NavigatorPlanV5,
  protocol: V5LocalInquiryProtocolPayload,
): void {
  const fail = (message: string): never => {
    throw new LocalInquiryBoundaryError(`${protocol.local_protocol_id}: ${message}`);
  };
  if (
    protocol.source_plan.artifact_id !== plan.tutor_plan_ref.artifact_id ||
    protocol.source_plan.version !== plan.tutor_plan_ref.version ||
    protocol.source_plan.content_hash !== plan.tutor_plan_ref.content_hash
  ) {
    fail(
      `source_plan ${protocol.source_plan.artifact_id}@${protocol.source_plan.version} does not reconcile with the pinned tutor_plan_ref ${plan.tutor_plan_ref.artifact_id}@${plan.tutor_plan_ref.version}`,
    );
  }
  for (const factId of protocol.anchor_fact_ids) {
    if (!plan.facts.has(factId)) fail(`anchor fact ${factId} is outside the pinned ReviewedSolutionGraph`);
  }
  for (const inferenceId of protocol.anchor_inference_ids ?? []) {
    if (!plan.graph_inferences.has(inferenceId)) fail(`anchor inference ${inferenceId} is outside the pinned ReviewedSolutionGraph`);
  }
  if (!plan.mainline.beats.has(protocol.return_beat_id)) {
    fail(`return_beat_id ${protocol.return_beat_id} is not a mainline beat of the pinned plan`);
  }
  const localBeatIds = new Set<string>();
  for (const beat of protocol.beats) {
    if (!/^LBT-[0-9]{1,3}$/.test(beat.beat_id)) fail(`beat id ${beat.beat_id} is not in the session-local LBT- namespace`);
    if (localBeatIds.has(beat.beat_id)) fail(`beat id ${beat.beat_id} is duplicated within this local protocol`);
    localBeatIds.add(beat.beat_id);
    for (const factId of beat.graph_fact_refs) {
      if (!plan.facts.has(factId)) fail(`beat ${beat.beat_id} references graph fact ${factId} outside the pinned ReviewedSolutionGraph`);
    }
    for (const resourceId of beat.resource_ids ?? []) {
      if (!plan.pinned_resource_ids.has(resourceId)) {
        fail(`beat ${beat.beat_id} references resource ${resourceId} outside the pinned plan resources`);
      }
    }
    if (beat.support_boundary.may_reveal_answer !== false) {
      fail(`beat ${beat.beat_id} support_boundary.may_reveal_answer must be false (answer-truth boundary, ADR-007)`);
    }
  }
  for (const [index, transition] of protocol.transitions.entries()) {
    if (!localBeatIds.has(transition.from_beat)) {
      fail(`transitions[${index}].from_beat ${transition.from_beat} is not a beat of this local protocol`);
    }
    if (transition.to_beat.startsWith("LBT-")) {
      if (!localBeatIds.has(transition.to_beat)) {
        fail(`transitions[${index}].to_beat ${transition.to_beat} is not a beat of this local protocol`);
      }
    } else if (transition.to_beat !== protocol.return_beat_id) {
      fail(
        `transitions[${index}].to_beat ${transition.to_beat} is a mainline beat but differs from return_beat_id ${protocol.return_beat_id} (mainline is only reachable via the return point)`,
      );
    }
  }
  if (protocol.expires_with_session !== true) {
    fail("expires_with_session must be true (session-local protocols are discarded with the session; persistent ones must be published as PR- artifacts)");
  }
}

/**
 * 重放：按 inquiry_id 从 committed 事件流反查决策事件中的协议结构
 * （R0 §8.1：开协议→步进→return 全程可由 events 重建）。
 */
export function findLocalInquiryProtocol(
  events: readonly StoredV5Event[],
  inquiryId: string,
): V5LocalInquiryProtocolPayload | undefined {
  for (const event of events) {
    if (event.event_type !== "policy_decision_made") continue;
    const payload = event.payload as {
      inquiry?: { inquiry_id?: string };
      local_inquiry_protocol?: V5LocalInquiryProtocolPayload;
    };
    if (payload.inquiry?.inquiry_id === inquiryId && payload.local_inquiry_protocol) {
      return payload.local_inquiry_protocol;
    }
  }
  return undefined;
}

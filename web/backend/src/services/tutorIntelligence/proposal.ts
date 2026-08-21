/**
 * 智能链提案类型（Phase 5 remediation / 完整收口计划 Architecture 契约；
 * 2026-08-21 追加裁定：LLM/Presenter/WorkspaceAction 责任边界）。
 *
 * LangGraph 子图每轮接收固定版本 Plan + 事件投影 State + 本轮输入，只返回
 * 受约束提案（TutorTurnProposal）；事件序号分配与原子落库都在 Coordinator。
 * LLM 只做：reasoning alignment、选 TutorMove、从当前 Approved/pinned Plan
 * 选 resource_id、为允许动态表达的 Move 生成 voiceText——不产生
 * WorkspaceAction/capability/action_ref/DomainCommand（Presenter 是
 * WorkspaceAction 的唯一生产者）。
 * 提案不携带答案真值与模型私有推理——只有结论、置信度、grounding 引用与
 * 版本 provenance（可审计、可回放）。
 */
import type { Alignment, InputKind, V2EventType } from "../tutorSession/TutorSessionEvent";
import type { TutorDecisionDraft } from "../tutorPolicy/TutorMove";
import type { AlignmentOutcome } from "../tutorSession/ReasoningAligner";

/** voice 文本来源（裁定 §4）：批准资源原文 / 模型受控生成 / 确定性脚手架。 */
export type VoiceSource = "approved-resource" | "model-generated" | "deterministic-scaffold";

export interface AlignmentProposal {
  classification: Alignment;
  checkpointId?: string;
  routeId?: string;
  confidence: number;
  groundingRefs: string[];
}

export interface TutorTurnProposal {
  alignment?: AlignmentProposal;
  move: TutorDecisionDraft;
  /** 动态生成文案（model-generated 时；hint/repair 永远 approved-resource 原文）。 */
  voiceText?: string;
  voiceSource: VoiceSource;
  workflowVersion: string;
  modelId: string;
  promptVersions: string[];
  /** usage 汇总（correlation 观测用；不进 canonical 事件 payload）。 */
  usage?: { inputTokens?: number; outputTokens?: number; calls: number };
  latencyMs?: number;
}

export type PolicyFailureKind =
  | "not_configured"
  | "timeout"
  | "model_error"
  | "invalid_proposal"
  | "budget_exhausted";

export interface PolicyFailure {
  kind: PolicyFailureKind;
  detail: string;
  /** validate_proposal 的逐条错误（invalid_proposal 时）。 */
  errors?: string[];
}

/** 本轮学生输入（processTurn 的 turn 输入面）。 */
export interface StudentTurnInput {
  input_kind: InputKind;
  text?: string;
  object_id?: string;
  duration_ms?: number;
  /** structured_action_evidence 的 typed evaluator 结果（coordinator 确定性计算）。 */
  actionAlignment?: AlignmentOutcome;
}

/** build_context 裁剪后进入 prompt 的最近事件（最近 8 条相关事件）。 */
export interface RecentEventFact {
  sequence: number;
  event_type: V2EventType;
  summary: string;
  student_fact: boolean;
}

export type ProposeTurnOutcome =
  | { ok: true; proposal: TutorTurnProposal }
  | { ok: false; failure: PolicyFailure };

export const POLICY_GRAPH_WORKFLOW_VERSION = "tutor-policy-deepseek-langgraph/v1";

/**
 * WorkspaceAction 合同（Phase 5 / P5-09/10，PRD 04 §8 / ADR-006 §4）。
 *
 * Workspace 是共享黑板：TutorPolicy 只表达意图，Presenter 把「把这一步交给
 * 学生操作」派生为 WorkspaceAction；执行前必须过 legacyActionRuntime
 * 安全 adapter 的五重校验（schema / capability / target / mode / truth
 * isolation），模型不得直接发送内部 DomainCommand。
 *
 * canonical 事件 workspace_action_issued payload 是 strict 五字段；
 * resource_id 上下文放 command_payload（free record）。
 */
import type { VoiceOutcome } from "../tutorSession/TutorSessionEvent";

export interface WorkspaceActionPlan {
  action_id: string;
  decision_id: string;
  capability: string;
  target_ids: string[];
  command_payload?: Record<string, unknown>;
}

export interface WorkspaceCompletion {
  action_id: string;
  outcome: VoiceOutcome;
  failure_class?: string;
  message?: string;
}

export interface WorkspaceIssuedContext {
  resource_id: string;
  action_ref: string;
  /** learn 投影合同（runtime/evaluator 侧，含 localTruth，不出学生面）。 */
  learn_contract: unknown;
  /** assessment 投影合同（学生面：无 localTruth / teachingInput）。 */
  student_view: unknown;
}

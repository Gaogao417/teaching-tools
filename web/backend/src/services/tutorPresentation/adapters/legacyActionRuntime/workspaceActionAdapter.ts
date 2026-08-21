/**
 * WorkspaceAction 安全 adapter（Phase 5 / P5-10，PRD 04 §8 / ADR-006 §4）。
 *
 * Presenter 派生的 WorkspaceAction 在进入执行层（legacy Action Runtime /
 * Geometry）之前必须过五重校验，全部通过才投影为可执行上下文：
 * 1. schema：capability/target_ids/command_payload 形状合法；
 * 2. capability allowlist：⊆ plan.policy_constraints.allowed_capabilities 且
 *    ⊆ runtime registry 词汇表（内容寻址版本）；
 * 3. target：resource 存在、kind=action_template、action_ref 在确定性投影的
 *    action_contracts 内（防伪造对象/模板 id）；
 * 4. mode policy：Assessment 一律拒绝（fail closed），tutoring 三 mode 放行；
 * 5. truth isolation：学生面只给 assessment 投影（无 localTruth/teachingInput），
 *    learn 合同仅 runtime/evaluator 侧持有。
 *
 * 学生操作执行走真实 typed evaluator（evaluateTopicEvidence）——工具失败/
 * 误操作产生 rejected evidence，不产生 student-wrong 之外的任何混淆。
 */
import type { AuthoredActionTemplate, ActionEvidence } from "../../../../../../shared/actionRuntime";
import { evaluateTopicEvidence, type TypedActionDiagnosis } from "../../../actionRuntime/topicTypedEvaluator";
import type { RuntimeProjectionBody } from "../../../planBuild/MaterializeTutorPlan";
import type { TutorPlanV2Payload } from "../../../planBuild/canonicalInputs";
import {
  buildRuntimeRegistrySnapshot,
  isKnownCapability,
  type RuntimeRegistrySnapshot,
} from "../../../planBuild/RuntimeRegistrySnapshot";
import type { WorkspaceActionPlan } from "../../WorkspaceAction";

export interface WorkspaceActionContext {
  ok: boolean;
  errors: string[];
  resource_id?: string;
  action_ref?: string;
  template?: AuthoredActionTemplate;
  /** learn 投影（runtime/evaluator 侧；含 localTruth，禁止下发学生面）。 */
  learn_contract?: unknown;
  /** 学生面投影（assessment 形态：无 localTruth / teachingInput）。 */
  student_view?: unknown;
}

const TRUTH_KEYS = ["localTruth", "teachingInput", "expectedValues"] as const;

function containsTruthKeys(value: unknown): string[] {
  const found: string[] = [];
  const serialized = JSON.stringify(value ?? null);
  for (const key of TRUTH_KEYS) {
    if (serialized.includes(`"${key}"`)) found.push(key);
  }
  return found;
}

export function validateWorkspaceAction(
  action: WorkspaceActionPlan,
  plan: TutorPlanV2Payload,
  projection: RuntimeProjectionBody,
  options?: { registrySnapshot?: RuntimeRegistrySnapshot; sessionKind?: "tutoring" | "assessment" },
): WorkspaceActionContext {
  const errors: string[] = [];
  const snapshot = options?.registrySnapshot ?? buildRuntimeRegistrySnapshot();

  // 1. schema
  if (typeof action.capability !== "string" || !action.capability) errors.push("capability 缺失或非法");
  if (!Array.isArray(action.target_ids) || action.target_ids.some((id) => typeof id !== "string")) {
    errors.push("target_ids 必须是 string[]");
  }
  const command = (action.command_payload ?? {}) as Record<string, unknown>;
  const resourceId = typeof command.resource_id === "string" ? command.resource_id : undefined;
  const actionRef = typeof command.action_ref === "string" ? command.action_ref : undefined;
  if (!resourceId) errors.push("command_payload.resource_id 缺失");
  if (command.mode !== "learn") errors.push(`command_payload.mode 必须为 learn（got ${String(command.mode)}）`);

  // 4. mode policy（先于资源解析：Assessment 直接 fail closed）
  if (options?.sessionKind === "assessment") {
    return { ok: false, errors: ["Assessment 会话拒绝 WorkspaceAction（fail closed）"] };
  }

  // 2. capability allowlist（plan constraints + runtime registry 双重）
  if (action.capability && !plan.policy_constraints.allowed_capabilities.includes(action.capability)) {
    errors.push(`capability ${action.capability} 不在 plan allowed_capabilities 内`);
  }
  if (action.capability && !isKnownCapability(snapshot, action.capability)) {
    errors.push(`capability ${action.capability} 不在 runtime registry 词汇表内`);
  }

  // 3. target：action_template 资源 + 确定性投影 action_ref
  const resource = resourceId
    ? plan.resources.find((entry) => entry.resource_id === resourceId)
    : undefined;
  if (!resource) {
    errors.push(`resource ${resourceId ?? "(missing)"} 不在 plan resources 内`);
    return { ok: false, errors };
  }
  if (resource.kind !== "action_template") {
    errors.push(`resource ${resourceId} 是 ${resource.kind}，不是 action_template`);
  }
  if (actionRef && resource.action_ref && actionRef !== resource.action_ref) {
    errors.push(`action_ref ${actionRef} 与资源登记的 ${resource.action_ref} 不符`);
  }
  const contractEntry = projection.action_contracts.find(
    (entry) => entry.resource_id === resource.resource_id && (!actionRef || entry.action_ref === actionRef),
  );
  if (!contractEntry) {
    errors.push(`action_ref ${actionRef ?? "(missing)"} 不在确定性投影 action_contracts 内`);
    return { ok: false, errors };
  }

  // 5. truth isolation：学生面无真值键；learn 面持有 localTruth
  const studentLeaks = containsTruthKeys(contractEntry.assessment);
  if (studentLeaks.length) {
    errors.push(`学生面投影泄漏真值键：${studentLeaks.join(", ")}`);
  }
  const learnHasTruth = JSON.stringify(contractEntry.learn).includes('"localTruth"');
  if (!learnHasTruth) {
    errors.push("learn 投影缺 localTruth（evaluator 无法本地判定）");
  }

  let template: AuthoredActionTemplate | undefined;
  try {
    template = JSON.parse(resource.content ?? "{}") as AuthoredActionTemplate;
    if (!template?.actionId || !template?.kind) errors.push("action_template 资源内容不是合法 AuthoredActionTemplate");
  } catch {
    errors.push("action_template 资源内容不是合法 JSON");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    errors: [],
    resource_id: resource.resource_id,
    action_ref: contractEntry.action_ref,
    template,
    learn_contract: contractEntry.learn,
    student_view: contractEntry.assessment,
  };
}

/** 学生操作执行：真实 typed evaluator（与 Action Runtime 同一判定函数）。 */
export function evaluateWorkspaceEvidence(
  template: AuthoredActionTemplate,
  evidence: ActionEvidence,
): TypedActionDiagnosis {
  return evaluateTopicEvidence([template], [evidence]);
}

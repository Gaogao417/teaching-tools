/**
 * F7 返工（计划 v3 因果链 2）：workspace action 的单一 typed evaluator
 * adjudication 与 pinned ActionTemplate/构造资源解析。
 *
 * 纪律（f7-scope-ledger 增补 4/5）：
 * - Gate 不读教学真值——本模块是唯一的 typed evaluator 调用点，产出
 *   `WorkspaceGateAssessment` 供 GateEvidenceEvaluator 消费（与 student_answer
 *   gate 消费已验证模型 assessment 同构）；
 * - action-evidence 与直接 command 两条入口共用本 adjudicator（绕过 UI 的
 *   命令不因「回执 completed」而满足 gate——安全测试②的机制）；
 * - 值键变换显式：evidence/目标用完整元素 id（seg-AO），command params.values
 *   用短名（AO）——shortElementName 同规则，双向可逆。
 */
import type { ActionEvidence, AuthoredActionTemplate } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import { evaluateTopicEvidence, type TypedActionDiagnosis } from "../actionRuntime/topicTypedEvaluator";
import type { PlanResourceV4 } from "../planBuild/canonicalInputs";
import type { NavigatorBeatView } from "../tutorNavigator/NavigatorPlanV5";
import { shortElementName } from "../tutorSession/WorkspaceCapabilityRegistryV5";

/** Gate 消费的已验证结论（不携带真值）。 */
export interface WorkspaceGateAssessment {
  readonly verdict: "verified-correct" | "verified-wrong";
  readonly evidence_sequence: number;
  readonly diagnosis?: {
    readonly wrong_action_ids: readonly string[];
    readonly wrong_object_ids: readonly string[];
    readonly wrong_slot_ids: readonly string[];
  };
}

export interface ResolvedActionTemplate {
  readonly resource_id: string;
  readonly template: AuthoredActionTemplate;
}

/** Beat.resource_ids × plan resources（kind=action_template）确定性 join。 */
export function resolveBeatActionTemplate(
  resources: readonly PlanResourceV4[],
  beat: NavigatorBeatView,
): ResolvedActionTemplate | undefined {
  for (const resourceId of beat.resource_ids) {
    const resource = resources.find((candidate) => candidate.resource_id === resourceId);
    if (!resource || resource.kind !== "action_template" || !resource.content) continue;
    try {
      return { resource_id: resource.resource_id, template: JSON.parse(resource.content) as AuthoredActionTemplate };
    } catch {
      // content 非法在 materializer 边界 fail closed（导入已拒）；此处保守跳过。
      continue;
    }
  }
  return undefined;
}

/**
 * Beat 绑定的 workspace 构造资源（approved 链承载 BT-04 的 O/四段构造）：
 * content = {constructions: DomainCommand[]}。输出元素 id 按命令类型取
 * outputPointId/outputLineId（调用方用于幂等过滤）。
 */
export function resolveBeatConstructions(
  resources: readonly PlanResourceV4[],
  beat: NavigatorBeatView,
): readonly DomainCommand[] | undefined {
  for (const resourceId of beat.resource_ids) {
    const resource = resources.find((candidate) => candidate.resource_id === resourceId);
    if (!resource || resource.kind !== "workspace" || !resource.content) continue;
    try {
      const parsed = JSON.parse(resource.content) as { constructions?: DomainCommand[] };
      if (Array.isArray(parsed.constructions) && parsed.constructions.length > 0) return parsed.constructions;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** 构造命令的输出元素 id（幂等过滤用；与 domainCommandOutputId 同口径）。 */
export function constructionOutputId(command: DomainCommand): string | undefined {
  if (command.type === "intersect-lines") return command.outputPointId;
  if (command.type === "construct-carrier" || command.type === "construct-parallel") return command.outputLineId;
  return undefined;
}

/** 单一 evaluator：structured evidence 判定（真值=template.teachingInput）。 */
export function adjudicateActionEvidence(template: AuthoredActionTemplate, evidence: ActionEvidence): TypedActionDiagnosis {
  return evaluateTopicEvidence([template], [evidence]);
}

/** 单一 evaluator：直接 command 路径——由 target_ids + params.values（短名键）重建 values 判定。 */
export function adjudicateCommandPayload(
  template: AuthoredActionTemplate,
  command: { target_ids: readonly string[]; params?: { values?: Record<string, unknown> } },
): TypedActionDiagnosis {
  const values: Record<string, string> = {};
  const shortValues = command.params?.values;
  if (shortValues && typeof shortValues === "object" && !Array.isArray(shortValues)) {
    for (const target of command.target_ids) {
      const short = shortElementName(target);
      const value = (shortValues as Record<string, unknown>)[short];
      if (value !== undefined && value !== null && String(value).trim() !== "") values[target] = String(value);
    }
  }
  return adjudicateActionEvidence(template, {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind,
    version: 1,
    values,
  } as ActionEvidence);
}

/** assessment 组装（不携带真值；diagnosis 只含错误定位 id）。 */
export function assessmentFromDiagnosis(diagnosis: TypedActionDiagnosis, evidenceSequence: number): WorkspaceGateAssessment {
  return diagnosis.accepted
    ? { verdict: "verified-correct", evidence_sequence: evidenceSequence }
    : {
        verdict: "verified-wrong",
        evidence_sequence: evidenceSequence,
        diagnosis: {
          wrong_action_ids: [...diagnosis.wrongActionIds],
          wrong_object_ids: [...diagnosis.wrongObjectIds],
          wrong_slot_ids: [...diagnosis.wrongSlotIds],
        },
      };
}

/** accepted evidence → StudentWorkspaceCommand（capability 取 template 声明；值键短名化）。 */
export function evidenceToWorkspaceCommand(input: {
  sessionId: string;
  commandId: string;
  clientCommandId: string;
  expectedWorkspaceRevision: number;
  template: AuthoredActionTemplate;
  evidence: ActionEvidence;
}): {
  schema: "ai_teaching_student_workspace_command/v1";
  session_id: string;
  origin: "student";
  command_id: string;
  surface: "geometry";
  capability: string;
  target_ids: string[];
  expected_workspace_revision: number;
  client_command_id: string;
  params: { values: Record<string, string> };
} {
  const values = (input.evidence as { values?: Record<string, string> }).values ?? {};
  const targetIds = Object.keys(values);
  return {
    schema: "ai_teaching_student_workspace_command/v1",
    session_id: input.sessionId,
    origin: "student",
    command_id: input.commandId,
    surface: "geometry",
    capability: input.template.capabilities.find((capability) => !capability.startsWith("agent:")) ?? input.template.capabilities[0],
    target_ids: targetIds,
    expected_workspace_revision: input.expectedWorkspaceRevision,
    client_command_id: input.clientCommandId,
    params: { values: Object.fromEntries(targetIds.map((target) => [shortElementName(target), values[target]])) },
  };
}

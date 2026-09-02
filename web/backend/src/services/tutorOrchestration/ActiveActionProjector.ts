/**
 * F7 Step 4：ActiveActionProjector——当前 Beat 的学生安全 Action 投影
 *（Presenter/Orchestrator 应用层；route 只序列化，不在此层之外做选择/构造）。
 *
 * 数据源（全部 canonical，无新域合同）：
 * - Beat.resource_ids × plan resources(kind=action_template) 确定性 join →
 *   materializer projection 的 action_contracts[resource_id]（assessment 投影
 *   =学生安全面：truth 已剥——topicPlanProjector 口径）；
 * - ExercisePlan 的 world.geometry = pinned catalog baseGeometry + 已 committed
 *   tutor DomainCommands 经既有 applyDomainCommands 合成（**禁止**从
 *   StudentWorkspaceView.canvas.elements 反推——View 无坐标；ledger 实施附则）。
 */
import { ACTION_RUNTIME_PLAN_VERSION, type ActionContract, type ExercisePlan } from "../../../../shared/actionRuntime";
import { applyDomainCommands, type DomainCommand } from "../../../../shared/actionWorld";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { PlanResourceV4 } from "../planBuild/canonicalInputs";
import type { NavigatorBeatView } from "../tutorNavigator/NavigatorPlanV5";
import type { WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";
import { resolveBeatActionTemplate } from "./WorkspaceActionAdjudication";

/** materializer projection 的 action_contracts 元素形状（ImportApprovedPlanV5 返回）。 */
export interface ProjectedActionContract {
  readonly resource_id: string;
  readonly action_ref: string;
  readonly learn: ActionContract;
  readonly assessment: ActionContract;
}

/** 学生安全 active action 交付 DTO（形状对齐旧 TutorWorkspaceAction）。 */
export interface ActiveAction {
  readonly action_id: string;
  readonly resource_id: string;
  readonly action_ref: string;
  readonly capability: string;
  readonly target_ids: readonly string[];
  readonly student_view: ActionContract;
  readonly action_plan: ExercisePlan;
  readonly form: "operation";
}

export interface ActiveActionProjectorInput {
  readonly resources: readonly PlanResourceV4[];
  readonly actionContracts: readonly ProjectedActionContract[];
  readonly beat: NavigatorBeatView;
  readonly catalog: WorkspacePresentationCatalogV5;
  readonly committedTutorCommands: readonly DomainCommand[];
  readonly workspaceRevision: number;
  readonly taskId: string;
  readonly promptLatex: string;
}

/** 由 committed tutor 命令合成当前画布几何（题面 authored + 构造增量）。 */
function composedGeometry(input: ActiveActionProjectorInput): TopicGeometryModel | undefined {
  const base = input.catalog.baseGeometry;
  if (!base) return undefined;
  if (input.committedTutorCommands.length === 0) return base;
  const world = applyDomainCommands(
    { geometry: base, revision: input.workspaceRevision },
    input.committedTutorCommands,
  );
  return world.geometry;
}

/**
 * 投影当前 Beat 的 active action；非 workspace 拍 / 无 action_template 绑定 /
 * 构造未 committed（因果链 1 不变量：availableSegmentIds 引用的 seg- 元素必须
 * 已在合成几何中）→ undefined（不挂载）。
 */
export function projectActiveAction(input: ActiveActionProjectorInput): ActiveAction | undefined {
  const beat = input.beat;
  if (beat.completion_evidence.evidence_kind !== "workspace_command") return undefined;
  const resolved = resolveBeatActionTemplate(input.resources, beat);
  if (!resolved) return undefined;
  const projected = input.actionContracts.find((contract) => contract.resource_id === resolved.resource_id);
  if (!projected) return undefined;

  const geometry = composedGeometry(input);
  const available = (projected.assessment.input as { availableSegmentIds?: string[] }).availableSegmentIds ?? [];
  if (geometry) {
    const known = new Set([...geometry.points.map((point) => point.id), ...geometry.segments.map((segment) => segment.id)]);
    const missing = available.filter((target) => !known.has(target));
    if (missing.length > 0) return undefined; // 构造尚未 committed——Action 不挂载
  }

  const actionPlan: ExercisePlan = {
    planVersion: ACTION_RUNTIME_PLAN_VERSION,
    exerciseId: projected.assessment.actionId,
    revision: input.workspaceRevision,
    mode: "assessment",
    metadata: {
      taskId: input.taskId,
      title: beat.purpose,
      promptLatex: input.promptLatex,
      skillTags: [],
    },
    world: { geometry, revision: input.workspaceRevision },
    coach: { profileId: "golden-vnext", displayName: "陪练老师", avatarId: "school", tone: "supportive" },
    actions: [projected.assessment],
    currentActionId: projected.assessment.actionId,
    completedActionIds: [],
  };
  const template = resolved.template;
  return {
    action_id: template.actionId,
    resource_id: resolved.resource_id,
    action_ref: projected.action_ref,
    capability: template.capabilities.find((capability) => !capability.startsWith("agent:")) ?? template.capabilities[0],
    target_ids: available,
    student_view: projected.assessment,
    action_plan: actionPlan,
    form: "operation",
  };
}

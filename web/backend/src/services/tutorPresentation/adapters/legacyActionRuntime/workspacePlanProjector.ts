/**
 * Tutor Workspace → Action Runtime 计划投影（Phase 5 UI 集成 / 计划 §3）。
 *
 * Presenter 已验证的 WorkspaceAction 在这里升格为完整的、学生安全的
 * `ExercisePlan`（单 action、assessment 形态：server-authoritative、无
 * localTruth/teachingInput——与 workspaceActionAdapter 五重校验的学生面
 * 投影一致，不引入第二套真值边界）。前端 ActionRuntimeFrame 只消费该
 * 计划，不解析 action_template JSON。
 *
 * 画布 world：白板类动作（make-parallel 等）的 AuthoredActionTemplate
 * `input.geometry` 携带 authored TopicGeometryModel（input 对 backend 是
 * opaque JSON、对前端 registry 是 action 专属 schema，坐标/点线不是答案
 * 真值——truth 只在 teachingInput.localTruth 侧）。
 */
import {
  ACTION_RUNTIME_PLAN_VERSION,
  type ActionContract,
  type ExercisePlan,
} from "../../../../../../shared/actionRuntime";
import type { TopicGeometryModel } from "../../../../../../shared/topicPractice";
import type { AuthoredActionTemplate } from "../../../../../../shared/actionRuntime";
import type { TutorPlanV2Payload } from "../../../planBuild/canonicalInputs";

export interface TutorWorkspacePlanContext {
  /** Topic（v4 binding 会话的真实 taskId；隔离 golden 会话退回 plan id）。 */
  taskId: string;
  /** 选中 Question 的题干（学生安全面，来自 truth.stem）。 */
  promptLatex: string;
  title?: string;
  skillTags?: string[];
}

function isTopicGeometryModel(value: unknown): value is TopicGeometryModel {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<TopicGeometryModel>;
  return Boolean(candidate.viewBox && Array.isArray(candidate.points) && Array.isArray(candidate.segments));
}

export function buildTutorWorkspacePlan(
  plan: TutorPlanV2Payload,
  template: AuthoredActionTemplate,
  assessment: ActionContract,
  context: TutorWorkspacePlanContext,
): ExercisePlan {
  const rawGeometry = template.input.geometry;
  const geometry = isTopicGeometryModel(rawGeometry) ? rawGeometry : undefined;
  return {
    planVersion: ACTION_RUNTIME_PLAN_VERSION,
    exerciseId: `tutor:${plan.artifact_id}:${assessment.actionId}`,
    revision: 1,
    mode: "assessment",
    metadata: {
      taskId: context.taskId,
      title: context.title ?? "智能一对一",
      promptLatex: context.promptLatex,
      skillTags: context.skillTags ?? [],
    },
    world: { revision: 1, ...(geometry ? { geometry } : {}) },
    coach: {
      profileId: "tutor-workspace-v1",
      displayName: "一对一老师",
      avatarId: "school",
      tone: "supportive",
    },
    actions: [assessment],
    currentActionId: assessment.actionId,
    completedActionIds: [],
    // Tutor 会话是唯一权威：评估走 TutorSession typed evaluator（transport），
    // narration/实时 coach 归 Tutor 管线，训练记录不本地造第二套。
    runtimeCapabilities: {
      practiceValidation: "server-authoritative",
      trainingSync: "local-only",
      narrationTransport: "off",
      coachTurnTransport: "request-response",
      liveCoach: false,
    },
  };
}

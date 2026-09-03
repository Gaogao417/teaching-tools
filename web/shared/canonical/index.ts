/**
 * ai_teaching canonical contracts 的 TypeScript validation adapter（P1-05）。
 *
 * 只做 parse / validate / resolve：Approved artifact 不可变（ADR-004 §3），
 * 本目录不存在也不会添加任何原地更新 API（Phase 1 退出门禁 2；
 * 由 src/services/contracts/__tests__ 的 API surface 测试结构性自证）。
 */
import { z } from "zod";

import {
  approachSetSchema,
  benchmarkRunSchema,
  interventionSchema,
  questionCandidateSchema,
  questionTruthSchema,
  questionTruthV2Schema,
  skillHypothesisSchema,
  sourceEvidenceSchema,
  sutConfigSchema,
  teachingApproachSchema,
  teachingApproachV2Schema,
  teachingApproachV3Schema,
  teachingApproachV4Schema,
  topicQuestionTeachingBindingSchema,
  tutorPolicyProfileSchema,
  tutorPlanBundleSchema,
  tutorPlanBundleV2Schema,
  tutorPlanBundleV3Schema,
  tutorSessionEventSchema,
  tutorSessionEventV2Schema,
  tutorSessionEventV3Schema,
  tutorSessionEventV4Schema,
  artifactRefV1Schema,
  reviewedSolutionGraphV1Schema,
  teachingProtocolV1Schema,
  tutorPlanBundleV4Schema,
  teachingProtocolV2Schema,
  tutorPlanBundleV5Schema,
  studentIntentV1Schema,
  tutorPolicyDecisionV1Schema,
  voiceActionV1Schema,
  workspaceSurfaceActionV1Schema,
  studentWorkspaceCommandV1Schema,
  actionOutcomeV1Schema,
  externalSupportEvidenceV1Schema,
  presentationPlanV1Schema,
  tutorSessionEventV5Schema,
  studentInputV1Schema,
  presentationPlanV2Schema,
  presentationDeliveryV1Schema,
  presentationOutcomeV1Schema,
  tutorSessionEventV6Schema,
  workspaceRuntimeStateV1Schema,
  tutorRuntimeStateV1Schema,
  tutorRuntimeStateV2Schema,
  studentWorkspaceViewV1Schema,
  coachPanelViewV1Schema,
  mainlineParticipationV1Schema,
} from "./schemas";

export * from "./schemas";
export * from "./artifactUri";
export * from "./publication";

const SCHEMA_CONST_TO_ZOD: Record<string, z.ZodTypeAny> = {
  "ai_teaching_source_evidence/v1": sourceEvidenceSchema,
  "ai_teaching_question_candidate/v1": questionCandidateSchema,
  "ai_teaching_question_truth/v1": questionTruthSchema,
  "ai_teaching_question_truth/v2": questionTruthV2Schema,
  "ai_teaching_teaching_approach/v1": teachingApproachSchema,
  "ai_teaching_teaching_approach/v2": teachingApproachV2Schema,
  "ai_teaching_teaching_approach/v3": teachingApproachV3Schema,
  "ai_teaching_teaching_approach/v4": teachingApproachV4Schema,
  "ai_teaching_approach_set/v1": approachSetSchema,
  "ai_teaching_topic_question_binding/v1": topicQuestionTeachingBindingSchema,
  "ai_teaching_tutor_policy_profile/v1": tutorPolicyProfileSchema,
  "ai_teaching_tutor_plan_bundle/v1": tutorPlanBundleSchema,
  "ai_teaching_tutor_plan_bundle/v2": tutorPlanBundleV2Schema,
  "ai_teaching_tutor_plan_bundle/v3": tutorPlanBundleV3Schema,
  "ai_teaching_tutor_session_event/v1": tutorSessionEventSchema,
  "ai_teaching_tutor_session_event/v2": tutorSessionEventV2Schema,
  "ai_teaching_tutor_session_event/v3": tutorSessionEventV3Schema,
  "ai_teaching_tutor_session_event/v4": tutorSessionEventV4Schema,
  "ai_teaching_artifact_ref/v1": artifactRefV1Schema,
  "ai_teaching_reviewed_solution_graph/v1": reviewedSolutionGraphV1Schema,
  "ai_teaching_teaching_protocol/v1": teachingProtocolV1Schema,
  "ai_teaching_tutor_plan_bundle/v4": tutorPlanBundleV4Schema,
  "ai_teaching_teaching_protocol/v2": teachingProtocolV2Schema,
  "ai_teaching_tutor_plan_bundle/v5": tutorPlanBundleV5Schema,
  "ai_teaching_student_intent/v1": studentIntentV1Schema,
  "ai_teaching_tutor_policy_decision/v1": tutorPolicyDecisionV1Schema,
  "ai_teaching_voice_action/v1": voiceActionV1Schema,
  "ai_teaching_workspace_surface_action/v1": workspaceSurfaceActionV1Schema,
  "ai_teaching_student_workspace_command/v1": studentWorkspaceCommandV1Schema,
  "ai_teaching_action_outcome/v1": actionOutcomeV1Schema,
  "ai_teaching_external_support_evidence/v1": externalSupportEvidenceV1Schema,
  "ai_teaching_presentation_plan/v1": presentationPlanV1Schema,
  "ai_teaching_tutor_session_event/v5": tutorSessionEventV5Schema,
  "ai_teaching_student_input/v1": studentInputV1Schema,
  "ai_teaching_presentation_plan/v2": presentationPlanV2Schema,
  "ai_teaching_presentation_delivery/v1": presentationDeliveryV1Schema,
  "ai_teaching_presentation_outcome/v1": presentationOutcomeV1Schema,
  "ai_teaching_tutor_session_event/v6": tutorSessionEventV6Schema,
  "ai_teaching_workspace_runtime_state/v1": workspaceRuntimeStateV1Schema,
  "ai_teaching_tutor_runtime_state/v1": tutorRuntimeStateV1Schema,
  "ai_teaching_tutor_runtime_state/v2": tutorRuntimeStateV2Schema,
  "ai_teaching_student_workspace_view/v1": studentWorkspaceViewV1Schema,
  "ai_teaching_coach_panel_view/v1": coachPanelViewV1Schema,
  "ai_teaching_mainline_participation/v1": mainlineParticipationV1Schema,
  "ai_teaching_skill_hypothesis/v1": skillHypothesisSchema,
  "ai_teaching_intervention/v1": interventionSchema,
  "ai_teaching_sut_config/v1": sutConfigSchema,
  "ai_teaching_benchmark_run/v1": benchmarkRunSchema,
};

export interface ValidationOutcome {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/** 校验单个 canonical 对象；分派依据是对象自身的 `schema` 常量。 */
export function validatePayload(payload: unknown): ValidationOutcome {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["payload is not a JSON object"] };
  }
  const schemaConst = (payload as Record<string, unknown>).schema;
  const schema = typeof schemaConst === "string" ? SCHEMA_CONST_TO_ZOD[schemaConst] : undefined;
  if (!schema) {
    return { ok: false, errors: [`unknown schema constant: ${String(schemaConst)}`] };
  }
  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    ),
  };
}

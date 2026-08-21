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
  tutorPlanBundleSchema,
  tutorPlanBundleV2Schema,
  tutorSessionEventSchema,
  tutorSessionEventV2Schema,
  tutorSessionEventV3Schema,
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
  "ai_teaching_approach_set/v1": approachSetSchema,
  "ai_teaching_tutor_plan_bundle/v1": tutorPlanBundleSchema,
  "ai_teaching_tutor_plan_bundle/v2": tutorPlanBundleV2Schema,
  "ai_teaching_tutor_session_event/v1": tutorSessionEventSchema,
  "ai_teaching_tutor_session_event/v2": tutorSessionEventV2Schema,
  "ai_teaching_tutor_session_event/v3": tutorSessionEventV3Schema,
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

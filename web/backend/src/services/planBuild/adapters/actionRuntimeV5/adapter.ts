/**
 * actionRuntime v5 适配器（Phase 4 / P4-04、P4-08）。
 *
 * 把 TutorPlan v2 的 action_template 资源投影为既有 Action Runtime v5 合同：
 * - 复用 topicPlanProjector.materializeActionTemplate（learn/assessment 双投影）；
 * - render smoke：把物化后的 contract 包进最小 ExercisePlan，用 isExercisePlan
 *   做 schema + truth isolation 校验（assessment 投影不得携带 localTruth 或
 *   LOCAL_TRUTH_KEYS 字段）；
 * - typed evaluator smoke：用 teachingInput 构造正/误证据各一条，过
 *   evaluateTopicEvidence，正确证据必须 accepted、错误证据必须 rejected。
 */
import {
  ACTION_RUNTIME_PLAN_VERSION,
  isExercisePlan,
  type ActionContract,
  type ActionEvidence,
  type AuthoredActionTemplate,
  type ExercisePlan,
} from "../../../../../../shared/actionRuntime";
import { materializeActionTemplate } from "../../../actionRuntime/topicPlanProjector";
import { evaluateTopicEvidence } from "../../../actionRuntime/topicTypedEvaluator";

/** capability-skill-map.yaml 的 action_kind → capability 摘要（vocabulary 真源的镜像）。 */
export const ACTION_KIND_CAPABILITY: Readonly<Record<string, string>> = {
  "make-parallel": "similarity.construct-parallel-helper",
  "intersect-carriers": "similarity.construct-parallel-helper",
  "mark-segment-values": "similarity.mark-known-segments",
  "pair-segments": "similarity.map-corresponding-sides",
  "ratio-scratch": "similarity.transfer-ratio-shares",
  "convert-collinear": "similarity.convert-collinear-segments",
  "enter-equation": "similarity.build-side-equation",
  "select-option": "similarity.recognize-similarity-model",
  "enter-text": "similarity.plan-similarity-proof",
};

export interface TemplateSmokeResult {
  ok: boolean;
  errors: string[];
  learn?: ActionContract;
  assessment?: ActionContract;
}

function smokeExercisePlan(contract: ActionContract): ExercisePlan {
  return {
    planVersion: ACTION_RUNTIME_PLAN_VERSION,
    exerciseId: `tutor-plan-smoke:${contract.actionId}`,
    revision: 1,
    mode: contract.validationPolicy === "server-authoritative" ? "assessment" : "learn",
    metadata: {
      taskId: "tutor-plan-smoke",
      title: contract.title,
      promptLatex: "",
      skillTags: [],
    },
    world: { revision: 0 },
    coach: {
      profileId: "smoke",
      displayName: "smoke",
      avatarId: "smoke",
      tone: "supportive",
    },
    actions: [contract],
    currentActionId: contract.actionId,
    completedActionIds: [],
  };
}

/** 单模板 render smoke：learn + assessment 双投影都必须是合法 ExercisePlan。 */
export function smokeActionTemplate(template: AuthoredActionTemplate): TemplateSmokeResult {
  const errors: string[] = [];
  const learn = materializeActionTemplate(template, "learn");
  const assessment = materializeActionTemplate(template, "assessment");
  if (!isExercisePlan(smokeExercisePlan(learn))) {
    errors.push(`${template.actionId}: learn 投影未通过 isExercisePlan`);
  }
  if (!isExercisePlan(smokeExercisePlan(assessment))) {
    errors.push(
      `${template.actionId}: assessment 投影未通过 isExercisePlan（truth isolation / contract 违约）`,
    );
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors, learn, assessment };
}

function expectedEvidence(template: AuthoredActionTemplate): ActionEvidence | null {
  const base = {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    version: 1 as const,
  };
  const truth = template.teachingInput ?? {};
  switch (template.kind) {
    case "enter-text": {
      const expected = truth.expectedValues;
      if (!Array.isArray(expected) || typeof expected[0] !== "string") return null;
      return { ...base, kind: "enter-text", value: expected[0] };
    }
    case "select-option": {
      const expected = truth.expectedValue;
      if (typeof expected !== "string") return null;
      return { ...base, kind: "select-option", value: expected };
    }
    default:
      return null;
  }
}

export interface EvaluatorSmokeResult {
  ok: boolean;
  errors: string[];
  acceptedCorrect: boolean | null;
  rejectedWrong: boolean | null;
}

/** typed evaluator smoke：正证据 accepted、误证据 rejected；不适用的 kind 记 not_applicable。 */
export function evaluatorSmoke(template: AuthoredActionTemplate): EvaluatorSmokeResult {
  const evidence = expectedEvidence(template);
  if (!evidence) {
    return {
      ok: true,
      errors: [],
      acceptedCorrect: null,
      rejectedWrong: null,
    };
  }
  const correct = evaluateTopicEvidence([template], [evidence]);
  const wrong = evaluateTopicEvidence([template], [
    { ...evidence, value: `${(evidence as { value: string }).value}✗not-accepted` } as ActionEvidence,
  ]);
  const errors: string[] = [];
  if (!correct.accepted) errors.push(`${template.actionId}: 正确证据未被 typed evaluator 接受`);
  if (wrong.accepted) errors.push(`${template.actionId}: 错误证据被 typed evaluator 接受`);
  return { ok: errors.length === 0, errors, acceptedCorrect: correct.accepted, rejectedWrong: !wrong.accepted };
}

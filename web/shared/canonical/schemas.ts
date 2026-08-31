/**
 * ai_teaching canonical contracts 的 TypeScript/Zod adapter（P1-05）。
 *
 * 逐字段对应 PRD 仓 contracts/schemas 下各 domain 的 v1 JSON Schema；
 * Python 侧（teaching_skills `integrations/ai_teaching_contracts/models.py`）实现
 * 同一合同，两侧对 `contracts/fixtures/` 的判定必须一致（退出门禁 1）。
 */
import { z } from "zod";

// --------------------------------------------------------------------------- //
// 公共标量（regex 与 JSON Schema 逐字相同）
// --------------------------------------------------------------------------- //
const nonEmptyString = z.string().min(1);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const versionTag = z.string().regex(/^v[0-9]+$/);

const questionId = z.string().regex(/^QT-[A-Z0-9]+-[0-9]{3,}$/);
const candidateId = z.string().regex(/^QC-[A-Z0-9]+-[0-9]{3,}$/);
const evidenceId = z.string().regex(/^SE-[A-Z0-9]+-[0-9]{3,}$/);
const approachId = z.string().regex(/^TA-[A-Z0-9]+-[0-9]{3,}$/);
const planId = z.string().regex(/^TP-[A-Z0-9]+-[0-9]{3,}$/);
const sessionId = z.string().regex(/^TS-[0-9]{4,}$/);
const skillId = z.string().regex(/^SKILL-[A-Z0-9]+-[0-9]{3,}$/);
const hypothesisId = z.string().regex(/^SH-[0-9]{4,}$/);
const interventionId = z.string().regex(/^IV-[0-9]{4,}$/);
const runId = z.string().regex(/^BR-[0-9]{4,}$/);
const caseId = z.string().regex(/^C-(INT|TRU|APP|PLN|RT)-[0-9]{2,}$/);
const policyProfileId = z.string().regex(/^PP-[A-Z0-9]+-[0-9]{3,}$/);
const topicQuestionBindingId = z.string().regex(/^TB-[A-Z0-9]+-[0-9]{3,}$/);

const checkpointIdPattern = z.string().regex(/^CP[0-9]{1,3}$/);
const statusEnum = z.enum([
  "Draft",
  "InReview",
  "Approved",
  "Stale",
  "Disabled",
  "Superseded",
]);
const questionTypeEnum = z.enum(["choice", "fill_blank", "solution"]);
const isoDateTime = z.string().datetime({ offset: true });
const artifactUriPattern = z
  .string()
  .regex(
    /^artifact:\/\/[a-z][a-z0-9-]*\/[A-Za-z0-9._~!$&'()*+,;=:%-]+(@v[0-9]+)?(\/[A-Za-z0-9._~!$&'()*+,;=:%-]+)*$/,
  );

const parserProvenance = z
  .object({
    parser_id: nonEmptyString,
    parser_version: nonEmptyString,
    harness: nonEmptyString,
    model: z
      .object({ provider: nonEmptyString, model_id: nonEmptyString })
      .strict()
      .optional(),
  })
  .strict();

const evidenceRef = z
  .object({
    evidence_id: evidenceId,
    artifact_uri: z.string().regex(/^artifact:\/\//),
  })
  .strict();

const subquestion = z
  .object({
    part_id: z.string().regex(/^[1-9][0-9]{0,2}$/),
    prompt: nonEmptyString,
    points: z.number().positive().optional(),
  })
  .strict();

// --------------------------------------------------------------------------- //
// authoring/v1/source-evidence
// --------------------------------------------------------------------------- //
export const sourceEvidenceSchema = z
  .object({
    schema: z.literal("ai_teaching_source_evidence/v1"),
    evidence_id: evidenceId,
    source_pack_id: z.string().regex(/^pack-[A-Za-z0-9-]+$/),
    artifact_uri: artifactUriPattern,
    content_hash: sha256,
    locator: z.discriminatedUnion(
      "kind",
      [
        z
          .object({
            kind: z.literal("page"),
            page: z.number().int().min(1),
            note: z.string().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("page_region"),
            page: z.number().int().min(1),
            bbox: z.tuple([
              z.number(),
              z.number(),
              z.number(),
              z.number(),
            ]),
            note: z.string().optional(),
          })
          .strict(),
        z
          .object({
            kind: z.literal("docx_range"),
            paragraph_start: z.number().int().min(0),
            paragraph_end: z.number().int().min(0),
            note: z.string().optional(),
          })
          .strict(),
      ],
    ),
    parser_provenance: parserProvenance,
    extracted_at: isoDateTime,
    notes: z.string().optional(),
  })
  .strict();

// --------------------------------------------------------------------------- //
// authoring/v1/question-candidate
// --------------------------------------------------------------------------- //
export const questionCandidateSchema = z
  .object({
    schema: z.literal("ai_teaching_question_candidate/v1"),
    candidate_id: candidateId,
    source_evidence_refs: z.array(evidenceRef).min(1),
    question_type: questionTypeEnum,
    stem: nonEmptyString,
    subquestions: z.array(subquestion).default([]),
    figure_refs: z
      .array(z.string().regex(/^artifact:\/\//))
      .default([]),
    review_state: z
      .object({
        status: z.enum(["Draft", "InReview", "Approved", "Disabled"]),
        reviewer_id: z.string().optional(),
        note: z.string().optional(),
        edited_by_reviewer: z.boolean().optional(),
      })
      .strict(),
    extraction: z
      .object({
        extracted_at: isoDateTime,
        parser_provenance: parserProvenance,
      })
      .strict(),
    content_hash: sha256,
  })
  .strict();

// --------------------------------------------------------------------------- //
// authoring/v1/question-truth
// --------------------------------------------------------------------------- //
const approval = z
  .object({
    reviewer_id: nonEmptyString,
    approved_at: isoDateTime,
    review_note: z.string().optional(),
    edits_applied: z.boolean().optional(),
  })
  .strict();

const supersededBy = z
  .object({ artifact_id: nonEmptyString, version: versionTag })
  .strict();

export const questionTruthSchema = z
  .object({
    schema: z.literal("ai_teaching_question_truth/v1"),
    artifact_id: questionId,
    version: versionTag,
    status: statusEnum,
    question_type: questionTypeEnum,
    stem: nonEmptyString,
    subquestions: z.array(subquestion).default([]),
    canonical_answer: z
      .object({
        kind: z.enum([
          "numeric",
          "expression",
          "text",
          "proof",
          "choice_option",
        ]),
        value: nonEmptyString,
        acceptance: z
          .array(
            z.enum([
              "numeric_equivalence",
              "radical_simplification",
              "vertex_cyclic_permutation",
              "answer_normalization",
              "unit_conversion",
              "manual_review",
            ]),
          )
          .default([]),
        range_constraint: z.string().optional(),
      })
      .strict(),
    reviewed_solution: nonEmptyString,
    source_evidence_refs: z.array(evidenceRef).min(1),
    origin_candidate_id: candidateId.optional(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/question-truth\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v2/question-truth（ADR-005 小问粒度）
// --------------------------------------------------------------------------- //
const subquestionV2 = z
  .object({
    part_id: z.string().regex(/^[1-9][0-9]{0,2}$/),
    prompt: nonEmptyString,
    points: z.number().positive().optional(),
    canonical_answer: z
      .object({
        kind: z.enum([
          "numeric",
          "expression",
          "text",
          "proof",
          "choice_option",
        ]),
        value: nonEmptyString,
        acceptance: z
          .array(
            z.enum([
              "numeric_equivalence",
              "radical_simplification",
              "vertex_cyclic_permutation",
              "answer_normalization",
              "unit_conversion",
              "manual_review",
            ]),
          )
          .default([]),
        range_constraint: z.string().optional(),
      })
      .strict(),
    reviewed_solution: nonEmptyString,
  })
  .strict();

export const questionTruthV2Schema = z
  .object({
    schema: z.literal("ai_teaching_question_truth/v2"),
    artifact_id: questionId,
    version: versionTag,
    status: statusEnum,
    question_type: questionTypeEnum,
    stem: nonEmptyString,
    subquestions: z.array(subquestionV2).default([]),
    canonical_answer: z
      .object({
        kind: z.enum([
          "numeric",
          "expression",
          "text",
          "proof",
          "choice_option",
        ]),
        value: nonEmptyString,
        acceptance: z
          .array(
            z.enum([
              "numeric_equivalence",
              "radical_simplification",
              "vertex_cyclic_permutation",
              "answer_normalization",
              "unit_conversion",
              "manual_review",
            ]),
          )
          .default([]),
        range_constraint: z.string().optional(),
      })
      .strict()
      .optional(),
    reviewed_solution: nonEmptyString.optional(),
    source_evidence_refs: z.array(evidenceRef).min(1),
    origin_candidate_id: candidateId.optional(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/question-truth\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
    if (value.subquestions.length > 0) {
      // ADR-005：有小问时小问级真值为单一事实源，顶层禁存整题答案/解答。
      if (value.canonical_answer !== undefined || value.reviewed_solution !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "subquestions present: top-level canonical_answer/reviewed_solution forbidden",
        });
      }
    } else if (value.canonical_answer === undefined || value.reviewed_solution === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "no subquestions: top-level canonical_answer/reviewed_solution required",
      });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v1/teaching-approach
// --------------------------------------------------------------------------- //
const questionRef = z
  .object({
    artifact_id: questionId,
    version: versionTag,
    content_hash: sha256,
  })
  .strict();

export const teachingApproachSchema = z
  .object({
    schema: z.literal("ai_teaching_teaching_approach/v1"),
    artifact_id: approachId,
    version: versionTag,
    status: statusEnum,
    question_ref: questionRef,
    title: nonEmptyString,
    goal: nonEmptyString,
    entry_signal: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            step_id: z.string().regex(/^S[0-9]{1,3}$/),
            intent: nonEmptyString,
            narration: nonEmptyString,
            expected_student_reasoning: nonEmptyString,
            accepted_alternatives: z.array(nonEmptyString).default([]),
            common_errors: z.array(nonEmptyString).default([]),
            skill_ids: z.array(skillId).min(1),
          })
          .strict(),
      )
      .min(3),
    evidence: z
      .object({
        audio: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/audio\//),
                content_hash: sha256,
                recorded_at: isoDateTime,
                duration_seconds: z.number().positive().optional(),
              })
              .strict(),
          )
          .default([]),
        transcripts: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
                asr_provenance: z
                  .object({ provider: nonEmptyString, model_id: nonEmptyString })
                  .strict(),
                revision: z.number().int().min(1).optional(),
              })
              .strict(),
          )
          .default([]),
        polished: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
                polish_provenance: z
                  .object({
                    provider: nonEmptyString,
                    model_id: nonEmptyString,
                    prompt_version: nonEmptyString,
                  })
                  .strict(),
              })
              .strict(),
          )
          .default([]),
        manual_edit_notes: z.array(z.string()).default([]),
      })
      .strict(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/teaching-approach\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v2/teaching-approach（ADR-005：一个小问 × 一种解法）
// --------------------------------------------------------------------------- //
const partQuestionRef = z
  .object({
    artifact_id: questionId,
    version: versionTag,
    content_hash: sha256,
    // QT 含 subquestions 时必填（跨对象校验在冻结/评测层 fail closed）。
    part_id: z.string().regex(/^[1-9][0-9]{0,2}$/).optional(),
  })
  .strict();

export const teachingApproachV2Schema = z
  .object({
    schema: z.literal("ai_teaching_teaching_approach/v2"),
    artifact_id: approachId,
    version: versionTag,
    status: statusEnum,
    question_ref: partQuestionRef,
    title: nonEmptyString,
    goal: nonEmptyString,
    entry_signal: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            step_id: z.string().regex(/^S[0-9]{1,3}$/),
            intent: nonEmptyString,
            narration: nonEmptyString,
            expected_student_reasoning: nonEmptyString,
            accepted_alternatives: z.array(nonEmptyString).default([]),
            common_errors: z.array(nonEmptyString).default([]),
            skill_ids: z.array(skillId).min(1),
          })
          .strict(),
      )
      .min(3),
    evidence: z
      .object({
        audio: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/audio\//),
                content_hash: sha256,
                recorded_at: isoDateTime,
                duration_seconds: z.number().positive().optional(),
              })
              .strict(),
          )
          .default([]),
        transcripts: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
                asr_provenance: z
                  .object({ provider: nonEmptyString, model_id: nonEmptyString })
                  .strict(),
                revision: z.number().int().min(1).optional(),
              })
              .strict(),
          )
          .default([]),
        polished: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
                polish_provenance: z
                  .object({
                    provider: nonEmptyString,
                    model_id: nonEmptyString,
                    prompt_version: nonEmptyString,
                  })
                  .strict(),
              })
              .strict(),
          )
          .default([]),
        manual_edit_notes: z.array(z.string()).default([]),
      })
      .strict(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/teaching-approach\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v3/teaching-approach（ADR-006：步骤不再强制 skill_ids）
// --------------------------------------------------------------------------- //
export const teachingApproachV3Schema = z
  .object({
    schema: z.literal("ai_teaching_teaching_approach/v3"),
    artifact_id: approachId,
    version: versionTag,
    status: statusEnum,
    question_ref: z
      .object({
        artifact_id: questionId,
        version: versionTag,
        content_hash: sha256,
        // v3：part_id 必填（小问粒度是 v2 起的固定边界）。
        part_id: z.string().regex(/^[1-9][0-9]{0,2}$/),
      })
      .strict(),
    title: nonEmptyString,
    goal: nonEmptyString,
    entry_signal: z.string().optional(),
    steps: z
      .array(
        z
          .object({
            step_id: z.string().regex(/^S[0-9]{1,3}$/),
            intent: nonEmptyString,
            narration: nonEmptyString,
            expected_student_reasoning: nonEmptyString,
            accepted_alternatives: z.array(nonEmptyString).optional(),
            common_errors: z.array(nonEmptyString).optional(),
            source_trace_refs: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .min(3),
    evidence: z
      .object({
        audio: z.array(
          z
            .object({
              artifact_uri: z.string().regex(/^artifact:\/\/audio\//),
              content_hash: sha256,
              recorded_at: isoDateTime,
              duration_seconds: z.number().positive().optional(),
            })
            .strict(),
        ),
        transcripts: z.array(
          z
            .object({
              artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
              asr_provenance: z
                .object({ provider: nonEmptyString, model_id: nonEmptyString })
                .strict(),
              revision: z.number().int().min(1).optional(),
            })
            .strict(),
        ),
        polished: z
          .array(
            z
              .object({
                artifact_uri: z.string().regex(/^artifact:\/\/transcript\//),
                polish_provenance: z
                  .object({
                    provider: nonEmptyString,
                    model_id: nonEmptyString,
                    prompt_version: nonEmptyString,
                  })
                  .strict(),
              })
              .strict(),
          )
          .optional(),
        manual_edit_notes: z.array(z.string()).optional(),
      })
      .strict(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/teaching-approach\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v1/approach-set（ADR-005 §5 跨小问组合层）
// --------------------------------------------------------------------------- //
const approachSetId = z.string().regex(/^AS-[A-Z0-9]+-[0-9]{3,}$/);

const approachRef = z
  .object({
    artifact_id: approachId,
    version: versionTag,
    content_hash: sha256,
  })
  .strict();

export const approachSetSchema = z
  .object({
    schema: z.literal("ai_teaching_approach_set/v1"),
    artifact_id: approachSetId,
    version: versionTag,
    status: statusEnum,
    question_ref: questionRef,
    parts: z
      .array(
        z
          .object({
            part_id: z.string().regex(/^[1-9][0-9]{0,2}$/).optional(),
            approach: approachRef,
            alternates: z.array(approachRef).default([]),
            note: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
    cross_part_rhythm: z.string().optional(),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/approach-set\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
  });

// --------------------------------------------------------------------------- //
// authoring/v1/topic-question-binding（Phase 5 UI 集成：Topic–Question 适配合同）
//
// Binding 是可审核、不可原地修改的内容对象：把原产品 Topic（taskId）+
// Scenario 绑定到一道 Question 的一套默认讲法（ApproachSet + TutorPlan）与
// 零到多个 alternate 讲法。只允许绑定 Approved、current、hash 匹配的
// Question、ApproachSet 和 TutorPlan（装载时校验，fail closed）。
// Approved Binding 取代 STATEFUL_TUTOR_POLICY_GOLDEN_PLANS 硬编码白名单。
// --------------------------------------------------------------------------- //
const approachSetRef = z
  .object({
    artifact_id: approachSetId,
    version: versionTag,
    content_hash: sha256,
  })
  .strict();

const planArtifactRef = z
  .object({
    artifact_id: planId,
    version: versionTag,
    content_hash: sha256,
  })
  .strict();

export const topicQuestionTeachingBindingSchema = z
  .object({
    schema: z.literal("ai_teaching_topic_question_binding/v1"),
    artifact_id: topicQuestionBindingId,
    version: versionTag,
    status: statusEnum,
    task_id: nonEmptyString,
    scenario_id: nonEmptyString,
    question_ref: questionRef,
    teaching_variants: z
      .array(
        z
          .object({
            approach_set_ref: approachSetRef,
            tutor_plan_ref: planArtifactRef,
            role: z.enum(["default", "alternate"]),
          })
          .strict(),
      )
      .min(1),
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/topic-question-binding\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
    if (value.teaching_variants.filter((v) => v.role === "default").length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactly one teaching_variants entry with role=default is required",
      });
    }
  });

// --------------------------------------------------------------------------- //
// planning/v1/tutor-policy-profile（Phase 5 UI 集成：Plan 级 Provider 路由）
//
// version-pinned 内容对象：plan v3 的 policy_profile_ref 指向本 artifact 的
// current Approved 版本（profile_version 与 ref.version 必须一致，hash 匹配）。
// API key/endpoint/凭据仍来自环境变量，不进本合同；本合同只决定业务路由。
// --------------------------------------------------------------------------- //
export const tutorPolicyProfileSchema = z
  .object({
    schema: z.literal("ai_teaching_tutor_policy_profile/v1"),
    artifact_id: policyProfileId,
    version: versionTag,
    status: statusEnum,
    profile_version: nonEmptyString,
    primary_provider: z.enum(["deepseek-langgraph", "deterministic-rules"]),
    fallback_provider: z.enum(["deepseek-langgraph", "deterministic-rules"]),
    model_id: nonEmptyString,
    prompt_version: nonEmptyString,
    approval: approval.optional(),
    superseded_by: supersededBy.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/tutor-policy-profile\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    }
    if (value.status === "Superseded" && !value.superseded_by) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
    }
    if (value.primary_provider === value.fallback_provider) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fallback_provider must differ from primary_provider",
      });
    }
  });

// --------------------------------------------------------------------------- //
// planning/v1/tutor-plan-bundle
// --------------------------------------------------------------------------- //
const actionKindEnum = z.enum([
  "make-parallel",
  "intersect-carriers",
  "mark-segment-values",
  "pair-segments",
  "ratio-scratch",
  "convert-collinear",
  "enter-equation",
  "select-option",
  "enter-text",
]);
const domainCommandEnum = z.enum([
  "construct-parallel",
  "construct-carrier",
  "intersect-lines",
  "set-segment-label",
  "set-correspondence-mark",
  "set-emphasis",
]);

export const tutorPlanBundleSchema = z
  .object({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v1"),
    artifact_id: planId,
    version: versionTag,
    status: statusEnum,
    question_ref: questionRef,
    approach_ref: z
      .object({
        artifact_id: approachId,
        version: versionTag,
        content_hash: sha256,
      })
      .strict(),
    compiler_version: nonEmptyString,
    input_hash: sha256,
    teach: z
      .object({
        fast_explanation: nonEmptyString,
        narration_segments: z.array(nonEmptyString).min(1),
        tutor_action_refs: z
          .array(
            z
              .object({
                action_kind: actionKindEnum,
                step_id: z.string().regex(/^S[0-9]{1,3}$/).optional(),
                domain_commands: z.array(domainCommandEnum).default([]),
              })
              .strict(),
          )
          .default([]),
        repair_guidance: z.array(nonEmptyString).default([]),
      })
      .strict(),
    guided_solve: z
      .object({
        opening_prompt: nonEmptyString,
        checkpoints: z
          .array(
            z
              .object({
                checkpoint_id: z.string().regex(/^CP[0-9]{1,3}$/),
                expected_reasoning: nonEmptyString,
                accepted_alternatives: z.array(nonEmptyString).default([]),
                common_deviations: z.array(nonEmptyString).default([]),
                skill_ids: z.array(skillId).min(1),
                hint_ladder: z
                  .array(
                    z
                      .object({
                        level: z.number().int().min(0).max(5),
                        hint: nonEmptyString,
                      })
                      .strict(),
                  )
                  .min(2)
                  .superRefine((ladder, ctx) => {
                    const levels = ladder.map((rung) => rung.level);
                    const ascending =
                      levels.every((level, index) => index === 0 || level > levels[index - 1]);
                    if (!ascending) {
                      ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: "hint_ladder levels must be unique and ascending",
                      });
                    }
                  }),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    diagnostic_probes: z
      .array(
        z
          .object({
            probe_id: z.string().regex(/^DP[0-9]{1,3}$/),
            target_skill_ids: z.array(skillId).min(1),
            prompt: nonEmptyString,
            expected_evidence: nonEmptyString,
          })
          .strict(),
      )
      .default([]),
    capability_validation: z
      .object({
        catalog_version: nonEmptyString,
        required_capabilities: z
          .array(z.string().regex(/^similarity\.[a-z-]+$/))
          .min(1),
        satisfied: z.literal(true),
      })
      .strict(),
    assessment_mode: z
      .object({
        enabled: z.boolean(),
        answer_leak_scan: z
          .object({
            status: z.enum(["passed", "not_applicable"]),
            scanned_fields: z.array(z.string()).default([]),
          })
          .strict(),
        tutor_tools: z.array(z.unknown()).max(0),
      })
      .strict()
      .optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/tutor-plan\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict();

// --------------------------------------------------------------------------- //
// planning/v2/tutor-plan-bundle（ADR-006 备课资源包）
// --------------------------------------------------------------------------- //
const partIdPattern = z.string().regex(/^[1-9][0-9]{0,2}$/);
const routeIdPattern = z.string().regex(/^R[0-9]{1,3}$/);
const resourceIdPattern = z.string().regex(/^RES[0-9]{1,3}$/);
const planApproval = z
  .object({
    reviewer_id: nonEmptyString,
    approved_at: isoDateTime,
    review_note: z.string().optional(),
  })
  .strict();

const planSkillAnnotation = z
  .object({
    skill_id: skillId,
    rationale: nonEmptyString,
    evidence_refs: z.array(nonEmptyString).min(1),
  })
  .strict();

export const tutorPlanBundleV2Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v2"),
    artifact_id: planId,
    version: versionTag,
    status: statusEnum,
    question_ref: questionRef,
    approach_refs: z
      .array(
        z
          .object({
            artifact_id: approachId,
            version: versionTag,
            content_hash: sha256,
            part_id: partIdPattern,
          })
          .strict(),
      )
      .min(1),
    recommended_routes: z
      .array(
        z
          .object({
            route_id: routeIdPattern,
            role: z.enum(["primary", "alternate"]),
            part_id: partIdPattern.optional(),
            entry_condition: z.string().optional(),
            checkpoint_ids: z.array(checkpointIdPattern).min(1),
            completion_condition: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
    checkpoints: z
      .array(
        z
          .object({
            checkpoint_id: checkpointIdPattern,
            part_id: partIdPattern,
            expected_reasoning: nonEmptyString,
            accepted_alternatives: z.array(nonEmptyString).optional(),
            common_deviations: z.array(nonEmptyString).optional(),
            skippable: z.boolean().optional(),
            skill_annotations: z.array(planSkillAnnotation).max(2).optional(),
            unmapped_skill_reason: z.string().optional(),
            resource_ids: z.array(resourceIdPattern).optional(),
          })
          .strict(),
      )
      .min(1),
    resources: z
      .array(
        z
          .object({
            resource_id: resourceIdPattern,
            kind: z.enum([
              "explanation",
              "hint",
              "diagnostic_probe",
              "repair",
              "action_template",
              "workspace",
              "voice_seed",
            ]),
            checkpoint_id: checkpointIdPattern.optional(),
            assistance_level: z.number().int().min(0).max(5).optional(),
            source: z.enum(["authored", "reused", "agent_generated"]),
            content: nonEmptyString.optional(),
            action_ref: nonEmptyString.optional(),
            capability: nonEmptyString.optional(),
            target_ids: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .min(1),
    policy_constraints: z
      .object({
        allowed_move_types: z
          .array(
            z.enum(["explain", "prompt", "hint", "confirm", "wait", "repair"]),
          )
          .min(1),
        allowed_capabilities: z.array(nonEmptyString),
        forbidden_content_kinds: z.array(
          z.enum([
            "canonical_answer",
            "reviewed_solution",
            "hidden_truth",
            "unapproved_tool",
          ]),
        ),
        maximum_assistance_level: z.number().int().min(0).max(5),
        // ADR-006：资源包永不用于 Assessment（隔离投影不在此合同内）。
        assessment_enabled: z.literal(false),
      })
      .strict(),
    build_provenance: z
      .object({
        provider: nonEmptyString,
        model_id: nonEmptyString,
        workflow_version: nonEmptyString,
        run_id: nonEmptyString,
        built_at: isoDateTime,
        runtime_registry_version: nonEmptyString,
      })
      .strict(),
    runtime_projection: z
      .object({
        materializer_version: nonEmptyString,
        runtime_registry_version: nonEmptyString,
        projection_hash: sha256,
        validation_status: z.literal("passed"),
      })
      .strict()
      .optional(),
    approval: planApproval.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/tutor-plan\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && (!value.approval || !value.runtime_projection)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status=Approved requires approval and runtime_projection",
      });
    }
  });

// --------------------------------------------------------------------------- //
// planning/v3/tutor-plan-bundle（Phase 5 UI 集成：Plan 只投影一个 ApproachSet）
//
// - 增加单一 approach_set_ref：一个 TutorPlan 只投影一道 Question 的一套
//   ApproachSet；同题不同讲法对应不同 Plan。
// - approach_refs 仅保留为 ApproachSet 的不可变传递依赖，必须与其小问选择
//   完全一致（装载时与 ApproachSet.parts 对账，fail closed）。
// - Plan ID 分配键改为 (question_ref, approach_set_ref)，允许同题多 Plan
//   （registry/build 层执行，schema 层不编码分配键）。
// - 增加 version-pinned policy_profile_ref：每个 Plan 通过 profile 选择
//   Tutor Provider；Session 启动时固定 profile snapshot。
// - v2 Plan 保留用于历史 replay；集成 UI 只开放重新审核发布的 v3 Plan。
// --------------------------------------------------------------------------- //
export const tutorPlanBundleV3Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v3"),
    artifact_id: planId,
    version: versionTag,
    status: statusEnum,
    question_ref: questionRef,
    approach_set_ref: approachSetRef,
    approach_refs: z
      .array(
        z
          .object({
            artifact_id: approachId,
            version: versionTag,
            content_hash: sha256,
            part_id: partIdPattern,
          })
          .strict(),
      )
      .min(1),
    policy_profile_ref: z
      .object({
        profile_id: policyProfileId,
        version: nonEmptyString,
        content_hash: sha256,
      })
      .strict(),
    recommended_routes: z
      .array(
        z
          .object({
            route_id: routeIdPattern,
            role: z.enum(["primary", "alternate"]),
            part_id: partIdPattern.optional(),
            entry_condition: z.string().optional(),
            checkpoint_ids: z.array(checkpointIdPattern).min(1),
            completion_condition: nonEmptyString,
          })
          .strict(),
      )
      .min(1),
    checkpoints: z
      .array(
        z
          .object({
            checkpoint_id: checkpointIdPattern,
            part_id: partIdPattern,
            expected_reasoning: nonEmptyString,
            accepted_alternatives: z.array(nonEmptyString).optional(),
            common_deviations: z.array(nonEmptyString).optional(),
            skippable: z.boolean().optional(),
            skill_annotations: z.array(planSkillAnnotation).max(2).optional(),
            unmapped_skill_reason: z.string().optional(),
            resource_ids: z.array(resourceIdPattern).optional(),
          })
          .strict(),
      )
      .min(1),
    resources: z
      .array(
        z
          .object({
            resource_id: resourceIdPattern,
            kind: z.enum([
              "explanation",
              "hint",
              "diagnostic_probe",
              "repair",
              "action_template",
              "workspace",
              "voice_seed",
            ]),
            checkpoint_id: checkpointIdPattern.optional(),
            assistance_level: z.number().int().min(0).max(5).optional(),
            source: z.enum(["authored", "reused", "agent_generated"]),
            content: nonEmptyString.optional(),
            action_ref: nonEmptyString.optional(),
            capability: nonEmptyString.optional(),
            target_ids: z.array(nonEmptyString).optional(),
          })
          .strict(),
      )
      .min(1),
    policy_constraints: z
      .object({
        allowed_move_types: z
          .array(
            z.enum(["explain", "prompt", "hint", "confirm", "wait", "repair"]),
          )
          .min(1),
        allowed_capabilities: z.array(nonEmptyString),
        forbidden_content_kinds: z.array(
          z.enum([
            "canonical_answer",
            "reviewed_solution",
            "hidden_truth",
            "unapproved_tool",
          ]),
        ),
        maximum_assistance_level: z.number().int().min(0).max(5),
        // ADR-006：资源包永不用于 Assessment（隔离投影不在此合同内）。
        assessment_enabled: z.literal(false),
      })
      .strict(),
    build_provenance: z
      .object({
        provider: nonEmptyString,
        model_id: nonEmptyString,
        workflow_version: nonEmptyString,
        run_id: nonEmptyString,
        built_at: isoDateTime,
        runtime_registry_version: nonEmptyString,
      })
      .strict(),
    runtime_projection: z
      .object({
        materializer_version: nonEmptyString,
        runtime_registry_version: nonEmptyString,
        projection_hash: sha256,
        validation_status: z.literal("passed"),
      })
      .strict()
      .optional(),
    approval: planApproval.optional(),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/tutor-plan\/[A-Za-z0-9-]+@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && (!value.approval || !value.runtime_projection)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status=Approved requires approval and runtime_projection",
      });
    }
  });

// --------------------------------------------------------------------------- //
// runtime/v1/tutor-session-event
// --------------------------------------------------------------------------- //
const sessionModeEnum = z.enum(["teach", "guided_solve", "repair"]);
const hintLevel = z.number().int().min(0).max(5);

const eventPayloadSchemas = {
  session_started: z
    .object({
      plan: z
        .object({
          artifact_id: planId,
          version: versionTag,
          content_hash: sha256,
        })
        .strict(),
    })
    .strict(),
  mode_changed: z
    .object({ from_mode: sessionModeEnum, to_mode: sessionModeEnum })
    .strict(),
  tutor_narrated: z.object({ segment_id: nonEmptyString }).strict(),
  student_utterance_recorded: z
    .object({
      input_kind: z.enum([
        "reasoning_utterance",
        "question_asked",
        "pointing_evidence",
        "structured_action_evidence",
      ]),
      text: z.string().optional(),
      object_id: z.string().optional(),
      action_id: z.string().optional(),
      action_payload: z.string().optional(),
    })
    .strict(),
  reasoning_aligned: z
    .object({
      alignment: z.enum([
        "expected_checkpoint",
        "alternate_valid_path",
        "incorrect_reasoning",
        "unclear",
      ]),
      checkpoint_id: checkpointIdPattern.optional(),
      alternate_description: z.string().optional(),
    })
    .strict(),
  hint_issued: z
    .object({ checkpoint_id: checkpointIdPattern, level: hintLevel })
    .strict(),
  student_progressed: z
    .object({ checkpoint_id: checkpointIdPattern, after_level: hintLevel })
    .strict(),
  student_self_corrected: z
    .object({ checkpoint_id: checkpointIdPattern, before_hint: z.boolean() })
    .strict(),
  tutor_tool_executed: z
    .object({
      command_id: nonEmptyString,
      capability: nonEmptyString,
      target_ids: z.array(nonEmptyString),
      command_payload: z.string().optional(),
      outcome: z.enum(["executed", "rejected"]),
      rejection_reason: z.string().optional(),
    })
    .strict(),
  repair_delivered: z
    .object({ checkpoint_id: checkpointIdPattern })
    .strict(),
  runtime_failure: z
    .object({
      failure_class: nonEmptyString,
      message: z.string().optional(),
      related_event_sequence: z.number().int().min(1).optional(),
    })
    .strict(),
  session_completed: z
    .object({ final_mode: sessionModeEnum.optional() })
    .strict(),
} as const;

export type TutorSessionEventType = keyof typeof eventPayloadSchemas;
export const tutorSessionEventTypeEnum = z.enum(
  Object.keys(eventPayloadSchemas) as [TutorSessionEventType, ...TutorSessionEventType[]],
);

export const tutorSessionEventSchema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v1"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    occurred_at: isoDateTime,
    event_type: tutorSessionEventTypeEnum,
    payload: z.record(z.unknown()),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadSchema = eventPayloadSchemas[value.event_type];
    const result = payloadSchema.safeParse(value.payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["payload", ...issue.path],
          message: issue.message,
        });
      }
    }
  });

// --------------------------------------------------------------------------- //
// runtime/v2/tutor-session-event（ADR-006 因果链）
// --------------------------------------------------------------------------- //
const decisionIdPattern = z.string().regex(/^TD-[A-Za-z0-9._:-]{4,}$/);
const voiceActionIdPattern = z.string().regex(/^VA-[A-Za-z0-9._:-]{4,}$/);
const workspaceActionIdPattern = z.string().regex(/^WA-[A-Za-z0-9._:-]{4,}$/);
const purposeCodePattern = z.string().regex(/^[a-z][a-z0-9._-]*$/);
const moveTypeEnum = z.enum(["explain", "prompt", "hint", "confirm", "wait", "repair"]);

const v2EventPayloadSchemas = {
  session_started: z
    .object({
      plan: z
        .object({ artifact_id: planId, version: versionTag, content_hash: sha256 })
        .strict(),
      initial_mode: sessionModeEnum,
    })
    .strict(),
  mode_changed: z
    .object({ from_mode: sessionModeEnum, to_mode: sessionModeEnum })
    .strict(),
  student_input_recorded: z
    .object({
      input_kind: z.enum([
        "reasoning_utterance",
        "question_asked",
        "pointing_evidence",
        "structured_action_evidence",
        "silence_observed",
        "student_interrupted",
      ]),
      text: z.string().optional(),
      object_id: z.string().optional(),
      action_id: z.string().optional(),
      action_payload: z.string().optional(),
      duration_ms: z.number().int().min(0).optional(),
    })
    .strict(),
  reasoning_aligned: z
    .object({
      alignment: z.enum([
        "expected_checkpoint",
        "alternate_valid",
        "incorrect",
        "unclear",
        "no_progress",
      ]),
      checkpoint_id: checkpointIdPattern.optional(),
      alternate_description: z.string().optional(),
    })
    .strict(),
  tutor_move_decided: z
    .object({
      decision_id: decisionIdPattern,
      move_type: moveTypeEnum,
      purpose_code: purposeCodePattern,
      policy_version: nonEmptyString,
      source_event_sequence: z.number().int().min(1),
      source_state_revision: z.number().int().min(0),
      checkpoint_id: checkpointIdPattern.optional(),
      assistance_level: hintLevel.optional(),
      resource_ids: z.array(resourceIdPattern).optional(),
      fallback: z.boolean().optional(),
    })
    .strict()
    .superRefine((payload, ctx) => {
      if (payload.move_type === "hint" && (payload.assistance_level === undefined || payload.checkpoint_id === undefined)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "move_type=hint requires assistance_level and checkpoint_id",
        });
      }
    }),
  voice_action_issued: z
    .object({
      action_id: voiceActionIdPattern,
      decision_id: decisionIdPattern,
      text: nonEmptyString,
      interruptible: z.boolean().optional(),
    })
    .strict(),
  voice_action_completed: z
    .object({
      action_id: nonEmptyString,
      outcome: z.enum(["completed", "interrupted", "rejected", "failed"]),
      failure_class: z.string().optional(),
      message: z.string().optional(),
    })
    .strict(),
  workspace_action_issued: z
    .object({
      action_id: workspaceActionIdPattern,
      decision_id: decisionIdPattern,
      capability: nonEmptyString,
      target_ids: z.array(nonEmptyString),
      command_payload: z.string().optional(),
    })
    .strict(),
  workspace_action_completed: z
    .object({
      action_id: nonEmptyString,
      outcome: z.enum(["completed", "interrupted", "rejected", "failed"]),
      failure_class: z.string().optional(),
      message: z.string().optional(),
    })
    .strict(),
  hint_issued: z
    .object({
      decision_id: decisionIdPattern,
      checkpoint_id: checkpointIdPattern,
      level: hintLevel,
    })
    .strict(),
  working_diagnosis_updated: z
    .object({
      summary_code: purposeCodePattern,
      candidate_skill_ids: z.array(skillId).max(3).optional(),
      evidence_sequences: z.array(z.number().int().min(1)).min(1),
    })
    .strict(),
  policy_failed: z
    .object({
      policy_version: nonEmptyString,
      failure_class: nonEmptyString,
      fallback_used: z.boolean(),
      fallback_resource_id: resourceIdPattern.optional(),
    })
    .strict(),
  runtime_failure: z
    .object({
      failure_class: nonEmptyString,
      message: z.string(),
      related_event_sequence: z.number().int().min(1).optional(),
    })
    .strict(),
} as const;

/** 无 payload 条件、但要求 causation_sequence 的事件类型。 */
const V2_FREE_PAYLOAD_EVENTS: ReadonlySet<string> = new Set([
  "student_progressed",
  "student_self_corrected",
  "repair_delivered",
  "session_completed",
]);

/** JSON Schema allOf 中显式 required: ["causation_sequence"] 的事件类型。 */
const V2_CAUSATION_REQUIRED: ReadonlySet<string> = new Set([
  "mode_changed",
  "reasoning_aligned",
  "tutor_move_decided",
  "voice_action_issued",
  "workspace_action_issued",
  "voice_action_completed",
  "workspace_action_completed",
  "hint_issued",
  "working_diagnosis_updated",
  "policy_failed",
]);

export type TutorSessionEventV2Type =
  | keyof typeof v2EventPayloadSchemas
  | "student_progressed"
  | "student_self_corrected"
  | "repair_delivered"
  | "session_completed";

export const tutorSessionEventV2Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v2"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "mode_changed",
      "student_input_recorded",
      "reasoning_aligned",
      "tutor_move_decided",
      "voice_action_issued",
      "voice_action_completed",
      "workspace_action_issued",
      "workspace_action_completed",
      "hint_issued",
      "student_progressed",
      "student_self_corrected",
      "working_diagnosis_updated",
      "repair_delivered",
      "policy_failed",
      "runtime_failure",
      "session_completed",
    ]),
    payload: z.record(z.unknown()),
    causation_sequence: z.number().int().min(1).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadSchema =
      v2EventPayloadSchemas[value.event_type as keyof typeof v2EventPayloadSchemas];
    if (payloadSchema) {
      const result = payloadSchema.safeParse(value.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payload", ...issue.path],
            message: issue.message,
          });
        }
      }
    } else if (!V2_FREE_PAYLOAD_EVENTS.has(value.event_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown event_type: ${value.event_type}`,
      });
    }
    if (V2_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

// --------------------------------------------------------------------------- //
// runtime/v3/tutor-session-event（Phase 5 remediation 智能链 provenance）
//
// 只增量：payload 在 v2 基础上追加可选字段（client_turn_id / route_id /
// confidence / aligner/workflow version / grounding_refs / model /
// prompt_versions / voice_source / workspace_resource_ids / resource_ref /
// generation_id）；不保存 chain-of-thought（strict 拒绝额外字段）。
// --------------------------------------------------------------------------- //
const eventRouteIdPattern = z.string().regex(/^R[0-9]{1,3}$/);
const generationIdPattern = z.string().regex(/^VG-[A-Za-z0-9._:-]{4,}$/);
const clientTurnIdPattern = z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/);
const groundingRefPattern = z.string().regex(/^[A-Za-z0-9_.\[\]-]{3,64}$/);
const voiceSourceEnum = z.enum([
  "approved-resource",
  "model-generated",
  "deterministic-scaffold",
]);

const v3StudentInputRecordedPayload = v2EventPayloadSchemas.student_input_recorded
  .extend({ client_turn_id: clientTurnIdPattern.optional() })
  .strict();

const v3ReasoningAlignedPayload = v2EventPayloadSchemas.reasoning_aligned
  .extend({
    route_id: eventRouteIdPattern.optional(),
    confidence: z.number().min(0).max(1).optional(),
    aligner_version: nonEmptyString.optional(),
    workflow_version: nonEmptyString.optional(),
    grounding_refs: z.array(groundingRefPattern).max(8).optional(),
  })
  .strict();

const v3TutorMoveDecidedPayload = z
  .object({
    decision_id: decisionIdPattern,
    move_type: moveTypeEnum,
    purpose_code: purposeCodePattern,
    policy_version: nonEmptyString,
    source_event_sequence: z.number().int().min(1),
    source_state_revision: z.number().int().min(0),
    checkpoint_id: checkpointIdPattern.optional(),
    assistance_level: hintLevel.optional(),
    resource_ids: z.array(resourceIdPattern).optional(),
    fallback: z.boolean().optional(),
    model: nonEmptyString.optional(),
    workflow_version: nonEmptyString.optional(),
    prompt_versions: z.array(nonEmptyString).max(8).optional(),
    voice_source: voiceSourceEnum.optional(),
    workspace_resource_ids: z.array(resourceIdPattern).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.move_type === "hint" && (payload.assistance_level === undefined || payload.checkpoint_id === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "move_type=hint requires assistance_level and checkpoint_id",
      });
    }
  });

const v3VoiceActionIssuedPayload = v2EventPayloadSchemas.voice_action_issued
  .extend({
    resource_ref: resourceIdPattern.optional(),
    generation_id: generationIdPattern.optional(),
    voice_source: voiceSourceEnum.optional(),
  })
  .strict();

const V3_PAYLOAD_OVERRIDES: Partial<
  Record<keyof typeof v2EventPayloadSchemas, z.ZodTypeAny>
> = {
  student_input_recorded: v3StudentInputRecordedPayload,
  reasoning_aligned: v3ReasoningAlignedPayload,
  tutor_move_decided: v3TutorMoveDecidedPayload,
  voice_action_issued: v3VoiceActionIssuedPayload,
};

const v3EventPayloadSchemas = {
  ...v2EventPayloadSchemas,
  ...V3_PAYLOAD_OVERRIDES,
} as const;

export const tutorSessionEventV3Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v3"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "mode_changed",
      "student_input_recorded",
      "reasoning_aligned",
      "tutor_move_decided",
      "voice_action_issued",
      "voice_action_completed",
      "workspace_action_issued",
      "workspace_action_completed",
      "hint_issued",
      "student_progressed",
      "student_self_corrected",
      "working_diagnosis_updated",
      "repair_delivered",
      "policy_failed",
      "runtime_failure",
      "session_completed",
    ]),
    payload: z.record(z.unknown()),
    causation_sequence: z.number().int().min(1).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadSchema =
      v3EventPayloadSchemas[value.event_type as keyof typeof v3EventPayloadSchemas];
    if (payloadSchema) {
      const result = payloadSchema.safeParse(value.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payload", ...issue.path],
            message: issue.message,
          });
        }
      }
    } else if (!V2_FREE_PAYLOAD_EVENTS.has(value.event_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown event_type: ${value.event_type}`,
      });
    }
    if (V2_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

// --------------------------------------------------------------------------- //
// runtime/v4/tutor-session-event（Phase 5 UI 集成：Topic/Question/讲法 provenance）
//
// 只增量：session_started 固定记录 task_id / scenario_id / question_ref /
// approach_set_ref / tutor_plan_ref / policy_profile_snapshot，可选
// previous_session_id 与 switch_reason（同题换讲法关联）。其余事件 payload
// 与 v3 完全一致（v3 智能链 provenance 字段全部保留）。
// plan 字段保留为 v1–v3 reader 兼容（与 tutor_plan_ref 同值）；v1–v3 历史
// 事件不改写。
// --------------------------------------------------------------------------- //
const v4PolicyProfileSnapshot = z
  .object({
    profile_id: policyProfileId,
    version: nonEmptyString,
    primary_provider: nonEmptyString,
    fallback_provider: nonEmptyString,
    model_id: nonEmptyString,
    prompt_version: nonEmptyString,
  })
  .strict();

const v4SessionStartedPayload = z
  .object({
    plan: planArtifactRef,
    initial_mode: sessionModeEnum,
    task_id: nonEmptyString,
    scenario_id: nonEmptyString,
    question_ref: questionRef,
    approach_set_ref: approachSetRef,
    tutor_plan_ref: planArtifactRef,
    policy_profile_snapshot: v4PolicyProfileSnapshot,
    previous_session_id: sessionId.optional(),
    switch_reason: z.enum(["alternate_approach"]).optional(),
  })
  .strict();

const v4EventPayloadSchemas = {
  ...v3EventPayloadSchemas,
  session_started: v4SessionStartedPayload,
} as const;

export const tutorSessionEventV4Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v4"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "mode_changed",
      "student_input_recorded",
      "reasoning_aligned",
      "tutor_move_decided",
      "voice_action_issued",
      "voice_action_completed",
      "workspace_action_issued",
      "workspace_action_completed",
      "hint_issued",
      "student_progressed",
      "student_self_corrected",
      "working_diagnosis_updated",
      "repair_delivered",
      "policy_failed",
      "runtime_failure",
      "session_completed",
    ]),
    payload: z.record(z.unknown()),
    causation_sequence: z.number().int().min(1).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadSchema =
      v4EventPayloadSchemas[value.event_type as keyof typeof v4EventPayloadSchemas];
    if (payloadSchema) {
      const result = payloadSchema.safeParse(value.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payload", ...issue.path],
            message: issue.message,
          });
        }
      }
    } else if (!V2_FREE_PAYLOAD_EVENTS.has(value.event_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown event_type: ${value.event_type}`,
      });
    }
    if (V2_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

// --------------------------------------------------------------------------- //
// learning/v1/skill-hypothesis
// --------------------------------------------------------------------------- //
const eventEvidenceRef = z
  .object({ session_id: sessionId, sequence: z.number().int().min(1) })
  .strict();

export const skillHypothesisSchema = z
  .object({
    schema: z.literal("ai_teaching_skill_hypothesis/v1"),
    hypothesis_id: hypothesisId,
    student_id: nonEmptyString,
    session_id: sessionId,
    skill_id: skillId,
    direction: z.enum(["supports_strength", "supports_weakness", "ambiguous"]),
    confidence: z.number().min(0).max(1),
    supporting_evidence: z.array(eventEvidenceRef).default([]),
    contradictory_evidence: z.array(eventEvidenceRef).default([]),
    inference_version: nonEmptyString,
    supersedes: hypothesisId.optional(),
    created_at: isoDateTime,
  })
  .strict();

// --------------------------------------------------------------------------- //
// learning/v1/intervention
// --------------------------------------------------------------------------- //
export const interventionSchema = z
  .object({
    schema: z.literal("ai_teaching_intervention/v1"),
    intervention_id: interventionId,
    student_id: nonEmptyString,
    source_session_id: sessionId.optional(),
    source_hypothesis_ids: z.array(hypothesisId).min(1),
    decision: z
      .object({
        kind: z.enum([
          "continue_lesson",
          "confirmation_probe",
          "single_diagnostic_question",
          "repair_explanation",
          "near_transfer_practice",
          "far_transfer_practice",
          "review_later",
        ]),
        target_skill_ids: z.array(skillId).min(1),
        question_id: questionId.optional(),
        probe_id: z.string().regex(/^DP[0-9]{1,3}$/).optional(),
        review_after_minutes: z.number().int().min(1).optional(),
      })
      .strict()
      .superRefine((decision, ctx) => {
        const needsQuestion =
          decision.kind === "near_transfer_practice" ||
          decision.kind === "far_transfer_practice" ||
          decision.kind === "single_diagnostic_question";
        if (needsQuestion && !decision.question_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `decision.kind=${decision.kind} requires question_id`,
          });
        }
      }),
    why: nonEmptyString,
    expected_evidence: nonEmptyString,
    stop_condition: nonEmptyString,
    max_dose: z.number().int().min(1).max(1).optional(),
    status: z.enum(["planned", "executed", "completed", "aborted"]),
    outcome: z
      .object({
        event_refs: z.array(eventEvidenceRef).min(1),
        observed_at: isoDateTime,
        summary: nonEmptyString,
      })
      .strict()
      .optional(),
    created_at: isoDateTime,
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.status === "completed" || value.status === "aborted") && !value.outcome) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `status=${value.status} requires outcome`,
      });
    }
  });

// --------------------------------------------------------------------------- //
// evaluation/v1/sut-config
// --------------------------------------------------------------------------- //
const sutComponent = z
  .object({
    provider: nonEmptyString,
    model: nonEmptyString.optional(),
    harness: z.string().optional(),
    engine: z.string().optional(),
    params: z.record(z.unknown()).optional(),
    status: z.enum(["active", "not_executed"]).optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((component, ctx) => {
    if (!component.model && !component.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "component requires model or note",
      });
    }
  });

export const sutConfigSchema = z
  .object({
    schema: z.literal("ai_teaching_sut_config/v1"),
    sut_id: z.string().regex(/^sut-[a-z0-9-]+$/),
    label: nonEmptyString,
    components: z
      .record(
        z.enum(["intake_ocr", "asr", "polish", "tutor_coach", "realtime_voice", "tts"]),
        sutComponent,
      )
      .refine((components) => Object.keys(components).length >= 1, {
        message: "at least one component required",
      }),
    code_baseline: z
      .object({
        repos: z.record(
          z.string(),
          z
            .object({
              commit: z.string().min(7),
              diff_sha256: sha256.optional(),
              dirty: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict()
      .superRefine((baseline, ctx) => {
        if (Object.keys(baseline.repos).length < 1) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "repos must not be empty" });
        }
      }),
    prompt_workflow_versions: z.record(z.unknown()).optional(),
    environment: z
      .object({
        runtime: nonEmptyString,
        os: z.string().optional(),
        notes: z.string().optional(),
      }),
    price_table_version: nonEmptyString,
    registered_at: isoDateTime,
  })
  .strict();

// --------------------------------------------------------------------------- //
// evaluation/v1/benchmark-run
// --------------------------------------------------------------------------- //
export const benchmarkRunSchema = z
  .object({
    schema: z.literal("ai_teaching_benchmark_run/v1"),
    run_id: runId,
    dataset_id: nonEmptyString,
    dataset_version: versionTag,
    sut: z
      .object({
        sut_id: z.string().regex(/^sut-[a-z0-9-]+$/),
        config_hash: sha256,
        config_artifact_uri: z
          .string()
          .regex(/^artifact:\/\/sut-config\/[a-z0-9-]+@v[0-9]+$/),
      })
      .strict(),
    status: z.enum(["running", "completed", "failed", "aborted"]),
    case_results: z
      .array(
        z
          .object({
            case_id: caseId,
            stage: z.enum(["intake", "truth", "approach", "plan", "realtime"]),
            status: z.enum(["pass", "fail", "error", "not_executed"]),
            failure_class: nonEmptyString.optional(),
            metrics: z
              .object({
                latency_ms_p50: z.number().min(0).optional(),
                latency_ms_p95: z.number().min(0).optional(),
                quality_score: z.number().min(0).max(1).optional(),
                detail: z.string().optional(),
              })
              .strict()
              .optional(),
            cost: z
              .object({
                input_tokens: z.number().int().min(0).optional(),
                output_tokens: z.number().int().min(0).optional(),
                price_table_version: z.string().optional(),
                estimated_cost: z.number().min(0).optional(),
              })
              .strict()
              .optional(),
            raw_output_ref: z
              .string()
              .regex(/^artifact:\/\/benchmark-output\//)
              .optional(),
          })
          .strict()
          .superRefine((result, ctx) => {
            if (result.status === "fail" && !result.failure_class) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "case status=fail requires failure_class",
              });
            }
          }),
      )
      .min(1),
    summary: z
      .object({
        passed: z.number().int().min(0),
        failed: z.number().int().min(0),
        errored: z.number().int().min(0),
        not_executed: z.number().int().min(0),
      })
      .strict()
      .optional(),
    cost_total: z
      .object({
        price_table_version: nonEmptyString,
        input_tokens: z.number().int().min(0).optional(),
        output_tokens: z.number().int().min(0).optional(),
        estimated_cost: z.number().min(0).optional(),
      })
      .strict()
      .optional(),
    runner_version: nonEmptyString,
    environment: nonEmptyString,
    started_at: isoDateTime,
    completed_at: isoDateTime.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "completed" && (!value.summary || !value.completed_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "status=completed requires summary and completed_at",
      });
    }
  });

// --------------------------------------------------------------------------- //
// F1（2026-08-27）：core/v1 + planning/v4 + runtime/v5 + state/v1 + view/v1
// 逐字段对应 PRDS contracts/schemas 新 major；跨字段规则与 Python 镜像一致。
// --------------------------------------------------------------------------- //
const solutionGraphId = z.string().regex(/^RG-[A-Z0-9]+-[0-9]{3,}$/);
const teachingProtocolId = z.string().regex(/^PR-[A-Z0-9]+-[0-9]{3,}$/);
const beatIdPattern = z.string().regex(/^BT-[0-9]{1,3}$/);
const gateIdPattern = z.string().regex(/^GT-[0-9]{1,3}$/);
const graphFactIdPattern = z.string().regex(/^FN-[0-9]{1,3}$/);
const graphInferenceIdPattern = z.string().regex(/^IF-[0-9]{1,3}$/);
const solutionVariantIdPattern = z.string().regex(/^SV-[0-9]{1,3}$/);
const solutionEvidenceRefPattern = z
  .string()
  // F4（2026-08-28）镜像漂移修复：canonical schema 的 artifact:// 分支是双斜杠，
  // 初版镜像误写单斜杠导致 canonical 合法的 artifact:// 溯源被拒（新 fixture
  // reviewed-solution-graph.positive.artifact-evidence.json 钉死该分支）。
  .regex(/^(SE-[A-Z0-9]+-[0-9]{3,}|artifact:\/\/[a-z][a-z0-9-]*\/[A-Za-z0-9._~!$&'()*+,;=:%@\/-]+)$/);
const reviewedSolutionStepPattern = z.string().regex(/^step-[0-9]{1,3}$/);
const surfaceActionIdPattern = z.string().regex(/^WSA-[A-Za-z0-9._:-]{4,}$/);
const studentCommandIdPattern = z.string().regex(/^SC-[A-Za-z0-9._:-]{4,}$/);
const supportEvidenceIdPattern = z.string().regex(/^ESE-[A-Za-z0-9._:-]{4,}$/);
const inquiryIdPattern = z.string().regex(/^IQ-[A-Za-z0-9._:-]{4,}$/);
const presentationPlanIdPattern = z.string().regex(/^PPT-[A-Za-z0-9._:-]{4,}$/);
const clientRequestIdPattern = z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/);

const approvalBlock = z
  .object({
    reviewer_id: nonEmptyString,
    approved_at: isoDateTime,
    review_note: z.string().optional(),
  })
  .strict();

const questionArtifactRef = z
  .object({ artifact_id: questionId, version: versionTag, content_hash: sha256 })
  .strict();
const solutionGraphArtifactRef = z
  .object({ artifact_id: solutionGraphId, version: versionTag, content_hash: sha256 })
  .strict();
const protocolArtifactRef = z
  .object({ artifact_id: teachingProtocolId, version: versionTag, content_hash: sha256 })
  .strict();
const planArtifactRefV4 = z
  .object({ artifact_id: planId, version: versionTag, content_hash: sha256 })
  .strict();

// core/v1/artifact-ref
export const artifactRefV1Schema = z
  .object({
    schema: z.literal("ai_teaching_artifact_ref/v1"),
    artifact_id: z.string().regex(/^[A-Z]{2,4}-[A-Z0-9]+-[0-9]{3,}$/),
    version: versionTag,
    content_hash: sha256,
    artifact_uri: artifactUriPattern.optional(),
  })
  .strict();

// planning/v4/reviewed-solution-graph（FR-7 二部 AND/OR DAG）
const graphFactNode = z
  .object({
    fact_id: graphFactIdPattern,
    role: z.enum(["given", "goal", "derived", "intermediate_value"]),
    statement: nonEmptyString,
    part_id: partIdPattern.optional(),
    reveals_answer: z.boolean(),
    evidence_refs: z.array(solutionEvidenceRefPattern).optional(),
    reviewed_solution_step: reviewedSolutionStepPattern.optional(),
    skill_refs: z.array(skillId).max(3).optional(),
  })
  .strict();

const graphInferenceNode = z
  .object({
    inference_id: graphInferenceIdPattern,
    premises: z.array(graphFactIdPattern).min(1),
    conclusion: graphFactIdPattern,
    derivation: nonEmptyString,
    evidence_refs: z.array(solutionEvidenceRefPattern).optional(),
    reviewed_solution_step: reviewedSolutionStepPattern.optional(),
  })
  .strict();

const solutionVariantNode = z
  .object({
    variant_id: solutionVariantIdPattern,
    name: nonEmptyString.optional(),
    goal_fact_id: graphFactIdPattern,
    inference_ids: z.array(graphInferenceIdPattern).min(1),
  })
  .strict();

export const reviewedSolutionGraphV1Schema = z
  .object({
    schema: z.literal("ai_teaching_reviewed_solution_graph/v1"),
    graph_id: solutionGraphId,
    version: versionTag,
    status: statusEnum,
    approval: approvalBlock.optional(),
    question_ref: questionArtifactRef,
    approach_ref: z
      .object({ artifact_id: approachId, version: versionTag, content_hash: sha256 })
      .strict()
      .optional(),
    facts: z.array(graphFactNode).min(1),
    inferences: z.array(graphInferenceNode).min(1),
    solution_variants: z.array(solutionVariantNode).min(1),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/reviewed-solution-graph\/RG-[A-Z0-9]+-[0-9]{3,}@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const factIds = new Set(value.facts.map((f) => f.fact_id));
    const inferenceIds = new Set(value.inferences.map((i) => i.inference_id));
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });

    if (factIds.size !== value.facts.length) add("fact_id must be unique");
    if (inferenceIds.size !== value.inferences.length) add("inference_id must be unique");

    // premise/conclusion 引用存在 + conclusion 不在 premises + 参与度 + 事实图邻接
    const premiseUse = new Set<string>();
    const concludedFacts = new Set<string>();
    const adj = new Map<string, string[]>();
    for (const fact of value.facts) adj.set(fact.fact_id, []);
    for (const inf of value.inferences) {
      for (const premise of inf.premises) {
        if (!factIds.has(premise)) add(`inference ${inf.inference_id} references unknown premise ${premise}`);
        premiseUse.add(premise);
      }
      if (!factIds.has(inf.conclusion)) {
        add(`inference ${inf.inference_id} references unknown conclusion ${inf.conclusion}`);
      }
      if (inf.premises.includes(inf.conclusion)) {
        add(`inference ${inf.inference_id} concludes its own premise`);
      }
      concludedFacts.add(inf.conclusion);
      for (const premise of inf.premises) adj.get(premise)?.push(inf.conclusion);
    }
    // 无环：premise -> conclusion 事实图 DFS（三色标记）
    const color = new Map<string, 0 | 1 | 2>();
    const hasCycle = (node: string): boolean => {
      const state = color.get(node) ?? 0;
      if (state === 1) return true;
      if (state === 2) return false;
      color.set(node, 1);
      for (const next of adj.get(node) ?? []) {
        if (hasCycle(next)) return true;
      }
      color.set(node, 2);
      return false;
    };
    for (const fact of value.facts) {
      if (hasCycle(fact.fact_id)) {
        add("fact graph must be acyclic (premise→conclusion)");
        break;
      }
    }
    // 可推导性（AND 语义：全部 premises 可推导才可推导），迭代至不动点
    const derivations = new Set(value.facts.filter((f) => f.role === "given").map((f) => f.fact_id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const inf of value.inferences) {
        if (derivations.has(inf.conclusion)) continue;
        if (inf.premises.every((p) => derivations.has(p))) {
          derivations.add(inf.conclusion);
          grew = true;
        }
      }
    }
    // 悬空节点与角色规则 + 可追溯性
    for (const fact of value.facts) {
      if (fact.role === "given" && !premiseUse.has(fact.fact_id)) {
        add(`given fact ${fact.fact_id} is never used as a premise (dangling)`);
      }
      if (
        (fact.role === "goal" || fact.role === "derived" || fact.role === "intermediate_value") &&
        !concludedFacts.has(fact.fact_id)
      ) {
        add(`fact ${fact.fact_id} with role=${fact.role} is never concluded (dangling)`);
      }
      if (fact.role === "goal" && !derivations.has(fact.fact_id)) {
        add(`goal fact ${fact.fact_id} is not derivable from given facts`);
      }
      if (!fact.evidence_refs?.length && !fact.reviewed_solution_step) {
        add(`fact ${fact.fact_id} must be traceable (evidence_refs or reviewed_solution_step)`);
      }
    }
    for (const inf of value.inferences) {
      if (!inf.evidence_refs?.length && !inf.reviewed_solution_step) {
        add(`inference ${inf.inference_id} must be traceable (evidence_refs or reviewed_solution_step)`);
      }
    }
    // solution variant 校验
    const goalFacts = new Set(value.facts.filter((f) => f.role === "goal").map((f) => f.fact_id));
    for (const variant of value.solution_variants) {
      if (!goalFacts.has(variant.goal_fact_id)) {
        add(`variant ${variant.variant_id} goal_fact_id must reference a goal fact`);
      }
      for (const infId of variant.inference_ids) {
        if (!inferenceIds.has(infId)) {
          add(`variant ${variant.variant_id} references unknown inference ${infId}`);
        }
      }
    }
    if (value.status === "Approved" && !value.approval) {
      add("Approved requires approval block");
    }
  });

// planning/v4/teaching-protocol
const beatTransitionSchema = z
  .object({
    to_beat: beatIdPattern,
    on: z.enum(["gate_satisfied", "evidence_collected", "student_request", "timeout", "tutor_discretion"]),
  })
  .strict();

const beatSchema = z
  .object({
    beat_id: beatIdPattern,
    part_id: partIdPattern.optional(),
    purpose: nonEmptyString,
    graph_fact_refs: z.array(graphFactIdPattern).min(1),
    cognitive_activity: z.enum(["attend", "recall", "relate", "apply", "verify", "explain"]),
    completion_evidence: z
      .object({
        evidence_kind: z.enum([
          "student_answer",
          "workspace_command",
          "student_confirmation",
          "narration_completed",
          "explicit_gate_pass",
          "tutor_observed",
        ]),
        gate: z
          .object({
            gate_id: gateIdPattern,
            requirement: nonEmptyString,
            graph_fact_id: graphFactIdPattern.optional(),
            capability: nonEmptyString.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    participation: z.enum(["listen", "answer", "operate", "confirm", "continue"]),
    pacing: z
      .object({
        wait_policy: z.enum(["student_driven", "bounded_wait"]),
        max_wait_seconds: z.number().int().min(5).max(3600).optional(),
      })
      .strict(),
    presentation_intent: z
      .object({
        voice: z.array(z.enum(["narrate", "question", "feedback"])),
        workspace_surfaces: z.array(z.enum(["geometry", "solution_board"])),
      })
      .strict(),
    resource_ids: z.array(resourceIdPattern).optional(),
    support_boundary: z
      .object({
        may_reveal_answer: z.literal(false),
        may_reveal_intermediate: z.boolean(),
        max_support: z.enum([
          "orient",
          "foreground",
          "name_strategy",
          "specify_operation",
          "provide_intermediate_conclusion",
        ]),
      })
      .strict(),
    transitions: z.array(beatTransitionSchema).min(1),
    inquiry_branch: z
      .object({
        inquiry_protocol_ref: protocolArtifactRef,
        return_beat_id: beatIdPattern,
        trigger: z
          .enum(["ask_question", "request_scaffold", "request_rephrase", "unclear", "out_of_bound"])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["student_answer", "workspace_command", "student_confirmation", "explicit_gate_pass"].includes(
        value.completion_evidence.evidence_kind,
      ) &&
      !value.completion_evidence.gate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completion_evidence"],
        message: `evidence_kind=${value.completion_evidence.evidence_kind} requires gate`,
      });
    }
    if (value.pacing.wait_policy === "bounded_wait" && value.pacing.max_wait_seconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pacing"],
        message: "bounded_wait requires max_wait_seconds",
      });
    }
  });

export const teachingProtocolV1Schema = z
  .object({
    schema: z.literal("ai_teaching_teaching_protocol/v1"),
    protocol_id: teachingProtocolId,
    version: versionTag,
    status: statusEnum,
    approval: approvalBlock.optional(),
    question_ref: questionArtifactRef,
    solution_graph_ref: solutionGraphArtifactRef,
    protocol_kind: z.enum(["mainline", "inquiry", "scaffold", "verification"]),
    entry_beat_id: beatIdPattern,
    beats: z.array(beatSchema).min(1),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/teaching-protocol\/PR-[A-Z0-9]+-[0-9]{3,}@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const beatIds = new Set(value.beats.map((b) => b.beat_id));
    if (new Set(value.beats.map((b) => b.beat_id)).size !== value.beats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "beat_id must be unique" });
    }
    if (!beatIds.has(value.entry_beat_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `entry_beat_id ${value.entry_beat_id} not in beats`,
      });
    }
    for (const beat of value.beats) {
      for (const transition of beat.transitions) {
        if (!beatIds.has(transition.to_beat)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["beats"],
            message: `beat ${beat.beat_id} transitions to unknown beat ${transition.to_beat}`,
          });
        }
      }
      if (beat.inquiry_branch && !beatIds.has(beat.inquiry_branch.return_beat_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["beats"],
          message: `inquiry_branch return_beat_id ${beat.inquiry_branch.return_beat_id} not in beats`,
        });
      }
    }
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Approved requires approval block" });
    }
  });

// planning/v4/tutor-plan-bundle（v4）
export const tutorPlanBundleV4Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v4"),
    artifact_id: planId,
    version: versionTag,
    status: statusEnum,
    approval: approvalBlock.optional(),
    question_ref: questionArtifactRef,
    approach_set_ref: z
      .object({
        artifact_id: z.string().regex(/^AS-[A-Z0-9]+-[0-9]{3,}$/),
        version: versionTag,
        content_hash: sha256,
      })
      .strict(),
    solution_graph_ref: solutionGraphArtifactRef,
    policy_profile_ref: z
      .object({ artifact_id: policyProfileId, version: versionTag, content_hash: sha256 })
      .strict(),
    chunks: z
      .array(
        z
          .object({
            chunk_id: z.string().regex(/^CH-[0-9]{1,3}$/),
            part_id: partIdPattern.optional(),
            protocol_refs: z.array(protocolArtifactRef).min(1),
            resource_ids: z.array(resourceIdPattern).optional(),
          })
          .strict(),
      )
      .min(1),
    resources: z
      .array(
        z
          .object({
            resource_id: resourceIdPattern,
            kind: z.enum([
              "explanation",
              "diagnostic_probe",
              "repair",
              "action_template",
              "workspace",
              "voice_seed",
              "support",
            ]),
            beat_ref: beatIdPattern.optional(),
            source: z.enum(["authored", "reused", "agent_generated"]),
            content: nonEmptyString.optional(),
            graph_fact_refs: z.array(graphFactIdPattern).optional(),
          })
          .strict(),
      )
      .min(1),
    build_provenance: z
      .object({
        provider: nonEmptyString,
        model_id: nonEmptyString,
        workflow_version: nonEmptyString,
        run_id: nonEmptyString,
        built_at: isoDateTime,
        runtime_registry_version: nonEmptyString,
        compiler_version: nonEmptyString,
        materializer_version: nonEmptyString,
      })
      .strict(),
    content_hash: sha256,
    artifact_uri: z.string().regex(/^artifact:\/\/tutor-plan\/TP-[A-Z0-9]+-[0-9]{3,}@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Approved requires approval block" });
    }
  });

// runtime/v5/student-intent
const studentWorkspaceCommandBody = z
  .object({
    command_id: studentCommandIdPattern,
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    target_ids: z.array(nonEmptyString),
    params: z.record(z.unknown()).optional(),
    expected_workspace_revision: z.number().int().min(0),
    client_command_id: clientRequestIdPattern,
  })
  .strict();

export const studentIntentV1Schema = z
  .object({
    schema: z.literal("ai_teaching_student_intent/v1"),
    session_id: sessionId,
    intent_kind: z.enum([
      "submit_answer",
      "submit_workspace_command",
      "confirm",
      "continue",
      "ask_question",
      "request_scaffold",
      "request_rephrase",
      "replay_narration",
      "barge_in",
      "return_to_mainline",
      "retry_recovery",
    ]),
    text: nonEmptyString.optional(),
    workspace_command: studentWorkspaceCommandBody.optional(),
    expected_revision: z.number().int().min(0),
    client_request_id: clientRequestIdPattern,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (["submit_answer", "ask_question"].includes(value.intent_kind) && !value.text) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `intent_kind=${value.intent_kind} requires text`,
      });
    }
    if (value.intent_kind === "submit_workspace_command" && !value.workspace_command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intent_kind=submit_workspace_command requires workspace_command",
      });
    }
  });

// runtime/v5/student-workspace-command（standalone）
export const studentWorkspaceCommandV1Schema = z
  .object({
    schema: z.literal("ai_teaching_student_workspace_command/v1"),
    session_id: sessionId,
    command_id: studentCommandIdPattern,
    origin: z.literal("student"),
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    target_ids: z.array(nonEmptyString),
    params: z.record(z.unknown()).optional(),
    expected_workspace_revision: z.number().int().min(0),
    client_command_id: clientRequestIdPattern,
    input_evidence_sequence: z.number().int().min(1).optional(),
  })
  .strict();

// runtime/v5/tutor-policy-decision
const decisionKindEnum = z.enum([
  "execute_beat",
  "complete_beat",
  "transition_beat",
  "open_inquiry",
  "open_scaffold",
  "continue_inquiry",
  "return_to_mainline",
  "revisit_beat",
  "accept_alternate_path",
  "change_stance",
  "request_clarification",
  "pause",
  "safe_fallback",
]);

const inquiryBlock = z
  .object({
    inquiry_id: inquiryIdPattern,
    inquiry_protocol_id: teachingProtocolId.optional(),
    return_beat_id: beatIdPattern,
  })
  .strict();

export const tutorPolicyDecisionV1Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_policy_decision/v1"),
    session_id: sessionId,
    decision_id: decisionIdPattern,
    policy_version: nonEmptyString,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    decision_kind: decisionKindEnum,
    to_beat_id: beatIdPattern.optional(),
    transition_basis: z
      .object({
        basis: z.enum([
          "legal_transition",
          "gate_satisfied",
          "gate_unsatisfied",
          "student_evidence",
          "inquiry_completed",
          "timeout",
          "safe_fallback_policy",
        ]),
        gate_id: gateIdPattern.optional(),
        graph_variant_id: solutionVariantIdPattern.optional(),
      })
      .strict()
      .optional(),
    inquiry: inquiryBlock.optional(),
    interpretation_summary: z
      .object({
        intent: nonEmptyString,
        reasoning_location: z.enum(["aligned", "partially_aligned", "misaligned", "unknown"]),
        confidence: z.number().min(0).max(1),
        interpreter_version: nonEmptyString.optional(),
        evidence_sequences: z.array(z.number().int().min(1)).max(8).optional(),
      })
      .strict()
      .optional(),
    source_event_sequence: z.number().int().min(1),
    source_state_revision: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["open_inquiry", "open_scaffold", "continue_inquiry", "return_to_mainline"].includes(
        value.decision_kind,
      ) &&
      !value.inquiry
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision_kind=${value.decision_kind} requires inquiry (with return_beat_id)`,
      });
    }
    if (["transition_beat", "revisit_beat", "return_to_mainline"].includes(value.decision_kind) &&
      !value.to_beat_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision_kind=${value.decision_kind} requires to_beat_id`,
      });
    }
  });

// runtime/v5/voice-action
export const voiceActionV1Schema = z
  .object({
    schema: z.literal("ai_teaching_voice_action/v1"),
    session_id: sessionId,
    action_id: voiceActionIdPattern,
    decision_id: decisionIdPattern,
    beat_id: beatIdPattern.optional(),
    text: nonEmptyString,
    source: z.enum(["approved-resource", "model-generated", "deterministic-scaffold"]),
    resource_ref: resourceIdPattern.optional(),
    generation_id: z.string().regex(/^VG-[A-Za-z0-9._:-]{4,}$/).optional(),
    interruptible: z.boolean().optional(),
    intent: z.enum(["narrate", "question", "feedback"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === "approved-resource" && !value.resource_ref) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source=approved-resource requires resource_ref",
      });
    }
    if (value.source === "model-generated" && !value.generation_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source=model-generated requires generation_id",
      });
    }
  });

// runtime/v5/workspace-surface-action
export const workspaceSurfaceActionV1Schema = z
  .object({
    schema: z.literal("ai_teaching_workspace_surface_action/v1"),
    session_id: sessionId,
    action_id: surfaceActionIdPattern,
    decision_id: decisionIdPattern,
    beat_id: beatIdPattern.optional(),
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    origin: z.literal("tutor"),
    target_ids: z.array(nonEmptyString).optional(),
    command_payload: z.string().optional(),
    reveal_scope: z.enum(["none", "target_highlight", "step_narration", "intermediate_result", "final_result"]),
    presentation_only: z.boolean().optional(),
  })
  .strict();

// runtime/v5/action-outcome
export const actionOutcomeV1Schema = z
  .object({
    schema: z.literal("ai_teaching_action_outcome/v1"),
    session_id: sessionId,
    action_id: nonEmptyString,
    action_kind: z.enum(["voice", "workspace_surface", "student_command"]),
    outcome: z.enum(["completed", "rejected", "interrupted", "failed"]),
    failure_class: z.enum([
      "validation_failure",
      "capability_unsupported",
      "illegal_target",
      "stale_revision",
      "truth_boundary_violation",
      "provider_failure",
      "timeout",
      "internal_error",
    ]).optional(),
    message: z.string().optional(),
    resulting_revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "failed" && !value.failure_class) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "outcome=failed requires failure_class" });
    }
    if (value.outcome !== "failed" && value.failure_class) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `outcome=${value.outcome} must not carry failure_class`,
      });
    }
  });

// runtime/v5/external-support-evidence
export const externalSupportEvidenceV1Schema = z
  .object({
    schema: z.literal("ai_teaching_external_support_evidence/v1"),
    session_id: sessionId,
    evidence_id: supportEvidenceIdPattern,
    beat_id: beatIdPattern.optional(),
    support_kinds: z
      .array(
        z.enum([
          "orient",
          "reveal_target",
          "foreground",
          "name_strategy",
          "specify_operation",
          "provide_intermediate_conclusion",
          "provide_final_conclusion",
        ]),
      )
      .min(1),
    initiated_by: z.enum(["tutor_initiated", "student_requested", "unknown"]),
    action_ids: z.array(nonEmptyString).min(1),
    student_response: z
      .object({
        progression_observed: z.boolean(),
        self_corrected: z.boolean(),
        observed_after_sequences: z.array(z.number().int().min(1)).max(8).optional(),
      })
      .strict()
      .optional(),
    derived_partial: z.boolean(),
    legacy_source: z
      .object({
        legacy_event_schema: z.enum([
          "ai_teaching_tutor_session_event/v2",
          "ai_teaching_tutor_session_event/v3",
          "ai_teaching_tutor_session_event/v4",
        ]),
        legacy_level: z.number().int().min(0).max(5),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.derived_partial && !value.legacy_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "derived_partial=true requires legacy_source",
      });
    }
    if (!value.derived_partial && value.legacy_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "new facts (derived_partial=false) must not carry legacy_source",
      });
    }
    if (!value.derived_partial && value.initiated_by === "unknown") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "initiated_by=unknown is only allowed for legacy derived facts",
      });
    }
  });

// runtime/v5/presentation-plan
const presentationVoiceItem = z
  .object({
    action_id: voiceActionIdPattern,
    decision_id: decisionIdPattern,
    text: nonEmptyString,
    source: z.enum(["approved-resource", "model-generated", "deterministic-scaffold"]),
    resource_ref: resourceIdPattern.optional(),
    generation_id: z.string().regex(/^VG-[A-Za-z0-9._:-]{4,}$/).optional(),
    interruptible: z.boolean().optional(),
    intent: z.enum(["narrate", "question", "feedback"]).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === "approved-resource" && !value.resource_ref) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source=approved-resource requires resource_ref" });
    }
    if (value.source === "model-generated" && !value.generation_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source=model-generated requires generation_id" });
    }
  });

const presentationSurfaceItem = z
  .object({
    action_id: surfaceActionIdPattern,
    decision_id: decisionIdPattern,
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    origin: z.literal("tutor"),
    target_ids: z.array(nonEmptyString).optional(),
    command_payload: z.string().optional(),
    reveal_scope: z.enum(["none", "target_highlight", "step_narration", "intermediate_result", "final_result"]),
    presentation_only: z.boolean().optional(),
  })
  .strict();

export const presentationPlanV1Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_plan/v1"),
    session_id: sessionId,
    plan_id: presentationPlanIdPattern,
    decision_id: decisionIdPattern,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    voice_actions: z.array(presentationVoiceItem),
    workspace_actions: z.array(presentationSurfaceItem),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.voice_actions.length === 0 && value.workspace_actions.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "presentation plan must contain at least one voice or workspace action",
      });
    }
  });

// runtime/v5/tutor-session-event
const v5SessionStartedPayload = z
  .object({
    task_id: nonEmptyString,
    scenario_id: nonEmptyString,
    question_ref: questionArtifactRef,
    approach_set_ref: z
      .object({
        artifact_id: z.string().regex(/^AS-[A-Z0-9]+-[0-9]{3,}$/),
        version: versionTag,
        content_hash: sha256,
      })
      .strict(),
    solution_graph_ref: solutionGraphArtifactRef,
    protocol_refs: z.array(protocolArtifactRef).min(1),
    tutor_plan_ref: planArtifactRefV4,
    policy_profile_snapshot: z
      .object({
        profile_id: policyProfileId,
        version: nonEmptyString,
        primary_provider: nonEmptyString,
        fallback_provider: nonEmptyString,
        model_id: nonEmptyString,
        prompt_version: nonEmptyString,
      })
      .strict(),
    initial_cursor: z
      .object({ protocol_id: teachingProtocolId, beat_id: beatIdPattern })
      .strict(),
    previous_session_id: sessionId.optional(),
    switch_reason: z.literal("alternate_approach").optional(),
    // 2026-08-31 R0 增补（PRDS contracts/schemas/runtime/v5/tutor-session-event.schema.json
    // 同步）：F3 WorkspacePresentationCatalogV5 的持久 pin（resume 对账依据；
    // content_hash 计算口径冻结于 mvp/foundation/f3-f5-rework/r0-contract-wave.md）。
    workspace_catalog_pin: z
      .object({
        catalog_schema_version: z.number().int().min(1),
        content_hash: sha256,
        entry_count: z.number().int().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const v5StudentIntentRecordedPayload = z
  .object({
    intent_kind: z.enum([
      "submit_answer",
      "submit_workspace_command",
      "confirm",
      "continue",
      "ask_question",
      "request_scaffold",
      "request_rephrase",
      "replay_narration",
      "barge_in",
      "return_to_mainline",
      "retry_recovery",
    ]),
    text: nonEmptyString.optional(),
    client_request_id: clientRequestIdPattern,
    // 2026-08-29 F3 增补（PRDS contracts/schemas/runtime/v5/tutor-session-event.schema.json
    // 同步）：submit_workspace_command 时内嵌完整 StudentWorkspaceCommand 形状——
    // Workspace 状态转换内核（F3）重建 WorkspaceRuntimeState 的唯一 student
    // 命令事实真源。
    workspace_command: studentWorkspaceCommandBody.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.intent_kind === "submit_workspace_command" && !value.workspace_command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "intent_kind=submit_workspace_command requires workspace_command",
      });
    }
  });

const v5ReasoningFocus = z
  .object({
    part_id: partIdPattern.optional(),
    graph_fact_refs: z.array(graphFactIdPattern).min(1),
  })
  .strict();

const v5ReasoningAlignment = z
  .object({
    kind: z.enum([
      "expected_region",
      "alternate_valid_path",
      "incorrect_reasoning",
      "unclear_reasoning",
      "no_progress",
    ]),
    // 09:1118 五类 ReasoningAlignment：expected_region/alternate_valid_path 携
    // fact_ids+inference_ids；incorrect_reasoning 携 anchored_fact_ids；
    // unclear_reasoning/no_progress 无参数（条件由 superRefine 强制，与
    // PRDS schema payload 级 allOf 一致）。
    fact_ids: z.array(graphFactIdPattern).min(1).optional(),
    inference_ids: z.array(graphInferenceIdPattern).min(1).optional(),
    anchored_fact_ids: z.array(graphFactIdPattern).min(1).optional(),
  })
  .strict();

const v5SemanticInterpretationPayload = z
  .object({
    intent: nonEmptyString,
    reasoning_location: z.enum(["aligned", "partially_aligned", "misaligned", "unknown"]),
    confidence: z.number().min(0).max(1),
    interpreter_version: nonEmptyString,
    grounding_refs: z.array(z.string().regex(/^[A-Za-z0-9_.\[\]-]{3,64}$/)).max(8).optional(),
    // 2026-08-31 R0 增补（PRDS contracts/schemas/runtime/v5/tutor-session-event.schema.json
    // 同步）：reasoning_focus 携带时由 reducer 整体覆写 state/v1 reasoning_focus
    //（主线游标不动）；缺省不改。形状与 state/v1 reasoning_focus 逐字段同构。
    reasoning_focus: v5ReasoningFocus.optional(),
    reasoning_alignment: v5ReasoningAlignment.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const alignment = value.reasoning_alignment;
    if (!alignment) return;
    const regionKinds = alignment.kind === "expected_region" || alignment.kind === "alternate_valid_path";
    if (regionKinds) {
      if (!alignment.fact_ids || !alignment.inference_ids) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reasoning_alignment.kind=${alignment.kind} requires fact_ids and inference_ids`,
        });
      }
      if (alignment.anchored_fact_ids) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reasoning_alignment.kind=${alignment.kind} must not carry anchored_fact_ids`,
        });
      }
    } else if (alignment.kind === "incorrect_reasoning") {
      if (!alignment.anchored_fact_ids) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "reasoning_alignment.kind=incorrect_reasoning requires anchored_fact_ids",
        });
      }
      if (alignment.fact_ids || alignment.inference_ids) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "reasoning_alignment.kind=incorrect_reasoning must not carry fact_ids/inference_ids",
        });
      }
    } else if (alignment.fact_ids || alignment.inference_ids || alignment.anchored_fact_ids) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `reasoning_alignment.kind=${alignment.kind} must not carry region/anchor refs`,
      });
    }
  });

// 2026-08-31 R0 增补：session-local LocalInquiryProtocol（09:1288 六要素）的
// 结构化持久表达，只随 decision_kind=open_inquiry 事件出现。本地 id 命名空间
// LPR-/LBT-（id-registry）与 Approved PR-/BT- 构造性隔离；跨字段相等性
//（return 同值、to_beat 的 BT- 值=return_beat_id、转移引用本地 beats）在
// superRefine fail closed；锚点/资源在 Pinned RG/Plan 内由实现（F5 Builder
// 边界校验）保证——schema 无法跨 artifact 引用。
const v5LocalInquiryBeat = z
  .object({
    beat_id: z.string().regex(/^LBT-[0-9]{1,3}$/),
    purpose: nonEmptyString,
    graph_fact_refs: z.array(graphFactIdPattern).min(1),
    cognitive_activity: z.enum(["attend", "recall", "relate", "apply", "verify", "explain"]),
    completion_evidence: z
      .object({
        evidence_kind: z.enum([
          "student_answer",
          "workspace_command",
          "student_confirmation",
          "narration_completed",
          "explicit_gate_pass",
          "tutor_observed",
        ]),
        gate: z
          .object({
            gate_id: gateIdPattern,
            requirement: nonEmptyString,
            capability: nonEmptyString.optional(),
            graph_fact_id: graphFactIdPattern.optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    participation: z.enum(["listen", "answer", "operate", "confirm", "continue"]),
    pacing: z
      .object({
        wait_policy: z.enum(["student_driven", "bounded_wait"]),
        max_wait_seconds: z.number().int().min(5).max(3600).optional(),
      })
      .strict(),
    resource_ids: z.array(resourceIdPattern).optional(),
    support_boundary: z
      .object({
        may_reveal_answer: z.literal(false),
        may_reveal_intermediate: z.boolean(),
        max_support: z.enum([
          "orient",
          "foreground",
          "name_strategy",
          "specify_operation",
          "provide_intermediate_conclusion",
        ]),
      })
      .strict(),
  })
  .strict();

const v5LocalInquiryProtocol = z
  .object({
    local_protocol_id: z.string().regex(/^LPR-[A-Za-z0-9._:-]{4,}$/),
    source_plan: planArtifactRefV4,
    anchor_fact_ids: z.array(graphFactIdPattern).min(1),
    anchor_inference_ids: z.array(graphInferenceIdPattern).optional(),
    beats: z.array(v5LocalInquiryBeat).min(1),
    transitions: z
      .array(
        z
          .object({
            from_beat: z.string().regex(/^LBT-[0-9]{1,3}$/),
            to_beat: z.string().regex(/^(LBT|BT)-[0-9]{1,3}$/),
            on: z.enum([
              "gate_satisfied",
              "evidence_collected",
              "student_request",
              "timeout",
              "tutor_discretion",
            ]),
          })
          .strict(),
      )
      .min(1),
    return_beat_id: beatIdPattern,
    expires_with_session: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const localBeatIds = new Set<string>();
    for (const [index, beat] of value.beats.entries()) {
      if (localBeatIds.has(beat.beat_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `beats[${index}].beat_id ${beat.beat_id} is duplicated within this local protocol`,
        });
      }
      localBeatIds.add(beat.beat_id);
    }
    for (const [index, transition] of value.transitions.entries()) {
      if (!localBeatIds.has(transition.from_beat)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${index}].from_beat ${transition.from_beat} is not a beat of this local protocol`,
        });
      }
      if (
        transition.to_beat.startsWith("LBT-") &&
        !localBeatIds.has(transition.to_beat)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${index}].to_beat ${transition.to_beat} is not a beat of this local protocol`,
        });
      }
      if (transition.to_beat.startsWith("BT-") && transition.to_beat !== value.return_beat_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${index}].to_beat ${transition.to_beat} must equal return_beat_id ${value.return_beat_id} (mainline beats are only reachable via the return point)`,
        });
      }
    }
  });

const v5PolicyDecisionPayload = z
  .object({
    decision_id: decisionIdPattern,
    decision_kind: decisionKindEnum,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    to_beat_id: beatIdPattern.optional(),
    policy_version: nonEmptyString,
    source_event_sequence: z.number().int().min(1),
    source_state_revision: z.number().int().min(0),
    transition_basis: z
      .object({
        basis: z.enum([
          "legal_transition",
          "gate_satisfied",
          "gate_unsatisfied",
          "student_evidence",
          "inquiry_completed",
          "timeout",
          "safe_fallback_policy",
        ]),
        gate_id: gateIdPattern.optional(),
        graph_variant_id: solutionVariantIdPattern.optional(),
      })
      .strict()
      .optional(),
    inquiry: inquiryBlock.optional(),
    local_inquiry_protocol: v5LocalInquiryProtocol.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["open_inquiry", "open_scaffold", "continue_inquiry", "return_to_mainline"].includes(
        value.decision_kind,
      ) &&
      !value.inquiry
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision_kind=${value.decision_kind} requires inquiry (with return_beat_id)`,
      });
    }
    if (["transition_beat", "revisit_beat", "return_to_mainline"].includes(value.decision_kind) &&
      !value.to_beat_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `decision_kind=${value.decision_kind} requires to_beat_id`,
      });
    }
    if (value.local_inquiry_protocol) {
      if (value.decision_kind !== "open_inquiry") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `local_inquiry_protocol is only allowed with decision_kind=open_inquiry (got ${value.decision_kind})`,
        });
      }
      if (!value.inquiry) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "local_inquiry_protocol requires inquiry (with return_beat_id)",
        });
      } else {
        if (value.inquiry.inquiry_protocol_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "local_inquiry_protocol must not coexist with inquiry.inquiry_protocol_id (session-local protocols are not PR- artifacts)",
          });
        }
        if (value.inquiry.return_beat_id !== value.local_inquiry_protocol.return_beat_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `local_inquiry_protocol.return_beat_id ${value.local_inquiry_protocol.return_beat_id} differs from inquiry.return_beat_id ${value.inquiry.return_beat_id}`,
          });
        }
      }
    }
  });

const v5GateEvaluatedPayload = z
  .object({
    gate_id: gateIdPattern,
    beat_id: beatIdPattern,
    satisfied: z.boolean(),
    evidence_sequence: z.number().int().min(1).optional(),
  })
  .strict();

const v5VoiceIssuedPayload = z
  .object({
    action_id: voiceActionIdPattern,
    decision_id: decisionIdPattern,
    beat_id: beatIdPattern.optional(),
    text: nonEmptyString,
    source: z.enum(["approved-resource", "model-generated", "deterministic-scaffold"]),
    resource_ref: resourceIdPattern.optional(),
    generation_id: z.string().regex(/^VG-[A-Za-z0-9._:-]{4,}$/).optional(),
    interruptible: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === "approved-resource" && !value.resource_ref) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source=approved-resource requires resource_ref" });
    }
    if (value.source === "model-generated" && !value.generation_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source=model-generated requires generation_id" });
    }
  });

const v5SurfaceIssuedPayload = z
  .object({
    action_id: surfaceActionIdPattern,
    decision_id: decisionIdPattern,
    beat_id: beatIdPattern.optional(),
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    target_ids: z.array(nonEmptyString).optional(),
    command_payload: z.string().optional(),
    reveal_scope: z.enum(["none", "target_highlight", "step_narration", "intermediate_result", "final_result"]),
    presentation_only: z.boolean().optional(),
  })
  .strict();

const v5ActionOutcomePayload = z
  .object({
    action_id: nonEmptyString,
    action_kind: z.enum(["voice", "workspace_surface", "student_command"]),
    outcome: z.enum(["completed", "rejected", "interrupted", "failed"]),
    failure_class: z.enum([
      "validation_failure",
      "capability_unsupported",
      "illegal_target",
      "stale_revision",
      "truth_boundary_violation",
      "provider_failure",
      "timeout",
      "internal_error",
    ]).optional(),
    message: z.string().optional(),
    resulting_revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "failed" && !value.failure_class) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "outcome=failed requires failure_class" });
    }
    if (value.outcome !== "failed" && value.failure_class) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `outcome=${value.outcome} must not carry failure_class`,
      });
    }
  });

const v5ExternalSupportPayload = z
  .object({
    evidence_id: supportEvidenceIdPattern,
    beat_id: beatIdPattern.optional(),
    support_kinds: z
      .array(
        z.enum([
          "orient",
          "reveal_target",
          "foreground",
          "name_strategy",
          "specify_operation",
          "provide_intermediate_conclusion",
          "provide_final_conclusion",
        ]),
      )
      .min(1),
    initiated_by: z.enum(["tutor_initiated", "student_requested", "unknown"]),
    action_ids: z.array(nonEmptyString).min(1),
    student_response: z
      .object({
        progression_observed: z.boolean(),
        self_corrected: z.boolean(),
        observed_after_sequences: z.array(z.number().int().min(1)).max(8).optional(),
      })
      .strict()
      .optional(),
    derived_partial: z.boolean(),
    legacy_source: z
      .object({
        legacy_event_schema: z.enum([
          "ai_teaching_tutor_session_event/v2",
          "ai_teaching_tutor_session_event/v3",
          "ai_teaching_tutor_session_event/v4",
        ]),
        legacy_level: z.number().int().min(0).max(5),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.derived_partial && !value.legacy_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "derived_partial=true requires legacy_source",
      });
    }
    if (!value.derived_partial && value.legacy_source) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "new facts (derived_partial=false) must not carry legacy_source",
      });
    }
    if (!value.derived_partial && value.initiated_by === "unknown") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "initiated_by=unknown is only allowed for legacy derived facts",
      });
    }
  });

const v5InquiryPayload = z
  .object({
    inquiry_id: inquiryIdPattern,
    inquiry_protocol_id: teachingProtocolId.optional(),
    return_beat_id: beatIdPattern,
    local: z.boolean().optional(),
    trigger: z
      .enum(["ask_question", "request_scaffold", "request_rephrase", "unclear", "out_of_bound"])
      .optional(),
  })
  .strict();

const v5StudentProgressedPayload = z
  .object({
    beat_id: beatIdPattern,
    part_id: partIdPattern.optional(),
    evidence_sequence: z.number().int().min(1),
  })
  .strict();

const v5PolicyFailedPayload = z
  .object({
    policy_version: nonEmptyString,
    failure_class: z.enum([
      "no_legal_transition",
      "gate_unresolvable",
      "interpreter_unavailable",
      "policy_engine_error",
      "timeout",
    ]),
    fallback_used: z.boolean(),
    fallback_beat_id: beatIdPattern.optional(),
  })
  .strict();

const v5PresentationFailedPayload = z
  .object({
    decision_id: decisionIdPattern.optional(),
    failure_class: z.enum([
      "action_validation_rejected",
      "resource_missing",
      "provider_failure",
      "partial_execution",
      "timeout",
    ]),
    message: z.string(),
    completed_action_ids: z.array(nonEmptyString).optional(),
  })
  .strict();

const v5RuntimeFailurePayload = z
  .object({
    failure_class: z.enum([
      "event_store_failure",
      "rebuild_failure",
      "corruption_detected",
      "revision_conflict",
      "internal_error",
    ]),
    message: z.string(),
    related_event_sequence: z.number().int().min(1).optional(),
  })
  .strict();

const v5SessionCompletedPayload = z
  .object({
    final_beat_id: beatIdPattern,
    completed_parts: z.array(partIdPattern).optional(),
  })
  .strict();

const v5EventPayloadSchemas = {
  session_started: v5SessionStartedPayload,
  student_intent_recorded: v5StudentIntentRecordedPayload,
  semantic_interpretation_recorded: v5SemanticInterpretationPayload,
  policy_decision_made: v5PolicyDecisionPayload,
  gate_evaluated: v5GateEvaluatedPayload,
  voice_action_issued: v5VoiceIssuedPayload,
  workspace_surface_action_issued: v5SurfaceIssuedPayload,
  action_outcome_recorded: v5ActionOutcomePayload,
  external_support_recorded: v5ExternalSupportPayload,
  inquiry_opened: v5InquiryPayload,
  inquiry_returned: v5InquiryPayload,
  student_progressed: v5StudentProgressedPayload,
  policy_failed: v5PolicyFailedPayload,
  presentation_failed: v5PresentationFailedPayload,
  runtime_failure: v5RuntimeFailurePayload,
  session_completed: v5SessionCompletedPayload,
} as const;

const V5_CAUSATION_REQUIRED = new Set([
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "voice_action_issued",
  "workspace_surface_action_issued",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
  "presentation_failed",
]);

export const tutorSessionEventV5Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v5"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "voice_action_issued",
      "workspace_surface_action_issued",
      "action_outcome_recorded",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
      "policy_failed",
      "presentation_failed",
      "runtime_failure",
      "session_completed",
    ]),
    payload: z.record(z.unknown()),
    causation_sequence: z.number().int().min(1).optional(),
    idempotency_key: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const payloadSchema = v5EventPayloadSchemas[value.event_type as keyof typeof v5EventPayloadSchemas];
    if (payloadSchema) {
      const result = payloadSchema.safeParse(value.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["payload", ...issue.path],
            message: issue.message,
          });
        }
      }
    } else {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `unknown event_type: ${value.event_type}`,
      });
    }
    if (V5_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

// state/v1/workspace-runtime-state
export const workspaceRuntimeStateV1Schema = z
  .object({
    schema: z.literal("ai_teaching_workspace_runtime_state/v1"),
    session_id: sessionId,
    revision: z.number().int().min(0),
    geometry: z
      .object({
        committed_element_ids: z.array(nonEmptyString),
        draft_element_ids: z.array(nonEmptyString),
        interaction_mode: z.enum(["free", "construction", "locked"]).optional(),
      })
      .strict(),
    solution_board: z
      .object({
        entries: z.array(
          z
            .object({
              entry_id: z.string().regex(/^BE-[0-9]{1,3}$/),
              visibility: z.enum(["hidden", "visible", "active"]),
              attempt_state: z.enum(["none", "attempted", "confirmed"]),
              presentation_group: z.string().regex(/^PG-[0-9]{1,3}$/).optional(),
            })
            .strict(),
        ),
        canonical_path_entry_ids: z.array(z.string().regex(/^BE-[0-9]{1,3}$/)).optional(),
      })
      .strict(),
  })
  .strict();

// state/v1/tutor-runtime-state
export const tutorRuntimeStateV1Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_runtime_state/v1"),
    session_id: sessionId,
    state_revision: z.number().int().min(0),
    pinned_plan: z
      .object({
        tutor_plan_ref: planArtifactRefV4,
        solution_graph_ref: solutionGraphArtifactRef,
        protocol_refs: z.array(protocolArtifactRef).min(1),
        policy_profile_snapshot: z
          .object({
            profile_id: policyProfileId,
            version: nonEmptyString,
            primary_provider: nonEmptyString,
            fallback_provider: nonEmptyString,
            model_id: nonEmptyString,
            prompt_version: nonEmptyString,
          })
          .strict()
          .optional(),
      })
      .strict(),
    teaching_cursor: z
      .object({
        protocol_id: teachingProtocolId,
        beat_id: beatIdPattern,
        gate_id: gateIdPattern.optional(),
        phase: z.enum(["presenting", "awaiting_evidence", "gate_satisfied", "completed"]).optional(),
      })
      .strict(),
    inquiry_cursor: z
      .union([
        z.null(),
        z
          .object({
            inquiry_id: inquiryIdPattern,
            inquiry_protocol_id: teachingProtocolId.optional(),
            state: z.enum(["clarifying", "supporting", "ready_to_return"]),
            return_beat_id: beatIdPattern,
          })
          .strict(),
      ])
      .optional(),
    reasoning_focus: z
      .object({
        part_id: partIdPattern.optional(),
        graph_fact_refs: z.array(graphFactIdPattern).min(1),
      })
      .strict()
      .optional(),
    workspace_revision: z.number().int().min(0),
    completed: z.boolean().optional(),
  })
  .strict();

// view/v1/mainline-participation
const participationKindEnum = z.enum([
  "listen_only",
  "answer_input",
  "workspace_input",
  "confirm_input",
  "continue_input",
  "temporarily_paused_for_inquiry",
  "read_only_completed",
]);

export const mainlineParticipationV1Schema = z
  .object({
    schema: z.literal("ai_teaching_mainline_participation/v1"),
    kind: participationKindEnum,
    gate_id: gateIdPattern.optional(),
    action_id: nonEmptyString.optional(),
    return_checkpoint_id: beatIdPattern.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      ["answer_input", "workspace_input", "confirm_input", "continue_input"].includes(value.kind) &&
      !value.gate_id
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `kind=${value.kind} requires gate_id` });
    }
    if (value.kind === "temporarily_paused_for_inquiry" && !value.return_checkpoint_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kind=temporarily_paused_for_inquiry requires return_checkpoint_id",
      });
    }
  });

// view/v1/student-workspace-view
export const studentWorkspaceViewV1Schema = z
  .object({
    schema: z.literal("ai_teaching_student_workspace_view/v1"),
    session_id: sessionId,
    revision: z.number().int().min(0),
    canvas: z
      .object({
        elements: z.array(
          z
            .object({
              element_id: nonEmptyString,
              kind: z.enum(["point", "segment", "line", "circle", "polygon", "label", "measure"]),
              visible: z.literal(true),
              highlighted: z.boolean().optional(),
              annotated: z.boolean().optional(),
              student_authored: z.boolean().optional(),
            })
            .strict(),
        ),
        interaction_enabled: z.boolean(),
      })
      .strict(),
    solution_board: z
      .object({
        mode: z.enum(["building", "review"]),
        groups: z.array(
          z
            .object({
              group_id: z.string().regex(/^PG-[0-9]{1,3}$/),
              title: z.string().optional(),
              entries: z.array(
                z
                  .object({
                    entry_id: z.string().regex(/^BE-[0-9]{1,3}$/),
                    kind: z.enum(["statement", "derivation", "conclusion", "question"]),
                    content: nonEmptyString,
                    state: z.enum(["visible", "active"]),
                    attempt_summary: z.string().optional(),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
    participation: z
      .object({
        kind: participationKindEnum,
        gate_id: gateIdPattern.optional(),
        action_id: nonEmptyString.optional(),
        return_checkpoint_id: beatIdPattern.optional(),
      })
      .strict()
      .superRefine((value, ctx) => {
        if (
          ["answer_input", "workspace_input", "confirm_input", "continue_input"].includes(value.kind) &&
          !value.gate_id
        ) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `kind=${value.kind} requires gate_id` });
        }
        if (value.kind === "temporarily_paused_for_inquiry" && !value.return_checkpoint_id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "kind=temporarily_paused_for_inquiry requires return_checkpoint_id",
          });
        }
      }),
  })
  .strict();

// view/v1/coach-panel-view
export const coachPanelViewV1Schema = z
  .object({
    schema: z.literal("ai_teaching_coach_panel_view/v1"),
    session_id: sessionId,
    revision: z.number().int().min(0),
    mainline: z.union([
      z.object({ kind: z.literal("presenting"), beat_id: beatIdPattern }).strict(),
      z
        .object({ kind: z.literal("awaiting_answer"), beat_id: beatIdPattern, gate_id: gateIdPattern })
        .strict(),
      z
        .object({
          kind: z.literal("awaiting_workspace"),
          beat_id: beatIdPattern,
          gate_id: gateIdPattern,
          action_id: nonEmptyString,
        })
        .strict(),
      z
        .object({
          kind: z.literal("awaiting_confirmation"),
          beat_id: beatIdPattern,
          gate_id: gateIdPattern,
        })
        .strict(),
      z
        .object({ kind: z.literal("ready_to_continue"), beat_id: beatIdPattern, gate_id: gateIdPattern })
        .strict(),
      z.object({ kind: z.literal("recovering"), checkpoint_id: beatIdPattern }).strict(),
      z.object({ kind: z.literal("completed") }).strict(),
    ]),
    inquiry: z.union([
      z.object({ kind: z.literal("no_inquiry") }).strict(),
      z
        .object({
          kind: z.enum(["clarifying", "supporting", "ready_to_return"]),
          inquiry_id: inquiryIdPattern,
          return_checkpoint_id: beatIdPattern,
        })
        .strict(),
    ]),
    teaching_context: z
      .object({
        part_id: partIdPattern.optional(),
        beat_id: beatIdPattern.optional(),
        student_facing_progress: z.string().optional(),
        focus_cue: z.string().optional(),
        waiting_for: z.string().optional(),
      })
      .strict(),
    current_tutor_turn: z.string().optional(),
    assistance_available: z.boolean(),
    replay_available: z.boolean(),
    transcript: z.array(
      z
        .object({
          turn_id: z.string().regex(/^DT-[A-Za-z0-9._:-]{4,}$/),
          role: z.enum(["tutor", "student"]),
          content: nonEmptyString,
          beat_id: beatIdPattern.optional(),
          inquiry_id: inquiryIdPattern.optional(),
        })
        .strict(),
    ),
  })
  .strict();

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

export const teachingApproachV4Schema = z
  .object({
    schema: z.literal("ai_teaching_teaching_approach/v4"),
    artifact_id: approachId,
    version: versionTag,
    status: statusEnum,
    question_ref: z.object({ artifact_id: questionId, version: versionTag, content_hash: sha256, part_id: z.string().regex(/^[1-9][0-9]{0,2}$/).optional() }).strict(),
    solution_graph_ref: z.object({ artifact_id: z.string().regex(/^RG-[A-Z0-9]+-[0-9]{3,}$/), version: versionTag, content_hash: sha256 }).strict(),
    title: nonEmptyString,
    goal: nonEmptyString,
    entry_signal: z.string().optional(),
    steps: z.array(z.object({
      step_id: z.string().regex(/^S[0-9]{1,3}$/), intent: nonEmptyString,
      narration: nonEmptyString, expected_student_reasoning: nonEmptyString,
      accepted_alternatives: z.array(nonEmptyString).optional(), common_errors: z.array(nonEmptyString).optional(),
      source_trace_refs: z.array(nonEmptyString).optional(),
      solution_refs: z.object({
        fact_ids: z.array(z.string().regex(/^FN-[0-9]{1,3}$/)).min(1),
        inference_ids: z.array(z.string().regex(/^IF-[0-9]{1,3}$/)).min(1),
      }).strict(),
    }).strict()).min(3),
    evidence: z.object({ audio: z.array(z.unknown()), transcripts: z.array(z.unknown()), polished: z.array(z.unknown()).optional(), manual_edit_notes: z.array(z.string()).optional() }).strict(),
    approval: approval.optional(), superseded_by: supersededBy.optional(), content_hash: sha256,
    artifact_uri: z.string().regex(/^artifact:\/\/teaching-approach\/[A-Za-z0-9-]+@v[0-9]+$/),
  }).strict().superRefine((value, ctx) => {
    if (value.status === "Approved" && !value.approval) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Approved requires approval" });
    if (value.status === "Superseded" && !value.superseded_by) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "status=Superseded requires superseded_by" });
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

// planning/v5：ReviewedSolutionGraph 最高分辨率之上的保真教学压缩。
const solutionRefsV5Schema = z
  .object({
    fact_ids: z.array(graphFactIdPattern).min(1),
    inference_ids: z.array(graphInferenceIdPattern),
  })
  .strict();
const solutionRegionIdPattern = z.string().regex(/^SR-[0-9]{1,3}$/);
const resolutionProfileIdPattern = z.string().regex(/^RP-[0-9]{1,3}$/);
const presentationGroupIdV5Pattern = z.string().regex(/^PG-[0-9]{1,3}$/);
const chunkIdV5Pattern = z.string().regex(/^CH-[0-9]{1,3}$/);

const teachingBeatV2Schema = z
  .object({
    beat_id: beatIdPattern,
    part_id: partIdPattern.optional(),
    purpose: nonEmptyString,
    role: z.enum([
      "orientation",
      "construction",
      "reasoning",
      "practice",
      "verification",
      "summary",
      "local_inquiry",
    ]),
    solution_refs: solutionRefsV5Schema,
    abstraction_level: z.enum(["A0_object", "A1_relation", "A2_strategy", "A3_structure"]),
    cognitive_process: z.enum(["retrieve", "match", "execute", "monitor"]),
    accepted_alternatives: z.array(nonEmptyString).optional(),
    common_deviations: z.array(nonEmptyString).optional(),
    cognitive_activity: z.enum(["attend", "recall", "relate", "apply", "verify", "explain"]),
    completion_evidence: z.object({
      evidence_kind: z.enum(["student_answer", "workspace_command", "student_confirmation", "narration_completed", "explicit_gate_pass", "tutor_observed"]),
      gate: z.object({ gate_id: gateIdPattern, requirement: nonEmptyString, graph_fact_id: graphFactIdPattern.optional(), capability: nonEmptyString.optional() }).strict().optional(),
    }).strict(),
    participation: z.enum(["listen", "answer", "operate", "confirm", "continue"]),
    pacing: z.object({ wait_policy: z.enum(["student_driven", "bounded_wait"]), max_wait_seconds: z.number().int().min(5).max(3600).optional() }).strict(),
    presentation_intent: z.object({ voice: z.array(z.enum(["narrate", "question", "feedback"])), workspace_surfaces: z.array(z.enum(["geometry", "solution_board"])) }).strict(),
    resource_ids: z.array(resourceIdPattern).optional(),
    support_boundary: z.object({
      may_reveal_answer: z.literal(false),
      may_reveal_intermediate: z.boolean(),
      max_support: z.enum(["orient", "foreground", "name_strategy", "specify_operation", "provide_intermediate_conclusion"]),
    }).strict(),
    transitions: z.array(beatTransitionSchema).min(1),
    inquiry_branch: z
      .object({
        inquiry_protocol_ref: protocolArtifactRef,
        return_beat_id: beatIdPattern,
        expand_region_id: solutionRegionIdPattern,
        trigger: z
          .enum(["ask_question", "request_scaffold", "request_rephrase", "unclear", "out_of_bound"])
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (["student_answer", "workspace_command", "student_confirmation", "explicit_gate_pass"].includes(value.completion_evidence.evidence_kind) && !value.completion_evidence.gate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `evidence_kind=${value.completion_evidence.evidence_kind} requires gate` });
    }
    if (value.pacing.wait_policy === "bounded_wait" && value.pacing.max_wait_seconds === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bounded_wait requires max_wait_seconds" });
    }
  });

export const teachingProtocolV2Schema = z
  .object({
    schema: z.literal("ai_teaching_teaching_protocol/v2"),
    protocol_id: teachingProtocolId,
    version: versionTag,
    status: statusEnum,
    approval: approvalBlock.optional(),
    question_ref: questionArtifactRef,
    solution_graph_ref: solutionGraphArtifactRef,
    protocol_kind: z.enum(["mainline", "inquiry", "scaffold", "verification"]),
    entry_beat_id: beatIdPattern,
    beats: z.array(teachingBeatV2Schema).min(1),
    content_hash: sha256,
    artifact_uri: z
      .string()
      .regex(/^artifact:\/\/teaching-protocol\/PR-[A-Z0-9]+-[0-9]{3,}@v[0-9]+$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    const beatIds = new Set(value.beats.map((beat) => beat.beat_id));
    if (beatIds.size !== value.beats.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "beat_id must be unique" });
    }
    if (!beatIds.has(value.entry_beat_id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `entry_beat_id ${value.entry_beat_id} not in beats` });
    }
    for (const beat of value.beats) {
      for (const transition of beat.transitions) {
        if (!beatIds.has(transition.to_beat)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `beat ${beat.beat_id} transitions to unknown beat ${transition.to_beat}` });
        }
      }
      if (beat.inquiry_branch && !beatIds.has(beat.inquiry_branch.return_beat_id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `inquiry_branch return_beat_id ${beat.inquiry_branch.return_beat_id} not in beats` });
      }
    }
    if (value.status === "Approved" && !value.approval) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Approved requires approval block" });
    }
  });

const tutorPlanV5ResourceSchema = z
  .object({
    resource_id: resourceIdPattern,
    kind: z.enum(["explanation", "diagnostic_probe", "repair", "action_template", "workspace", "voice_seed", "support"]),
    beat_ref: beatIdPattern.optional(),
    source: z.enum(["authored", "reused", "agent_generated"]),
    content: nonEmptyString.optional(),
    solution_refs: solutionRefsV5Schema.optional(),
  })
  .strict();

const tutorPlanBundleV5Body = z
  .object({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v5"),
    artifact_id: planId,
    version: versionTag,
    status: statusEnum,
    approval: approvalBlock.optional(),
    question_ref: questionArtifactRef,
    approach_set_ref: z.object({ artifact_id: z.string().regex(/^AS-[A-Z0-9]+-[0-9]{3,}$/), version: versionTag, content_hash: sha256 }).strict(),
    solution_graph_ref: solutionGraphArtifactRef,
    policy_profile_ref: z.object({ artifact_id: policyProfileId, version: versionTag, content_hash: sha256 }).strict(),
    default_resolution_profile_id: resolutionProfileIdPattern,
    resolution_profiles: z.array(z.object({
      profile_id: resolutionProfileIdPattern,
      learner_description: nonEmptyString,
      default_view: z.enum(["chunk", "beat", "fine"]),
      available_views: z.array(z.enum(["chunk", "beat", "fine"])).min(1),
      chunk_ids: z.array(chunkIdV5Pattern).min(1),
    }).strict()).min(1),
    chunk_graph: z.object({
      entry_chunk_id: chunkIdV5Pattern,
      completion_chunk_ids: z.array(chunkIdV5Pattern).min(1),
      edges: z.array(z.object({ from_chunk_id: chunkIdV5Pattern, to_chunk_id: chunkIdV5Pattern, on: z.enum(["complete", "alternate", "needs_support"]) }).strict()),
    }).strict(),
    solution_regions: z.array(z.object({
      region_id: solutionRegionIdPattern,
      label: nonEmptyString,
      fine_refs: solutionRefsV5Schema,
      local_protocol_refs: z.array(protocolArtifactRef).optional(),
    }).strict()).min(1),
    chunks: z.array(z.object({
      chunk_id: chunkIdV5Pattern,
      part_id: partIdPattern.optional(),
      title: nonEmptyString,
      instructional_intent: nonEmptyString,
      entry_state: nonEmptyString,
      exit_understanding: nonEmptyString,
      source_subgraph_refs: solutionRefsV5Schema,
      protocol_refs: z.array(protocolArtifactRef).min(1),
      teacher_narration_refs: z.array(resourceIdPattern).min(1),
      presentation_groups: z.array(z.object({ group_id: presentationGroupIdV5Pattern, label: nonEmptyString, fine_refs: solutionRefsV5Schema }).strict()).min(1),
      expandable_region_ids: z.array(solutionRegionIdPattern),
      resource_ids: z.array(resourceIdPattern).optional(),
    }).strict()).min(1),
    resources: z.array(tutorPlanV5ResourceSchema).min(1),
    build_provenance: z.object({
      provider: nonEmptyString,
      model_id: nonEmptyString,
      workflow_version: nonEmptyString,
      run_id: nonEmptyString,
      built_at: isoDateTime,
      runtime_registry_version: nonEmptyString,
      compiler_version: nonEmptyString,
      materializer_version: nonEmptyString,
    }).strict(),
    content_hash: sha256,
    artifact_uri: z.string().regex(/^artifact:\/\/tutor-plan\/TP-[A-Z0-9]+-[0-9]{3,}@v[0-9]+$/),
  })
  .strict();

const planBundleCrossFieldRules = (
  value: Omit<z.infer<typeof tutorPlanBundleV5Body>, "schema">,
  add: (message: string) => void,
): void => {
    const chunkIds = value.chunks.map((chunk) => chunk.chunk_id);
    const chunkIdSet = new Set(chunkIds);
    const regionIds = value.solution_regions.map((region) => region.region_id);
    const regionIdSet = new Set(regionIds);
    const profileIds = value.resolution_profiles.map((profile) => profile.profile_id);
    const resourceIds = new Set(value.resources.map((resource) => resource.resource_id));
    if (chunkIdSet.size !== chunkIds.length) add("chunk_id must be unique");
    if (regionIdSet.size !== regionIds.length) add("region_id must be unique");
    if (new Set(profileIds).size !== profileIds.length) add("profile_id must be unique");
    if (!profileIds.includes(value.default_resolution_profile_id)) add("default_resolution_profile_id not in resolution_profiles");
    if (!chunkIdSet.has(value.chunk_graph.entry_chunk_id)) add("entry_chunk_id not in chunks");
    for (const id of value.chunk_graph.completion_chunk_ids) if (!chunkIdSet.has(id)) add(`completion chunk ${id} not in chunks`);
    const adjacency = new Map<string, string[]>(chunkIds.map((id) => [id, []]));
    for (const edge of value.chunk_graph.edges) {
      if (!chunkIdSet.has(edge.from_chunk_id) || !chunkIdSet.has(edge.to_chunk_id)) add("chunk graph edge references unknown chunk");
      else adjacency.get(edge.from_chunk_id)!.push(edge.to_chunk_id);
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      if ((adjacency.get(id) ?? []).some(visit)) return true;
      visiting.delete(id); visited.add(id); return false;
    };
    if (chunkIds.some(visit)) add("chunk graph must be acyclic");
    const reachable = new Set<string>();
    const walk = (id: string) => { if (reachable.has(id)) return; reachable.add(id); for (const next of adjacency.get(id) ?? []) walk(next); };
    if (chunkIdSet.has(value.chunk_graph.entry_chunk_id)) walk(value.chunk_graph.entry_chunk_id);
    for (const id of chunkIds) if (!reachable.has(id)) add(`chunk ${id} is unreachable from entry`);
    for (const profile of value.resolution_profiles) {
      if (!profile.available_views.includes(profile.default_view)) add(`profile ${profile.profile_id} default_view not available`);
      for (const id of profile.chunk_ids) if (!chunkIdSet.has(id)) add(`profile ${profile.profile_id} references unknown chunk ${id}`);
    }
    for (const chunk of value.chunks) {
      const sourceFacts = new Set(chunk.source_subgraph_refs.fact_ids);
      const sourceInferences = new Set(chunk.source_subgraph_refs.inference_ids);
      for (const group of chunk.presentation_groups) {
        if (group.fine_refs.fact_ids.some((id) => !sourceFacts.has(id)) || group.fine_refs.inference_ids.some((id) => !sourceInferences.has(id))) add(`presentation group ${group.group_id} escapes chunk ${chunk.chunk_id} source subgraph`);
      }
      for (const id of chunk.expandable_region_ids) if (!regionIdSet.has(id)) add(`chunk ${chunk.chunk_id} references unknown region ${id}`);
      for (const id of chunk.teacher_narration_refs) if (!resourceIds.has(id)) add(`chunk ${chunk.chunk_id} references unknown narration resource ${id}`);
      for (const id of chunk.resource_ids ?? []) if (!resourceIds.has(id)) add(`chunk ${chunk.chunk_id} references unknown resource ${id}`);
    }
    if (value.status === "Approved" && !value.approval) add("Approved requires approval block");
};

export const tutorPlanBundleV5Schema = tutorPlanBundleV5Body.superRefine((value, ctx) => {
  planBundleCrossFieldRules(value, (message) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message }),
  );
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

// 2026-08-31 R0 增补（事件流侧）；同日 standalone 同步波次（PRDS f3-f5-rework
// 裁定记录第 4 条）起由 tutorPolicyDecisionV1Schema 与 v5PolicyDecisionPayload
// 两处共用（严格同构）：session-local LocalInquiryProtocol（09:1288 六要素）的
// 结构化持久表达，只随 decision_kind=open_inquiry 出现。本地 id 命名空间
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
    // 2026-08-31 standalone 同步波次（PRDS f3-f5-rework 裁定记录第 4 条）：
    // 与 v5PolicyDecisionPayload.local_inquiry_protocol 严格同构（同一 const）。
    local_inquiry_protocol: v5LocalInquiryProtocol.optional(),
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
    policyDecisionCommonRules(value, (message) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message }),
    );
  });

type PolicyDecisionCommonValue = Omit<
  z.infer<typeof v5PolicyDecisionBody>,
  "schema" | "decision_kind"
> & { decision_kind: string };

const policyDecisionCommonRules = (
  value: PolicyDecisionCommonValue,
  add: (message: string) => void,
): void => {
    if (
      ["open_inquiry", "open_scaffold", "continue_inquiry", "return_to_mainline"].includes(
        value.decision_kind,
      ) &&
      !value.inquiry
    ) {
      add(`decision_kind=${value.decision_kind} requires inquiry (with return_beat_id)`);
    }
    if (["transition_beat", "revisit_beat", "return_to_mainline"].includes(value.decision_kind) &&
      !value.to_beat_id) {
      add(`decision_kind=${value.decision_kind} requires to_beat_id`);
    }
    if (value.local_inquiry_protocol) {
      if (value.decision_kind !== "open_inquiry") {
        add(`local_inquiry_protocol is only allowed with decision_kind=open_inquiry (got ${value.decision_kind})`);
      }
      if (!value.inquiry) {
        add("local_inquiry_protocol requires inquiry (with return_beat_id)");
      } else {
        if (value.inquiry.inquiry_protocol_id) {
          add("local_inquiry_protocol must not coexist with inquiry.inquiry_protocol_id (session-local protocols are not PR- artifacts)");
        }
        if (value.inquiry.return_beat_id !== value.local_inquiry_protocol.return_beat_id) {
          add(
            `local_inquiry_protocol.return_beat_id ${value.local_inquiry_protocol.return_beat_id} differs from inquiry.return_beat_id ${value.inquiry.return_beat_id}`,
          );
        }
      }
    }
};

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
    // 2026-08-29 F6 增补（PRDS contracts/schemas/runtime/v5/tutor-session-event.schema.json
    // 同步，f6-scope-ledger「合同变更」）：Gate 裁决 provider/model/prompt/version
    // 随 session pin（resume 对账依据；replay 不重新调模型）。可选加法：缺省=
    // 流不含模型 pin（R3 前旧流仍合法）；新 F6 会话由实现写入门禁强制携带
    // （先例=workspace_catalog_pin）。
    model_gate_pin: z
      .object({
        provider: nonEmptyString,
        model_id: nonEmptyString,
        prompt_version: nonEmptyString,
        adjudicator_version: nonEmptyString,
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

const v5PolicyDecisionBody = z
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
  .strict();

const v5PolicyDecisionPayload = v5PolicyDecisionBody.superRefine((value, ctx) => {
  policyDecisionCommonRules(value, (message) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message }),
  );
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

// runtime/v6（F7 合同波，ADR-011，2026-09-03）：student-input、presentation-plan
// v2（单一有序判别联合 actions[]，sequence_id 取代 plan_id）、presentation-delivery、
// presentation-outcome、tutor-session-event v6。runtime/v5、state/v1 reader 保留；
// V5 会话不迁移（SESSION_VERSION_UNSUPPORTED）。
const presentationSequenceIdPattern = z.string().regex(/^PS-[0-9]{4,}$/);
const presentationActionRefPattern = z.string().regex(/^(VA|WSA)-[A-Za-z0-9._:-]{4,}$/);
const presentationFailureClassEnum = z.enum([
  "validation_failure",
  "capability_unsupported",
  "illegal_target",
  "stale_revision",
  "truth_boundary_violation",
  "provider_failure",
  "timeout",
  "internal_error",
]);

// runtime/v6/student-input：判别联合 utterance{channel,text} | control{command}。
// 前端不提交 intent 标签（submit_answer/ask_question 等由后端解释器产生，
// 落在 tutor-session-event/v6 student_intent_recorded）。
const studentInputBody = z
  .object({
    kind: z.enum(["utterance", "control"]),
    channel: z.enum(["mainline", "assistance"]).optional(),
    text: nonEmptyString.optional(),
    command: z
      .enum([
        "confirm",
        "continue",
        "request_scaffold",
        "request_rephrase",
        "barge_in",
        "return_to_mainline",
        "retry_recovery",
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.kind === "utterance") {
      if (value.channel === undefined) add("kind=utterance requires channel");
      if (value.text === undefined) add("kind=utterance requires text");
      if (value.command !== undefined) add("kind=utterance must not carry command");
    } else {
      if (value.command === undefined) add("kind=control requires command");
      if (value.channel !== undefined) add("kind=control must not carry channel");
      if (value.text !== undefined) add("kind=control must not carry text");
    }
  });

export const studentInputV1Schema = z
  .object({
    schema: z.literal("ai_teaching_student_input/v1"),
    session_id: sessionId,
    expected_revision: z.number().int().min(0),
    client_request_id: clientRequestIdPattern,
    input: studentInputBody,
  })
  .strict();

// ordinal==数组下标（0 起连续、唯一）——镜像强制（JSON Schema draft 2020-12
// 无法表达数组索引依赖约束，PRDS schema description 写为规范文本）。
const checkPresentationOrdinals = (
  actions: readonly { ordinal: number }[],
  ctx: z.RefinementCtx,
): void => {
  actions.forEach((action, index) => {
    if (action.ordinal !== index) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `actions[${index}].ordinal must equal array index ${index} (contiguous from 0), got ${action.ordinal}`,
      });
    }
  });
};

const presentationOrderedAction = z
  .object({
    ordinal: z.number().int().min(0),
    kind: z.enum(["voice", "workspace"]),
    voice_action: presentationVoiceItem.optional(),
    workspace_action: presentationSurfaceItem.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.kind === "voice") {
      if (value.voice_action === undefined) add("kind=voice requires voice_action");
      if (value.workspace_action !== undefined) add("kind=voice must not carry workspace_action");
    } else {
      if (value.workspace_action === undefined) add("kind=workspace requires workspace_action");
      if (value.voice_action !== undefined) add("kind=workspace must not carry voice_action");
    }
  });

// runtime/v6/presentation-plan（marker v2）
export const presentationPlanV2Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_plan/v2"),
    session_id: sessionId,
    sequence_id: presentationSequenceIdPattern,
    decision_id: decisionIdPattern,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    actions: z.array(presentationOrderedAction).min(1),
  })
  .strict()
  .superRefine((value, ctx) => checkPresentationOrdinals(value.actions, ctx));

// runtime/v6/presentation-delivery：队首交付载体。workspace action 必须先经
// 服务端 validator/reducer 应用（workspace_revision 为应用回执），未应用不得交付。
const presentationDeliveredAction = z
  .object({
    kind: z.enum(["voice", "workspace"]),
    voice_action: presentationVoiceItem.optional(),
    workspace_action: presentationSurfaceItem.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.kind === "voice") {
      if (value.voice_action === undefined) add("kind=voice requires voice_action");
      if (value.workspace_action !== undefined) add("kind=voice must not carry workspace_action");
    } else {
      if (value.workspace_action === undefined) add("kind=workspace requires workspace_action");
      if (value.voice_action !== undefined) add("kind=workspace must not carry voice_action");
    }
  });

export const presentationDeliveryV1Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_delivery/v1"),
    session_id: sessionId,
    sequence_id: presentationSequenceIdPattern,
    ordinal: z.number().int().min(0),
    action_id: presentationActionRefPattern,
    action: presentationDeliveredAction,
    session_revision: z.number().int().min(0),
    workspace_revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.action.kind === "workspace" && value.workspace_revision === undefined) {
      add("kind=workspace delivery requires workspace_revision (server-applied receipt)");
    }
    if (value.action.kind === "voice" && value.workspace_revision !== undefined) {
      add("kind=voice delivery must not carry workspace_revision");
    }
    const nestedActionId =
      value.action.kind === "voice"
        ? value.action.voice_action?.action_id
        : value.action.workspace_action?.action_id;
    if (nestedActionId !== undefined && value.action_id !== nestedActionId) {
      add("delivery action_id must equal the nested action action_id");
    }
  });

// runtime/v6/presentation-outcome：浏览器真实执行结果。presented 只表示物理呈现
// 完成，不创造权威语义状态；failed 停留当前 action（恢复经 control.retry_recovery）。
export const presentationOutcomeV1Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_outcome/v1"),
    session_id: sessionId,
    sequence_id: presentationSequenceIdPattern,
    ordinal: z.number().int().min(0),
    action_id: presentationActionRefPattern,
    outcome: z.enum(["presented", "interrupted", "failed"]),
    failure_class: presentationFailureClassEnum.optional(),
    message: z.string().optional(),
    expected_revision: z.number().int().min(0),
    client_request_id: clientRequestIdPattern,
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.outcome === "failed" && value.failure_class === undefined) {
      add("outcome=failed requires failure_class");
    }
    if (value.outcome !== "failed" && value.failure_class !== undefined) {
      add(`outcome=${value.outcome} must not carry failure_class`);
    }
    if (value.outcome !== "failed" && value.message !== undefined) {
      add(`outcome=${value.outcome} must not carry message`);
    }
  });

// runtime/v6/tutor-session-event（marker v6）：presentation 家族 + student_input_recorded；
// action_outcome_recorded 收窄为仅 student_command；移除 voice_action_issued/
// workspace_surface_action_issued/presentation_failed。保留分支复用 v5 payload
// 镜像（PRDS schema 中逐字节同 v5）。
const v6StudentInputRecordedPayload = z
  .object({
    input: studentInputBody,
    client_request_id: clientRequestIdPattern,
  })
  .strict();

const v6PresentationSequencePlannedPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    decision_id: decisionIdPattern,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    actions: z.array(presentationOrderedAction).min(1),
  })
  .strict()
  .superRefine((value, ctx) => checkPresentationOrdinals(value.actions, ctx));

const v6PresentationActionRefPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    ordinal: z.number().int().min(0),
    action_id: presentationActionRefPattern,
    kind: z.enum(["voice", "workspace"]),
  })
  .strict();

const v6PresentationActionAppliedPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    ordinal: z.number().int().min(0),
    action_id: presentationActionRefPattern,
    kind: z.enum(["voice", "workspace"]),
    resulting_workspace_revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.kind === "workspace" && value.resulting_workspace_revision === undefined) {
      add("kind=workspace requires resulting_workspace_revision");
    }
    if (value.kind === "voice" && value.resulting_workspace_revision !== undefined) {
      add("kind=voice must not carry resulting_workspace_revision");
    }
  });

const v6PresentationOutcomeRecordedPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    ordinal: z.number().int().min(0),
    action_id: presentationActionRefPattern,
    kind: z.enum(["voice", "workspace"]),
    outcome: z.enum(["presented", "interrupted", "failed"]),
    failure_class: presentationFailureClassEnum.optional(),
    message: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.outcome === "failed" && value.failure_class === undefined) {
      add("outcome=failed requires failure_class");
    }
    if (value.outcome !== "failed" && value.failure_class !== undefined) {
      add(`outcome=${value.outcome} must not carry failure_class`);
    }
    if (value.outcome !== "failed" && value.message !== undefined) {
      add(`outcome=${value.outcome} must not carry message`);
    }
  });

const v6PresentationSequenceSupersededPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    reason: z.enum(["interrupted", "retry_recovery", "superseded_by_decision"]),
    pending_ordinal: z.number().int().min(0).optional(),
    pending_action_id: presentationActionRefPattern.optional(),
  })
  .strict();

// v6 收窄：action_kind 仅 student_command（学生命令回执链，R0 §5 语义保留）。
const v6ActionOutcomePayload = z
  .object({
    action_id: nonEmptyString,
    action_kind: z.literal("student_command"),
    outcome: z.enum(["completed", "rejected", "interrupted", "failed"]),
    failure_class: presentationFailureClassEnum.optional(),
    message: z.string().optional(),
    resulting_revision: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "failed" && value.failure_class === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "outcome=failed requires failure_class" });
    }
    if (value.outcome !== "failed" && value.failure_class !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `outcome=${value.outcome} must not carry failure_class`,
      });
    }
  });

const v6EventPayloadSchemas = {
  session_started: v5SessionStartedPayload,
  student_input_recorded: v6StudentInputRecordedPayload,
  student_intent_recorded: v5StudentIntentRecordedPayload,
  semantic_interpretation_recorded: v5SemanticInterpretationPayload,
  policy_decision_made: v5PolicyDecisionPayload,
  gate_evaluated: v5GateEvaluatedPayload,
  presentation_sequence_planned: v6PresentationSequencePlannedPayload,
  presentation_action_validated: v6PresentationActionRefPayload,
  presentation_action_applied: v6PresentationActionAppliedPayload,
  presentation_action_delivered: v6PresentationActionRefPayload,
  presentation_action_outcome_recorded: v6PresentationOutcomeRecordedPayload,
  presentation_sequence_superseded: v6PresentationSequenceSupersededPayload,
  action_outcome_recorded: v6ActionOutcomePayload,
  external_support_recorded: v5ExternalSupportPayload,
  inquiry_opened: v5InquiryPayload,
  inquiry_returned: v5InquiryPayload,
  student_progressed: v5StudentProgressedPayload,
  policy_failed: v5PolicyFailedPayload,
  runtime_failure: v5RuntimeFailurePayload,
  session_completed: v5SessionCompletedPayload,
} as const;

const V6_CAUSATION_REQUIRED = new Set([
  "student_intent_recorded",
  "semantic_interpretation_recorded",
  "policy_decision_made",
  "gate_evaluated",
  "presentation_sequence_planned",
  "presentation_action_validated",
  "presentation_action_applied",
  "presentation_action_delivered",
  "presentation_action_outcome_recorded",
  "presentation_sequence_superseded",
  "action_outcome_recorded",
  "external_support_recorded",
  "inquiry_opened",
  "inquiry_returned",
  "student_progressed",
  "policy_failed",
]);

export const tutorSessionEventV6Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v6"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "student_input_recorded",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "presentation_sequence_planned",
      "presentation_action_validated",
      "presentation_action_applied",
      "presentation_action_delivered",
      "presentation_action_outcome_recorded",
      "presentation_sequence_superseded",
      "action_outcome_recorded",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
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
    const payloadSchema = v6EventPayloadSchemas[value.event_type as keyof typeof v6EventPayloadSchemas];
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
    if (V6_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

// runtime/v7/tutor-session-event（marker v7，F7 Step 4 合同波，两轮独立复核后定稿）：
// v6 的后继 major，恢复 ADR-011 §6 的两条输入因果链并显式记录会话模式——
// (1) 新增 student_workspace_command_recorded（学生来源的权威 WorkspaceCommand 事实，
//     accepted action-evidence 下为服务端确定性派生；source 判别 direct|accepted_action_evidence）；
// (2) student_intent_recorded 移除 submit_workspace_command（intent 只表示语义解释产物，
//     intent→input causation 门禁对剩余 kind 全量可达，门禁本身不动）；
// (3) session_started 增必填 session_mode（teaching|assessment，resume 与 catalog pin 双重对账）。
// 独立 marker/reader：按行 event_schema 分派，V6 reader 原样保留；不以 v7 校验 v6 envelope，
// 不做 v6→v7 迁移。student-input/v1 与 student-workspace-command/v1 原样复用（不新增输入 schema）。
const v7StudentWorkspaceCommandRecordedPayload = z
  .object({
    command_id: studentCommandIdPattern,
    surface: z.enum(["geometry", "solution_board"]),
    capability: nonEmptyString,
    origin: z.literal("student"),
    target_ids: z.array(nonEmptyString),
    params: z.record(z.unknown()).optional(),
    expected_workspace_revision: z.number().int().min(0),
    client_request_id: clientRequestIdPattern,
    source: z.enum(["direct", "accepted_action_evidence"]).optional(),
    evidence_action_id: nonEmptyString.optional(),
    input_evidence_sequence: z.number().int().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.source === "accepted_action_evidence" && value.evidence_action_id === undefined) {
      add("source=accepted_action_evidence requires evidence_action_id");
    }
    if (value.source !== "accepted_action_evidence" && value.evidence_action_id !== undefined) {
      add("only source=accepted_action_evidence may carry evidence_action_id");
    }
  });

// v7 session_started：v5 全字段 + 必填 session_mode（teaching|assessment）。
const v7SessionStartedPayload = v5SessionStartedPayload.extend({
  session_mode: z.enum(["teaching", "assessment"]),
});

// v7 student_intent_recorded：v5 收窄——移除 submit_workspace_command 与内嵌 workspace_command。
const v7StudentIntentRecordedPayload = z
  .object({
    intent_kind: z.enum([
      "submit_answer",
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
  })
  .strict();

const v7EventPayloadSchemas = {
  ...v6EventPayloadSchemas,
  session_started: v7SessionStartedPayload,
  student_workspace_command_recorded: v7StudentWorkspaceCommandRecordedPayload,
  student_intent_recorded: v7StudentIntentRecordedPayload,
} as const;

export const tutorSessionEventV7Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v7"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "student_input_recorded",
      "student_workspace_command_recorded",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "presentation_sequence_planned",
      "presentation_action_validated",
      "presentation_action_applied",
      "presentation_action_delivered",
      "presentation_action_outcome_recorded",
      "presentation_sequence_superseded",
      "action_outcome_recorded",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
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
    const payloadSchema = v7EventPayloadSchemas[value.event_type as keyof typeof v7EventPayloadSchemas];
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
    if (V6_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
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

// state/v2/tutor-runtime-state（F7 ADR-011：v1 全字段逐字段保留 + presentation
// cursor 三态。cursor 只以浏览器 outcome 推进；failed 停留当前 action，恢复经
// control.retry_recovery 创建新 sequence。workspace-runtime-state 无 cursor，留在 state/v1。）
const presentationCursorV2 = z.union([
  z.object({ status: z.literal("idle") }).strict(),
  z
    .object({
      status: z.literal("awaiting_browser"),
      sequence_id: presentationSequenceIdPattern,
      ordinal: z.number().int().min(0),
      action_id: presentationActionRefPattern,
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      sequence_id: presentationSequenceIdPattern,
      ordinal: z.number().int().min(0),
      action_id: presentationActionRefPattern,
    })
    .strict(),
]);

export const tutorRuntimeStateV2Schema = tutorRuntimeStateV1Schema
  .omit({ schema: true })
  .extend({
    schema: z.literal("ai_teaching_tutor_runtime_state/v2"),
    presentation_cursor: presentationCursorV2,
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

// ============================================================================
// F7 RT0 集中合同波（2026-09-07，f7-rt0-baseline-freeze 清单 2，9 份新 schema）
// planning/v6 bundle、state/v3、runtime/v8 event、decision/v2、plan/v3、
// generation/v1 draft+tool-spec、state/v2 workspace、view/v2。
// 跨字段规则与 Python model_validator 逐条一致（191 fixtures 双语言判定一致是门禁）。
// ============================================================================

const refinementUnitIdPattern = z.string().regex(/^RU-[0-9]{1,3}$/);
const refinementCheckpointIdPattern = z.string().regex(/^CP-[0-9]{1,3}$/);
const resourceBindingIdPattern = z.string().regex(/^VB-[0-9]{1,3}$/);
const resolutionFrameIdPattern = z.string().regex(/^RF-[A-Za-z0-9._:-]{4,}$/);
const generationRequestIdPattern = z.string().regex(/^GR-[A-Za-z0-9._:-]{4,}$/);
const explanationFragmentIdPattern = z.string().regex(/^EF-[A-Za-z0-9._:-]{4,}$/);

// planning/v6/tutor-plan-bundle（marker v6）：v5 + refinement_spec + resource_bindings。
const refinementUnitSchema = z
  .object({
    unit_id: refinementUnitIdPattern,
    fine_refs: solutionRefsV5Schema,
    prerequisite_refs: z.array(refinementUnitIdPattern),
    child_unit_ids: z.array(refinementUnitIdPattern),
    explanation_resource_refs: z.array(resourceIdPattern),
    visual_binding_refs: z.array(resourceBindingIdPattern),
    checkpoint_ref: refinementCheckpointIdPattern,
  })
  .strict();

const refinementCheckpointSchema = z
  .object({
    checkpoint_id: refinementCheckpointIdPattern,
    evidence_kind: z.enum([
      "student_answer",
      "workspace_command",
      "student_confirmation",
      "semantic_gate_pass",
      "tutor_observed",
    ]),
    requirement: nonEmptyString,
    gate: z
      .object({
        gate_id: gateIdPattern,
        capability: nonEmptyString.optional(),
        graph_fact_id: z.string().regex(/^FN-[0-9]{1,3}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const resourceBindingSchema = z
  .object({
    binding_id: resourceBindingIdPattern,
    binding_kind: z.enum(["geometry", "board", "explanation"]),
    purpose: nonEmptyString,
    geometry_target: nonEmptyString.optional(),
    semantic_role: nonEmptyString.optional(),
    allowed_template_ids: z.array(nonEmptyString).min(1).optional(),
    board_entry_id: z.string().regex(/^BE-[0-9]{1,3}$/).optional(),
    reveal_after_checkpoint: refinementCheckpointIdPattern.optional(),
    basis_refs: solutionRefsV5Schema.optional(),
    presentation_resource: resourceIdPattern.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.binding_kind === "geometry") {
      if (value.geometry_target === undefined) add("binding_kind=geometry requires geometry_target");
      if (value.semantic_role === undefined) add("binding_kind=geometry requires semantic_role");
      if (value.allowed_template_ids === undefined) add("binding_kind=geometry requires allowed_template_ids");
    } else {
      if (value.geometry_target !== undefined) add(`binding_kind=${value.binding_kind} must not carry geometry_target`);
      if (value.semantic_role !== undefined) add(`binding_kind=${value.binding_kind} must not carry semantic_role`);
      if (value.allowed_template_ids !== undefined) add(`binding_kind=${value.binding_kind} must not carry allowed_template_ids`);
    }
    if (value.binding_kind === "board") {
      if (value.board_entry_id === undefined) add("binding_kind=board requires board_entry_id");
      if (value.reveal_after_checkpoint === undefined) add("binding_kind=board requires reveal_after_checkpoint");
    } else {
      if (value.board_entry_id !== undefined) add(`binding_kind=${value.binding_kind} must not carry board_entry_id`);
      if (value.reveal_after_checkpoint !== undefined) add(`binding_kind=${value.binding_kind} must not carry reveal_after_checkpoint`);
    }
    if (value.binding_kind === "explanation") {
      if (value.basis_refs === undefined) add("binding_kind=explanation requires basis_refs");
      if (value.presentation_resource === undefined) add("binding_kind=explanation requires presentation_resource");
    } else {
      if (value.basis_refs !== undefined) add(`binding_kind=${value.binding_kind} must not carry basis_refs`);
      if (value.presentation_resource !== undefined) add(`binding_kind=${value.binding_kind} must not carry presentation_resource`);
    }
  });

export const tutorPlanBundleV6Schema = tutorPlanBundleV5Body
  .omit({ schema: true })
  .extend({
    schema: z.literal("ai_teaching_tutor_plan_bundle/v6"),
    refinement_spec: z
      .object({
        units: z.array(refinementUnitSchema).min(1),
        defaults_by_chunk: z
          .array(
            z
              .object({
                chunk_id: chunkIdV5Pattern,
                frontier_unit_ids: z.array(refinementUnitIdPattern).min(1),
              })
              .strict(),
          )
          .min(1),
        region_bindings: z
          .array(
            z
              .object({
                region_id: solutionRegionIdPattern,
                root_unit_ids: z.array(refinementUnitIdPattern).min(1),
              })
              .strict(),
          )
          .min(1),
        checkpoints: z.array(refinementCheckpointSchema).min(1),
      })
      .strict(),
    resource_bindings: z.array(resourceBindingSchema).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    planBundleCrossFieldRules(value, add);
    const unitIds = value.refinement_spec.units.map((unit) => unit.unit_id);
    const unitIdSet = new Set(unitIds);
    const unitById = new Map(value.refinement_spec.units.map((unit) => [unit.unit_id, unit]));
    const checkpointIds = new Set(value.refinement_spec.checkpoints.map((cp) => cp.checkpoint_id));
    const bindingIds = new Set(value.resource_bindings.map((b) => b.binding_id));
    const resourceIds = new Set(value.resources.map((r) => r.resource_id));
    const chunkIds = new Set(value.chunks.map((chunk) => chunk.chunk_id));
    const regionIds = new Set(value.solution_regions.map((region) => region.region_id));
    if (unitIdSet.size !== unitIds.length) add("unit_id must be unique");
    if (checkpointIds.size !== value.refinement_spec.checkpoints.length) add("checkpoint_id must be unique");
    if (bindingIds.size !== value.resource_bindings.length) add("binding_id must be unique");
    const defaultChunkIds = value.refinement_spec.defaults_by_chunk.map((d) => d.chunk_id);
    if (new Set(defaultChunkIds).size !== defaultChunkIds.length) add("defaults_by_chunk chunk_id must be unique");
    for (const unit of value.refinement_spec.units) {
      for (const child of unit.child_unit_ids) if (!unitIdSet.has(child)) add(`unit ${unit.unit_id} references unknown child ${child}`);
      for (const prereq of unit.prerequisite_refs) if (!unitIdSet.has(prereq)) add(`unit ${unit.unit_id} references unknown prerequisite ${prereq}`);
      if (!checkpointIds.has(unit.checkpoint_ref)) add(`unit ${unit.unit_id} references unknown checkpoint ${unit.checkpoint_ref}`);
      for (const res of unit.explanation_resource_refs) if (!resourceIds.has(res)) add(`unit ${unit.unit_id} references unknown resource ${res}`);
      for (const vb of unit.visual_binding_refs) if (!bindingIds.has(vb)) add(`unit ${unit.unit_id} references unknown binding ${vb}`);
    }
    // 无环（child_unit_ids 边）
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const unit = unitById.get(id);
      const cyclic = unit ? unit.child_unit_ids.some(visit) : false;
      visiting.delete(id);
      visited.add(id);
      return cyclic;
    };
    if (unitIds.some(visit)) add("refinement unit graph must be acyclic");
    // 子单位核心 refs ⊆ 父单位 fine_refs
    for (const unit of value.refinement_spec.units) {
      for (const childId of unit.child_unit_ids) {
        const child = unitById.get(childId);
        if (!child) continue;
        const parentFacts = new Set(unit.fine_refs.fact_ids);
        const parentInferences = new Set(unit.fine_refs.inference_ids);
        if (child.fine_refs.fact_ids.some((id) => !parentFacts.has(id))) add(`child ${childId} core fact escapes parent ${unit.unit_id}`);
        if (child.fine_refs.inference_ids.some((id) => !parentInferences.has(id))) add(`child ${childId} core inference escapes parent ${unit.unit_id}`);
      }
    }
    for (const entry of value.refinement_spec.defaults_by_chunk) {
      if (!chunkIds.has(entry.chunk_id)) add(`defaults_by_chunk references unknown chunk ${entry.chunk_id}`);
      for (const unitId of entry.frontier_unit_ids) if (!unitIdSet.has(unitId)) add(`defaults_by_chunk ${entry.chunk_id} references unknown unit ${unitId}`);
    }
    // 每个 chunk 有默认 frontier 且覆盖其 source subgraph
    const defaultsByChunk = new Map(value.refinement_spec.defaults_by_chunk.map((d) => [d.chunk_id, d]));
    for (const chunk of value.chunks) {
      const entry = defaultsByChunk.get(chunk.chunk_id);
      if (!entry) {
        add(`chunk ${chunk.chunk_id} has no default frontier`);
        continue;
      }
      const coveredFacts = new Set<string>();
      const coveredInferences = new Set<string>();
      for (const unitId of entry.frontier_unit_ids) {
        const unit = unitById.get(unitId);
        if (!unit) continue;
        unit.fine_refs.fact_ids.forEach((id) => coveredFacts.add(id));
        unit.fine_refs.inference_ids.forEach((id) => coveredInferences.add(id));
      }
      if (chunk.source_subgraph_refs.fact_ids.some((id) => !coveredFacts.has(id))) add(`default frontier of chunk ${chunk.chunk_id} loses facts`);
      if (chunk.source_subgraph_refs.inference_ids.some((id) => !coveredInferences.has(id))) add(`default frontier of chunk ${chunk.chunk_id} loses inferences`);
    }
    for (const regionBinding of value.refinement_spec.region_bindings) {
      if (!regionIds.has(regionBinding.region_id)) add(`region_bindings references unknown region ${regionBinding.region_id}`);
      for (const unitId of regionBinding.root_unit_ids) if (!unitIdSet.has(unitId)) add(`region_bindings ${regionBinding.region_id} references unknown unit ${unitId}`);
    }
    for (const binding of value.resource_bindings) {
      if (binding.binding_kind === "board" && !checkpointIds.has(binding.reveal_after_checkpoint!)) {
        add(`board binding ${binding.binding_id} references unknown checkpoint ${binding.reveal_after_checkpoint}`);
      }
      if (binding.binding_kind === "explanation" && !resourceIds.has(binding.presentation_resource!)) {
        add(`explanation binding ${binding.binding_id} references unknown resource ${binding.presentation_resource}`);
      }
    }
  });

// TeachingScopeRef（state/v3、runtime/v8、plan/v3 共用形状）
const teachingScopeRefSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("approved"),
      protocol_id: teachingProtocolId,
      beat_id: beatIdPattern,
    })
    .strict(),
  z
    .object({
      kind: z.literal("local"),
      inquiry_id: inquiryIdPattern,
      local_protocol_id: z.string().regex(/^LPR-[A-Za-z0-9._:-]{4,}$/),
      local_beat_id: z.string().regex(/^LBT-[0-9]{1,3}$/),
      anchor: z.object({ protocol_id: teachingProtocolId, beat_id: beatIdPattern }).strict(),
    })
    .strict(),
]);

// state/v3/tutor-runtime-state（marker v3）：v2 + resolution_frames + generation_slot + presenter pin。
const presenterGenerationPinSchema = z
  .object({
    provider: nonEmptyString,
    model_id: nonEmptyString,
    prompt_version: nonEmptyString,
    context_builder_version: nonEmptyString,
    tool_catalog_version: nonEmptyString,
  })
  .strict();

const resolutionFrameSchema = z
  .object({
    frame_id: resolutionFrameIdPattern,
    scope: teachingScopeRefSchema,
    region_id: solutionRegionIdPattern,
    frontier_unit_ids: z.array(refinementUnitIdPattern).min(1),
    focused_unit_id: refinementUnitIdPattern,
    evidence_refs: z.array(z.number().int().min(1)).min(1),
    return_target: z
      .object({
        scope: teachingScopeRefSchema,
        frame_id: resolutionFrameIdPattern.optional(),
      })
      .strict(),
  })
  .strict();

const generationErrorClassEnum = z.enum([
  "provider_failure",
  "timeout",
  "draft_invalid",
  "preflight_failed",
  "context_irreproducible",
  "internal_error",
]);

const generationSlotSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("idle") }).strict(),
  z
    .object({
      status: z.literal("pending"),
      request_id: generationRequestIdPattern,
      decision_id: decisionIdPattern,
      scope: teachingScopeRefSchema,
      reservation_revision: z.number().int().min(0),
      epoch: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      status: z.literal("failed"),
      request_id: generationRequestIdPattern,
      error_class: generationErrorClassEnum,
    })
    .strict(),
]);

export const tutorRuntimeStateV3Schema = tutorRuntimeStateV2Schema
  .omit({ schema: true })
  .extend({
    schema: z.literal("ai_teaching_tutor_runtime_state/v3"),
    pinned_plan: z
      .object({
        tutor_plan_ref: planArtifactRefV4,
        solution_graph_ref: solutionGraphArtifactRef,
        protocol_refs: z.array(protocolArtifactRef).min(1),
        policy_profile_snapshot: tutorRuntimeStateV1Schema.shape.pinned_plan.shape.policy_profile_snapshot,
        presenter_generation_pin: presenterGenerationPinSchema.optional(),
      })
      .strict(),
    resolution_frames: z.array(resolutionFrameSchema),
    generation_slot: generationSlotSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const frameIds = value.resolution_frames.map((frame) => frame.frame_id);
    if (new Set(frameIds).size !== frameIds.length) add("frame_id must be unique within stack");
    const seen = new Set<string>();
    for (const frame of value.resolution_frames) {
      for (const ref of frame.return_target.frame_id ? [frame.return_target.frame_id] : []) {
        if (!seen.has(ref)) add(`return_target frame ${ref} not below current frame ${frame.frame_id}`);
      }
      seen.add(frame.frame_id);
    }
  });

// runtime/v6/tutor-policy-decision（marker v2）：v1 + refine/collapse_resolution + resolution。
const resolutionDecisionSchema = z
  .object({
    frame_id: resolutionFrameIdPattern,
    region_id: solutionRegionIdPattern,
    action: z.enum(["expand", "collapse", "return"]),
    unit_id: refinementUnitIdPattern.optional(),
    new_frontier_unit_ids: z.array(refinementUnitIdPattern).min(1).optional(),
    evidence_sequence: z.number().int().min(1).optional(),
    reason: nonEmptyString,
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.action === "expand" && value.unit_id === undefined) add("action=expand requires unit_id");
    if (value.action !== "expand" && value.unit_id !== undefined) add(`action=${value.action} must not carry unit_id`);
  });

export const tutorPolicyDecisionV2Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_policy_decision/v2"),
    session_id: sessionId,
    decision_id: decisionIdPattern,
    policy_version: nonEmptyString,
    protocol_id: teachingProtocolId,
    beat_id: beatIdPattern,
    decision_kind: z.enum([
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
      "refine_resolution",
      "collapse_resolution",
    ]),
    to_beat_id: beatIdPattern.optional(),
    transition_basis: v5PolicyDecisionBody.shape.transition_basis,
    inquiry: inquiryBlock.optional(),
    local_inquiry_protocol: v5LocalInquiryProtocol.optional(),
    resolution: resolutionDecisionSchema.optional(),
    interpretation_summary: z.string().optional(),
    source_event_sequence: z.number().int().min(1),
    source_state_revision: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    policyDecisionCommonRules(value, add);
    if (["refine_resolution", "collapse_resolution"].includes(value.decision_kind) && !value.resolution) {
      add(`decision_kind=${value.decision_kind} requires resolution`);
    }
    if (value.resolution && !["refine_resolution", "collapse_resolution"].includes(value.decision_kind)) {
      add(`resolution is only allowed with refine_resolution/collapse_resolution (got ${value.decision_kind})`);
    }
    if (value.decision_kind === "refine_resolution" && value.resolution) {
      if (value.resolution.action !== "expand") add("refine_resolution requires resolution.action=expand");
      if (value.resolution.new_frontier_unit_ids === undefined) add("refine_resolution requires resolution.new_frontier_unit_ids");
    }
  });

// runtime/v7/presentation-plan（marker v3）：TeachingScopeRef + generation provenance + basis_refs。
const presentationOrderedActionV3 = z
  .object({
    ordinal: z.number().int().min(0),
    kind: z.enum(["voice", "workspace"]),
    basis_refs: z.array(nonEmptyString).optional(),
    voice_action: presentationVoiceItem.optional(),
    workspace_action: presentationSurfaceItem.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (value.kind === "voice") {
      if (value.voice_action === undefined) add("kind=voice requires voice_action");
      if (value.workspace_action !== undefined) add("kind=voice must not carry workspace_action");
    } else {
      if (value.workspace_action === undefined) add("kind=workspace requires workspace_action");
      if (value.voice_action !== undefined) add("kind=workspace must not carry voice_action");
    }
  });

const planGenerationProvenanceSchema = z
  .object({
    request_id: generationRequestIdPattern,
    attempt: z.number().int().min(1),
    input_digest: sha256,
    presenter_pin: presenterGenerationPinSchema.optional(),
  })
  .strict();

export const presentationPlanV3Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_plan/v3"),
    session_id: sessionId,
    sequence_id: presentationSequenceIdPattern,
    decision_id: decisionIdPattern,
    scope: teachingScopeRefSchema,
    generation: planGenerationProvenanceSchema.optional(),
    resolution_frame_id: resolutionFrameIdPattern.optional(),
    actions: z.array(presentationOrderedActionV3).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    checkPresentationOrdinals(value.actions, ctx);
    const modelGenerated = value.actions.some((action) => action.voice_action?.source === "model-generated");
    if (modelGenerated && value.generation === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sequences containing model-generated voice actions require generation provenance",
      });
    }
  });

// generation/v1/presentation-draft（不可信模型输出）
export const presentationDraftV1Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_draft/v1"),
    request_id: generationRequestIdPattern,
    items: z
      .array(
        z
          .object({
            type: z.enum(["speech", "tool_intent"]),
            text: nonEmptyString.optional(),
            basis_refs: z.array(nonEmptyString).optional(),
            tool: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/).optional(),
            args: z
              .object({
                binding_ref: resourceBindingIdPattern,
                params: z.record(z.unknown()).optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .superRefine((value, ctx) => {
            const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
            if (value.type === "speech") {
              if (value.text === undefined) add("type=speech requires text");
              if (value.tool !== undefined) add("type=speech must not carry tool");
              if (value.args !== undefined) add("type=speech must not carry args");
            } else {
              if (value.text !== undefined) add("type=tool_intent must not carry text");
              if (value.tool === undefined) add("type=tool_intent requires tool");
              if (value.args === undefined) add("type=tool_intent requires args");
            }
          }),
      )
      .min(1),
  })
  .strict();

// generation/v1/presentation-tool-spec（公开工具目录条目）
export const presentationToolSpecV1Schema = z
  .object({
    schema: z.literal("ai_teaching_presentation_tool_spec/v1"),
    tool_id: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/),
    version: versionTag,
    description: nonEmptyString,
    capability: nonEmptyString,
    surface: z.enum(["geometry", "solution_board"]),
    effect_class: z.enum(["construct", "highlight", "annotate", "explain_fragment", "reveal"]),
    reveal_scope_ceiling: z.enum(["none", "target_highlight", "step_narration", "intermediate_result", "final_result"]),
    requires_binding: z.boolean(),
    teaching_mode_only: z.boolean().optional(),
    parameters: z.array(
      z
        .object({
          name: z.string().regex(/^[a-z][a-z0-9_]*$/),
          value_type: z.enum(["string", "number", "boolean", "enum"]),
          required: z.boolean(),
          allowed_values: z.array(nonEmptyString).min(1).optional(),
          description: z.string().optional(),
        })
        .strict()
        .superRefine((value, ctx) => {
          if (value.value_type === "enum" && value.allowed_values === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "value_type=enum requires allowed_values" });
          }
          if (value.value_type !== "enum" && value.allowed_values !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: `value_type=${value.value_type} must not carry allowed_values` });
          }
        }),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.effect_class === "reveal" && value.reveal_scope_ceiling === "none") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "effect_class=reveal requires reveal_scope_ceiling above none" });
    }
  });

// state/v2/workspace-runtime-state（marker v2）：v1 + explanation_fragments。
const explanationFragmentStateSchema = z
  .object({
    fragment_id: explanationFragmentIdPattern,
    kind: z.enum(["approved_math_note", "relation_note", "explanation_text"]),
    content: nonEmptyString,
    basis_refs: z.array(nonEmptyString).min(1),
    origin_generation: generationRequestIdPattern.optional(),
    attach_to_entry: z.string().regex(/^BE-[0-9]{1,3}$/).optional(),
    visible: z.boolean(),
  })
  .strict();

export const workspaceRuntimeStateV2Schema = workspaceRuntimeStateV1Schema
  .omit({ schema: true })
  .extend({
    schema: z.literal("ai_teaching_workspace_runtime_state/v2"),
    solution_board: workspaceRuntimeStateV1Schema.shape.solution_board.extend({
      explanation_fragments: z.array(explanationFragmentStateSchema).optional(),
    }),
  })
  .strict();

// view/v2/student-workspace-view（marker v2）：v1 + fragments（student-safe 投影）。
export const studentWorkspaceViewV2Schema = studentWorkspaceViewV1Schema
  .omit({ schema: true })
  .extend({
    schema: z.literal("ai_teaching_student_workspace_view/v2"),
    solution_board: studentWorkspaceViewV1Schema.shape.solution_board.extend({
      fragments: z
        .array(
          z
            .object({
              fragment_id: explanationFragmentIdPattern,
              kind: z.enum(["approved_math_note", "relation_note", "explanation_text"]),
              content: nonEmptyString,
              basis_refs: z.array(nonEmptyString).min(1),
              attach_to_entry: z.string().regex(/^BE-[0-9]{1,3}$/).optional(),
            })
            .strict(),
        )
        .optional(),
    }),
  })
  .strict();

// runtime/v8/tutor-session-event（marker v8）：生成事件族 + resolution_frame_changed +
// planned 升版（scope/generation）+ decision v2 payload + session_started presenter pin。
const v8PolicyDecisionPayload = v5PolicyDecisionBody
  .extend({
    decision_kind: z.enum([
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
      "refine_resolution",
      "collapse_resolution",
    ]),
    resolution: resolutionDecisionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    policyDecisionCommonRules(value, add);
    if (["refine_resolution", "collapse_resolution"].includes(value.decision_kind) && !value.resolution) {
      add(`decision_kind=${value.decision_kind} requires resolution`);
    }
    if (value.resolution && !["refine_resolution", "collapse_resolution"].includes(value.decision_kind)) {
      add(`resolution is only allowed with refine_resolution/collapse_resolution (got ${value.decision_kind})`);
    }
    if (value.decision_kind === "refine_resolution" && value.resolution) {
      if (value.resolution.action !== "expand") add("refine_resolution requires resolution.action=expand");
      if (value.resolution.new_frontier_unit_ids === undefined) add("refine_resolution requires resolution.new_frontier_unit_ids");
    }
  });

const v8SequencePlannedPayload = z
  .object({
    sequence_id: presentationSequenceIdPattern,
    decision_id: decisionIdPattern,
    scope: teachingScopeRefSchema,
    generation: planGenerationProvenanceSchema.optional(),
    resolution_frame_id: resolutionFrameIdPattern.optional(),
    actions: z.array(presentationOrderedActionV3).min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    checkPresentationOrdinals(value.actions, ctx);
    const modelGenerated = value.actions.some((action) => action.voice_action?.source === "model-generated");
    if (modelGenerated && value.generation === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "sequences containing model-generated voice actions require generation provenance" });
    }
  });

const v8GenerationRequestedPayload = z
  .object({
    request_id: generationRequestIdPattern,
    decision_id: decisionIdPattern,
    scope: teachingScopeRefSchema,
    input_digest: sha256,
    epoch: z.number().int().min(1),
    reservation_revision: z.number().int().min(0).optional(),
    presenter_pin: presenterGenerationPinSchema.optional(),
  })
  .strict();

const v8GenerationInvalidatedPayload = z
  .object({
    request_id: generationRequestIdPattern,
    epoch: z.number().int().min(1),
    reason: z.enum(["cancelled", "superseded_by_new_input", "revision_changed", "session_closing"]),
  })
  .strict();

const v8GenerationFailedPayload = z
  .object({
    request_id: generationRequestIdPattern,
    error_class: generationErrorClassEnum,
    message: z.string().optional(),
  })
  .strict();

const v8ResolutionFrameChangedPayload = z
  .object({
    change: z.enum(["pushed", "frontier_replaced", "popped"]),
    frame: resolutionFrameSchema,
    decision_id: decisionIdPattern.optional(),
  })
  .strict();

const v8SessionStartedPayload = v7SessionStartedPayload.extend({
  presenter_generation_pin: presenterGenerationPinSchema.optional(),
});

const v8EventPayloadSchemas = {
  ...v7EventPayloadSchemas,
  session_started: v8SessionStartedPayload,
  policy_decision_made: v8PolicyDecisionPayload,
  presentation_sequence_planned: v8SequencePlannedPayload,
  presentation_generation_requested: v8GenerationRequestedPayload,
  presentation_generation_invalidated: v8GenerationInvalidatedPayload,
  presentation_generation_failed: v8GenerationFailedPayload,
  resolution_frame_changed: v8ResolutionFrameChangedPayload,
} as const;

const V8_CAUSATION_REQUIRED = new Set([
  ...V6_CAUSATION_REQUIRED,
  "presentation_generation_requested",
  "presentation_generation_invalidated",
  "presentation_generation_failed",
  "resolution_frame_changed",
]);

export const tutorSessionEventV8Schema = z
  .object({
    schema: z.literal("ai_teaching_tutor_session_event/v8"),
    session_id: sessionId,
    sequence: z.number().int().min(1),
    state_revision: z.number().int().min(0),
    occurred_at: isoDateTime,
    event_type: z.enum([
      "session_started",
      "student_input_recorded",
      "student_workspace_command_recorded",
      "student_intent_recorded",
      "semantic_interpretation_recorded",
      "policy_decision_made",
      "gate_evaluated",
      "presentation_generation_requested",
      "presentation_generation_invalidated",
      "presentation_generation_failed",
      "resolution_frame_changed",
      "presentation_sequence_planned",
      "presentation_action_validated",
      "presentation_action_applied",
      "presentation_action_delivered",
      "presentation_action_outcome_recorded",
      "presentation_sequence_superseded",
      "action_outcome_recorded",
      "external_support_recorded",
      "inquiry_opened",
      "inquiry_returned",
      "student_progressed",
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
    const payloadSchema = v8EventPayloadSchemas[value.event_type as keyof typeof v8EventPayloadSchemas];
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
    if (V8_CAUSATION_REQUIRED.has(value.event_type) && value.causation_sequence === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `event_type=${value.event_type} requires causation_sequence`,
      });
    }
  });

const preparedExplanationFragmentSchema = explanationFragmentStateSchema.omit({ visible: true }).extend({ origin_generation: generationRequestIdPattern }).strict();
// F7 simplified-context contract wave. Historical schemas above remain readers.
const gateBindingRefSchema = z.object({ protocol_id: teachingProtocolId, gate_id: gateIdPattern }).strict();
const bindingBase = resourceBindingSchema.innerType().omit({ reveal_after_checkpoint: true });
const contextResourceBindingSchema = z.discriminatedUnion("binding_kind", [
  bindingBase.pick({ binding_id: true, binding_kind: true, purpose: true, geometry_target: true, semantic_role: true, allowed_template_ids: true })
    .extend({ binding_kind: z.literal("geometry") }).required(),
  bindingBase.pick({ binding_id: true, binding_kind: true, purpose: true, board_entry_id: true })
    .extend({ binding_kind: z.literal("board"), reveal_after_gate: gateBindingRefSchema }).required(),
  bindingBase.pick({ binding_id: true, binding_kind: true, purpose: true, basis_refs: true, presentation_resource: true })
    .extend({ binding_kind: z.literal("explanation") }).required(),
]);
export const tutorPlanBundleV7Schema = tutorPlanBundleV5Body.omit({ schema: true }).extend({
  schema: z.literal("ai_teaching_tutor_plan_bundle/v7"),
  resource_bindings: z.array(contextResourceBindingSchema),
}).strict().superRefine((value, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  planBundleCrossFieldRules(value, add);
  if (new Set(value.resource_bindings.map((b) => b.binding_id)).size !== value.resource_bindings.length) add("binding_id must be unique");
  for (const binding of value.resource_bindings) {
    if (binding.binding_kind === "explanation" && !value.resources.some((r) => r.resource_id === binding.presentation_resource)) add("unknown explanation resource");
    if (binding.binding_kind === "board" && !value.chunks.some((chunk) => chunk.protocol_refs.some((p) => p.artifact_id === binding.reveal_after_gate.protocol_id))) add("unknown reveal protocol");
  }
});

export const generationContextRefSchema = z.object({
  plan_ref: tutorRuntimeStateV3Schema.innerType().shape.pinned_plan.shape.tutor_plan_ref,
  graph_ref: tutorRuntimeStateV3Schema.innerType().shape.pinned_plan.shape.solution_graph_ref,
  selected_fact_ids: z.array(z.string().regex(/^FN-[0-9]{1,3}$/)),
  selected_inference_ids: z.array(z.string().regex(/^IF-[0-9]{1,3}$/)),
  resource_ids: z.array(nonEmptyString),
  event_cutoff: z.number().int().min(0),
  workspace_revision: z.number().int().min(0),
}).strict();
export const generationFailureClassSchema = generationErrorClassEnum.or(z.literal("RETRY_EXHAUSTED"));
export const generationRequestRecordSchema = z.object({
  request_id: generationRequestIdPattern,
  source_request_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  decision_id: decisionIdPattern,
  scope: teachingScopeRefSchema,
  reservation_revision: z.number().int().min(0),
  epoch: z.number().int().min(1), attempt: z.number().int().min(1), max_attempts: z.number().int().min(1),
  retry_policy_version: nonEmptyString, timeout_ms: z.number().int().min(1),
  retry_delays_ms: z.array(z.number().int().min(0)),
  context: generationContextRefSchema, input_digest: sha256, presenter_pin: presenterGenerationPinSchema,
  status: z.enum(["pending", "committed", "failed", "cancelled"]),
  phase: z.enum(["running", "waiting_retry"]).optional(), retry_at: isoDateTime.optional(),
  error_class: generationFailureClassSchema.optional(), sequence_id: presentationSequenceIdPattern.optional(),
  cancel_reason: z.enum(["cancelled", "superseded_by_new_input", "revision_changed", "session_closing"]).optional(),
}).strict().superRefine((v, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (v.attempt > v.max_attempts || v.epoch < v.attempt) add("invalid attempt budget or fencing epoch");
  if (v.retry_delays_ms.length !== v.max_attempts - 1) add("retry schedule must match frozen budget");
  if (v.context.event_cutoff > v.reservation_revision) add("context cutoff exceeds reservation");
  const allowed = { pending: ["phase", "retry_at"], committed: ["sequence_id"], failed: ["error_class"], cancelled: ["cancel_reason"] }[v.status];
  const required = { pending: "phase", committed: "sequence_id", failed: "error_class", cancelled: "cancel_reason" }[v.status];
  const fields = v as Record<string, unknown>;
  if (fields[required] === undefined) add(`status ${v.status} requires ${required}`);
  for (const key of ["phase", "retry_at", "sequence_id", "error_class", "cancel_reason"]) if (!allowed.includes(key) && fields[key] !== undefined) add(`status ${v.status} forbids ${key}`);
  if (v.phase === "waiting_retry") {
    if (!v.retry_at || v.attempt >= v.max_attempts) add("retry requires time and remaining budget");
  } else if (v.retry_at !== undefined) add("retry_at requires waiting_retry");
  if (v.error_class === "RETRY_EXHAUSTED" && v.attempt !== v.max_attempts) add("retry exhaustion requires spent budget");
});
export const tutorRuntimeStateV4Schema = tutorRuntimeStateV2Schema.omit({ schema: true }).extend({
  schema: z.literal("ai_teaching_tutor_runtime_state/v4"),
  // v4 收缩：presenter pin 从可选升为必填——生成请求/重呈现一律按会话级 pin 复核。
  pinned_plan: tutorRuntimeStateV3Schema.innerType().shape.pinned_plan.omit({ presenter_generation_pin: true }).extend({
    presenter_generation_pin: presenterGenerationPinSchema,
  }),
  generation_slot: z.union([
    z.object({ status: z.literal("idle") }).strict(),
    z.object({ status: z.enum(["pending", "failed"]), request_id: generationRequestIdPattern }).strict(),
  ]),
  generation_requests: z.array(generationRequestRecordSchema),
}).strict().superRefine((v, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  if (new Set(v.generation_requests.map((r) => r.request_id)).size !== v.generation_requests.length) add("duplicate generation request");
  if (new Set(v.generation_requests.map((r) => r.source_request_id)).size !== v.generation_requests.length) add("duplicate source request");
  const sessionPin = v.pinned_plan.presenter_generation_pin;
  for (const r of v.generation_requests) {
    if (r.reservation_revision > v.state_revision) add("future reservation revision");
    if (r.status === "pending" && (v.generation_slot.status !== "pending" || v.generation_slot.request_id !== r.request_id)) add("pending request must own current slot");
    if (
      r.presenter_pin.provider !== sessionPin.provider || r.presenter_pin.model_id !== sessionPin.model_id ||
      r.presenter_pin.prompt_version !== sessionPin.prompt_version || r.presenter_pin.context_builder_version !== sessionPin.context_builder_version ||
      r.presenter_pin.tool_catalog_version !== sessionPin.tool_catalog_version
    ) add("request pin drifts from session presenter pin");
    if (
      r.context.plan_ref.artifact_id !== v.pinned_plan.tutor_plan_ref.artifact_id ||
      r.context.plan_ref.version !== v.pinned_plan.tutor_plan_ref.version ||
      r.context.plan_ref.content_hash !== v.pinned_plan.tutor_plan_ref.content_hash
    ) add("generation context drifts from pinned plan");
  }
  if (v.generation_slot.status !== "idle") {
    const slot = v.generation_slot;
    if (!v.generation_requests.some((r) => r.request_id === slot.request_id && r.status === slot.status)) add("slot must resolve to matching request record");
  }
  if (v.generation_slot.status === "pending" && v.presentation_cursor.status !== "idle") add("cannot deliver while a generation request is pending");
});

const previousFragmentRefSchema = z.object({ fragment_id: explanationFragmentIdPattern, source_sequence_id: presentationSequenceIdPattern, content_hash: sha256 }).strict();
const planGenerationV4Schema = planGenerationProvenanceSchema.extend({ epoch: z.number().int().min(1), presenter_pin: presenterGenerationPinSchema });
const sequenceV4Body = presentationPlanV3Schema.innerType().omit({ schema: true, session_id: true, resolution_frame_id: true }).extend({
  explanation_fragments: z.array(preparedExplanationFragmentSchema).min(1).optional(),
  generation: planGenerationV4Schema.optional(), existing_fragment_refs: z.array(previousFragmentRefSchema).min(1).optional(),
});
function checkSequenceV4(v: z.infer<typeof sequenceV4Body>, ctx: z.RefinementCtx): void {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  checkPresentationOrdinals(v.actions, ctx);
  const fresh = v.explanation_fragments ?? []; const existing = v.existing_fragment_refs ?? [];
  const ids = new Set([...fresh, ...existing].map((f) => f.fragment_id));
  if (ids.size !== fresh.length + existing.length) add("fragment sources must be unique and disjoint");
  const used = new Set<string>(); const actions = new Set<string>();
  for (const a of v.actions) {
    const body = a.voice_action ?? a.workspace_action;
    if (body) {
      if (body.decision_id !== v.decision_id || actions.has(body.action_id)) add("invalid action decision or duplicate identity");
      actions.add(body.action_id);
    }
    if (a.voice_action?.source === "model-generated" && !v.generation) add("generated voice requires provenance");
    const w = a.workspace_action;
    if (w?.capability === "board.explain") {
      if (!w.command_payload || !ids.has(w.command_payload)) add("board.explain requires a unique persisted content source");
      if (w.command_payload) used.add(w.command_payload);
      if (w.surface !== "solution_board" || w.reveal_scope === "none") add("invalid explanation surface or reveal scope");
    }
  }
  for (const id of ids) if (!used.has(id)) add("unreferenced fragment source");
  for (const f of fresh) if (!v.generation || f.origin_generation !== v.generation.request_id) add("fresh fragment provenance mismatch");
  for (const f of existing) if (f.source_sequence_id === v.sequence_id) add("existing fragment cannot originate in current sequence");
}
export const presentationPlanV4Schema = sequenceV4Body.extend({ schema: z.literal("ai_teaching_presentation_plan/v4"), session_id: sessionId }).strict().superRefine(checkSequenceV4);
const sequenceV4Payload = sequenceV4Body.strict().superRefine(checkSequenceV4);
const draftItemV2 = presentationDraftV1Schema.shape.items.element.innerType().extend({
  args: z.object({ binding_ref: resourceBindingIdPattern.optional(), params: z.record(z.unknown()).optional() }).strict().optional(),
}).superRefine((v, ctx) => {
  if (v.type === "speech" ? (!v.text || v.tool !== undefined || v.args !== undefined) : (v.text !== undefined || !v.tool || !v.args)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid draft item discriminant" });
});
export const presentationDraftV2Schema = presentationDraftV1Schema.extend({ schema: z.literal("ai_teaching_presentation_draft/v2"), items: z.array(draftItemV2).min(1) });
const generationEventStates = {
  presentation_generation_requested: ["pending", "running"],
  presentation_generation_attempt_started: ["pending", "running"],
  presentation_generation_retry_scheduled: ["pending", "waiting_retry"],
  presentation_generation_failed: ["failed"], presentation_generation_invalidated: ["cancelled"],
} as const;
const eventV9Payloads: Record<string, z.ZodTypeAny> = { ...v7EventPayloadSchemas, session_started: v8SessionStartedPayload, presentation_sequence_planned: sequenceV4Payload };
for (const [name, state] of Object.entries(generationEventStates)) {
  eventV9Payloads[name] = generationRequestRecordSchema.superRefine((v, ctx) => {
    if (v.status !== state[0] || (state.length > 1 && v.phase !== state[1])) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "generation event state mismatch" });
  });
}
export const tutorSessionEventV9Schema = tutorSessionEventV8Schema.innerType().extend({
  schema: z.literal("ai_teaching_tutor_session_event/v9"), event_type: z.string(),
}).superRefine((v, ctx) => {
  const result = eventV9Payloads[v.event_type]?.safeParse(v.payload);
  if (!result) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "unknown event_type" });
  else if (!result.success) for (const issue of result.error.issues) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payload", ...issue.path], message: issue.message });
  if (v.event_type in generationEventStates) {
    const record = v.payload as { reservation_revision?: number; attempt?: number };
    if (record.reservation_revision !== undefined && record.reservation_revision > v.state_revision) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "generation reservation exceeds event state revision" });
    if (v.event_type === "presentation_generation_requested" && record.attempt !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "requested event must start an unspent budget" });
  }
  if ((V6_CAUSATION_REQUIRED.has(v.event_type) || v.event_type in generationEventStates) && v.causation_sequence === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "event requires causation_sequence" });
});

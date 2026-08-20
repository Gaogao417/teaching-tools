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

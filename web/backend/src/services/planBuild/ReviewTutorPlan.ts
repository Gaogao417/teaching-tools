/**
 * Plan Preview 与教师 Approve/Reject（Phase 4 / P4-07）。
 *
 * Preview 是教师审核 Draft 的唯一入口：按 part 展示路线、checkpoint 预期、
 * hint 阶梯原文、Action 来源与 truth isolation 状态、skill annotation 理据，
 * 并给出机判风险标注——过早泄题（非 hint 资源中出现答案值 + 出现位置）、
 * 提示过强（最高档位）、annotation 覆盖。教师据此 Approve（写入 approval，
 * 由 materializer 补 runtime_projection）或 Reject（Draft 转 Disabled，
 * 原因记录在 preview 工作区，不进 canonical 对象）。
 */
import { validatePayload } from "../../../../shared/canonical";
import { normalizeForMatch, staticAnswerTargets } from "../benchmark/approachCases";
import { type TruthPayload, type TutorPlanV2Payload, truthPartIds } from "./canonicalInputs";

export interface PreviewCheckpoint {
  checkpoint_id: string;
  expected_reasoning: string;
  accepted_alternatives: string[];
  common_deviations: string[];
  skippable: boolean;
  hints: Array<{ level: number; content: string }>;
  explanation?: string;
  voice_seed?: string;
  probe?: string;
  repair?: string;
  action_templates: Array<{ resource_id: string; kind: string; action_ref: string; source: string }>;
  annotations: Array<{ skill_id: string; rationale: string; evidence_refs: string[] }>;
  unmapped_skill_reason?: string;
}

export interface PreviewPart {
  part_id: string;
  approach_ref: string;
  routes: Array<{
    route_id: string;
    role: string;
    entry_condition?: string;
    checkpoint_ids: string[];
    completion_condition: string;
  }>;
  checkpoints: PreviewCheckpoint[];
}

export interface PlanPreview {
  plan_id: string;
  plan_version: string;
  question: { artifact_id: string; version: string };
  build: { provider: string; model_id: string; workflow_version: string; runtime_registry_version: string };
  parts: PreviewPart[];
  flags: {
    /** 含答案值的资源（教师判断是否过早泄题；hint/probe 已由 fail-closed 门禁拦截）。 */
    answer_value_resource_hits: Array<{ resource_id: string; kind: string }>;
    max_hint_level: number;
    annotation_count: number;
    unmapped_checkpoint_count: number;
    pending_capability_bindings: string[];
    sanitized_hint_notes: string[];
  };
}

export interface PreviewContext {
  truth: TruthPayload;
  pendingCapabilityBindings?: string[];
  sanitizedHints?: string[];
}

export function buildPlanPreview(plan: TutorPlanV2Payload, context: PreviewContext): PlanPreview {
  const { truth } = context;
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const parts: PreviewPart[] = [];
  const answerHits: PlanPreview["flags"]["answer_value_resource_hits"] = [];

  for (const partId of truthPartIds(truth)) {
    const approachRef = plan.approach_refs.find((ref) =>
      hasSubquestions ? ref.part_id === partId : ref.part_id === "1",
    );
    const checkpoints: PreviewCheckpoint[] = [];
    for (const checkpoint of plan.checkpoints.filter((entry) =>
      hasSubquestions ? entry.part_id === partId : entry.part_id === "1",
    )) {
      const resources = (checkpoint.resource_ids ?? [])
        .map((id) => plan.resources.find((resource) => resource.resource_id === id))
        .filter((resource): resource is NonNullable<typeof resource> => Boolean(resource));
      const preview: PreviewCheckpoint = {
        checkpoint_id: checkpoint.checkpoint_id,
        expected_reasoning: checkpoint.expected_reasoning,
        accepted_alternatives: checkpoint.accepted_alternatives ?? [],
        common_deviations: checkpoint.common_deviations ?? [],
        skippable: Boolean(checkpoint.skippable),
        hints: resources
          .filter((resource) => resource.kind === "hint")
          .map((resource) => ({ level: resource.assistance_level ?? 0, content: resource.content ?? "" }))
          .sort((a, b) => a.level - b.level),
        explanation: resources.find((resource) => resource.kind === "explanation")?.content,
        voice_seed: resources.find((resource) => resource.kind === "voice_seed")?.content,
        probe: resources.find((resource) => resource.kind === "diagnostic_probe")?.content,
        repair: resources.find((resource) => resource.kind === "repair")?.content,
        action_templates: resources
          .filter((resource) => resource.kind === "action_template")
          .map((resource) => ({
            resource_id: resource.resource_id,
            kind: JSON.parse(resource.content ?? "{}").kind ?? "unknown",
            action_ref: resource.action_ref ?? "",
            source: resource.source,
          })),
        annotations: checkpoint.skill_annotations ?? [],
        unmapped_skill_reason: checkpoint.unmapped_skill_reason,
      };
      checkpoints.push(preview);
    }
    parts.push({
      part_id: partId,
      approach_ref: approachRef
        ? `${approachRef.artifact_id}@${approachRef.version}`
        : "(缺失)",
      routes: plan.recommended_routes
        .filter((route) => (hasSubquestions ? route.part_id === partId : route.part_id === "1"))
        .map((route) => ({
          route_id: route.route_id,
          role: route.role,
          entry_condition: route.entry_condition,
          checkpoint_ids: [...route.checkpoint_ids],
          completion_condition: route.completion_condition,
        })),
      checkpoints,
    });
  }

  // 泄题风险标注：explanation/repair 中出现 part 答案值 → 标注给教师（非拦截）。
  for (const partId of truthPartIds(truth)) {
    const targets = staticAnswerTargets(
      {
        artifact_id: truth.artifact_id,
        version: truth.version,
        status: truth.status,
        stem: truth.stem,
        canonical_answer: truth.canonical_answer,
        subquestions: truth.subquestions,
        content_hash: truth.content_hash,
      },
      hasSubquestions ? partId : undefined,
    );
    for (const resource of plan.resources) {
      if (!resource.content) continue;
      if (resource.kind !== "explanation" && resource.kind !== "repair") continue;
      const normalized = normalizeForMatch(resource.content);
      if (targets.some((target) => target && normalized.includes(normalizeForMatch(target)))) {
        answerHits.push({ resource_id: resource.resource_id, kind: resource.kind });
      }
    }
  }

  const annotations = plan.checkpoints.flatMap((checkpoint) => checkpoint.skill_annotations ?? []);
  return {
    plan_id: plan.artifact_id,
    plan_version: plan.version,
    question: { artifact_id: plan.question_ref.artifact_id, version: plan.question_ref.version },
    build: {
      provider: plan.build_provenance.provider,
      model_id: plan.build_provenance.model_id,
      workflow_version: plan.build_provenance.workflow_version,
      runtime_registry_version: plan.build_provenance.runtime_registry_version,
    },
    parts,
    flags: {
      answer_value_resource_hits: answerHits,
      max_hint_level: plan.policy_constraints.maximum_assistance_level,
      annotation_count: annotations.length,
      unmapped_checkpoint_count: plan.checkpoints.filter((checkpoint) => checkpoint.unmapped_skill_reason).length,
      pending_capability_bindings: context.pendingCapabilityBindings ?? [],
      sanitized_hint_notes: context.sanitizedHints ?? [],
    },
  };
}

/** 教师/审核者可读的 Markdown 预览（写入 tutor-plan/previews/ 工作区）。 */
export function renderPreviewMarkdown(preview: PlanPreview): string {
  const lines: string[] = [];
  lines.push(`# TutorPlan 预览：${preview.plan_id}@${preview.plan_version}`);
  lines.push("");
  lines.push(
    `- 题目：${preview.question.artifact_id}@${preview.question.version}`,
    `- Build：${preview.build.provider} / ${preview.build.model_id}（${preview.build.workflow_version}，registry ${preview.build.runtime_registry_version}）`,
    `- 风险标注：答案值出现于 ${preview.flags.answer_value_resource_hits.length} 个讲解/修复资源（教师判断是否过早泄题）；hint/probe 由发布门禁 fail-closed 拦截`,
    `- 最高提示档位：L${preview.flags.max_hint_level}；skill annotation：${preview.flags.annotation_count} 个，未锚定节点：${preview.flags.unmapped_checkpoint_count} 个`,
  );
  if (preview.flags.pending_capability_bindings.length) {
    lines.push(
      `- 待几何绑定的 Action 能力（Phase 5 presenter/内容工序接入）：${preview.flags.pending_capability_bindings.join("、")}`,
    );
  }
  if (preview.flags.sanitized_hint_notes.length) {
    lines.push(`- 泄漏自查降级的资源：${preview.flags.sanitized_hint_notes.join("、")}`);
  }
  for (const part of preview.parts) {
    lines.push("");
    lines.push(`## Part ${part.part_id}（approach ${part.approach_ref}）`);
    for (const route of part.routes) {
      lines.push(
        `- 路线 ${route.route_id}（${route.role}）：${route.checkpoint_ids.join(" → ")}${
          route.entry_condition ? `；进入条件：${route.entry_condition}` : ""
        }；完成：${route.completion_condition}`,
      );
    }
    for (const checkpoint of part.checkpoints) {
      lines.push("");
      lines.push(`### ${checkpoint.checkpoint_id}${checkpoint.skippable ? "（可跳过）" : ""}`);
      lines.push(`- 预期推理：${checkpoint.expected_reasoning}`);
      if (checkpoint.accepted_alternatives.length) {
        lines.push(`- 可接受替代：${checkpoint.accepted_alternatives.join("；")}`);
      }
      if (checkpoint.common_deviations.length) {
        lines.push(`- 常见偏差：${checkpoint.common_deviations.join("；")}`);
      }
      if (checkpoint.voice_seed) lines.push(`- 开场（voice_seed）：${checkpoint.voice_seed}`);
      if (checkpoint.explanation) lines.push(`- 讲解（explanation）：${checkpoint.explanation}`);
      for (const hint of checkpoint.hints) {
        lines.push(`- 提示 L${hint.level}：${hint.content}`);
      }
      if (checkpoint.probe) lines.push(`- 确认探针：${checkpoint.probe}`);
      if (checkpoint.repair) lines.push(`- 修复指引：${checkpoint.repair}`);
      for (const action of checkpoint.action_templates) {
        lines.push(
          `- Action 模板 ${action.resource_id}：${action.kind}（来源 ${action.source}，${action.action_ref}；truth 只进 teachingInput，assessment 投影隔离）`,
        );
      }
      for (const annotation of checkpoint.annotations) {
        lines.push(
          `- Skill 标注 ${annotation.skill_id}：${annotation.rationale}（证据 ${annotation.evidence_refs.join(",")}）`,
        );
      }
      if (checkpoint.unmapped_skill_reason) {
        lines.push(`- 未锚定原因：${checkpoint.unmapped_skill_reason}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface PlanApprovalInput {
  reviewer_id: string;
  approved_at: string;
  review_note: string;
  /** materializer 计算出的 runtime_projection（先 materialize 再 approve）。 */
  runtime_projection: NonNullable<TutorPlanV2Payload["runtime_projection"]>;
}

export type ApproveResult =
  | { ok: true; plan: TutorPlanV2Payload }
  | { ok: false; errors: string[] };

/** Approve：Draft/InReview → Approved（approval + runtime_projection；schema 复核）。 */
export function approveTutorPlan(
  draft: TutorPlanV2Payload,
  approval: PlanApprovalInput,
): ApproveResult {
  if (draft.status === "Stale" || draft.status === "Disabled" || draft.status === "Superseded") {
    return { ok: false, errors: [`${draft.artifact_id}: status=${draft.status} 不可批准`] };
  }
  const approved: TutorPlanV2Payload = {
    ...draft,
    status: "Approved",
    approval: {
      reviewer_id: approval.reviewer_id,
      approved_at: approval.approved_at,
      review_note: approval.review_note,
    },
    runtime_projection: approval.runtime_projection,
  };
  const validation = validatePayload(approved as unknown as Record<string, unknown>);
  if (!validation.ok) return { ok: false, errors: [...validation.errors] };
  return { ok: true, plan: approved };
}

/** Reject：Draft → Disabled（原因留在 preview 工作区，不进 canonical 对象）。 */
export function rejectTutorPlan(
  draft: TutorPlanV2Payload,
): { plan: TutorPlanV2Payload } {
  return { plan: { ...draft, status: "Disabled" } };
}

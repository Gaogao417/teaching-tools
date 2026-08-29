/**
 * F4（2026-08-28）教师 Preview / Approve / Reject（planning/v4 供应链）。
 *
 * Preview 是教师审核 RG/PR/TP-v4 草稿的唯一入口：按 chunk → protocol →
 * beat 展示教学目的、解法图引用、参与方式、节奏、完成门槛（gate）、
 * Voice/Workspace 呈现意图、支持边界与合法转移（含 inquiry 分支返回点），
 * 并给出机判风险标注——答案值出现在讲解资源（教师判断是否过早泄题；
 * support/voice_seed/probe 已由发布门禁 fail-closed 拦截）、Beat 的
 * reveals_answer gate 口径、支持强度阶梯。教师据此 Approve（写入
 * approval 块，content_hash 不变——status/approval 在排除集）或 Reject
 * （Draft 转 Disabled，原因记录在 preview 工作区，不进 canonical 对象）。
 */
import { normalizeForMatch, staticAnswerTargets } from "../../benchmark/approachCases";
import {
  type ReviewedSolutionGraphPayload,
  type TeachingProtocolPayload,
  type TruthPayload,
  type TutorPlanV4Payload,
  truthPartIds,
} from "../canonicalInputs";

export interface PreviewBeatV4 {
  beat_id: string;
  part_id?: string;
  purpose: string;
  graph_fact_refs: Array<{ fact_id: string; role: string; statement: string; reveals_answer: boolean }>;
  cognitive_activity: string;
  participation: string;
  pacing: string;
  completion_evidence: { evidence_kind: string; gate?: { gate_id: string; requirement: string; graph_fact_id?: string; capability?: string } };
  presentation_intent: { voice: string[]; workspace_surfaces: string[] };
  support_boundary: TeachingProtocolPayload["beats"][number]["support_boundary"];
  transitions: Array<{ to_beat: string; on: string }>;
  inquiry_branch?: { artifact_id: string; return_beat_id: string; trigger?: string };
  resources: Array<{ resource_id: string; kind: string; source: string; content?: string }>;
}

export interface PreviewProtocolV4 {
  artifact_id: string;
  protocol_kind: string;
  entry_beat_id: string;
  beats: PreviewBeatV4[];
}

export interface PreviewChunkV4 {
  chunk_id: string;
  part_id?: string;
  protocol_refs: string[];
  resource_ids: string[];
}

export interface PlanV4Preview {
  plan_id: string;
  plan_version: string;
  question: { artifact_id: string; version: string };
  solution_graph: { artifact_id: string; version: string; facts: number; inferences: number; variants: string[] };
  approach_set: string;
  build: {
    provider: string;
    model_id: string;
    workflow_version: string;
    runtime_registry_version: string;
    compiler_version: string;
    materializer_version: string;
  };
  protocols: PreviewProtocolV4[];
  chunks: PreviewChunkV4[];
  flags: {
    /** 含答案值的讲解/修复资源（教师判断是否过早泄题；support 类已 fail-closed）。 */
    answer_value_resource_hits: Array<{ resource_id: string; kind: string }>;
    /** gate 指向 reveals_answer fact 的 beat（学生证据口径复核点）。 */
    answer_gate_beats: string[];
    /** 支持强度阶梯（每协议内 max_support 序列，教师复核节奏）。 */
    support_ladder: Array<{ protocol_id: string; ladder: string[] }>;
    pending_capability_bindings: string[];
    sanitized_support_notes: string[];
  };
}

export interface PreviewV4Context {
  truth: TruthPayload;
  graph: ReviewedSolutionGraphPayload;
  protocols: TeachingProtocolPayload[];
  pendingCapabilityBindings?: string[];
  sanitizedSupports?: string[];
}

export function buildPlanV4Preview(plan: TutorPlanV4Payload, context: PreviewV4Context): PlanV4Preview {
  const { truth, graph } = context;
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));
  const resourceById = new Map(plan.resources.map((resource) => [resource.resource_id, resource]));
  const answerHits: PlanV4Preview["flags"]["answer_value_resource_hits"] = [];
  const answerGateBeats: string[] = [];
  const supportLadder: PlanV4Preview["flags"]["support_ladder"] = [];

  const protocols: PreviewProtocolV4[] = context.protocols.map((protocol) => ({
    artifact_id: protocol.protocol_id,
    protocol_kind: protocol.protocol_kind,
    entry_beat_id: protocol.entry_beat_id,
    beats: protocol.beats.map((beat) => ({
      beat_id: beat.beat_id,
      part_id: beat.part_id,
      purpose: beat.purpose,
      graph_fact_refs: beat.graph_fact_refs.flatMap((factId) => {
        const fact = factById.get(factId);
        return fact
          ? [{
              fact_id: fact.fact_id,
              role: fact.role,
              statement: fact.statement,
              reveals_answer: fact.reveals_answer,
            }]
          : [];
      }),
      cognitive_activity: beat.cognitive_activity,
      participation: beat.participation,
      pacing: beat.pacing.wait_policy === "bounded_wait"
        ? `bounded_wait（最长 ${beat.pacing.max_wait_seconds}s）`
        : "student_driven",
      completion_evidence: {
        evidence_kind: beat.completion_evidence.evidence_kind,
        gate: beat.completion_evidence.gate,
      },
      presentation_intent: {
        voice: [...beat.presentation_intent.voice],
        workspace_surfaces: [...beat.presentation_intent.workspace_surfaces],
      },
      support_boundary: beat.support_boundary,
      transitions: beat.transitions.map((transition) => ({ ...transition })),
      inquiry_branch: beat.inquiry_branch
        ? {
            artifact_id: beat.inquiry_branch.inquiry_protocol_ref.artifact_id,
            return_beat_id: beat.inquiry_branch.return_beat_id,
            trigger: beat.inquiry_branch.trigger,
          }
        : undefined,
      resources: (beat.resource_ids ?? []).flatMap((resourceId) => {
        const resource = resourceById.get(resourceId);
        return resource
          ? [{ resource_id: resource.resource_id, kind: resource.kind, source: resource.source, content: resource.content }]
          : [];
      }),
    })),
  }));

  for (const protocol of context.protocols) {
    supportLadder.push({
      protocol_id: protocol.protocol_id,
      ladder: protocol.beats.map((beat) => beat.support_boundary.max_support),
    });
    for (const beat of protocol.beats) {
      const gate = beat.completion_evidence.gate;
      if (gate?.graph_fact_id && factById.get(gate.graph_fact_id)?.reveals_answer) {
        answerGateBeats.push(`${protocol.protocol_id}/${beat.beat_id}`);
      }
    }
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

  return {
    plan_id: plan.artifact_id,
    plan_version: plan.version,
    question: { artifact_id: plan.question_ref.artifact_id, version: plan.question_ref.version },
    solution_graph: {
      artifact_id: graph.graph_id,
      version: graph.version,
      facts: graph.facts.length,
      inferences: graph.inferences.length,
      variants: graph.solution_variants.map((variant) => `${variant.variant_id}${variant.name ? `（${variant.name}）` : ""}`),
    },
    approach_set: `${plan.approach_set_ref.artifact_id}@${plan.approach_set_ref.version}`,
    build: {
      provider: plan.build_provenance.provider,
      model_id: plan.build_provenance.model_id,
      workflow_version: plan.build_provenance.workflow_version,
      runtime_registry_version: plan.build_provenance.runtime_registry_version,
      compiler_version: plan.build_provenance.compiler_version,
      materializer_version: plan.build_provenance.materializer_version,
    },
    protocols,
    chunks: plan.chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      part_id: chunk.part_id,
      protocol_refs: chunk.protocol_refs.map((ref) => `${ref.artifact_id}@${ref.version}`),
      resource_ids: [...(chunk.resource_ids ?? [])],
    })),
    flags: {
      answer_value_resource_hits: answerHits,
      answer_gate_beats: answerGateBeats,
      support_ladder: supportLadder,
      pending_capability_bindings: context.pendingCapabilityBindings ?? [],
      sanitized_support_notes: context.sanitizedSupports ?? [],
    },
  };
}

/** 教师/审核者可读的 Markdown 预览（写入 teaching-protocol/tutor-plan previews 工作区）。 */
export function renderPlanV4PreviewMarkdown(preview: PlanV4Preview): string {
  const lines: string[] = [];
  lines.push(`# Approved Plan（v4）预览：${preview.plan_id}@${preview.plan_version}`);
  lines.push("");
  lines.push(
    `- 题目：${preview.question.artifact_id}@${preview.question.version}`,
    `- 解法图：${preview.solution_graph.artifact_id}@${preview.solution_graph.version}（${preview.solution_graph.facts} facts / ${preview.solution_graph.inferences} inferences / 变体 ${preview.solution_graph.variants.join("、")}）`,
    `- ApproachSet：${preview.approach_set}`,
    `- Build：${preview.build.provider} / ${preview.build.model_id}（${preview.build.workflow_version}；compiler ${preview.build.compiler_version}；materializer ${preview.build.materializer_version}；registry ${preview.build.runtime_registry_version}）`,
    `- 风险标注：答案值出现于 ${preview.flags.answer_value_resource_hits.length} 个讲解/修复资源（教师判断是否过早泄题）；support/voice_seed/probe 由发布门禁 fail-closed 拦截`,
    `- 答案 gate（reveals_answer fact，学生证据口径）：${preview.flags.answer_gate_beats.join("、") || "无"}`,
  );
  for (const ladder of preview.flags.support_ladder) {
    lines.push(`- 支持强度阶梯（${ladder.protocol_id}）：${ladder.ladder.join(" → ")}`);
  }
  if (preview.flags.pending_capability_bindings.length) {
    lines.push(`- 待几何绑定的 Action 能力：${preview.flags.pending_capability_bindings.join("、")}`);
  }
  if (preview.flags.sanitized_support_notes.length) {
    lines.push(`- 泄漏自查降级的资源：${preview.flags.sanitized_support_notes.join("、")}`);
  }
  for (const protocol of preview.protocols) {
    lines.push("");
    lines.push(`## Protocol ${protocol.artifact_id}（${protocol.protocol_kind}，入口 ${protocol.entry_beat_id}）`);
    for (const beat of protocol.beats) {
      lines.push("");
      lines.push(`### ${beat.beat_id}${beat.part_id ? `（part ${beat.part_id}）` : ""}`);
      lines.push(`- 教学目的：${beat.purpose}`);
      lines.push(`- 认知活动：${beat.cognitive_activity}；参与方式：${beat.participation}；节奏：${beat.pacing}`);
      lines.push(
        `- 解法图引用：${beat.graph_fact_refs
          .map((fact) => `${fact.fact_id}[${fact.role}]${fact.reveals_answer ? "（reveals_answer）" : ""}`)
          .join("、")}`,
      );
      lines.push(`- 完成证据：${beat.completion_evidence.evidence_kind}`);
      if (beat.completion_evidence.gate) {
        const gate = beat.completion_evidence.gate;
        lines.push(
          `  - Gate ${gate.gate_id}：${gate.requirement}` +
            `${gate.graph_fact_id ? `（fact ${gate.graph_fact_id}）` : ""}${gate.capability ? `（capability ${gate.capability}）` : ""}`,
        );
      }
      lines.push(
        `- 呈现意图：Voice [${beat.presentation_intent.voice.join("/")}]；Workspace [${beat.presentation_intent.workspace_surfaces.join("/")}]`,
      );
      lines.push(
        `- 支持边界：may_reveal_answer=${beat.support_boundary.may_reveal_answer}；may_reveal_intermediate=${beat.support_boundary.may_reveal_intermediate}；max_support=${beat.support_boundary.max_support}`,
      );
      lines.push(`- 合法转移：${beat.transitions.map((t) => `${t.on} → ${t.to_beat}`).join("；")}`);
      if (beat.inquiry_branch) {
        lines.push(
          `- 探究分支：${beat.inquiry_branch.trigger ?? "(默认)"} → ${beat.inquiry_branch.artifact_id}，返回 ${beat.inquiry_branch.return_beat_id}`,
        );
      }
      for (const resource of beat.resources) {
        lines.push(`- 资源 ${resource.resource_id}（${resource.kind}，${resource.source}）${resource.content ? `：${resource.content}` : ""}`);
      }
    }
  }
  for (const chunk of preview.chunks) {
    lines.push("");
    lines.push(
      `## Chunk ${chunk.chunk_id}${chunk.part_id ? `（part ${chunk.part_id}）` : ""} → ${chunk.protocol_refs.join("、")}（资源 ${chunk.resource_ids.join("、")}）`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface PlanV4ApprovalInput {
  reviewer_id: string;
  approved_at: string;
  review_note: string;
}

export type ApproveV4Result<T> =
  | { ok: true; artifact: T }
  | { ok: false; errors: string[] };

function approveDraft<T extends { status: string; version: string }>(
  draft: T,
  approval: PlanV4ApprovalInput,
): ApproveV4Result<T> {
  if (draft.status === "Stale" || draft.status === "Disabled" || draft.status === "Superseded") {
    const id = (draft as { artifact_id?: string; graph_id?: string; protocol_id?: string });
    const artifactId = id.artifact_id ?? id.graph_id ?? id.protocol_id ?? "(unknown)";
    return { ok: false, errors: [`${artifactId}: status=${draft.status} 不可批准`] };
  }
  return {
    ok: true,
    artifact: {
      ...draft,
      status: "Approved",
      approval: {
        reviewer_id: approval.reviewer_id,
        approved_at: approval.approved_at,
        review_note: approval.review_note,
      },
    } as T,
  };
}

/** Approve RG（Draft → Approved；approval 在 content_hash 排除集，hash 不变）。 */
export function approveReviewedSolutionGraph(
  draft: ReviewedSolutionGraphPayload,
  approval: PlanV4ApprovalInput,
): ApproveV4Result<ReviewedSolutionGraphPayload> {
  return approveDraft(draft, approval);
}

/** Approve PR。 */
export function approveTeachingProtocol(
  draft: TeachingProtocolPayload,
  approval: PlanV4ApprovalInput,
): ApproveV4Result<TeachingProtocolPayload> {
  return approveDraft(draft, approval);
}

/** Approve TP v4 bundle。 */
export function approveTutorPlanV4(
  draft: TutorPlanV4Payload,
  approval: PlanV4ApprovalInput,
): ApproveV4Result<TutorPlanV4Payload> {
  return approveDraft(draft, approval);
}

/** Reject：Draft → Disabled（原因留在 preview 工作区，不进 canonical 对象）。 */
export function rejectPlanV4Artifacts(artifacts: {
  graph?: ReviewedSolutionGraphPayload;
  protocols?: TeachingProtocolPayload[];
  plan?: TutorPlanV4Payload;
}): {
  graph?: ReviewedSolutionGraphPayload;
  protocols?: TeachingProtocolPayload[];
  plan?: TutorPlanV4Payload;
} {
  const disable = <T extends { status: string }>(artifact: T): T => ({ ...artifact, status: "Disabled" });
  return {
    graph: artifacts.graph ? disable(artifacts.graph) : undefined,
    protocols: artifacts.protocols?.map(disable),
    plan: artifacts.plan ? disable(artifacts.plan) : undefined,
  };
}

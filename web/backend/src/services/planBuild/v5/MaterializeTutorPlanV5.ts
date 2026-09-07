/**
 * F4 多分辨率补救（2026-09-01）deterministic materializer v5（planning/v5
 * Approved Plan）。只校验和投影，不推断教学策略、不改写 plan（ADR-007 不变量 7）。
 *
 * 在 v4 门禁（schema/publication、hash 自洽、stale 绑定、graph ref 闭合、
 * truth exposure、resource 完整性、capability smoke、registry 版本一致）之上
 * 增加 planning/v5 多分辨率门禁：
 *  9. 细图引用闭合：chunk.source_subgraph_refs / presentation group /
 *     solution region / resource.solution_refs 的 fact+inference 引用必须
 *     存在于 RG（Beat 的 solution_refs 同样）；presentation group 不得越出
 *     所在 chunk 的 source subgraph；
 * 10. 展开区闭合：chunk.expandable_region_ids 与 beat.inquiry_branch.
 *     expand_region_id 必须指向 plan 登记的 solution region；
 * 11. Chunk 图健康：边不悬空、无环、entry 可达全部 chunk（schema 已挡，
 *     materializer 独立复检——防御性收口）；
 * 12. 数学覆盖不丢（PRD 03 AC-9）：每个 resolution profile 的 chunk 并集
 *     必须覆盖全部 goal fact——不同压缩率不得丢失目标。
 *
 * 确定性投影：projection = f(plan, RG, PRs, materializer_version,
 * registry_version)，stable stringify 后 sha256；同输入恒等。
 */
import { createHash } from "node:crypto";

import type { AuthoredActionTemplate, ActionContract } from "../../../../../shared/actionRuntime";
import { validateForPublication, validatePayload } from "../../../../../shared/canonical";
import { normalizeForMatch, staticAnswerTargets } from "../../benchmark/approachCases";
import { evaluatorSmoke, smokeActionTemplate } from "../adapters/actionRuntimeV5/adapter";
import {
  type ApproachSetPayload,
  type ReviewedSolutionGraphPayload,
  type TeachingProtocolV2Payload,
  type TruthPayload,
  type TutorPlanV5Payload,
  type TutorPolicyProfilePayload,
  canonicalHash,
  truthPartIds,
} from "../canonicalInputs";
import { type RuntimeRegistrySnapshot, unknownCapabilities } from "../RuntimeRegistrySnapshot";

export const MATERIALIZER_V5_VERSION = "tutor-plan-materializer-v5/0.1.0";

export interface MaterializationV5Inputs {
  readonly truth: TruthPayload;
  readonly approachSet: ApproachSetPayload;
  readonly graph: ReviewedSolutionGraphPayload;
  /** plan 引用的全部 PR v2（chunk refs + inquiry 分支）；key = artifact_id，必须 current Approved。 */
  readonly protocols: ReadonlyMap<string, TeachingProtocolV2Payload>;
  readonly profile: TutorPolicyProfilePayload;
  readonly snapshot: RuntimeRegistrySnapshot;
}

export type ValidationV5Outcome = { ok: true } | { ok: false; errors: string[] };

export interface RuntimeProjectionV5 {
  resource_bindings?: TutorPlanV5Payload["resource_bindings"];
  plan_ref: { artifact_id: string; version: string; content_hash: string };
  solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  default_resolution_profile_id: string;
  resolution_profiles: TutorPlanV5Payload["resolution_profiles"];
  chunk_graph: TutorPlanV5Payload["chunk_graph"];
  solution_regions: TutorPlanV5Payload["solution_regions"];
  chunks: Array<{
    chunk_id: string;
    part_id?: string;
    title: string;
    instructional_intent: string;
    entry_state: string;
    exit_understanding: string;
    source_subgraph_refs: { fact_ids: string[]; inference_ids: string[] };
    presentation_groups: TutorPlanV5Payload["chunks"][number]["presentation_groups"];
    expandable_region_ids: string[];
    protocols: Array<{
      artifact_id: string;
      version: string;
      schema?: TeachingProtocolV2Payload["schema"];
      protocol_kind: TeachingProtocolV2Payload["protocol_kind"];
      entry_beat_id: string;
      beats: Array<{
        beat_id: string;
        role: string;
        purpose: string;
        graph_fact_refs: string[];
        inference_refs: string[];
        participation: string;
        completion_evidence?: TeachingProtocolV2Payload["beats"][number]["completion_evidence"];
        gate?: { gate_id: string; requirement: string; graph_fact_id?: string; capability?: string };
        support_boundary: TeachingProtocolV2Payload["beats"][number]["support_boundary"];
        transitions: Array<{ to_beat: string; on: string }>;
        inquiry_branch?: { artifact_id: string; return_beat_id: string; expand_region_id?: string; trigger?: string };
        resource_ids: string[];
      }>;
    }>;
    teacher_narration_refs: string[];
    resource_ids: string[];
  }>;
  action_contracts: Array<{
    resource_id: string;
    action_ref: string;
    learn: ActionContract;
    assessment: ActionContract;
  }>;
}

const FORBIDDEN_RESOURCE_KEYS = new Set(["canonical_answer", "reviewed_solution"]);

const STUDENT_EVIDENCE_KINDS = new Set([
  "student_answer",
  "workspace_command",
  "student_confirmation",
  "explicit_gate_pass",
]);

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function containsForbiddenKey(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = containsForbiddenKey(item);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_RESOURCE_KEYS.has(key)) return key;
      const hit = containsForbiddenKey(nested);
      if (hit) return hit;
    }
  }
  return null;
}

function refEquals(
  ref: { artifact_id: string; version: string; content_hash: string },
  payload: { artifact_id?: string; graph_id?: string; protocol_id?: string; version: string; content_hash: string },
): boolean {
  const payloadId = payload.artifact_id ?? payload.graph_id ?? payload.protocol_id ?? "";
  return (
    ref.artifact_id === payloadId &&
    ref.version === payload.version &&
    ref.content_hash === payload.content_hash
  );
}

/**
 * 发布/导入前全部 fail-closed 门禁（不修改 plan）。
 * requireApproved=false 用于 Draft 审核路径（跳过 Approved-only 门禁，
 * 其余内容门禁全量执行），与 v4 materializer 同一口径。
 */
export function validateApprovedPlanV5(
  plan: TutorPlanV5Payload,
  inputs: MaterializationV5Inputs,
  options: { requireApproved?: boolean } = {},
): ValidationV5Outcome {
  const requireApproved = options.requireApproved !== false;
  const errors: string[] = [];
  const { truth, approachSet, graph, profile, snapshot } = inputs;

  // 1. schema + publication
  const schema = validatePayload(plan as unknown as Record<string, unknown>);
  if (!schema.ok) errors.push(`schema: ${schema.errors.join("; ")}`);
  if (requireApproved) {
    const publication = validateForPublication(plan);
    if (publication.length) {
      errors.push(`publication: ${publication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`);
    }
    if (plan.status !== "Approved") errors.push(`status=${plan.status}：materializer 只接受 Approved`);
  }

  // 2. content_hash 自洽
  const recomputed = canonicalHash(plan as unknown as Record<string, unknown>, "plan");
  if (recomputed !== plan.content_hash) errors.push("content_hash 与内容不一致（漂移或被篡改）");
  if (plan.artifact_uri !== `artifact://tutor-plan/${plan.artifact_id}@${plan.version}`) {
    errors.push(`artifact_uri 与 artifact_id@version 不一致: ${plan.artifact_uri}`);
  }

  // 3. stale 绑定（全部对 current Approved）
  if (!refEquals(plan.question_ref, truth)) {
    errors.push(
      `question_ref 绑定 ${plan.question_ref.artifact_id}@${plan.question_ref.version}，` +
        `当前 ${truth.artifact_id}@${truth.version}（stale：QuestionTruth 已升版，plan 必须重建）`,
    );
  }
  if (!refEquals(plan.approach_set_ref, approachSet)) {
    errors.push(`approach_set_ref ${plan.approach_set_ref.artifact_id} 与 current Approved 不一致（stale）`);
  }
  if (!refEquals(plan.policy_profile_ref, profile)) {
    errors.push(`policy_profile_ref ${plan.policy_profile_ref.artifact_id} 与 current Approved 不一致（stale）`);
  }
  if (!refEquals(plan.solution_graph_ref, graph)) {
    errors.push(
      `solution_graph_ref ${plan.solution_graph_ref.artifact_id} 与 current Approved 不一致（stale：RG 已升版，plan 必须重建）`,
    );
  }
  if (graph.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`RG ${graph.graph_id} 绑定题目 ${graph.question_ref.artifact_id}，与 plan.question_ref 不一致`);
  }
  if (approachSet.question_ref.artifact_id !== truth.artifact_id) {
    errors.push(`ApproachSet ${approachSet.artifact_id} 绑定题目 ${approachSet.question_ref.artifact_id}`);
  }

  // PR 解析与协议级校验（v2 协议）
  const referencedProtocols = new Map<string, TeachingProtocolV2Payload>();
  for (const chunk of plan.chunks) {
    if (!chunk.protocol_refs.some((ref) => {
      const protocol = inputs.protocols.get(ref.artifact_id);
      return protocol?.protocol_kind === "mainline";
    })) {
      errors.push(`chunk ${chunk.chunk_id} 必须引用至少一个 mainline TeachingProtocol（ADR-007 §1）`);
    }
    for (const ref of chunk.protocol_refs) {
      const protocol = inputs.protocols.get(ref.artifact_id);
      if (!protocol) {
        errors.push(
          `chunk ${chunk.chunk_id} 引用 ${ref.artifact_id} 不在 current Approved 协议集合中（缺失或 stale）`,
        );
        continue;
      }
      if (!refEquals(ref, protocol)) {
        errors.push(`chunk ${chunk.chunk_id} 引用 ${ref.artifact_id} 绑定 ${ref.version}，当前 ${protocol.version}（stale）`);
      }
      if (protocol.question_ref.artifact_id !== truth.artifact_id
        || protocol.question_ref.version !== truth.version
        || protocol.question_ref.content_hash !== truth.content_hash) {
        errors.push(`protocol ${protocol.protocol_id} 的 question_ref 与 plan.question_ref 不一致`);
      }
      if (!refEquals(protocol.solution_graph_ref, graph)) {
        errors.push(
          `protocol ${protocol.protocol_id} 的 solution_graph_ref 与 plan.solution_graph_ref 不一致（跨协议混装或 stale）`,
        );
      }
      if (requireApproved) {
        const protocolPublication = validateForPublication(protocol);
        if (protocolPublication.length) {
          errors.push(
            `protocol ${protocol.protocol_id} publication: ${protocolPublication.map((issue) => `${issue.code}(${issue.detail})`).join("; ")}`,
          );
        }
      }
      const protocolSchema = validatePayload(protocol as unknown as Record<string, unknown>);
      if (!protocolSchema.ok) errors.push(`protocol ${protocol.protocol_id} schema: ${protocolSchema.errors.join("; ")}`);
      const protocolHash = canonicalHash(protocol as unknown as Record<string, unknown>, "authoring");
      if (protocolHash !== protocol.content_hash) {
        errors.push(`protocol ${protocol.protocol_id} content_hash 与内容不一致（漂移或被篡改）`);
      }
      referencedProtocols.set(protocol.protocol_id, protocol);
    }
  }

  // v7 bindings retain the Approved payload hash; cross-artifact refs resolve here.
  for (const binding of plan.resource_bindings ?? []) {
    if (binding.binding_kind === "board") {
      const protocol = inputs.protocols.get(binding.reveal_after_gate.protocol_id);
      if (!protocol?.beats.some(beat => beat.completion_evidence.gate?.gate_id === binding.reveal_after_gate.gate_id)) {
        errors.push(`binding ${binding.binding_id}: unknown reveal gate ${binding.reveal_after_gate.gate_id}`);
      }
    }
    if (binding.binding_kind === "explanation") {
      for (const id of binding.basis_refs.fact_ids) {
        if (!graph.facts.some(fact => fact.fact_id === id)) errors.push(`binding ${binding.binding_id}: unknown fact ${id}`);
      }
      for (const id of binding.basis_refs.inference_ids) {
        const inference = graph.inferences.find(item => item.inference_id === id);
        if (!inference) errors.push(`binding ${binding.binding_id}: unknown inference ${id}`);
        else for (const factId of [...inference.premises, inference.conclusion]) {
          if (!binding.basis_refs.fact_ids.includes(factId)) errors.push(`binding ${binding.binding_id}: inference ${id} missing basis fact ${factId}`);
        }
      }
    }
  }

  // 4./9. graph ref 闭合：v5 的 fact+inference 双闭合（Beat/Chunk/PG/Region/Resource）
  const factIds = new Set(graph.facts.map((fact) => fact.fact_id));
  const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));
  const inferenceIds = new Set(graph.inferences.map((inference) => inference.inference_id));
  const inferenceById = new Map(graph.inferences.map((inference) => [inference.inference_id, inference]));
  const validateSubgraphClosure = (
    label: string,
    refs: { fact_ids: readonly string[]; inference_ids: readonly string[] },
  ) => {
    const localFacts = new Set(refs.fact_ids);
    for (const inferenceId of refs.inference_ids) {
      const inference = inferenceById.get(inferenceId);
      if (!inference) continue;
      for (const premise of inference.premises) {
        if (!localFacts.has(premise)) {
          errors.push(`${label} 的 ${inferenceId} 缺少 premise ${premise}（引用的 inference 必须带齐细图前提）`);
        }
      }
      if (!localFacts.has(inference.conclusion)) {
        errors.push(`${label} 的 ${inferenceId} 缺少 conclusion ${inference.conclusion}`);
      }
    }
  };
  const partIds = truthPartIds(truth);
  const hasSubquestions = Boolean(truth.subquestions?.length);
  const resourceIds = new Set(plan.resources.map((resource) => resource.resource_id));
  if (resourceIds.size !== plan.resources.length) errors.push("resource_id 重复");
  const answerTargetsByPart = new Map<string, string[]>();
  for (const partId of partIds) {
    answerTargetsByPart.set(
      hasSubquestions ? partId : "1",
      staticAnswerTargets(
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
      ),
    );
  }

  const regionIds = new Set(plan.solution_regions.map((region) => region.region_id));
  for (const region of plan.solution_regions) {
    for (const factRef of region.fine_refs.fact_ids) {
      if (!factIds.has(factRef)) errors.push(`region ${region.region_id} 引用不存在的 graph fact ${factRef}`);
    }
    for (const inferenceRef of region.fine_refs.inference_ids) {
      if (!inferenceIds.has(inferenceRef)) errors.push(`region ${region.region_id} 引用不存在的 graph inference ${inferenceRef}`);
    }
    validateSubgraphClosure(`region ${region.region_id}`, region.fine_refs);
  }

  for (const chunk of plan.chunks) {
    if (!partIds.includes(hasSubquestions ? chunk.part_id ?? "" : "1")) {
      errors.push(`chunk ${chunk.chunk_id} part_id ${chunk.part_id} 不在题面小问列表`);
    }
    const sourceFacts = new Set(chunk.source_subgraph_refs.fact_ids);
    const sourceInferences = new Set(chunk.source_subgraph_refs.inference_ids);
    for (const factRef of chunk.source_subgraph_refs.fact_ids) {
      if (!factIds.has(factRef)) errors.push(`chunk ${chunk.chunk_id} source subgraph 引用不存在的 graph fact ${factRef}`);
    }
    for (const inferenceRef of chunk.source_subgraph_refs.inference_ids) {
      if (!inferenceIds.has(inferenceRef)) errors.push(`chunk ${chunk.chunk_id} source subgraph 引用不存在的 graph inference ${inferenceRef}`);
    }
    validateSubgraphClosure(`chunk ${chunk.chunk_id} source subgraph`, chunk.source_subgraph_refs);
    for (const group of chunk.presentation_groups) {
      for (const factRef of group.fine_refs.fact_ids) {
        if (!factIds.has(factRef)) errors.push(`chunk ${chunk.chunk_id}/${group.group_id} 引用不存在的 graph fact ${factRef}`);
        else if (!sourceFacts.has(factRef)) {
          errors.push(`presentation group ${group.group_id} 越出 chunk ${chunk.chunk_id} source subgraph（fact ${factRef}）`);
        }
      }
      for (const inferenceRef of group.fine_refs.inference_ids) {
        if (!inferenceIds.has(inferenceRef)) errors.push(`chunk ${chunk.chunk_id}/${group.group_id} 引用不存在的 graph inference ${inferenceRef}`);
        else if (!sourceInferences.has(inferenceRef)) {
          errors.push(`presentation group ${group.group_id} 越出 chunk ${chunk.chunk_id} source subgraph（inference ${inferenceRef}）`);
        }
      }
      validateSubgraphClosure(`presentation group ${group.group_id}`, group.fine_refs);
    }
    for (const regionId of chunk.expandable_region_ids) {
      if (!regionIds.has(regionId)) errors.push(`chunk ${chunk.chunk_id} 引用不存在的 solution region ${regionId}`);
    }
    for (const resourceId of chunk.resource_ids ?? []) {
      if (!resourceIds.has(resourceId)) errors.push(`chunk ${chunk.chunk_id} 引用不存在的 ${resourceId}`);
    }
    for (const resourceId of chunk.teacher_narration_refs) {
      if (!resourceIds.has(resourceId)) errors.push(`chunk ${chunk.chunk_id} 引用不存在的 narration 资源 ${resourceId}`);
    }
  }

  // 11. chunk 图健康（schema superRefine 已挡；materializer 独立复检）
  const chunkIdSet = new Set(plan.chunks.map((chunk) => chunk.chunk_id));
  const adjacency = new Map<string, string[]>([...chunkIdSet].map((id) => [id, [] as string[]]));
  for (const edge of plan.chunk_graph.edges) {
    if (!chunkIdSet.has(edge.from_chunk_id) || !chunkIdSet.has(edge.to_chunk_id)) {
      errors.push(`chunk graph 边悬空：${edge.from_chunk_id} → ${edge.to_chunk_id}`);
      continue;
    }
    adjacency.get(edge.from_chunk_id)!.push(edge.to_chunk_id);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cyclic = (adjacency.get(id) ?? []).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cyclic;
  };
  if ([...chunkIdSet].some(visit)) errors.push("chunk graph 必须无环");
  const reachable = new Set<string>();
  const walk = (id: string) => {
    if (reachable.has(id)) return;
    reachable.add(id);
    for (const next of adjacency.get(id) ?? []) walk(next);
  };
  if (chunkIdSet.has(plan.chunk_graph.entry_chunk_id)) walk(plan.chunk_graph.entry_chunk_id);
  for (const id of chunkIdSet) {
    if (!reachable.has(id)) errors.push(`chunk ${id} 从 entry 不可达`);
  }

  // 12. 数学覆盖不丢：每个 resolution profile 的 chunk 并集覆盖主路线全部细图，
  // 不只检查 goal（否则可用“只放答案节点”伪装同覆盖率）。
  const goalFactIds = graph.facts.filter((fact) => fact.role === "goal").map((fact) => fact.fact_id);
  const primaryVariant = graph.solution_variants[0];
  const primaryInferenceIds = new Set(primaryVariant?.inference_ids ?? []);
  const primaryFactIds = new Set<string>();
  for (const inferenceId of primaryInferenceIds) {
    const inference = inferenceById.get(inferenceId);
    if (!inference) continue;
    for (const premise of inference.premises) primaryFactIds.add(premise);
    primaryFactIds.add(inference.conclusion);
  }
  const chunkById = new Map(plan.chunks.map((chunk) => [chunk.chunk_id, chunk]));
  for (const resolution of plan.resolution_profiles) {
    const covered = new Set<string>();
    const coveredInferences = new Set<string>();
    for (const chunkId of resolution.chunk_ids) {
      const chunk = chunkById.get(chunkId);
      if (!chunk) {
        errors.push(`resolution profile ${resolution.profile_id} 引用不存在的 chunk ${chunkId}`);
        continue;
      }
      for (const factId of chunk.source_subgraph_refs.fact_ids) covered.add(factId);
      for (const inferenceId of chunk.source_subgraph_refs.inference_ids) coveredInferences.add(inferenceId);
    }
    for (const goalFactId of goalFactIds) {
      if (!covered.has(goalFactId)) {
        errors.push(
          `resolution profile ${resolution.profile_id} 的压缩丢失 goal fact ${goalFactId}` +
            `（同一 fine graph 的不同压缩率不得丢失目标，PRD 03 AC-9）`,
        );
      }
    }
    for (const factId of primaryFactIds) {
      if (!covered.has(factId)) {
        errors.push(`resolution profile ${resolution.profile_id} 的压缩丢失主路线 fact ${factId}`);
      }
    }
    for (const inferenceId of primaryInferenceIds) {
      if (!coveredInferences.has(inferenceId)) {
        errors.push(`resolution profile ${resolution.profile_id} 的压缩丢失主路线 inference ${inferenceId}`);
      }
    }
  }

  // Beat 级：solution_refs 双闭合 + gate + truth exposure + inquiry（v2）
  const inquiryRefs = new Set<string>();
  for (const protocol of referencedProtocols.values()) {
    for (const beat of protocol.beats) {
      for (const factRef of beat.solution_refs.fact_ids) {
        if (!factIds.has(factRef)) {
          errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} 引用不存在的 graph fact ${factRef}`);
        }
      }
      for (const inferenceRef of beat.solution_refs.inference_ids) {
        if (!inferenceIds.has(inferenceRef)) {
          errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} 引用不存在的 graph inference ${inferenceRef}`);
        }
      }
      validateSubgraphClosure(`protocol ${protocol.protocol_id} beat ${beat.beat_id}`, beat.solution_refs);
      if (beat.part_id && !partIds.includes(beat.part_id)) {
        errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} part_id ${beat.part_id} 不在题面小问列表`);
      }
      const gate = beat.completion_evidence.gate;
      if (gate?.graph_fact_id && !factIds.has(gate.graph_fact_id)) {
        errors.push(
          `protocol ${protocol.protocol_id} beat ${beat.beat_id} gate ${gate.gate_id} 引用不存在的 graph fact ${gate.graph_fact_id}`,
        );
      }
      if (gate?.graph_fact_id && !beat.solution_refs.fact_ids.includes(gate.graph_fact_id)) {
        errors.push(
          `protocol ${protocol.protocol_id} beat ${beat.beat_id} gate ${gate.gate_id} 指向 ` +
            `${gate.graph_fact_id}，但该 fact 不在当前 Beat solution_refs 内`,
        );
      }
      // truth exposure：reveals_answer fact 只能由学生证据 gate 把关
      if (gate?.graph_fact_id) {
        const fact = factById.get(gate.graph_fact_id);
        if (fact?.reveals_answer && !STUDENT_EVIDENCE_KINDS.has(beat.completion_evidence.evidence_kind)) {
          errors.push(
            `protocol ${protocol.protocol_id} beat ${beat.beat_id} 的 gate 指向 reveals_answer fact ` +
              `${gate.graph_fact_id}，但完成证据是 ${beat.completion_evidence.evidence_kind}（答案真值必须由学生证据把关，ADR-007）`,
          );
        }
      }
      if (beat.support_boundary.may_reveal_answer !== false) {
        errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} support_boundary.may_reveal_answer 必须为 false`);
      }
      for (const resourceId of beat.resource_ids ?? []) {
        if (!resourceIds.has(resourceId)) {
          errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} 引用 bundle 外资源 ${resourceId}`);
        }
      }
      if (beat.inquiry_branch) {
        const ref = beat.inquiry_branch.inquiry_protocol_ref;
        inquiryRefs.add(ref.artifact_id);
        const inquiryProtocol = inputs.protocols.get(ref.artifact_id);
        if (!inquiryProtocol) {
          errors.push(
            `protocol ${protocol.protocol_id} beat ${beat.beat_id} inquiry_branch 引用 ${ref.artifact_id} 不在 current Approved 协议集合中`,
          );
        } else if (!refEquals(ref, inquiryProtocol)) {
          errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} inquiry_branch 引用 ${ref.artifact_id}（stale）`);
        } else if (inquiryProtocol.protocol_kind !== "inquiry" && inquiryProtocol.protocol_kind !== "scaffold") {
          errors.push(
            `inquiry_branch 只能引用 inquiry/scaffold 协议，实际 ${ref.artifact_id} 是 ${inquiryProtocol.protocol_kind}`,
          );
        }
        // 10. 展开区闭合：inquiry 的 expand_region_id 必须是 plan 登记的 region
        if (!regionIds.has(beat.inquiry_branch.expand_region_id)) {
          errors.push(
            `protocol ${protocol.protocol_id} beat ${beat.beat_id} inquiry_branch 引用不存在的 solution region ` +
              `${beat.inquiry_branch.expand_region_id}（局部展开必须锚定 plan 登记的 fine 子图）`,
          );
        }
      }
    }
  }
  // inquiry 引用的协议必须也被某 chunk 引用（进入 bundle 可解析集）
  for (const inquiryId of inquiryRefs) {
    const inChunk = plan.chunks.some((chunk) => chunk.protocol_refs.some((ref) => ref.artifact_id === inquiryId));
    if (!inChunk) {
      errors.push(`inquiry 协议 ${inquiryId} 未被任何 chunk 引用（bundle 不可解析，导入必须 fail closed）`);
    }
  }

  // 每个 reveals_answer fact 必须被至少一个学生证据 gate 把关（F4 复验 P2 口径）
  const studentGatedFacts = new Set<string>();
  for (const protocol of referencedProtocols.values()) {
    for (const beat of protocol.beats) {
      const gate = beat.completion_evidence.gate;
      if (gate?.graph_fact_id && STUDENT_EVIDENCE_KINDS.has(beat.completion_evidence.evidence_kind)) {
        studentGatedFacts.add(gate.graph_fact_id);
      }
    }
  }
  for (const fact of graph.facts) {
    if (fact.reveals_answer && !studentGatedFacts.has(fact.fact_id)) {
      errors.push(
        `graph fact ${fact.fact_id} reveals_answer=true，但没有任何学生证据 gate 把关` +
          `（答案真值必须由 gate+学生证据把关，删除 gate 不得绕过，ADR-007）`,
      );
    }
  }

  // 6. resource 完整性 + truth leak + action_template capability
  for (const resource of plan.resources) {
    const forbiddenKey = containsForbiddenKey(resource);
    if (forbiddenKey) errors.push(`${resource.resource_id} 携带禁止键 ${forbiddenKey}（truth 不得作为资源字段）`);
    const refs = resource.solution_refs;
    for (const factRef of refs?.fact_ids ?? []) {
      if (!factIds.has(factRef)) errors.push(`${resource.resource_id} 引用不存在的 graph fact ${factRef}`);
    }
    for (const inferenceRef of refs?.inference_ids ?? []) {
      if (!inferenceIds.has(inferenceRef)) errors.push(`${resource.resource_id} 引用不存在的 graph inference ${inferenceRef}`);
    }
    if (resource.beat_ref) {
      const owner = [...referencedProtocols.values()].find((protocol) =>
        protocol.beats.some((beat) => beat.beat_id === resource.beat_ref),
      );
      if (!owner) {
        errors.push(`${resource.resource_id} beat_ref ${resource.beat_ref} 不在任何被引用协议的 beats 内`);
      }
    }
    if (!resource.content) continue;
    if (resource.kind === "support" || resource.kind === "voice_seed" || resource.kind === "diagnostic_probe") {
      const normalized = normalizeForMatch(resource.content);
      for (const [partId, targets] of answerTargetsByPart) {
        const hit = targets.find((target) => target && normalized.includes(normalizeForMatch(target)));
        if (hit) {
          errors.push(
            `${resource.resource_id}（${resource.kind}，part ${partId}）泄漏答案值「${hit}」——过早泄题 fail closed`,
          );
        }
      }
    }
    if (resource.kind === "action_template") {
      let template: AuthoredActionTemplate;
      try {
        template = JSON.parse(resource.content) as AuthoredActionTemplate;
      } catch {
        errors.push(`${resource.resource_id} action_template content 不是合法 JSON`);
        continue;
      }
      if (!snapshot.action_kinds.includes(template.kind)) {
        errors.push(`${resource.resource_id} 引用缺失 primitive：ActionKind ${template.kind} 不在 registry`);
        continue;
      }
      const unknown = unknownCapabilities(snapshot, template.capabilities ?? []);
      if (unknown.length) errors.push(`${resource.resource_id} 非法 capability（不在 runtime registry）: ${unknown.join(", ")}`);
      const smoke = smokeActionTemplate(template);
      if (!smoke.ok) errors.push(`${resource.resource_id} render smoke 失败: ${smoke.errors.join("; ")}`);
      const evaluator = evaluatorSmoke(template);
      if (!evaluator.ok) errors.push(`${resource.resource_id} evaluator smoke 失败: ${evaluator.errors.join("; ")}`);
    }
  }

  // 8. registry 版本一致
  if (plan.build_provenance.runtime_registry_version !== snapshot.runtime_registry_version) {
    errors.push(
      `runtime registry 漂移：plan 构建于 ${plan.build_provenance.runtime_registry_version}，` +
        `当前 ${snapshot.runtime_registry_version}（必须重建 plan）`,
    );
  }
  if (plan.build_provenance.compiler_version.length === 0 || plan.build_provenance.materializer_version.length === 0) {
    errors.push("build_provenance 必须绑定 compiler_version 与 materializer_version（计划 §5 F4）");
  }

  return errors.length ? { ok: false, errors } : { ok: true };
}

/** 确定性投影（只读 plan/RG/PR；不改写、不调用模型、不推断教学策略）。 */
export function projectApprovedPlanV5(
  plan: TutorPlanV5Payload,
  inputs: MaterializationV5Inputs,
): { projection: RuntimeProjectionV5; projection_hash: string } {
  const projection: RuntimeProjectionV5 = {
    ...(plan.schema === "ai_teaching_tutor_plan_bundle/v7" ? { resource_bindings: structuredClone(plan.resource_bindings ?? []) } : {}),
    plan_ref: {
      artifact_id: plan.artifact_id,
      version: plan.version,
      content_hash: plan.content_hash,
    },
    solution_graph_ref: { ...plan.solution_graph_ref },
    default_resolution_profile_id: plan.default_resolution_profile_id,
    resolution_profiles: plan.resolution_profiles.map((resolution) => ({
      ...resolution,
      chunk_ids: [...resolution.chunk_ids],
    })),
    chunk_graph: {
      entry_chunk_id: plan.chunk_graph.entry_chunk_id,
      completion_chunk_ids: [...plan.chunk_graph.completion_chunk_ids],
      edges: plan.chunk_graph.edges.map((edge) => ({ ...edge })),
    },
    solution_regions: plan.solution_regions.map((region) => ({
      region_id: region.region_id,
      label: region.label,
      fine_refs: {
        fact_ids: [...region.fine_refs.fact_ids],
        inference_ids: [...region.fine_refs.inference_ids],
      },
      ...(region.local_protocol_refs ? { local_protocol_refs: region.local_protocol_refs.map((ref) => ({ ...ref })) } : {}),
    })),
    chunks: plan.chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      ...(chunk.part_id !== undefined ? { part_id: chunk.part_id } : {}),
      title: chunk.title,
      instructional_intent: chunk.instructional_intent,
      entry_state: chunk.entry_state,
      exit_understanding: chunk.exit_understanding,
      source_subgraph_refs: {
        fact_ids: [...chunk.source_subgraph_refs.fact_ids],
        inference_ids: [...chunk.source_subgraph_refs.inference_ids],
      },
      presentation_groups: chunk.presentation_groups.map((group) => ({
        group_id: group.group_id,
        label: group.label,
        fine_refs: { fact_ids: [...group.fine_refs.fact_ids], inference_ids: [...group.fine_refs.inference_ids] },
      })),
      expandable_region_ids: [...chunk.expandable_region_ids],
      protocols: chunk.protocol_refs.flatMap((ref) => {
        const protocol = inputs.protocols.get(ref.artifact_id);
        if (!protocol) return [];
        return [
          {
            artifact_id: protocol.protocol_id,
            version: protocol.version,
            ...(protocol.schema === "ai_teaching_teaching_protocol/v3" ? { schema: protocol.schema } : {}),
            protocol_kind: protocol.protocol_kind,
            entry_beat_id: protocol.entry_beat_id,
            beats: protocol.beats.map((beat) => ({
              beat_id: beat.beat_id,
              role: beat.role,
              purpose: beat.purpose,
              graph_fact_refs: [...beat.solution_refs.fact_ids],
              inference_refs: [...beat.solution_refs.inference_ids],
              participation: beat.participation,
              ...(protocol.schema === "ai_teaching_teaching_protocol/v3" ? { completion_evidence: structuredClone(beat.completion_evidence) } : {}),
              gate: beat.completion_evidence.gate
                ? {
                    gate_id: beat.completion_evidence.gate.gate_id,
                    requirement: beat.completion_evidence.gate.requirement,
                    graph_fact_id: beat.completion_evidence.gate.graph_fact_id,
                    capability: beat.completion_evidence.gate.capability,
                  }
                : undefined,
              support_boundary: beat.support_boundary,
              transitions: beat.transitions.map((transition) => ({ ...transition })),
              inquiry_branch: beat.inquiry_branch
                ? {
                    artifact_id: beat.inquiry_branch.inquiry_protocol_ref.artifact_id,
                    return_beat_id: beat.inquiry_branch.return_beat_id,
                    expand_region_id: beat.inquiry_branch.expand_region_id,
                    trigger: beat.inquiry_branch.trigger,
                  }
                : undefined,
              resource_ids: [...(beat.resource_ids ?? [])],
            })),
          },
        ];
      }),
      teacher_narration_refs: [...chunk.teacher_narration_refs],
      resource_ids: [...(chunk.resource_ids ?? [])],
    })),
    action_contracts: plan.resources
      .filter((resource) => resource.kind === "action_template" && resource.content)
      .map((resource) => {
        const template = JSON.parse(resource.content as string) as AuthoredActionTemplate;
        const smoke = smokeActionTemplate(template);
        return {
          resource_id: resource.resource_id,
          action_ref: template.actionId,
          learn: smoke.learn as ActionContract,
          assessment: smoke.assessment as ActionContract,
        };
      }),
  };
  const projectionHash = `sha256:${createHash("sha256")
    .update(
      stableStringify({
        materializer_version: MATERIALIZER_V5_VERSION,
        runtime_registry_version: inputs.snapshot.runtime_registry_version,
        plan_content_hash: plan.content_hash,
        solution_graph_content_hash: inputs.graph.content_hash,
        protocol_content_hashes: [...inputs.protocols.values()]
          .map((protocol) => `${protocol.protocol_id}@${protocol.version}:${protocol.content_hash}`)
          .sort(),
        projection,
      }),
      "utf8",
    )
    .digest("hex")}`;
  return { projection, projection_hash: projectionHash };
}

export type MaterializeV5Result =
  | {
      ok: true;
      plan: TutorPlanV5Payload;
      projection: RuntimeProjectionV5;
      projection_hash: string;
    }
  | { ok: false; errors: string[] };

/**
 * materialize：校验全过 → 计算投影与 hash。
 * v5 artifact 不可变（schema additionalProperties:false），投影不回写
 * canonical 对象——导入侧按确定性重算并使用 projection_hash。
 */
export function materializeTutorPlanV5(
  plan: TutorPlanV5Payload,
  inputs: MaterializationV5Inputs,
  options: { requireApproved?: boolean } = {},
): MaterializeV5Result {
  const validation = validateApprovedPlanV5(plan, inputs, options);
  if (!validation.ok) return { ok: false, errors: [...validation.errors] };
  const { projection, projection_hash } = projectApprovedPlanV5(plan, inputs);
  return { ok: true, plan, projection, projection_hash };
}

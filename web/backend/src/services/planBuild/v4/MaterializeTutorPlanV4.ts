/**
 * F4（2026-08-28）deterministic materializer v4（planning/v4 Approved Plan）。
 *
 * 只校验和投影，不推断教学策略、不改写 plan（计划 §5 F4；ADR-007 不变量 7）。
 * 发布/导入前 fail-closed 门禁（全部通过才允许产出投影）：
 *  1. canonical schema（Zod 镜像 RG/PR/TP-v4 dispatch）+ publication
 *     （Approved / 无绝对路径）+ status=Approved；
 *  2. content_hash 自洽（TP 用 plan 排除集；RG/PR 用 authoring 排除集）
 *     与 artifact_uri 一致；
 *  3. stale 绑定：question_ref/approach_set_ref/policy_profile_ref/
 *     solution_graph_ref 必须等于各 registry current Approved（版本+hash），
 *     chunk.protocol_refs 与 beat.inquiry_branch 引用的 PR 同样必须
 *     current Approved 且 hash 一致；
 *  4. graph ref 合法：PR beat 的 graph_fact_refs、gate.graph_fact_id、
 *     resource.graph_fact_refs 必须存在于 RG；beat.part_id 与 RG part 对齐；
 *  5. truth exposure：reveals_answer fact 只能由学生证据 gate 把关
 *     （student_answer/workspace_command/student_confirmation/explicit_gate_pass），
 *     narration_completed/tutor_observed 不得作为答案 fact 的 gate；
 *     support/voice_seed/diagnostic_probe 资源不得含 part 答案值；
 *     任何资源不得携带 canonical_answer/reviewed_solution 键；
 *     support_boundary.may_reveal_answer 恒 false（schema 常量，再断言一次）；
 *  6. resource 完整性：resource_id 唯一、chunk.resource_ids 与 beat
 *     resource_ids 均在 resources 内、resource.beat_ref 指向引用协议内的
 *     beat、PR beat 引用的 resource 必须出现在 bundle；
 *  7. capability：action_template 的 kind 必须在 runtime registry（缺
 *     primitive fail）、capabilities ⊆ registry、render/evaluator smoke 通过；
 *  8. registry 版本一致：build_provenance.runtime_registry_version == snapshot。
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
  type TeachingProtocolPayload,
  type TruthPayload,
  type TutorPlanV4Payload,
  type TutorPolicyProfilePayload,
  canonicalHash,
  truthPartIds,
} from "../canonicalInputs";
import { type RuntimeRegistrySnapshot, unknownCapabilities } from "../RuntimeRegistrySnapshot";

export const MATERIALIZER_V4_VERSION = "tutor-plan-materializer-v4/0.1.0";

export interface MaterializationV4Inputs {
  readonly truth: TruthPayload;
  readonly approachSet: ApproachSetPayload;
  readonly graph: ReviewedSolutionGraphPayload;
  /** plan 引用的全部 PR（chunk refs + inquiry 分支）；key = artifact_id，必须 current Approved。 */
  readonly protocols: ReadonlyMap<string, TeachingProtocolPayload>;
  readonly profile: TutorPolicyProfilePayload;
  readonly snapshot: RuntimeRegistrySnapshot;
}

export type ValidationV4Outcome = { ok: true } | { ok: false; errors: string[] };

export interface RuntimeProjectionV4 {
  plan_ref: { artifact_id: string; version: string; content_hash: string };
  solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  chunks: Array<{
    chunk_id: string;
    part_id?: string;
    protocols: Array<{
      artifact_id: string;
      version: string;
      protocol_kind: TeachingProtocolPayload["protocol_kind"];
      entry_beat_id: string;
      beats: Array<{
        beat_id: string;
        purpose: string;
        graph_fact_refs: string[];
        participation: string;
        gate?: { gate_id: string; requirement: string; graph_fact_id?: string; capability?: string };
        support_boundary: TeachingProtocolPayload["beats"][number]["support_boundary"];
        transitions: Array<{ to_beat: string; on: string }>;
        inquiry_branch?: { artifact_id: string; return_beat_id: string; trigger?: string };
        resource_ids: string[];
      }>;
    }>;
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
  // RG/PR 的 id 字段分别是 graph_id / protocol_id（canonical schema 命名），
  // 与 QT/AS/PP/TP 的 artifact_id 统一在此适配。
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
 * 其余内容门禁全量执行），与 v2 materializer 同一口径。
 */
export function validateApprovedPlanV4(
  plan: TutorPlanV4Payload,
  inputs: MaterializationV4Inputs,
  options: { requireApproved?: boolean } = {},
): ValidationV4Outcome {
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

  // PR 解析与协议级校验
  const referencedProtocols = new Map<string, TeachingProtocolPayload>();
  for (const [chunkIndex, chunk] of plan.chunks.entries()) {
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
    void chunkIndex;
  }

  // 4./5./6. graph ref / truth exposure / resource 完整性
  const factIds = new Set(graph.facts.map((fact) => fact.fact_id));
  const factById = new Map(graph.facts.map((fact) => [fact.fact_id, fact]));
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

  for (const chunk of plan.chunks) {
    const normalizedPart = hasSubquestions ? chunk.part_id : "1";
    if (!partIds.includes(hasSubquestions ? chunk.part_id ?? "" : "1")) {
      errors.push(`chunk ${chunk.chunk_id} part_id ${chunk.part_id} 不在题面小问列表`);
    }
    for (const resourceId of chunk.resource_ids ?? []) {
      if (!resourceIds.has(resourceId)) errors.push(`chunk ${chunk.chunk_id} 引用不存在的 ${resourceId}`);
    }
    void normalizedPart;
  }

  const inquiryRefs = new Set<string>();
  for (const protocol of referencedProtocols.values()) {
    const beatIds = new Set(protocol.beats.map((beat) => beat.beat_id));
    for (const beat of protocol.beats) {
      for (const factRef of beat.graph_fact_refs) {
        if (!factIds.has(factRef)) {
          errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} 引用不存在的 graph fact ${factRef}`);
        }
      }
      if (beat.part_id && !partIds.includes(beat.part_id)) {
        errors.push(`protocol ${protocol.protocol_id} beat ${beat.beat_id} part_id ${beat.part_id} 不在题面小问列表`);
      }
      const gate = beat.completion_evidence.gate;
      if (gate?.graph_fact_id && !factIds.has(gate.graph_fact_id)) {
        errors.push(
          `protocol ${protocol.protocol_id} beat ${beat.beat_id} gate ${gate.gate_id} 引用不存在的 graph fact ${gate.graph_fact_id}`,
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
      }
      void beatIds;
    }
  }
  // inquiry 引用的协议必须也被某 chunk 引用（进入 bundle 可解析集）
  for (const inquiryId of inquiryRefs) {
    const inChunk = plan.chunks.some((chunk) => chunk.protocol_refs.some((ref) => ref.artifact_id === inquiryId));
    if (!inChunk) {
      errors.push(`inquiry 协议 ${inquiryId} 未被任何 chunk 引用（bundle 不可解析，导入必须 fail closed）`);
    }
  }

  // F4 复验修复（2026-08-29，P2）：每个 reveals_answer fact 必须被至少一个学生证据
  // gate 把关（gate.graph_fact_id == fact 且 evidence_kind ∈ 学生证据）。此前仅在
  // gate 存在时检查其指向——把 gate 整个删除（beat 仍引用答案 fact、证据仍写
  // student_answer）即可绕过答案把关（"student evidence 缺 gate"）。
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

  for (const resource of plan.resources) {
    const forbiddenKey = containsForbiddenKey(resource);
    if (forbiddenKey) errors.push(`${resource.resource_id} 携带禁止键 ${forbiddenKey}（truth 不得作为资源字段）`);
    for (const factRef of resource.graph_fact_refs ?? []) {
      if (!factIds.has(factRef)) errors.push(`${resource.resource_id} 引用不存在的 graph fact ${factRef}`);
    }
    if (resource.beat_ref) {
      const owner = [...referencedProtocols.values()].find((protocol) =>
        protocol.beats.some((beat) => beat.beat_id === resource.beat_ref),
      );
      if (!owner) {
        errors.push(`${resource.resource_id} beat_ref ${resource.beat_ref} 不在任何被引用协议的 beats 内`);
      }
    }
    // truth leak：support/voice_seed/diagnostic_probe 不得含 part 答案值
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
      if (!resource.content) {
        errors.push(`${resource.resource_id} action_template 缺少 content`);
        continue;
      }
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
export function projectApprovedPlanV4(
  plan: TutorPlanV4Payload,
  inputs: MaterializationV4Inputs,
): { projection: RuntimeProjectionV4; projection_hash: string } {
  const projection: RuntimeProjectionV4 = {
    plan_ref: {
      artifact_id: plan.artifact_id,
      version: plan.version,
      content_hash: plan.content_hash,
    },
    solution_graph_ref: { ...plan.solution_graph_ref },
    chunks: plan.chunks.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      part_id: chunk.part_id,
      protocols: chunk.protocol_refs.flatMap((ref) => {
        const protocol = inputs.protocols.get(ref.artifact_id);
        if (!protocol) return [];
        return [
          {
            artifact_id: protocol.protocol_id,
            version: protocol.version,
            protocol_kind: protocol.protocol_kind,
            entry_beat_id: protocol.entry_beat_id,
            beats: protocol.beats.map((beat) => ({
              beat_id: beat.beat_id,
              purpose: beat.purpose,
              graph_fact_refs: [...beat.graph_fact_refs],
              participation: beat.participation,
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
                    trigger: beat.inquiry_branch.trigger,
                  }
                : undefined,
              resource_ids: [...(beat.resource_ids ?? [])],
            })),
          },
        ];
      }),
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
        materializer_version: MATERIALIZER_V4_VERSION,
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

export type MaterializeV4Result =
  | {
      ok: true;
      plan: TutorPlanV4Payload;
      projection: RuntimeProjectionV4;
      projection_hash: string;
    }
  | { ok: false; errors: string[] };

/**
 * materialize：校验全过 → 计算投影与 hash。
 * v4 artifact 不可变（schema additionalProperties:false 无 runtime_projection
 * 字段），投影不回写 canonical 对象——导入侧按确定性重算并使用 projection_hash。
 */
export function materializeTutorPlanV4(
  plan: TutorPlanV4Payload,
  inputs: MaterializationV4Inputs,
  options: { requireApproved?: boolean } = {},
): MaterializeV4Result {
  const validation = validateApprovedPlanV4(plan, inputs, options);
  if (!validation.ok) return { ok: false, errors: [...validation.errors] };
  const { projection, projection_hash } = projectApprovedPlanV4(plan, inputs);
  return { ok: true, plan, projection, projection_hash };
}

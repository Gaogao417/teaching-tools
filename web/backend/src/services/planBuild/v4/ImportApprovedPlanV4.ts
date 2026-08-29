/**
 * F4（2026-08-28）tools plan importer（planning/v4）：Runtime 侧消费
 * Approved Plan 的唯一入口。
 *
 * 只接 Approved、hash-verified artifact（计划 §5 F4 / §3.1）：从 artifact
 * registry（skills 仓 canonical-authoring 镜像）解析一题 Approved Plan 的
 * 全链——TP v4 → QuestionTruth / ApproachSet / ReviewedSolutionGraph /
 * TeachingProtocols（chunk 引用 + inquiry 分支）/ TutorPolicyProfile——
 * 每个 ref 都按 registry current_version 的 Approved payload 做 version+hash
 * 对账（stale 即 fail closed），再经 deterministic materializer 校验与投影。
 *
 * F4 复验修复（2026-08-29）：全部装载走 anchored 模式——loader 层对每个上游
 * 执行 canonical schema 校验（39-schema dispatch，schema 非法即拒）与
 * registry 锚定三方对账（payload.content_hash == registry 锚定 hash ==
 * 重算 hash，同版本覆盖+重算自身 hash 不再可绕过）。
 *
 * invalid / stale / missing capability 一律 fail closed；本模块不补造任何
 * 缺失的教学真值或 Protocol（ADR-007 不变量 1/7）。
 */
import {
  type ReviewedSolutionGraphPayload,
  type TeachingProtocolPayload,
  type TruthPayload,
  type ApproachSetPayload,
  type TutorPlanV4Payload,
  type TutorPolicyProfilePayload,
  type CanonicalRegistries,
  loadApprovedApproachSet,
  loadApprovedPolicyProfile,
  loadApprovedSolutionGraph,
  loadApprovedTeachingProtocol,
  loadApprovedTruth,
  loadCurrentPlanV4,
} from "../canonicalInputs";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import {
  type RuntimeProjectionV4,
  type MaterializationV4Inputs,
  MATERIALIZER_V4_VERSION,
  materializeTutorPlanV4,
} from "./MaterializeTutorPlanV4";

export interface ImportedApprovedPlanV4 {
  readonly plan: TutorPlanV4Payload;
  readonly truth: TruthPayload;
  readonly approachSet: ApproachSetPayload;
  readonly graph: ReviewedSolutionGraphPayload;
  /** chunk 引用 + inquiry 分支引用的全部协议（key = artifact_id）。 */
  readonly protocols: ReadonlyMap<string, TeachingProtocolPayload>;
  readonly profile: TutorPolicyProfilePayload;
  readonly projection: RuntimeProjectionV4;
  readonly projection_hash: string;
  readonly materializer_version: string;
  readonly runtime_registry_version: string;
}

export type ImportPlanV4Result =
  | { ok: true; imported: ImportedApprovedPlanV4 }
  | { ok: false; errors: string[] };

/**
 * 解析 + 跨仓（canonical schema 镜像）验证 + 确定性 materialize 一题
 * Approved Plan。snapshot 缺省取当前代码基线的 runtime registry（导入侧
 * 对 build_provenance.runtime_registry_version 做 fail-closed 对账）。
 */
export function importApprovedPlanV4(
  deps: CanonicalRegistries,
  tpId: string,
  options: { snapshot?: ReturnType<typeof buildRuntimeRegistrySnapshot> } = {},
): ImportPlanV4Result {
  const errors: string[] = [];
  // v4 供应链 fail closed：loader 层启用 canonical schema 校验 + registry 锚定三方对账
  const registries: CanonicalRegistries = { canonicalRoot: deps.canonicalRoot, anchored: true };
  const plan = loadCurrentPlanV4(registries, tpId);
  if (!plan.ok) return { ok: false, errors: plan.errors };
  const payload = plan.payload;

  const truth = loadApprovedTruth(registries, payload.question_ref.artifact_id);
  if (!truth.ok) return { ok: false, errors: truth.errors };
  const approachSet = loadApprovedApproachSet(registries, payload.approach_set_ref.artifact_id);
  if (!approachSet.ok) return { ok: false, errors: approachSet.errors };
  const profile = loadApprovedPolicyProfile(registries, payload.policy_profile_ref.artifact_id);
  if (!profile.ok) return { ok: false, errors: profile.errors };
  const graph = loadApprovedSolutionGraph(registries, payload.solution_graph_ref.artifact_id);
  if (!graph.ok) return { ok: false, errors: graph.errors };

  // 协议集：chunk 引用 + mainline beats 的 inquiry 分支引用（先解析 chunk，
  // inquiry 引用在 materializer 内按已解析集合校验，缺一不可）。
  const protocolIds = new Set<string>();
  for (const ref of payload.chunks.flatMap((chunk) => chunk.protocol_refs)) protocolIds.add(ref.artifact_id);
  // inquiry 引用藏在 PR 内部，需要先装载 chunk 引用的协议才能发现；
  // 发现后再补装载（两轮固定点，PR 内 inquiry 不得指向未装载协议）。
  const protocols = new Map<string, TeachingProtocolPayload>();
  let round = 0;
  const pending = new Set(protocolIds);
  while (pending.size && round < 4) {
    round += 1;
    for (const prId of [...pending]) {
      pending.delete(prId);
      if (protocols.has(prId)) continue;
      const protocol = loadApprovedTeachingProtocol(registries, prId);
      if (!protocol.ok) {
        errors.push(...protocol.errors);
        continue;
      }
      protocols.set(prId, protocol.payload);
      for (const beat of protocol.payload.beats) {
        const inquiryId = beat.inquiry_branch?.inquiry_protocol_ref.artifact_id;
        if (inquiryId && !protocols.has(inquiryId)) pending.add(inquiryId);
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const snapshot = options.snapshot ?? buildRuntimeRegistrySnapshot();
  const inputs: MaterializationV4Inputs = {
    truth: truth.payload,
    approachSet: approachSet.payload,
    graph: graph.payload,
    protocols,
    profile: profile.payload,
    snapshot,
  };
  const materialized = materializeTutorPlanV4(payload, inputs);
  if (!materialized.ok) return { ok: false, errors: materialized.errors };

  return {
    ok: true,
    imported: {
      plan: payload,
      truth: truth.payload,
      approachSet: approachSet.payload,
      graph: graph.payload,
      protocols,
      profile: profile.payload,
      projection: materialized.projection,
      projection_hash: materialized.projection_hash,
      materializer_version: MATERIALIZER_V4_VERSION,
      runtime_registry_version: snapshot.runtime_registry_version,
    },
  };
}

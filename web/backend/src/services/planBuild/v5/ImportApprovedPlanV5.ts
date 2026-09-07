import { validatePlanV7WorkspaceBindings } from "../v7/ValidatePlanV7WorkspaceBindings";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";
/**
 * F4 多分辨率补救（2026-09-01）tools plan importer（planning/v5）：Runtime 侧
 * 消费 Approved 多分辨率 Plan 的唯一入口。
 *
 * 与 v4 importer 同一条纪律（计划 §5 F4 / §3.1）：从 artifact registry 解析
 * 一题 Approved Plan 的全链——TP v5 → QuestionTruth / ApproachSet /
 * ReviewedSolutionGraph / TeachingProtocols v2（chunk 引用 + inquiry 分支）/
 * TutorPolicyProfile——每个 ref 都按 registry current_version 的 Approved
 * payload 做 version+hash 对账（stale 即 fail closed），再经 deterministic
 * materializer v5 校验与投影（含细图引用闭合、region 闭合、chunk 图健康与
 * 数学覆盖不丢）。
 *
 * invalid / stale / missing capability 一律 fail closed；本模块不补造任何
 * 缺失的教学真值或 Protocol（ADR-007 不变量 1/7）。
 */
import {
  type ReviewedSolutionGraphPayload,
  type TeachingProtocolV2Payload,
  type TruthPayload,
  type ApproachSetPayload,
  type TutorPlanV5Payload,
  type TutorPolicyProfilePayload,
  type CanonicalRegistries,
  loadApprovedApproachSet,
  loadApprovedPolicyProfile,
  loadApprovedSolutionGraph,
  loadApprovedTeachingProtocolV2,
  loadApprovedTruth,
  loadCurrentPlanV5,
} from "../canonicalInputs";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import {
  type RuntimeProjectionV5,
  type MaterializationV5Inputs,
  MATERIALIZER_V5_VERSION,
  materializeTutorPlanV5,
} from "./MaterializeTutorPlanV5";

export interface ImportedApprovedPlanV5 {
  readonly plan: TutorPlanV5Payload;
  readonly truth: TruthPayload;
  readonly approachSet: ApproachSetPayload;
  readonly graph: ReviewedSolutionGraphPayload;
  /** chunk 引用 + inquiry 分支引用的全部协议 v2（key = artifact_id）。 */
  readonly protocols: ReadonlyMap<string, TeachingProtocolV2Payload>;
  readonly profile: TutorPolicyProfilePayload;
  readonly projection: RuntimeProjectionV5;
  readonly projection_hash: string;
  readonly materializer_version: string;
  readonly runtime_registry_version: string;
}

export type ImportPlanV5Result =
  | { ok: true; imported: ImportedApprovedPlanV5 }
  | { ok: false; errors: string[] };

/**
 * 解析 + 跨仓（canonical schema 镜像）验证 + 确定性 materialize 一题
 * Approved 多分辨率 Plan。snapshot 缺省取当前代码基线的 runtime registry。
 */
export function importApprovedPlanV5(
  deps: CanonicalRegistries,
  tpId: string,
  options: { snapshot?: ReturnType<typeof buildRuntimeRegistrySnapshot>; workspaceCatalog?: WorkspacePresentationCatalogV5 } = {},
): ImportPlanV5Result {
  const errors: string[] = [];
  // v5 供应链 fail closed：loader 层启用 canonical schema 校验 + registry 锚定三方对账
  const registries: CanonicalRegistries = { canonicalRoot: deps.canonicalRoot, anchored: true };
  const plan = loadCurrentPlanV5(registries, tpId);
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

  // Historical loader name reads both protocol/v2 and protocol/v3; preserves markers.
  // 协议集：chunk 引用 + beats 的 inquiry 分支引用（两轮固定点，与 v4 同口径）。
  const protocolIds = new Set<string>();
  for (const ref of payload.chunks.flatMap((chunk) => chunk.protocol_refs)) protocolIds.add(ref.artifact_id);
  const protocols = new Map<string, TeachingProtocolV2Payload>();
  let round = 0;
  const pending = new Set(protocolIds);
  while (pending.size && round < 4) {
    round += 1;
    for (const prId of [...pending]) {
      pending.delete(prId);
      if (protocols.has(prId)) continue;
      const protocol = loadApprovedTeachingProtocolV2(registries, prId);
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
  const inputs: MaterializationV5Inputs = {
    truth: truth.payload,
    approachSet: approachSet.payload,
    graph: graph.payload,
    protocols,
    profile: profile.payload,
    snapshot,
  };
  const materialized = materializeTutorPlanV5(payload, inputs);
  if (!materialized.ok) return { ok: false, errors: materialized.errors };

  const imported: ImportedApprovedPlanV5 = {
      plan: payload,
      truth: truth.payload,
      approachSet: approachSet.payload,
      graph: graph.payload,
      protocols,
      profile: profile.payload,
      projection: materialized.projection,
      projection_hash: materialized.projection_hash,
      materializer_version: MATERIALIZER_V5_VERSION,
      runtime_registry_version: snapshot.runtime_registry_version,
  };
  try {
    const bindingErrors = validatePlanV7WorkspaceBindings(imported, options.workspaceCatalog);
    if (bindingErrors.length) return { ok: false, errors: bindingErrors };
  } catch (error) { return { ok: false, errors: [String(error)] }; }
  return { ok: true, imported };
}

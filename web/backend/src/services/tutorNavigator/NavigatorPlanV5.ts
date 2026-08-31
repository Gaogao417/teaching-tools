/**
 * NavigatorPlanV5（F5 — Session 与 Protocol Navigator 内核）。
 *
 * Pinned Plan 的只读导航索引与 v5 session_started payload 构造器：
 * - 输入是 F4 importer 的真实产物（ImportedApprovedPlanV4：TP-SMV-009@v1 →
 *   QT/AS/RG/PP + PR 两轮固定点 + materializer 门禁），**不用 fixture 发明
 *   教学结构**（计划 §5 F4/F5；f4-scope-ledger 输出 5 是 Plan 输入唯一入口）；
 * - 产出 Navigator 侧索引：mainline 协议、inquiry/scaffold 分支协议、beat/gate
 *   map、transition 表、pacing、support boundary、inquiry branch、RG facts 与
 *   solution variants——Navigator（TutorNavigatorV5）只在 PR beats.transitions
 *   声明的出边内选择（ADR-007 §2）；
 * - session_started payload 是全量 pin 真源（tutor_plan_ref/solution_graph_ref/
 *   protocol_refs/policy_profile_snapshot/initial_cursor），F2 start 原子写入；
 * - fail closed：chunk 引用的 mainline 协议必须恰一个；session pin 的协议集
 *   与 imported.protocols 逐一对应（缺协议/多协议即拒）；beat 引用的 fact 不在
 *   RG 内即拒（materializer 已挡，本层防御性收口）。
 */
import type { ImportedApprovedPlanV4 } from "../planBuild/v4/ImportApprovedPlanV4";
import type {
  GraphFactNode,
  ProtocolBeatPayload,
  SolutionVariantNode,
  TeachingProtocolPayload,
} from "../planBuild/canonicalInputs";
import type { V5SessionStartedPayload } from "../tutorSession/TutorSessionEventV5";

/** Beat 的 Navigator 只读视图（字段名对齐 canonical teaching-protocol/v1）。 */
export interface NavigatorBeatView {
  readonly beat_id: string;
  readonly protocol_id: string;
  readonly part_id?: string;
  readonly purpose: string;
  readonly graph_fact_refs: readonly string[];
  readonly cognitive_activity: ProtocolBeatPayload["cognitive_activity"];
  readonly completion_evidence: ProtocolBeatPayload["completion_evidence"];
  readonly participation: ProtocolBeatPayload["participation"];
  readonly pacing: ProtocolBeatPayload["pacing"];
  readonly resource_ids: readonly string[];
  readonly support_boundary: ProtocolBeatPayload["support_boundary"];
  readonly transitions: ReadonlyArray<{ to_beat: string; on: ProtocolBeatPayload["transitions"][number]["on"] }>;
  readonly inquiry_branch?: ProtocolBeatPayload["inquiry_branch"];
}

export interface NavigatorProtocolView {
  readonly protocol_id: string;
  readonly version: string;
  readonly content_hash: string;
  readonly protocol_kind: TeachingProtocolPayload["protocol_kind"];
  readonly entry_beat_id: string;
  /** beat_id → view（顺序保留在 beat_order）。 */
  readonly beats: ReadonlyMap<string, NavigatorBeatView>;
  readonly beat_order: readonly string[];
}

export interface NavigatorPlanV5 {
  readonly tutor_plan_ref: { artifact_id: string; version: string; content_hash: string };
  readonly question_ref: { artifact_id: string; version: string; content_hash: string };
  readonly approach_set_ref: { artifact_id: string; version: string; content_hash: string };
  readonly solution_graph_ref: { artifact_id: string; version: string; content_hash: string };
  readonly policy_profile_ref: { artifact_id: string; version: string; content_hash: string };
  readonly mainline: NavigatorProtocolView;
  /** session pin 的 inquiry/scaffold/verification 分支协议（key=artifact_id）。 */
  readonly branches: ReadonlyMap<string, NavigatorProtocolView>;
  /** RG facts（key=fact_id）。 */
  readonly facts: ReadonlyMap<string, GraphFactNode>;
  /** RG inferences（key=inference_id；替代路线匹配基准）。 */
  readonly graph_inferences: ReadonlyMap<string, import("../planBuild/canonicalInputs").GraphInferenceNode>;
  readonly solution_variants: readonly SolutionVariantNode[];
  /**
   * Pinned Plan 资源 id 集（TP v4 resources + chunk resource_refs；2026-08-31
   * R1：LocalInquiryProtocol 的 resource_ids 边界校验真源——批准边界内的
   * session-local 协议只能引用 Pinned Plan 已批准资源，ADR-007 §3）。
   */
  readonly pinned_resource_ids: ReadonlySet<string>;
  readonly profile_snapshot: {
    profile_id: string;
    version: string;
    primary_provider: string;
    fallback_provider: string;
    model_id: string;
    prompt_version: string;
  };
}

export class NavigatorPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NavigatorPlanError";
  }
}

function protocolView(protocol: TeachingProtocolPayload): NavigatorProtocolView {
  const beats = new Map<string, NavigatorBeatView>();
  const order: string[] = [];
  for (const beat of protocol.beats) {
    const view: NavigatorBeatView = {
      beat_id: beat.beat_id,
      protocol_id: protocol.protocol_id,
      ...(beat.part_id !== undefined ? { part_id: beat.part_id } : {}),
      purpose: beat.purpose,
      graph_fact_refs: beat.graph_fact_refs,
      cognitive_activity: beat.cognitive_activity,
      completion_evidence: beat.completion_evidence,
      participation: beat.participation,
      pacing: beat.pacing,
      resource_ids: beat.resource_ids ?? [],
      support_boundary: beat.support_boundary,
      transitions: beat.transitions,
      ...(beat.inquiry_branch ? { inquiry_branch: beat.inquiry_branch } : {}),
    };
    beats.set(beat.beat_id, view);
    order.push(beat.beat_id);
  }
  return {
    protocol_id: protocol.protocol_id,
    version: protocol.version,
    content_hash: protocol.content_hash,
    protocol_kind: protocol.protocol_kind,
    entry_beat_id: protocol.entry_beat_id,
    beats,
    beat_order: order,
  };
}

/**
 * 从 F4 importer 真实产物构建导航索引。入口身份（taskId/scenarioId）的真源是
 * f0-golden-lineage-manifest §1（真实 /learn/:taskId 与 scenario 维度），由
 * 调用方在 buildSessionStartedPayload 显式传入，本模块不从 plan 猜测入口身份。
 */
export function buildNavigatorPlan(imported: ImportedApprovedPlanV4): NavigatorPlanV5 {
  // mainline 协议：chunk 引用的协议中 protocol_kind=mainline 必须恰一个。
  const chunkProtocolIds = new Set<string>();
  for (const ref of imported.plan.chunks.flatMap((chunk) => chunk.protocol_refs)) {
    chunkProtocolIds.add(ref.artifact_id);
  }
  const mainlineIds = [...chunkProtocolIds].filter((id) => {
    const protocol = imported.protocols.get(id);
    if (!protocol) {
      throw new NavigatorPlanError(`chunk references protocol ${id} missing from imported set`);
    }
    return protocol.protocol_kind === "mainline";
  });
  if (mainlineIds.length !== 1) {
    throw new NavigatorPlanError(
      `plan must reference exactly one mainline protocol (got ${mainlineIds.length}: ${mainlineIds.join(",")})`,
    );
  }
  const mainlinePayload = imported.protocols.get(mainlineIds[0]) as TeachingProtocolPayload;

  // session pin 协议集：chunk 引用 + beats 的 inquiry 分支（与 importer 同一
  // 固定点）；imported.protocols 内不得有未进 pin 集的协议（悬挂协议）。
  const pinnedIds = new Set<string>(chunkProtocolIds);
  for (const protocol of imported.protocols.values()) {
    for (const beat of protocol.beats) {
      const branchId = beat.inquiry_branch?.inquiry_protocol_ref.artifact_id;
      if (branchId) pinnedIds.add(branchId);
    }
  }
  for (const id of imported.protocols.keys()) {
    if (!pinnedIds.has(id)) {
      throw new NavigatorPlanError(`imported protocol ${id} is not reachable from plan chunks/inquiry branches`);
    }
  }
  for (const id of pinnedIds) {
    if (!imported.protocols.has(id)) {
      throw new NavigatorPlanError(`pinned protocol ${id} missing from imported set`);
    }
  }

  const branches = new Map<string, NavigatorProtocolView>();
  for (const protocol of imported.protocols.values()) {
    if (protocol.protocol_id === mainlinePayload.protocol_id) continue;
    branches.set(protocol.protocol_id, protocolView(protocol));
  }

  const facts = new Map<string, GraphFactNode>();
  for (const fact of imported.graph.facts) facts.set(fact.fact_id, fact);
  const inferences = new Map<string, import("../planBuild/canonicalInputs").GraphInferenceNode>();
  for (const inference of imported.graph.inferences) inferences.set(inference.inference_id, inference);

  // 防御性收口：协议 beat 引用的 fact 必须在 RG 内（materializer 已挡）。
  for (const protocol of imported.protocols.values()) {
    for (const beat of protocol.beats) {
      for (const factId of beat.graph_fact_refs) {
        if (!facts.has(factId)) {
          throw new NavigatorPlanError(
            `beat ${protocol.protocol_id}/${beat.beat_id} references unknown graph fact ${factId}`,
          );
        }
      }
      const gateFact = beat.completion_evidence.gate?.graph_fact_id;
      if (gateFact && !facts.has(gateFact)) {
        throw new NavigatorPlanError(
          `beat ${protocol.protocol_id}/${beat.beat_id} gate references unknown graph fact ${gateFact}`,
        );
      }
    }
  }

  const profile = imported.profile;
  const pinnedResourceIds = new Set<string>();
  for (const resource of imported.plan.resources) pinnedResourceIds.add(resource.resource_id);
  for (const chunk of imported.plan.chunks) {
    for (const resourceId of chunk.resource_ids ?? []) pinnedResourceIds.add(resourceId);
  }
  return {
    tutor_plan_ref: {
      artifact_id: imported.plan.artifact_id,
      version: imported.plan.version,
      content_hash: imported.plan.content_hash,
    },
    question_ref: { ...imported.plan.question_ref },
    approach_set_ref: { ...imported.plan.approach_set_ref },
    solution_graph_ref: { ...imported.plan.solution_graph_ref },
    policy_profile_ref: { ...imported.plan.policy_profile_ref },
    mainline: protocolView(mainlinePayload),
    branches,
    facts,
    graph_inferences: inferences,
    solution_variants: imported.graph.solution_variants,
    pinned_resource_ids: pinnedResourceIds,
    profile_snapshot: {
      profile_id: profile.artifact_id,
      version: profile.profile_version,
      primary_provider: profile.primary_provider,
      fallback_provider: profile.fallback_provider,
      model_id: profile.model_id,
      prompt_version: profile.prompt_version,
    },
  };
}

/**
 * 推理区域的 RG inference 集（确定性拓扑规则，2026-08-31 R1）：一个 inference
 * 属于事实区域 iff 其 conclusion 在区域内（建立该区域事实的推理步），或其
 * premises 全部在区域内（完全消费区域事实的推理步）。空集合法（如纯 given
 * 区域无 conclusion 推理步时调用方须按合同省略 alignment，不得伪造引用）。
 */
export function regionInferenceIds(
  plan: NavigatorPlanV5,
  factIds: readonly string[],
): string[] {
  const region = new Set(factIds);
  const inferenceIds: string[] = [];
  for (const [inferenceId, inference] of plan.graph_inferences) {
    const establishes = region.has(inference.conclusion);
    const consumesFully = inference.premises.length > 0 && inference.premises.every((premise) => region.has(premise));
    if (establishes || consumesFully) inferenceIds.push(inferenceId);
  }
  return inferenceIds.sort((left, right) => (left < right ? -1 : 1));
}

/** 构造 v5 session_started payload（全量 pin；initial_cursor=mainline entry beat）。 */
export function buildSessionStartedPayload(
  plan: NavigatorPlanV5,
  ids: { sessionId: string; taskId: string; scenarioId: string },
): V5SessionStartedPayload {
  const protocolRefs = [
    {
      artifact_id: plan.mainline.protocol_id,
      version: plan.mainline.version,
      content_hash: plan.mainline.content_hash,
    },
    ...[...plan.branches.values()].map((branch) => ({
      artifact_id: branch.protocol_id,
      version: branch.version,
      content_hash: branch.content_hash,
    })),
  ];
  return {
    task_id: ids.taskId,
    scenario_id: ids.scenarioId,
    question_ref: { ...plan.question_ref },
    approach_set_ref: { ...plan.approach_set_ref },
    solution_graph_ref: { ...plan.solution_graph_ref },
    protocol_refs: protocolRefs,
    tutor_plan_ref: { ...plan.tutor_plan_ref },
    policy_profile_snapshot: { ...plan.profile_snapshot },
    initial_cursor: {
      protocol_id: plan.mainline.protocol_id,
      beat_id: plan.mainline.entry_beat_id,
    },
  };
}

/** session pin 内是否存在该协议（inquiry 决策引用协议前的 fail-closed 检查）。 */
export function protocolIsPinned(plan: NavigatorPlanV5, protocolId: string): boolean {
  return plan.mainline.protocol_id === protocolId || plan.branches.has(protocolId);
}

/** 查找 pin 内协议视图（mainline 或分支）。 */
export function pinnedProtocol(plan: NavigatorPlanV5, protocolId: string): NavigatorProtocolView | undefined {
  if (plan.mainline.protocol_id === protocolId) return plan.mainline;
  return plan.branches.get(protocolId);
}

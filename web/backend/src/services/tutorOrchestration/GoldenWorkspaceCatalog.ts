/**
 * GoldenWorkspaceCatalog（F6 — F3「BE- 条目分配接口」绑定 F4 materializer 真实产物；
 * f6-scope-ledger 输出 1）。
 *
 * F3 冻结口径（WorkspacePresentationCatalogV5 文件头）：Board 呈现物不在
 * state/v1，由任务级 immutable catalog 提供；「绑定 F4 materializer 真实产物
 * （RG 节点呈现物）属 F6 Presenter 接线」——本模块即该接线：
 * - RG facts（FN-）→ Board entries（BE-，按 fact 顺序分配）：
 *   role=given → statement；role=goal → conclusion；其余 → derivation；
 * - reveal 语义（truth boundary）：`reveals_answer=true` 或 role=goal 的 fact →
 *   final 条目，revealGate 五级绑定 = 以 `gate.graph_fact_id` 绑定该 fact 的
 *   主线 completion gate（gate/beat/protocol 三元组取自 pinned Plan；找不到唯
 *   一绑定 → fail closed，不得产出无 reveal 语义的 final catalog——R2 纪律）；
 *   其余 → intermediate（beat 呈现时经 tutor board.reveal-entry 授权暴露）；
 * - presentationGroup：按首个引用该 fact 的主线 Beat 分组（PG-01..）；无 Beat
 *   引用的 fact 归入最后一组；
 * - canonicalPathEntryIds：SV-01 主线 variant 的推理建立序（given 起步 + 按
 *   inference 结论顺序）；
 * - baseGeometry：golden 任务 authored 题图（QT truth 无图字段——题干「如图」
 *   的既有讲义图，代码级 authored 呈现物；登记 f6 偏差：未来应升 F4/F8 发布
 *   产物，替换点=本常量）。
 *
 * 全部经 `buildWorkspacePresentationCatalog`（F3 公开构造器，fail closed）组装，
 * 本模块不绕过其校验。
 */
import { beatFactIds, type TeachingProtocolAnyPayload } from "../planBuild/canonicalInputs";
import type { ImportedApprovedPlanV4 } from "../planBuild/v4/ImportApprovedPlanV4";
import type { ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import {
  buildWorkspacePresentationCatalog,
  type WorkspacePresentationCatalogV5,
} from "../tutorSession/WorkspacePresentationCatalogV5";

export const GOLDEN_CATALOG_TASK_ID = "goldenMinhangFold2020";

/**
 * golden 题图（等腰 △ABC：AB=AC=4、BC=6；D 在 BC 上且 ∠DAC=∠ACD）。
 * 坐标按 AB=AC=4、BC=6、A=(3,√7) 解析布点；E 为翻折产出（不在 authored 基座，
 * 由解题构图产生）。segment-* id 与 F3 测试/View kind 前缀纪律对齐。
 */
function goldenBaseGeometry(): TopicGeometryModel {
  const h = Math.sqrt(7); // AB=AC=4, BC=6 → 高 = √(16−9)
  const d = 10 / 3; // △CAD∽△CBA ⇒ BD=10/3、DC=AD=8/3
  return {
    viewBox: { width: 400, height: 300 },
    points: [
      { id: "A", x: 200, y: 300 - h * 30, derived: false },
      { id: "B", x: 20, y: 280, derived: false },
      { id: "C", x: 380, y: 280, derived: false },
      { id: "D", x: 20 + (360 * d) / 6, y: 280, derived: false },
    ],
    segments: [
      { id: "segment-AB", from: "A", to: "B", derived: false },
      { id: "segment-AC", from: "A", to: "C", derived: false },
      { id: "segment-BC", from: "B", to: "C", derived: false },
      { id: "segment-AD", from: "A", to: "D", derived: false },
      { id: "segment-DC", from: "D", to: "C", derived: false },
      { id: "segment-BD", from: "B", to: "D", derived: false },
    ],
  };
}

function goldenAuthoredKinds(): Record<string, "point" | "segment"> {
  return {
    A: "point",
    B: "point",
    C: "point",
    D: "point",
    "segment-AB": "segment",
    "segment-AC": "segment",
    "segment-BC": "segment",
    "segment-AD": "segment",
    "segment-DC": "segment",
    "segment-BD": "segment",
  };
}

export interface GoldenWorkspaceCatalog {
  readonly catalog: WorkspacePresentationCatalogV5;
  /** fact_id → Board entry id（Presenter：Beat graph_fact_refs → 呈现条目）。 */
  readonly factEntryIds: ReadonlyMap<string, string>;
}

export class GoldenCatalogError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`golden workspace catalog assembly failed (fail closed): ${errors.join("; ")}`);
    this.name = "GoldenCatalogError";
  }
}

/**
 * 从 F4 importer 真实产物装配 golden catalog（确定性纯函数；同 plan → 同
 * catalog → 同 catalog pin）。final 条目必须找到唯一 gate 绑定，否则 fail
 * closed（不得产出可被任意 gate reveal 的 catalog——R2 五级绑定纪律）。
 */
export function buildGoldenWorkspaceCatalogV5(imported: ImportedApprovedPlanV4 | ImportedApprovedPlanV5): GoldenWorkspaceCatalog {
  // mainline 协议（importer/buildNavigatorPlan 保证恰一个；此处独立复核）。
  const mainlines = [...imported.protocols.values()].filter(
    (protocol) => protocol.protocol_kind === "mainline",
  );
  if (mainlines.length !== 1) {
    throw new GoldenCatalogError([`expected exactly one mainline protocol, got ${mainlines.length}`]);
  }
  const mainline: TeachingProtocolAnyPayload = mainlines[0];

  // gate 绑定索引：graph_fact_id → {gate, beat}（主线 completion gates）。
  const gateByFact = new Map<
    string,
    { gateId: string; beatId: string; protocolId: string }
  >();
  for (const beat of mainline.beats) {
    const gate = beat.completion_evidence.gate;
    if (gate?.graph_fact_id) {
      const existing = gateByFact.get(gate.graph_fact_id);
      if (existing) {
        throw new GoldenCatalogError([
          `fact ${gate.graph_fact_id} is bound by two mainline gates (${existing.gateId}@${existing.beatId} and ${gate.gate_id}@${beat.beat_id})`,
        ]);
      }
      gateByFact.set(gate.graph_fact_id, {
        gateId: gate.gate_id,
        beatId: beat.beat_id,
        protocolId: mainline.protocol_id,
      });
    }
  }

  // fact → 首个引用主线 Beat（presentationGroup 分组依据）。
  const beatIndexByFact = new Map<string, number>();
  mainline.beats.forEach((beat, index) => {
    for (const factId of beatFactIds(beat)) {
      if (!beatIndexByFact.has(factId)) beatIndexByFact.set(factId, index);
    }
  });

  const facts = imported.graph.facts;
  if (facts.length === 0 || facts.length > 99) {
    throw new GoldenCatalogError([`unexpected fact count ${facts.length} (BE- 分配上限 1..99)`]);
  }
  const groupCount = new Set([...beatIndexByFact.values()]).size;
  const entries = facts.map((fact, index) => {
    const entryId = `BE-${String(index + 1).padStart(2, "0")}`;
    const isFinal = fact.reveals_answer === true || fact.role === "goal";
    const kind = fact.role === "goal" ? "conclusion" : fact.role === "given" ? "statement" : "derivation";
    const beatIndex = beatIndexByFact.get(fact.fact_id) ?? groupCount; // 未引用 → 最后一组
    const presentationGroup = `PG-${String(beatIndex + 1).padStart(2, "0")}`;
    if (isFinal) {
      const binding = gateByFact.get(fact.fact_id);
      if (!binding) {
        throw new GoldenCatalogError([
          `final fact ${fact.fact_id} (reveals_answer=${String(fact.reveals_answer)}, role=${String(fact.role)}) has no mainline gate binding (gate.graph_fact_id); refusing to build a final entry without reveal semantics`,
        ]);
      }
      return {
        entryId,
        kind,
        content: fact.statement,
        presentationGroup,
        revealRequirement: "final" as const,
        revealGate: { gateId: binding.gateId, beatId: binding.beatId, protocolId: binding.protocolId },
      };
    }
    return {
      entryId,
      kind,
      content: fact.statement,
      presentationGroup,
      revealRequirement: "intermediate" as const,
    };
  });

  // canonicalPath：SV-01 主线 variant 的推理建立序。
  const variant = imported.graph.solution_variants.find((candidate) => candidate.variant_id === "SV-01")
    ?? imported.graph.solution_variants[0];
  if (!variant) {
    throw new GoldenCatalogError(["solution graph has no solution variants (canonicalPath 不可推导)"]);
  }
  const inferenceById = new Map(imported.graph.inferences.map((inference) => [inference.inference_id, inference]));
  const pathFactOrder: string[] = facts.filter((fact) => fact.role === "given").map((fact) => fact.fact_id);
  for (const inferenceId of variant.inference_ids) {
    const inference = inferenceById.get(inferenceId);
    if (!inference) {
      throw new GoldenCatalogError([`variant ${variant.variant_id} references unknown inference ${inferenceId}`]);
    }
    if (!pathFactOrder.includes(inference.conclusion)) pathFactOrder.push(inference.conclusion);
  }
  const factEntryIds = new Map(facts.map((fact, index) => [fact.fact_id, `BE-${String(index + 1).padStart(2, "0")}`]));
  const canonicalPathEntryIds = pathFactOrder
    .map((factId) => factEntryIds.get(factId))
    .filter((entryId): entryId is string => entryId !== undefined);

  const catalog = buildWorkspacePresentationCatalog({
    schemaVersion: 1,
    taskId: GOLDEN_CATALOG_TASK_ID,
    baseGeometry: goldenBaseGeometry(),
    authoredElementKinds: goldenAuthoredKinds(),
    boardEntries: entries,
    canonicalPathEntryIds,
    initialInteractionMode: "construction",
  });
  return { catalog, factEntryIds };
}

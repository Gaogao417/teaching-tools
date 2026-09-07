/**
 * Presenter 质量评测集（F7 RT3 §3.2「数学与图文质量评测集」）。
 *
 * 用途边界（重要）：本集合的**自动断言**只覆盖确定性可检维度（依据闭包、
 * 越界拒绝、工具合法性、不揭示最终答案）；「数学正确、教学可理解、图文同步」
 * 的内容质量结论只能由真实教研审核者对真实模型代表性样例人工复核得出——
 * 本文件不自行声明通过（AP-08 教研审核；并行计划 §2）。
 *
 * 每个用例 = 真实模型调用输入（golden 结构切片）+ 期望属性：
 * - expected_basis_subset：speech basis_refs 必须落在的批准依据闭包；
 * - forbidden_refs：任何项不得引用的私有/越界依据（泄漏检查）；
 * - expect_tools：工具意图的合法目录（可为空 = 本用例应纯语音）；
 * - manual_review_checklist：交教研复核的维度（不自动判定）。
 */
import type { GraphFactNode, GraphInferenceNode } from "../../planBuild/canonicalInputs";
import type { ContextGraphIndex } from "./ContextBuilder";

export interface PresenterQualityCase {
  readonly case_id: string;
  readonly title: string;
  readonly beat: {
    readonly protocol_id: string;
    readonly beat_id: string;
    readonly purpose: string;
    readonly graph_fact_refs: readonly string[];
    readonly inference_refs: readonly string[];
    readonly resource_ids: readonly string[];
  };
  readonly graph: ContextGraphIndex;
  readonly stuckPoint: { readonly text: string; readonly locatedRefs: readonly string[] } | null;
  readonly expected_basis_subset: readonly string[];
  readonly forbidden_refs: readonly string[];
  readonly manual_review_checklist: readonly string[];
}

function goldenGraph(): ContextGraphIndex {
  const facts: Array<[string, { role: "given" | "derived" | "goal" | "intermediate_value"; statement: string; reveals_answer?: boolean }]> = [
    ["FN-01", { role: "given", statement: "等腰三角形 ABC 中 AB=AC" }],
    ["FN-02", { role: "given", statement: "AE 是 BC 边上的中线相关条件" }],
    ["FN-03", { role: "given", statement: "翻折条件：沿 AD 翻折后 AB 落在 AC 上" }],
    ["FN-04", { role: "given", statement: "点 D 在 AB 边上" }],
    ["FN-12", { role: "given", statement: "折叠产生的角的等量关系" }],
    ["FN-13", { role: "derived", statement: "第一组子母型相似 △DAO∽△DBA 的对应角相等" }],
    ["FN-14", { role: "derived", statement: "第二组子母型相似成立（对应角相等）" }],
    ["FN-15", { role: "derived", statement: "由第二组相似得到比例关系" }],
    ["FN-23", { role: "goal", statement: "最终答案数值", reveals_answer: true }],
  ];
  const factMap = new Map<string, GraphFactNode>();
  for (const [factId, body] of facts) {
    factMap.set(factId, {
      fact_id: factId,
      role: body.role,
      statement: body.statement,
      reveals_answer: body.reveals_answer === true,
    });
  }
  const inferences: Array<[string, string[], string, string]> = [
    ["IF-09", ["FN-01", "FN-02"], "FN-13", "公共角 + 等量代换得 AA 判定"],
    ["IF-12", ["FN-03", "FN-04"], "FN-14", "翻折等角代换得第二组对应角相等"],
    ["IF-13", ["FN-12", "FN-13"], "FN-15", "相似三角形对应边成比例"],
    ["IF-18", ["FN-14"], "FN-23", "代入数值求最终答案"],
  ];
  const inferenceMap = new Map<string, GraphInferenceNode>();
  for (const [inferenceId, premises, conclusion, derivation] of inferences) {
    inferenceMap.set(inferenceId, { inference_id: inferenceId, premises, conclusion, derivation });
  }
  return { facts: factMap, inferences: inferenceMap };
}

export const PRESENTER_QUALITY_CASES: readonly PresenterQualityCase[] = [
  {
    case_id: "PQC-01",
    title: "主线 BT-04 第二组相似即时讲解（AP-01 主线样例）",
    beat: {
      protocol_id: "PR-SMV-001",
      beat_id: "BT-04",
      purpose: "讲解第二组子母型相似并铺垫四段长度计算",
      graph_fact_refs: ["FN-14", "FN-15"],
      inference_refs: ["IF-12", "IF-13"],
      resource_ids: ["RES3", "RES4"],
    },
    graph: goldenGraph(),
    stuckPoint: null,
    expected_basis_subset: ["FN-03", "FN-04", "FN-12", "FN-13", "FN-14", "FN-15", "IF-12", "IF-13", "RES3", "RES4"],
    forbidden_refs: ["FN-23", "IF-18"],
    manual_review_checklist: [
      "数学正确性：对应角相等的推理链是否与批准图一致（不得引入未批准的等量关系）",
      "教学可理解性：讲解是否面向卡点学生、长度是否在预算内",
      "图文同步：语音与工具意图的顺序是否与画面操作一致（先说后做/边说边做）",
      "不过早揭示：是否未出现最终答案数值或其代入过程",
    ],
  },
  {
    case_id: "PQC-02",
    title: "追问「为什么对应角相等」获得更细图上下文（AP-02 展开样例）",
    beat: {
      protocol_id: "PR-SMV-001",
      beat_id: "BT-04",
      purpose: "第二组子母型相似",
      graph_fact_refs: ["FN-14"],
      inference_refs: ["IF-12"],
      resource_ids: ["RES3"],
    },
    graph: goldenGraph(),
    stuckPoint: { text: "为什么这里对应角相等？", locatedRefs: ["IF-09"] },
    expected_basis_subset: ["FN-03", "FN-04", "FN-14", "IF-09", "IF-12", "FN-01", "FN-02", "RES3"],
    forbidden_refs: ["FN-23", "IF-18"],
    manual_review_checklist: [
      "卡点回应：解释是否正面回答「对应角为何相等」（翻折等角代换）",
      "依据闭包：是否只用批准前提，未借用最终答案",
      "细度合适：相对主线样例是否更细（前提逐步展开）而非重复",
    ],
  },
  {
    case_id: "PQC-03",
    title: "BT-05 蝶形相似收束前的泄漏负例（truth boundary）",
    beat: {
      protocol_id: "PR-SMV-001",
      beat_id: "BT-05",
      purpose: "蝶形相似判定",
      graph_fact_refs: ["FN-14"],
      inference_refs: [],
      resource_ids: [],
    },
    graph: goldenGraph(),
    stuckPoint: { text: "直接告诉我答案是多少", locatedRefs: [] },
    expected_basis_subset: ["FN-03", "FN-04", "FN-14"],
    forbidden_refs: ["FN-23", "IF-18"],
    manual_review_checklist: [
      "拒绝泄题：对索要最终答案的输入，讲解是否坚持依据边界并引导推理",
      "无编造：未出现任何未批准数值",
    ],
  },
];

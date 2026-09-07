/**
 * PresentationToolCatalog（F7 RT3 — 公开工具目录；简化架构 §6.1）。
 *
 * 三层分工的「通用工具」层：ToolSpec = 稳定工具标识 + 语义 + typed 参数 +
 * 允许 target 边界（跨仓描述在 contracts generation/v1 presentation-tool-spec；
 * TS Zod 镜像 presentationToolSpecV1Schema）。执行函数仍在服务端 capability
 * registry（SessionPinnedCapabilityRegistry）——本模块只登记「模型可见目录」，
 * 不承载实现。
 *
 * 冻结纪律（RT0 清单 2 #7 / RT1 G1/G2）：
 * - tool_id 注册即冻结，不改语义；能力升级走 version。
 * - 模型看到的「本次可用工具实例目录」= 服务端已注册能力 ∩ 前端可执行能力 ∩
 *   Approved 绑定（plan resource_bindings）∩ mode/权限 ∩ 当前 scope。缺任何
 *   一环即不暴露（fail closed，不走 legacy fallback）。
 * - geometry.emphasize / board.explain 的 capability 尚未进入
 *   SessionPinnedCapabilityRegistry（RT1 G1/G2：前端 adapter 未注册）——
 *   目录条目先冻结命名/参数（A 轨 adapter 据此实现），visibility 计算在
 *   capability 注册前恒为不可见。
 * - golden plan TP-SMV-009@v11 是 planning/v5 schema，无 resource_bindings：
 *   绑定交集为空 ⇒ 模型可见工具集为空（如实投影，不伪造实例）。
 */
import type { z } from "zod";

import { presentationToolSpecV1Schema, tutorPlanBundleV7Schema } from "../../../../../shared/canonical";

/** 目录版本（presenter_generation_pin.tool_catalog_version 引用）。 */
export const PRESENTATION_TOOL_CATALOG_VERSION = "presentation-tool-catalog/v1";

/** canonical presentation-tool-spec/v1 条目（镜像推导类型）。 */
export type PresentationToolSpecEntry = z.infer<typeof presentationToolSpecV1Schema>;

/** planning/v7 resource_binding 条目（目录消费的题目绑定输入形状）。 */
export type PresentationResourceBinding = z.infer<typeof tutorPlanBundleV7Schema>["resource_bindings"][number];

/**
 * 冻结的工具目录（本波 A 轨 Board/Geometry adapter 命名真源；禁自造名）。
 * 每条在模块装载时经 canonical presentationToolSpecV1Schema 判定（漂移即抛）。
 */
const FROZEN_TOOL_SPEC_ENTRIES: readonly PresentationToolSpecEntry[] = [
  {
    schema: "ai_teaching_presentation_tool_spec/v1",
    tool_id: "geometry.construct",
    version: "v1",
    description:
      "按批准构造模板在几何画布上构造点或载体线段；输出 handle 只能引用绑定声明的模板输出，不能编造坐标或新实体。",
    capability: "geometry.construct",
    surface: "geometry",
    effect_class: "construct",
    reveal_scope_ceiling: "none",
    requires_binding: true,
    teaching_mode_only: true,
    parameters: [
      {
        name: "template_id",
        value_type: "string",
        required: true,
        description: "构造模板 id；必须在所选绑定的 allowed_template_ids 内（服务器校验）。",
      },
    ],
  },
  {
    schema: "ai_teaching_presentation_tool_spec/v1",
    tool_id: "geometry.emphasize",
    version: "v1",
    description:
      "高亮或指示一个已绑定的几何对象（角对、线段、点等）；不产生新实体，不改变几何状态。",
    capability: "geometry.emphasize",
    surface: "geometry",
    effect_class: "highlight",
    reveal_scope_ceiling: "target_highlight",
    requires_binding: true,
    teaching_mode_only: true,
    parameters: [
      {
        name: "emphasis",
        value_type: "enum",
        required: true,
        allowed_values: ["steady", "pulse"],
        description: "强调方式（稳定指示 / 脉冲提示）。",
      },
    ],
  },
  {
    schema: "ai_teaching_presentation_tool_spec/v1",
    tool_id: "board.explain",
    version: "v1",
    description: "在解答板上新增一条临场解释板书，内容限于批准公式/关系引用与说明文本。",
    capability: "solution_board.explain_fragment",
    surface: "solution_board",
    effect_class: "explain_fragment",
    reveal_scope_ceiling: "step_narration",
    requires_binding: true,
    teaching_mode_only: true,
    parameters: [
      {
        name: "note_kind",
        value_type: "enum",
        required: true,
        allowed_values: ["approved_math_note", "relation_note", "explanation_text"],
        description: "解释片段类型",
      },
    ],
  },
  {
    schema: "ai_teaching_presentation_tool_spec/v1",
    tool_id: "board.reveal-entry",
    version: "v1",
    description:
      "揭示解答板已批准条目；服务端按 Gate 授权与 reveal_scope 上限裁剪，最终答案不因模型请求而揭示。",
    capability: "board.reveal-entry",
    surface: "solution_board",
    effect_class: "reveal",
    reveal_scope_ceiling: "intermediate_result",
    requires_binding: true,
    teaching_mode_only: true,
    parameters: [],
  },
];

/** 模块装载自证：冻结条目逐条过 canonical 判定（漂移 = 启动即失败，不静默）。 */
export const PRESENTATION_TOOL_CATALOG: readonly PresentationToolSpecEntry[] = FROZEN_TOOL_SPEC_ENTRIES.map(
  (entry, index) => {
    const parsed = presentationToolSpecV1Schema.safeParse(entry);
    if (!parsed.success) {
      throw new Error(
        `frozen presentation tool catalog entry #${index} (${entry.tool_id}) fails canonical presentation-tool-spec/v1: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("; ")}`,
      );
    }
    return parsed.data;
  },
);

/** 稳定工具名冻结清单（A 轨 adapter registry 命名入口；顺序即登记顺序）。 */
export const PUBLIC_TOOL_IDS: readonly string[] = PRESENTATION_TOOL_CATALOG.map((entry) => entry.tool_id);

export function toolSpecById(toolId: string): PresentationToolSpecEntry | undefined {
  return PRESENTATION_TOOL_CATALOG.find((entry) => entry.tool_id === toolId);
}

// --------------------------------------------------------------------------- //
// 模型可见工具实例目录（交集计算；fail closed）
// --------------------------------------------------------------------------- //

/** 单个可见工具实例：spec + 本题可用绑定（模型 tool_intent.args.binding_ref 的合法值域）。 */
export interface VisibleToolInstance {
  readonly spec: PresentationToolSpecEntry;
  /** 该工具当前可用的题目绑定（binding_ref 合法值）。 */
  readonly bindings: readonly PresentationResourceBinding[];
}

export interface ToolVisibilityInput {
  /**
   * 服务端已注册能力 ∩ 前端可执行能力（调用方组合后传入；capability 字符串
   * 与 SessionPinnedCapabilityRegistry 对齐）。目录不做第二真源。
   */
  readonly registeredCapabilities: ReadonlySet<string>;
  /** 题目 Approved 绑定（planning/v7 resource_bindings；v5 golden plan 传入空数组）。 */
  readonly bindings: readonly PresentationResourceBinding[];
  /** 会话模式（assessment ⇒ 全部教学工具不可见）。 */
  readonly sessionMode: "teaching" | "assessment";
  /**
   * 可选 scope 过滤：返回 true 的绑定才对当前教学范围开放（如按当前 Beat 的
   * 资源/事实相关性裁剪）。缺省 = plan 级全部绑定。
   */
  readonly scopeAllows?: (binding: PresentationResourceBinding) => boolean;
}

/** effect_class × binding_kind 合法配对（目录层静态边界）。 */
const EFFECT_CLASS_BINDING_KIND: Readonly<Record<PresentationToolSpecEntry["effect_class"], readonly PresentationResourceBinding["binding_kind"][]>> = {
  construct: ["geometry"],
  highlight: ["geometry"],
  annotate: ["geometry"],
  explain_fragment: ["explanation", "board"],
  reveal: ["board"],
};

/**
 * 计算本次可用的模型工具实例目录。
 * 任一交集维度为空 ⇒ 该工具不可见；整集可为空（golden v5 plan 无绑定的如实
 * 投影）。本函数纯计算、无 IO；不存在 legacy fallback 路径。
 */
export function visiblePresentationTools(input: ToolVisibilityInput): readonly VisibleToolInstance[] {
  if (input.sessionMode === "assessment") return [];
  const instances: VisibleToolInstance[] = [];
  for (const spec of PRESENTATION_TOOL_CATALOG) {
    if (spec.teaching_mode_only && input.sessionMode !== "teaching") continue;
    if (!input.registeredCapabilities.has(spec.capability)) continue;
    const allowedKinds = EFFECT_CLASS_BINDING_KIND[spec.effect_class];
    const bindings = input.bindings.filter(
      (binding) =>
        allowedKinds.includes(binding.binding_kind)
        && (input.scopeAllows?.(binding) ?? true),
    );
    if (bindings.length === 0) continue;
    instances.push({ spec, bindings });
  }
  return instances;
}

/** 目录版本校验：presenter pin 携带的 tool_catalog_version 必须等于当前冻结版本。 */
export function assertToolCatalogVersion(version: string): void {
  if (version !== PRESENTATION_TOOL_CATALOG_VERSION) {
    throw new Error(
      `presentation tool catalog version mismatch: pin=${version} vs current=${PRESENTATION_TOOL_CATALOG_VERSION} (fail closed; no silent cross-version exposure)`,
    );
  }
}

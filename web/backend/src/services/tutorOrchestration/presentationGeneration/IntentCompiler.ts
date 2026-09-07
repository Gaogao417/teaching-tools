/**
 * IntentCompiler（F7 RT3 — draft → canonical 候选序列编译；fail closed）。
 *
 * 职责（动态板书事实链规格 Interfaces + 简化架构 §5.1）：
 * - speech 项 → voice action（source=model-generated，服务器分配 VA-/VG- 身份，
 *   basis_refs 编译期校验 ⊆ 冻结上下文选取集 ∪ 资源 ∪ 可见绑定）；
 * - tool_intent 项 → workspace action：工具必须在**本次可见目录**内（目录外/
 *   未注册能力 = 非法工具拒绝），binding_ref 必须解析到该工具当前可用绑定，
 *   params 按 tool-spec parameters 逐项校验（类型/必填/枚举）；
 * - board.explain → 编译器分配 EF- fragment（正文：approved_math_note/relation_note
 *   由绑定的批准依据确定性渲染；explanation_text 取紧邻 speech 文本——均为
 *   origin_generation=GR 的呈现材料，保存与可见分离由 applied 事件决定）；
 * - reveal 类工具：reveal_scope 服务器裁定（min(策略, ceiling, Gate 授权)），
 *   模型请求不扩大揭示；未授权 final 揭示 = ILLEGAL_REVEAL 拒绝；
 * - 一项非法 ⇒ 整份候选拒绝（零部分提交；AP-05 确定性反例）。
 *
 * 编译产物经 canonical presentation-plan/v4（内嵌 sequence 形状）判定后返回，
 * 提交仍由 kernel 事务（RT4 coordinator）唯一落库。
 */
import type { z } from "zod";
import { PRESENTER_PROMPT_VERSION } from "./PresenterPrompts";

import { presentationPlanV4Schema } from "../../../../../shared/canonical";
import type { DomainCommand } from "../../../../../shared/actionWorld";
import { constructionOutputId } from "../WorkspaceActionAdjudication";
import type { GraphFactNode, GraphInferenceNode, PlanResourceV5 } from "../../planBuild/canonicalInputs";
import type { BuiltPresentationContext } from "./ContextBuilder";
import type { PresentationDraftV2 } from "./GeneratorPort";
import type { PresentationResourceBinding, VisibleToolInstance } from "./PresentationToolCatalog";

/** canonical presentation-plan/v4（编译产物合同形状）。 */
export type CompiledPresentationPlanV4 = z.infer<typeof presentationPlanV4Schema>;

export type IntentRejectionCode =
  | "ILLEGAL_TOOL"
  | "ILLEGAL_TARGET"
  | "ILLEGAL_PARAM"
  | "ILLEGAL_SOURCE_REF"
  | "ILLEGAL_REVEAL"
  | "EMPTY_SEGMENT"
  | "COMPILE_VALIDATION_FAILED";

export class IntentCompilerError extends Error {
  constructor(readonly code: IntentRejectionCode, message: string) {
    super(message);
    this.name = "IntentCompilerError";
  }
}

export interface TeachingScopeRef {
  readonly kind: "approved";
  readonly protocol_id: string;
  readonly beat_id: string;
}

export interface IntentCompilerInput {
  readonly sessionId: string;
  /** 会话内 presentation sequence 单调序号（committed planned 计数 +1）。 */
  readonly sequenceSerial: number;
  readonly decisionId: string;
  readonly scope: TeachingScopeRef;
  readonly request: {
    readonly request_id: string;
    readonly attempt: number;
    readonly epoch: number;
    readonly input_digest: string;
    readonly presenter_pin: {
      readonly provider: string;
      readonly model_id: string;
      readonly prompt_version: string;
      readonly context_builder_version: string;
      readonly tool_catalog_version: string;
    };
  };
  readonly draft: PresentationDraftV2;
  readonly context: BuiltPresentationContext;
  readonly visibleTools: readonly VisibleToolInstance[];
  readonly resources: ReadonlyMap<string, PlanResourceV5>;
  readonly graph: {
    readonly facts: ReadonlyMap<string, GraphFactNode>;
    readonly inferences: ReadonlyMap<string, GraphInferenceNode>;
  };
  /**
   * 当前 Beat 已批准的构造命令（resolveBeatConstructions 产物；orchestrator
   * 预计算传入）。geometry.construct 意图只能从中选取模板输出——模型不能发明
   * 构造（架构 §6.3：临场选择受绑定与批准模板约束）。
   */
  readonly approvedConstructions: readonly DomainCommand[];
  /** Board contents with real presented outcomes before this request cutoff. */
  readonly alreadyPresentedBoardContent?: readonly string[];
  /** reveal 授权查询（Board final 条目等；未授权 ⇒ ILLEGAL_REVEAL）。 */
  readonly revealAuthorized: (binding: PresentationResourceBinding) => boolean;
}

interface CompiledFragment {
  readonly fragment_id: string;
  readonly kind: "approved_math_note" | "relation_note" | "explanation_text";
  readonly content: string;
  readonly basis_refs: readonly string[];
  readonly origin_generation: string;
  readonly attach_to_entry?: string;
}

type CompiledAction = {
  readonly ordinal: number;
  readonly kind: "voice" | "workspace";
  readonly basis_refs?: readonly string[];
  readonly voice_action?: {
    readonly action_id: string;
    readonly decision_id: string;
    readonly text: string;
    readonly source: "model-generated";
    readonly generation_id: string;
    readonly interruptible: boolean;
    readonly intent: "narrate" | "question" | "feedback";
  };
  readonly workspace_action?: {
    readonly action_id: string;
    readonly decision_id: string;
    readonly surface: "geometry" | "solution_board";
    readonly capability: string;
    readonly origin: "tutor";
    readonly target_ids?: readonly string[];
    readonly command_payload?: string;
    readonly reveal_scope: "none" | "target_highlight" | "step_narration" | "intermediate_result" | "final_result";
    readonly presentation_only?: boolean;
  };
};

/** 允许模型引用的依据闭包（冻结上下文选取集 + Beat 资源 + 可见绑定）。 */
function allowedSourceRefs(input: IntentCompilerInput): Set<string> {
  const refs = new Set<string>([
    ...input.context.context.selected_fact_ids,
    ...input.context.context.selected_inference_ids,
    ...input.context.context.resource_ids,
  ]);
  for (const instance of input.visibleTools) {
    for (const binding of instance.bindings) refs.add(binding.binding_id);
  }
  return refs;
}

function validateParams(
  spec: VisibleToolInstance["spec"],
  params: Record<string, unknown> | undefined,
): { ok: true; values: Record<string, unknown> } | { ok: false; reason: string } {
  const values: Record<string, unknown> = {};
  const source = params ?? {};
  for (const parameter of spec.parameters) {
    const value = source[parameter.name];
    if (value === undefined) {
      if (parameter.required) return { ok: false, reason: `missing required parameter ${parameter.name}` };
      continue;
    }
    switch (parameter.value_type) {
      case "string":
        if (typeof value !== "string" || value.length === 0) return { ok: false, reason: `parameter ${parameter.name} must be a non-empty string` };
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: `parameter ${parameter.name} must be a finite number` };
        break;
      case "boolean":
        if (typeof value !== "boolean") return { ok: false, reason: `parameter ${parameter.name} must be a boolean` };
        break;
      case "enum":
        if (typeof value !== "string" || !parameter.allowed_values?.includes(value)) {
          return { ok: false, reason: `parameter ${parameter.name} must be one of ${(parameter.allowed_values ?? []).join("|")}` };
        }
        break;
    }
    values[parameter.name] = value;
  }
  for (const key of Object.keys(source)) {
    if (!spec.parameters.some((parameter) => parameter.name === key)) {
      return { ok: false, reason: `unknown parameter ${key} for tool ${spec.tool_id}` };
    }
  }
  return { ok: true, values };
}

/** 批准依据 → fragment 正文（确定性渲染；数学表达第一版只引用批准文本）。 */
export function renderFragmentContent(
  kind: CompiledFragment["kind"],
  binding: PresentationResourceBinding,
  graph: IntentCompilerInput["graph"],
  alreadyPresented: readonly string[],
  requirePresentedDerivation = false,
): string | undefined {
  if (kind === "explanation_text" || binding.binding_kind !== "explanation") return undefined;
  const factIds = new Set(binding.basis_refs.fact_ids);
  const inferenceIds = new Set(binding.basis_refs.inference_ids);
  const historyLines = new Set(alreadyPresented.flatMap(content => content.split("\n").map(line => line.trim())));
  const lines: string[] = [];
  const shown = new Set<string>();
  const fact = (id: string) => factIds.has(id) ? graph.facts.get(id) : undefined;
  for (const id of factIds) if (!graph.facts.has(id)) throw new IntentCompilerError("ILLEGAL_SOURCE_REF", "unknown bound board fact");
  for (const id of inferenceIds) {
    const inference = graph.inferences.get(id);
    if (!inference || !factIds.has(inference.conclusion) || inference.premises.some(id => !factIds.has(id))) {
      throw new IntentCompilerError("ILLEGAL_SOURCE_REF", "board derivation is not closed within the bound facts");
    }
  }
  const known = (id: string) => shown.has(id) || Boolean(fact(id)
    && (historyLines.has(`∵ ${fact(id)!.statement}`) || historyLines.has(`∴ ${fact(id)!.statement}`)));
  const appendFact = (id: string, prefix: string) => {
    const value = fact(id);
    if (!value || known(id)) return;
    lines.push(`${prefix}${value.statement}`);
    shown.add(id);
  };
  // Topological proof order, rather than a dump of all facts followed by all
  // inference metadata. Every displayed mathematical statement is copied from
  // this binding's approved facts; reference IDs stay only in basis_refs.
  const producers = new Map([...inferenceIds].map(id => graph.inferences.get(id)).filter((v): v is GraphInferenceNode => Boolean(v)).map(v => [v.conclusion, v]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const emitInference = (inference: GraphInferenceNode) => {
    if (visited.has(inference.inference_id)) return;
    if (visiting.has(inference.inference_id)) throw new IntentCompilerError("ILLEGAL_SOURCE_REF", "cyclic board derivation");
    visiting.add(inference.inference_id);
    for (const id of inference.premises) { const producer = producers.get(id); if (producer) emitInference(producer); }
    visiting.delete(inference.inference_id); visited.add(inference.inference_id);
    const proofLines = `${inference.derivation}\n∴ ${fact(inference.conclusion)!.statement}`.split("\n").map(line => line.trim());
    const derivationPresented = alreadyPresented.some(content => {
      const history = content.split("\n").map(line => line.trim());
      return history.some((_, index) => proofLines.every((line, offset) => history[index + offset] === line));
    });
    if (requirePresentedDerivation ? shown.has(inference.conclusion) || derivationPresented : known(inference.conclusion)) return;
    for (const id of inference.premises) appendFact(id, "∵ ");
    const conclusion = fact(inference.conclusion);
    if (!conclusion) throw new IntentCompilerError("ILLEGAL_SOURCE_REF", "board conclusion is outside the bound facts");
    lines.push(inference.derivation, `∴ ${conclusion.statement}`, "");
    shown.add(inference.conclusion);
  };
  for (const id of inferenceIds) { const inference = graph.inferences.get(id); if (inference) emitInference(inference); }
  if (inferenceIds.size === 0) for (const id of factIds) appendFact(id, fact(id)?.role === "given" ? "∵ " : "∴ ");
  if (!factIds.size && !inferenceIds.size) return undefined;
  return lines.join("\n").trim();
}

/**
 * 编译：validated draft + 冻结上下文 + 可见工具目录 → canonical 候选序列。
 * 纯函数；任何非法项 ⇒ IntentCompilerError（整段拒绝，零部分产物）。
 */
export function compilePresentationIntents(input: IntentCompilerInput): CompiledPresentationPlanV4 {
  const allowedRefs = allowedSourceRefs(input);
  const serial = String(input.sequenceSerial).padStart(4, "0");
  const sequenceId = `PS-${serial}`;
  const actions: CompiledAction[] = [];
  const fragments: CompiledFragment[] = [];
  let voiceIndex = 0;
  let toolIndex = 0;
  let fragmentIndex = 0;
  let lastSpeechText: string | undefined;

  const visibleByTool = new Map(input.visibleTools.map((instance) => [instance.spec.tool_id, instance]));

  for (const item of input.draft.items) {
    if (actions.length >= 12) {
      throw new IntentCompilerError("EMPTY_SEGMENT", "compiled segment exceeds the bounded short-segment cap (12 actions)");
    }
    if (item.type === "speech") {
      if (item.basis_refs !== undefined) {
        for (const ref of item.basis_refs) {
          if (!allowedRefs.has(ref)) {
            throw new IntentCompilerError(
              "ILLEGAL_SOURCE_REF",
              `speech basis_ref ${ref} is outside the frozen context selection (selected facts/inferences/resources/bindings only; fail closed)`,
            );
          }
        }
      }
      if (item.text === undefined) {
        // canonical 判定已保证 speech 必带 text；此处只收窄类型（防御性 fail closed）。
        throw new IntentCompilerError("ILLEGAL_PARAM", "speech item carries no text (draft shape violated)");
      }
      const actionId = `VA-${input.sessionId}-${serial}-G${voiceIndex}`;
      actions.push({
        ordinal: actions.length,
        kind: "voice",
        ...(item.basis_refs !== undefined && item.basis_refs.length > 0 ? { basis_refs: [...item.basis_refs] } : {}),
        voice_action: {
          action_id: actionId,
          decision_id: input.decisionId,
          text: item.text,
          source: "model-generated",
          generation_id: `VG-${input.sessionId}-${serial}-G${voiceIndex}`,
          interruptible: true,
          intent: "narrate",
        },
      });
      voiceIndex += 1;
      lastSpeechText = item.text;
      continue;
    }

    // tool_intent：目录内工具 + 绑定 + 参数三重校验。
    if (item.tool === undefined) {
      throw new IntentCompilerError("ILLEGAL_TOOL", "tool_intent carries no tool id (draft shape violated)");
    }
    const instance = visibleByTool.get(item.tool);
    if (!instance) {
      throw new IntentCompilerError(
        "ILLEGAL_TOOL",
        `tool ${item.tool} is not in this request's visible tool catalog (unregistered capability, missing approved binding, assessment mode, or scope exclusion; fail closed)`,
      );
    }
    const spec = instance.spec;
    if (spec.requires_binding && item.args?.binding_ref === undefined) {
      throw new IntentCompilerError("ILLEGAL_TARGET", `tool ${spec.tool_id} requires a binding_ref (model cannot invent targets)`);
    }
    const binding = item.args?.binding_ref !== undefined
      ? instance.bindings.find((candidate) => candidate.binding_id === item.args?.binding_ref)
      : undefined;
    if (spec.requires_binding && !binding) {
      throw new IntentCompilerError(
        "ILLEGAL_TARGET",
        `binding_ref ${String(item.args?.binding_ref)} does not resolve to an available binding of tool ${spec.tool_id} for this request`,
      );
    }
    const paramsCheck = validateParams(spec, item.args?.params);
    if (!paramsCheck.ok) {
      throw new IntentCompilerError("ILLEGAL_PARAM", `tool ${spec.tool_id}: ${paramsCheck.reason}`);
    }

    const actionId = `WSA-${input.sessionId}-${serial}-T${toolIndex}`;
    toolIndex += 1;

    if (spec.tool_id === "board.explain") {
      const noteKind = paramsCheck.values.note_kind as CompiledFragment["kind"];
      const explainBinding = binding as PresentationResourceBinding;
      if (explainBinding.binding_kind === "geometry") {
        throw new IntentCompilerError("ILLEGAL_TARGET", "board.explain requires an explanation or board binding (geometry binding is not a content source)");
      }
      const content = noteKind === "explanation_text"
        ? lastSpeechText
        : renderFragmentContent(noteKind, explainBinding, input.graph, [...(input.alreadyPresentedBoardContent ?? []), ...fragments.filter(fragment => fragment.kind !== "explanation_text").map(fragment => fragment.content)], input.request.presenter_pin.prompt_version === PRESENTER_PROMPT_VERSION);
      // The exact approved proof is already visible: do not append another copy
      // merely because the teacher answered a follow-up. Speech remains in order.
      if (content === "" && noteKind !== "explanation_text") continue;
      if (content === undefined || content.length === 0) {
        throw new IntentCompilerError(
          "ILLEGAL_PARAM",
          `board.explain fragment content is empty (approved basis rendering or adjacent speech required; never fabricate)`,
        );
      }
      const fragmentId = `EF-${input.sessionId}-${serial}-${String(fragmentIndex).padStart(2, "0")}`;
      fragmentIndex += 1;
      const basisRefs = explainBinding.binding_kind === "explanation"
        ? [...explainBinding.basis_refs.fact_ids, ...explainBinding.basis_refs.inference_ids]
        : [explainBinding.board_entry_id];
      fragments.push({
        fragment_id: fragmentId,
        kind: noteKind,
        content,
        basis_refs: basisRefs,
        origin_generation: input.request.request_id,
        ...(explainBinding.binding_kind === "board" ? { attach_to_entry: explainBinding.board_entry_id } : {}),
      });
      actions.push({
        ordinal: actions.length,
        kind: "workspace",
        workspace_action: {
          action_id: actionId,
          decision_id: input.decisionId,
          surface: "solution_board",
          // canonical v9 planned 规则按 capability="board.explain" 触发 fragment
          // 引用闭合；tool-spec 的 capability 字段是 registry/编译入口锚点
          // （solution_board.explain_fragment）——映射在这里完成，不发明第三名。
          capability: "board.explain",
          origin: "tutor",
          command_payload: fragmentId,
          reveal_scope: "step_narration",
        },
      });
      continue;
    }

    if (spec.effect_class === "reveal") {
      // reveal 授权：绑定级 reveal_after_gate + 当前授权查询；模型请求不扩大揭示。
      const boardBinding = binding?.binding_kind === "board" ? binding : undefined;
      if (!boardBinding || !boardBinding.reveal_after_gate) {
        throw new IntentCompilerError("ILLEGAL_REVEAL", `reveal tool ${spec.tool_id} requires a board binding with reveal_after_gate`);
      }
      if (!input.revealAuthorized(boardBinding)) {
        throw new IntentCompilerError(
          "ILLEGAL_REVEAL",
          `reveal of ${boardBinding.board_entry_id} is not currently authorized (gate ${boardBinding.reveal_after_gate.gate_id} unsatisfied; early reveal rejected)`,
        );
      }
      actions.push({
        ordinal: actions.length,
        kind: "workspace",
        workspace_action: {
          action_id: actionId,
          decision_id: input.decisionId,
          surface: "solution_board",
          capability: spec.capability,
          origin: "tutor",
          target_ids: [boardBinding.board_entry_id],
          reveal_scope: spec.reveal_scope_ceiling === "none" ? "none" : spec.reveal_scope_ceiling,
        },
      });
      continue;
    }

    if (spec.effect_class === "construct") {
      // 构造编译：模板输出必须解析到绑定允许的批准构造命令（同段依赖顺序由
      // SequencePreflight 预演：构造 O → 引用 O 合法；反序非法）。
      const geometryBinding = binding?.binding_kind === "geometry" ? binding : undefined;
      if (!geometryBinding) {
        throw new IntentCompilerError("ILLEGAL_TARGET", `geometry tool ${spec.tool_id} requires a geometry binding`);
      }
      const templateId = typeof paramsCheck.values.template_id === "string" ? paramsCheck.values.template_id : undefined;
      const target = templateId ?? geometryBinding.geometry_target;
      const approved = input.approvedConstructions.find(
        (command) => constructionOutputId(command) === target && geometryBinding.allowed_template_ids.includes(target),
      );
      if (!approved) {
        throw new IntentCompilerError(
          "ILLEGAL_TARGET",
          `construct target ${target} does not resolve to an approved construction template of binding ${geometryBinding.binding_id} (model cannot invent constructions)`,
        );
      }
      const stamped = {
        ...approved,
        commandId: `cmd-${input.sessionId}-${serial}-T${toolIndex}`,
        actionId,
      } as DomainCommand;
      actions.push({
        ordinal: actions.length,
        kind: "workspace",
        workspace_action: {
          action_id: actionId,
          decision_id: input.decisionId,
          surface: "geometry",
          capability: spec.capability,
          origin: "tutor",
          target_ids: [target],
          command_payload: JSON.stringify(stamped),
          reveal_scope: "none",
        },
      });
      continue;
    }

    if (spec.effect_class === "highlight" || spec.effect_class === "annotate") {
      // RT1 G1/G2：emphasize/annotate 能力尚未注册（capability registry 无条目）。
      // 目录可见性交集已保证此类工具不可见；编译器对漏网意图显式拒绝（fail closed）。
      throw new IntentCompilerError(
        "ILLEGAL_TOOL",
        `tool ${spec.tool_id} (${spec.effect_class}) has no registered execution capability yet (RT1 G1/G2; reject instead of improvising)`,
      );
    }

    throw new IntentCompilerError("ILLEGAL_TOOL", `tool ${spec.tool_id} has no compiler binding for effect class ${spec.effect_class}`);
  }

  if (actions.length === 0) {
    throw new IntentCompilerError("EMPTY_SEGMENT", "draft compiles to zero actions (canonical requires at least one item)");
  }

  const plan = {
    schema: "ai_teaching_presentation_plan/v4" as const,
    session_id: input.sessionId,
    sequence_id: sequenceId,
    decision_id: input.decisionId,
    scope: input.scope,
    generation: {
      request_id: input.request.request_id,
      attempt: input.request.attempt,
      input_digest: input.request.input_digest,
      presenter_pin: input.request.presenter_pin,
      epoch: input.request.epoch,
    },
    actions,
    ...(fragments.length > 0 ? { explanation_fragments: fragments } : {}),
  };
  const parsed = presentationPlanV4Schema.safeParse(plan);
  if (!parsed.success) {
    throw new IntentCompilerError(
      "COMPILE_VALIDATION_FAILED",
      `compiled candidate fails canonical presentation-plan/v4: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  return parsed.data;
}

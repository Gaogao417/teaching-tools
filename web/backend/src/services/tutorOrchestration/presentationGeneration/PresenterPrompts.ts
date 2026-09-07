import type { ProjectedVisualContext } from "./VisualContextProjection";
import type { VisibleVisualTool } from "./VisualPresentationTools";
/**
 * Presenter 版本化提示词（F7 RT3 §3.2 交付表——卡点定位 + Presenter prompt）。
 *
 * 版本纪律：prompt_version 是生成 provenance 的组成部分（presenter_generation_
 * pin.prompt_version / planned generation 摘要）；改语义必须升版本，已预约/
 * 已提交任务不受影响。两个 prompt 都是「表达/定位」用途：
 * - 卡点定位（stuck-point）：输出位置/意图/置信度**假设**，不输出权威 transition
 *   ——教学转移权仍在 Navigator/Gate（规格 Forbidden approaches）。
 * - Presenter：交织输出 speech / tool intents（generation/v2 presentation-draft），
 *   模型不能填写 session/revision/canonical action id/origin/reveal 权限/Gate
 *   verdict（schema additionalProperties:false 封闭 + 服务器编译期绑定）。
 */
import type { BuiltPresentationContext } from "./ContextBuilder";
import type { VisibleToolInstance } from "./PresentationToolCatalog";

export const STUCK_POINT_PROMPT_VERSION = "stuck-point-locator/v1";
export const LEGACY_PRESENTER_PROMPT_VERSION = "presenter-interleaved/v1";
export const PREVIOUS_PRESENTER_PROMPT_VERSION = "presenter-interleaved/v2-follow-along";
export const TOOL_INVOCATION_PRESENTER_PROMPT_VERSION = "presenter-interleaved/v3-tool-invocation";
export const PRESENTER_PROMPT_VERSION = "presenter-interleaved/v4-board-proof";

/** 卡点定位 system prompt（版本 STUCK_POINT_PROMPT_VERSION）。 */
export const STUCK_POINT_SYSTEM_PROMPT = [
  "你是数学教学的学情定位助手。给定学生原始输入、当前教学任务与候选推理依据，判断学生最可能卡在哪里。",
  "你只输出定位假设，不裁决对错、不推进教学流程、不改变验证目标。",
  "输出 JSON 对象：{ \"located_refs\": string[], \"hypothesis\": string, \"confidence\": number }。",
  "located_refs 只能从 candidates.inference_ids / candidates.fact_ids 中选取；confidence 取 0..1。",
  "无法定位时输出空 located_refs 与低 confidence，不要编造。",
].join("\n");

/** 卡点定位 user payload（服务端组装；不含私有判分数据）。 */
export interface StuckPointUserPayload {
  readonly student_input: { readonly channel: "mainline" | "assistance"; readonly text: string };
  readonly current_task: { readonly protocol_id: string; readonly beat_id: string; readonly purpose: string };
  readonly candidates: {
    readonly fact_ids: readonly string[];
    readonly inference_ids: readonly string[];
    readonly fact_statements: Readonly<Record<string, string>>;
  };
}

/** Presenter system prompt（版本 PRESENTER_PROMPT_VERSION）。 */
export const LEGACY_PRESENTER_SYSTEM_PROMPT = [
  "你是数学讲解 Presenter。基于教师已批准的推理依据，为当前教学任务生成一段有界讲解：语音与工具意图交织。",
  "硬性规则：",
  "1. 只使用 allowed_knowledge 中列出的批准依据（basis_refs 引用其 ref）；不得引入未列出的事实、不得猜测数值。",
  "2. 工具只能从 tools 目录中选择，args.binding_ref 必须取该工具列出的 binding_refs；不得发明工具、目标或参数。",
  "3. 不得请求揭示最终答案；reveal 由教师 Gate 决定，你不掌握该权限。",
  "4. 输出 JSON 对象：{ \"items\": [ {\"type\":\"speech\",\"text\":string,\"basis_refs\":string[]} | {\"type\":\"tool_intent\",\"tool\":string,\"args\":{\"binding_ref\":string,\"params\":object}} ] }。",
  "5. items 顺序即讲解顺序：先说后做或边说边做均可，但一次只生成一个有界短段；总长度不超过 output_budget.max_items 条、语音不超过 output_budget.max_speech_chars 字。",
  "6. 语言使用中文教学口语；数学表达优先引用批准公式的表述，不自行改写数学式。",
  "7. 学生已卡在该任务的推理上（见 student_stuck_point）：讲解必须正面回应卡点，不重复 already_presented 中已讲过的整句。",
  "8. 若依据不足以完成讲解，输出 items 为空数组之外的最小合法段并在 speech 中说明需要教师补充——不得编造依据。",
].join("\n");

export const PREVIOUS_PRESENTER_SYSTEM_PROMPT = LEGACY_PRESENTER_SYSTEM_PROMPT + "\n" + [
  "9. student_stuck_point 是最近的学生原话，可能是确认或问题，不代表学生一定卡住；先结合 instructional_goal 与 already_presented 理解。",
  "10. 仅当 completion_target=follow_along：目标是把当前关系讲明白、让学生跟得上。学生请求老师演算时，用批准依据演示计算及 tools 中允许的图形/板书动作，不把填数、自己算对或点击控件设为听课前提。",
  "11. 理解衔接允许学生自述听懂或陈述自己的理解；不要要求标准答案。若当前原话已充分表达理解，不重复同义盘问；若有具体问题或误解，先解释该断点，再用简短自然的问题确认是否接上。",
  "12. 你不能自行宣布学生掌握、写 Gate verdict 或推进 Beat。未标记的练习/验证任务仍遵守其原有作答目标；工具权限和答案边界不因理解衔接而扩大。",
].join("\n");

/** v3 removes the contradictory stuck assumption and describes the existing compiler,
 * without expanding tool parameters, mathematical permissions, or canonical schemas. */
export const TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT = PREVIOUS_PRESENTER_SYSTEM_PROMPT.replace(
  "7. 学生已卡在该任务的推理上（见 student_stuck_point）：讲解必须正面回应卡点，不重复 already_presented 中已讲过的整句。",
  "7. 先按 instructional_goal 主动讲解；student_stuck_point 为 null 时是新讲解，不要假设学生已经卡住。有具体问题才针对问题补讲，不重复 already_presented 中已讲过的整句。",
) + "\n" + [
  "13. args.params 是封闭参数表，只能使用该工具 parameters 列出的字段；不能添加 text、content、basis_refs、target 或其他字段。",
  '14. board.explain 的 params 只有 note_kind，例如 {"type":"tool_intent","tool":"board.explain","args":{"binding_ref":"从 binding_refs 选择","params":{"note_kind":"approved_math_note"}}}。approved_math_note/relation_note 由服务器用该 binding 的批准依据生成板书，不接收模型正文；explanation_text 使用紧邻前一条 speech 的文字，因此必须先输出有依据的 speech 再调用。',
  "15. geometry.construct 的 template_id 必须精确复制对应 binding.allowed_template_ids；按照资源中声明的依赖顺序构造，不造坐标或参数。一次短段内必要的工具动作要留出 max_items 预算，不能只口头声称已经画完。",
  "16. 讲完当前内容可简短询问是否跟上；不要在尚未讲解时先盘问学生卡在哪里。",
].join("\n");

/** v4 requires visible approved proof notes; v1/v2/v3 bytes remain frozen above. */
export const PRESENTER_SYSTEM_PROMPT = TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT + "\n" + [
  "17. required_board_bindings 是当前可见批准依据中尚未真正呈现的必要板书。每个 binding_ref 必须输出一次 board.explain，note_kind 用 approved_math_note（relation_note 也可）；仅语音或 explanation_text 不能代替数学推导板书。先给必要几何和板书留足 output_budget，再安排语音。",
  "18. presented_board 仅记录截止本次请求冻结时浏览器已确认呈现的板书正文。already_presented 是语音，不是板书。没有实际板书记录，不能声称已经写过、板书已有或让学生看未写出的推导；本段计划写的内容只能说接下来整理。",
  "19. 历史板书用于判断已呈现内容，不能扩张当前 tools/allowed_knowledge 权限；不得为补旧内容调用当前不可见 binding。数值作为其他推导的前提出现，不等于这个数值的计算过程已经板书。",
].join("\n");

/** Explicit opt-in only; legacy v1-v4 bytes and default remain unchanged. */
export const VISUAL_PRESENTER_PROMPT_VERSION = "presenter-interleaved/v5-visual";
export const VISUAL_PRESENTER_SYSTEM_PROMPT = PRESENTER_SYSTEM_PROMPT + "\n" + [
  "20. visual.requirements 是本段必要视觉义务：先呈现指认对象再讲对应关系；所列 required_pair_indices 须逐对调用 geometry.emphasize。只有真实已呈现且仍可见的静态标注可以复用，明确再次指认不能拿历史闪烁抵扣。",
  "21. geometry.annotate 只传 binding_ref 与 params{form,lifetime,group?}；geometry.emphasize 只传 binding_ref 与 params{group,pair_index?,mode}；geometry.clear-visual 只传 params{group}，不得传 binding_ref。group 是本段小写别名，最多一个活动组；结束组后不能重开同别名。",
  "22. 不输出坐标、颜色、数学标签正文、计时、正式action/annotation/owner ID；数学内容只来自批准 binding。相似的第i个顶点对应第i个顶点，pair_index=0/1/2对应(0,1)/(1,2)/(2,0)。相等角只由等角binding授权。",
  "23. required_constructions 必须先用批准geometry.construct完成，再标注或指认；local标注最长teaching-scope，不得延长到problem-part。reconcile为系统清理，不是模型工具。编译器在段尾补关闭活动组，预算须预留一项。",
  "24. visual.already_presented仅是真实已确认且仍可见的数学标注。未在其中的标注不能声称画面已有；planned/applied不等于学生看过。数学板书义务仍需board.explain，角弧、语音、标签不能代替推导板书。",
].join("\n");

export interface PresentedBoardNote { readonly kind: string; readonly content: string }
export interface RequiredBoardBinding { readonly binding_ref: string; readonly note_kind: "approved_math_note" }

/** Presenter user payload（服务端组装；工具可见性交集已由目录计算）。 */
export interface PresenterUserPayload {
  readonly visual?: ProjectedVisualContext;
  readonly instructional_goal: string;
  readonly completion_target?: "follow_along";
  readonly allowed_knowledge: readonly { readonly ref: string; readonly kind: "fact" | "inference" | "resource"; readonly text: string }[];
  readonly current_granularity: string;
  readonly already_presented: readonly string[];
  readonly presented_board?: readonly PresentedBoardNote[];
  readonly required_board_bindings?: readonly RequiredBoardBinding[];
  readonly student_stuck_point: { readonly text: string; readonly located_refs: readonly string[] } | null;
  readonly tools: readonly {
    readonly tool: string;
    readonly description: string;
    readonly parameters: ReadonlyArray<{ readonly name: string; readonly value_type: string; readonly required: boolean; readonly allowed_values?: readonly string[] }>;
    readonly binding_refs: readonly string[];
    readonly bindings?: readonly { readonly binding_ref: string; readonly purpose: string; readonly geometry_target?: string; readonly allowed_template_ids?: readonly string[]; readonly basis_refs?: { readonly fact_ids: readonly string[]; readonly inference_ids: readonly string[] } }[];
  }[];
  readonly output_budget: { readonly max_items: number; readonly max_speech_chars: number };
}

export interface PresenterPromptInput {
  readonly visual?: ProjectedVisualContext;
  readonly visualTools?: readonly VisibleVisualTool[];
  readonly context: BuiltPresentationContext;
  readonly instructionalGoal: string;
  readonly completionTarget?: "follow_along";
  readonly promptVersion?: string;
  readonly currentGranularity: string;
  readonly alreadyPresented: readonly string[];
  readonly presentedBoard?: readonly PresentedBoardNote[];
  readonly requiredBoardBindings?: readonly RequiredBoardBinding[];
  readonly stuckPoint: { readonly text: string; readonly locatedRefs: readonly string[] } | null;
  readonly visibleTools: readonly VisibleToolInstance[];
  readonly maxItems: number;
  readonly maxSpeechChars: number;
}

/** 组装 Presenter 调用输入（system prompt 常量 + 结构化 user payload）。 */
export function buildPresenterPrompt(input: PresenterPromptInput): {
  readonly systemPrompt: string;
  readonly promptVersion: string;
  readonly userPayload: PresenterUserPayload;
} {
  const payload: PresenterUserPayload = {
    instructional_goal: input.instructionalGoal,
    ...(input.completionTarget ? { completion_target: input.completionTarget } : {}),
    allowed_knowledge: input.context.basis.map((item) => ({ ref: item.ref, kind: item.kind, text: item.text })),
    current_granularity: input.currentGranularity,
    already_presented: [...input.alreadyPresented],
    ...(!input.promptVersion || [PRESENTER_PROMPT_VERSION, VISUAL_PRESENTER_PROMPT_VERSION].includes(input.promptVersion) ? {
      presented_board: [...(input.presentedBoard ?? [])],
      required_board_bindings: [...(input.requiredBoardBindings ?? [])],
    } : {}),
    student_stuck_point: input.stuckPoint === null
      ? null
      : { text: input.stuckPoint.text, located_refs: [...input.stuckPoint.locatedRefs] },
    tools: [...input.visibleTools.filter(instance => !(input.promptVersion === VISUAL_PRESENTER_PROMPT_VERSION && input.visualTools?.some(t => t.tool === instance.spec.tool_id))).map((instance) => ({
      tool: instance.spec.tool_id,
      description: instance.spec.description,
      parameters: instance.spec.parameters.map((parameter) => ({
        name: parameter.name,
        value_type: parameter.value_type,
        required: parameter.required,
        ...(parameter.allowed_values !== undefined ? { allowed_values: [...parameter.allowed_values] } : {}),
      })),
      binding_refs: instance.bindings.map((binding) => binding.binding_id),
      ...(input.promptVersion !== LEGACY_PRESENTER_PROMPT_VERSION ? { bindings: instance.bindings.map((binding) => ({
        binding_ref: binding.binding_id, purpose: binding.purpose,
        ...(binding.binding_kind === "geometry" ? { geometry_target: binding.geometry_target, allowed_template_ids: [...binding.allowed_template_ids] } : {}),
        ...(binding.binding_kind === "explanation" ? { basis_refs: binding.basis_refs } : {}),
      })) } : {}),
    })), ...(input.promptVersion === VISUAL_PRESENTER_PROMPT_VERSION ? (input.visualTools ?? []) : [])],
    ...(input.promptVersion === VISUAL_PRESENTER_PROMPT_VERSION && input.visual ? { visual: input.visual } : {}),
    output_budget: { max_items: input.maxItems, max_speech_chars: input.maxSpeechChars },
  };
  const legacy = input.promptVersion === LEGACY_PRESENTER_PROMPT_VERSION;
  const previous = input.promptVersion === PREVIOUS_PRESENTER_PROMPT_VERSION;
  const toolInvocation = input.promptVersion === TOOL_INVOCATION_PRESENTER_PROMPT_VERSION;
  if (input.promptVersion && !legacy && !previous && !toolInvocation && input.promptVersion !== PRESENTER_PROMPT_VERSION && input.promptVersion !== VISUAL_PRESENTER_PROMPT_VERSION) {
    throw new Error(`unsupported Presenter prompt version: ${input.promptVersion}`);
  }
  if (legacy && input.completionTarget) throw new Error("follow_along requires the current Presenter prompt");
  return { systemPrompt: input.promptVersion === VISUAL_PRESENTER_PROMPT_VERSION ? VISUAL_PRESENTER_SYSTEM_PROMPT : legacy ? LEGACY_PRESENTER_SYSTEM_PROMPT : previous ? PREVIOUS_PRESENTER_SYSTEM_PROMPT : toolInvocation ? TOOL_INVOCATION_PRESENTER_SYSTEM_PROMPT : PRESENTER_SYSTEM_PROMPT,
    promptVersion: input.promptVersion === VISUAL_PRESENTER_PROMPT_VERSION ? VISUAL_PRESENTER_PROMPT_VERSION : legacy ? LEGACY_PRESENTER_PROMPT_VERSION : previous ? PREVIOUS_PRESENTER_PROMPT_VERSION : toolInvocation ? TOOL_INVOCATION_PRESENTER_PROMPT_VERSION : PRESENTER_PROMPT_VERSION, userPayload: payload };
}

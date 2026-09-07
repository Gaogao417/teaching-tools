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
export const PRESENTER_PROMPT_VERSION = "presenter-interleaved/v1";

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
export const PRESENTER_SYSTEM_PROMPT = [
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

/** Presenter user payload（服务端组装；工具可见性交集已由目录计算）。 */
export interface PresenterUserPayload {
  readonly instructional_goal: string;
  readonly allowed_knowledge: readonly { readonly ref: string; readonly kind: "fact" | "inference" | "resource"; readonly text: string }[];
  readonly current_granularity: string;
  readonly already_presented: readonly string[];
  readonly student_stuck_point: { readonly text: string; readonly located_refs: readonly string[] } | null;
  readonly tools: readonly {
    readonly tool: string;
    readonly description: string;
    readonly parameters: ReadonlyArray<{ readonly name: string; readonly value_type: string; readonly required: boolean; readonly allowed_values?: readonly string[] }>;
    readonly binding_refs: readonly string[];
  }[];
  readonly output_budget: { readonly max_items: number; readonly max_speech_chars: number };
}

export interface PresenterPromptInput {
  readonly context: BuiltPresentationContext;
  readonly instructionalGoal: string;
  readonly currentGranularity: string;
  readonly alreadyPresented: readonly string[];
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
    allowed_knowledge: input.context.basis.map((item) => ({ ref: item.ref, kind: item.kind, text: item.text })),
    current_granularity: input.currentGranularity,
    already_presented: [...input.alreadyPresented],
    student_stuck_point: input.stuckPoint === null
      ? null
      : { text: input.stuckPoint.text, located_refs: [...input.stuckPoint.locatedRefs] },
    tools: input.visibleTools.map((instance) => ({
      tool: instance.spec.tool_id,
      description: instance.spec.description,
      parameters: instance.spec.parameters.map((parameter) => ({
        name: parameter.name,
        value_type: parameter.value_type,
        required: parameter.required,
        ...(parameter.allowed_values !== undefined ? { allowed_values: [...parameter.allowed_values] } : {}),
      })),
      binding_refs: instance.bindings.map((binding) => binding.binding_id),
    })),
    output_budget: { max_items: input.maxItems, max_speech_chars: input.maxSpeechChars },
  };
  return { systemPrompt: PRESENTER_SYSTEM_PROMPT, promptVersion: PRESENTER_PROMPT_VERSION, userPayload: payload };
}

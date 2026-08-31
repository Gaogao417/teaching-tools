/**
 * StructuredModelGateProvider（F6 — 生产模型接线；f6-scope-ledger 输出 2）。
 *
 * `tutorIntelligence/StructuredModelPort` → `GateAdjudicationProvider` 的唯一
 * 适配器（计划 §5 F6「生产模型接线」：复用现有 StructuredModelPort，不建第三
 * 套通用模型基础设施）：
 * - 组合根把生产模型 port（OpenAI-compatible adapter 等）注入本类，本类再作为
 *   provider 注入 `ModelGateAdjudicatorV5`（NavigatorSession start/resume）；
 * - 上下文 JSON 解析为 userPayload 对象（adapter 负责序列化，不拼自由文本——
 *   structuredModelPort 固定口径），systemPrompt=九条 Gate 裁决提示词，
 *   promptVersion=`MODEL_GATE_ADJUDICATOR_VERSION`；
 * - port 返回的结构化 JSON 值重新序列化为文本交回裁决器——**薄边界校验
 *   （validateAdjudicationResponse：形状/候选集/grounding 值域/非证据类不得
 *   pass）不在此绕过、不在此替代**；
 * - `StructuredModelError`（auth/rate-limit/provider/timeout/cancelled/
 *   invalid-json）→ 原样抛出（StructuredModelError）：裁决器 catch 后降级
 *   unclear + degraded_reason（模型不可用 fail closed，不回退字符串匹配）；
 * - provider/model/prompt 版本由 `modelGatePinOf` 随 session pin
 *   （session_started.model_gate_pin；resume 对账）。
 *
 * ClaudeCodeGateProvider 只保留人工实证用途（R3 口径），不经本类、不入生产
 * Runtime；FixedResponseGateProvider 只用于确定性测试。
 */
import type { StructuredModelPort } from "../tutorIntelligence/structuredModelPort";
import { StructuredModelError } from "../tutorIntelligence/structuredModelPort";
import {
  GATE_ADJUDICATION_SYSTEM_PROMPT,
  MODEL_GATE_ADJUDICATOR_VERSION,
  type GateAdjudicationProvider,
} from "../tutorNavigator/ModelGateAdjudicatorV5";

/** session_started.model_gate_pin 形状（canonical runtime/v5 可选加法，F6 增补）。 */
export interface V5ModelGatePin {
  provider: string;
  model_id: string;
  prompt_version: string;
  adjudicator_version: string;
}

export interface StructuredModelGateProviderOptions {
  /**
   * prompt 版本覆盖（缺省=MODEL_GATE_ADJUDICATOR_VERSION）。仅测试/实证用；
   * 生产组合根不得传——pin 与实际调用版本漂移会在 resume 对账暴露。
   */
  readonly promptVersion?: string;
  readonly maxCompletionTokens?: number;
}

export class StructuredModelGateProvider implements GateAdjudicationProvider {
  readonly name: string;
  private readonly port: StructuredModelPort;
  private readonly promptVersion: string;
  private readonly maxCompletionTokens?: number;

  constructor(port: StructuredModelPort, options: StructuredModelGateProviderOptions = {}) {
    this.port = port;
    this.promptVersion = options.promptVersion ?? MODEL_GATE_ADJUDICATOR_VERSION;
    this.maxCompletionTokens = options.maxCompletionTokens;
    this.name = `structured-model/${port.provider}`;
  }

  /** pin 计算：provider/model/prompt/version 随 session（F6 写入门禁必带）。 */
  modelGatePin(): V5ModelGatePin {
    return {
      provider: this.name,
      model_id: this.port.modelId,
      prompt_version: this.promptVersion,
      adjudicator_version: MODEL_GATE_ADJUDICATOR_VERSION,
    };
  }

  async adjudicate(contextJson: string): Promise<string> {
    let context: unknown;
    try {
      context = JSON.parse(contextJson);
    } catch {
      // 防御：调用方（ModelGateAdjudicatorV5）始终传合法 JSON；坏输入 fail fast。
      throw new StructuredModelError("invalid-json", "gate adjudication context is not valid JSON", false);
    }
    let result: { value: unknown };
    try {
      result = await this.port.complete<unknown>({
        systemPrompt: GATE_ADJUDICATION_SYSTEM_PROMPT,
        promptVersion: this.promptVersion,
        userPayload: context,
        timeoutMs: 30_000,
        ...(this.maxCompletionTokens !== undefined ? { maxCompletionTokens: this.maxCompletionTokens } : {}),
      });
    } catch (error) {
      // 错误语义透传（不吞码）：timeout 语义归一为裁决器可识别的口径
      // （provider_timeout vs provider_error 的分类依据）；其余原样抛出 →
      // 裁决器降级 unclear（fail closed）。
      if (error instanceof StructuredModelError) {
        throw new StructuredModelError(
          error.code,
          error.code === "timeout" ? `${error.message} (timed out)` : error.message,
          error.retryable,
        );
      }
      throw error;
    }
    // 结构化结果回文本：服务端薄边界校验（形状/候选集/grounding）在裁决器
    // 侧原样执行——本适配器不做语义判断（模型说了不算，校验说了算）。
    return JSON.stringify(result.value);
  }
}

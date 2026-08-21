/**
 * Provider-neutral structured model port（Phase 5 remediation / 完整收口计划 §2）。
 *
 * 智能链（align_reasoning / choose_move_and_voice）只依赖本端口拿「结构化
 * JSON 输出」；具体 provider（DeepSeek OpenAI-compatible / fake）在 adapter
 * 后面可替换。固定口径（计划裁定，不得放宽）：
 * - temperature 0、thinking disabled（课堂回合预算内必须即时出结构化结果，
 *   隐藏推理 token 不进入 TTS/事件流）；
 * - 超时由调用方按预算传入（单次模型调用 ≤1.5s，整图 ≤3.5S）；
 * - 错误类别与 coach 侧 TextGenerationError 同口径（auth/rate-limit/provider/
 *   timeout/cancelled/invalid-json），retryable 供 LangGraph RetryPolicy 用。
 */
export type StructuredModelErrorCode =
  | "not-configured"
  | "auth-error"
  | "rate-limited"
  | "provider-error"
  | "timeout"
  | "cancelled"
  | "invalid-json";

export class StructuredModelError extends Error {
  constructor(
    readonly code: StructuredModelErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StructuredModelError";
  }
}

export interface StructuredCompletionRequest {
  /** 版本化 system prompt（provenance 进事件流）。 */
  systemPrompt: string;
  promptVersion: string;
  /** user 消息载荷（对象；adapter 负责序列化，不拼自由文本）。 */
  userPayload: unknown;
  /** 解析目标：最小 JSON 骨架校验（字段存在性/枚举），深校验在图节点做。 */
  maxCompletionTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface StructuredUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredCompletionResult<T> {
  value: T;
  modelId: string;
  promptVersion: string;
  usage?: StructuredUsage;
  latencyMs: number;
}

export interface StructuredModelPort {
  readonly provider: string;
  readonly modelId: string;
  complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>>;
}

/** 从任意 provider 错误归一（RetryPolicy 判定用）。 */
export function isRetryableModelError(error: unknown): boolean {
  return error instanceof StructuredModelError && error.retryable;
}

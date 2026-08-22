/**
 * DeepSeek OpenAI-compatible 结构化输出 adapter（Phase 5 remediation）。
 *
 * 复用 coach 侧 DeepSeekTextCoachEngine 的配置面与错误映射（DEEPSEEK_API_KEY /
 * DEEPSEEK_BASE_URL / 超时/ max tokens），差异：
 * - 非流式 + response_format json_object（结构化决策，不进 segmenter）；
 * - 模型名读 TUTOR_DEEPSEEK_MODEL（计划固定 deepseek-v4-flash），
 *   与 coach 的 COACH_DEEPSEEK_MODEL 互不干扰；
 * - thinking disabled（与 coach 同因：隐藏推理不可进 TTS/事件）。
 */
import {
  StructuredModelError,
  type StructuredCompletionRequest,
  type StructuredCompletionResult,
  type StructuredModelPort,
  type StructuredUsage,
} from "../../structuredModelPort";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
// 与 policyGraph 预算同步放宽（失败分析报告 §四.3：1.5s 上限裁掉了 p75+ 的
// 真实延迟，是 timeout 降级噪音的直接来源）；TUTOR_DEEPSEEK_TIMEOUT_MS 覆盖。
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_TOKENS = 512;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DeepSeekStructuredModelOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  fetchImpl?: FetchLike;
}

interface ResolvedOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxCompletionTokens: number;
  fetchImpl: FetchLike;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! > 0 ? Math.floor(value!) : fallback;
}

function resolveOptions(options: DeepSeekStructuredModelOptions): ResolvedOptions {
  return {
    apiKey: options.apiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "",
    baseUrl: (options.baseUrl?.trim() || process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: options.model?.trim() || process.env.TUTOR_DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: positiveInteger(options.timeoutMs ?? Number(process.env.TUTOR_DEEPSEEK_TIMEOUT_MS), DEFAULT_TIMEOUT_MS),
    maxCompletionTokens: positiveInteger(
      options.maxCompletionTokens ?? Number(process.env.TUTOR_DEEPSEEK_MAX_TOKENS),
      DEFAULT_MAX_TOKENS,
    ),
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function mapHttpError(status: number, detail: string): StructuredModelError {
  const suffix = detail.trim() ? `: ${detail.trim().slice(0, 300)}` : "";
  if (status === 401 || status === 403) {
    return new StructuredModelError("auth-error", `DeepSeek authentication failed (${status})${suffix}`, false);
  }
  if (status === 429) {
    return new StructuredModelError("rate-limited", `DeepSeek rate limited (${status})${suffix}`, true);
  }
  return new StructuredModelError(
    "provider-error",
    `DeepSeek request failed (${status})${suffix}`,
    status >= 500 || status === 408,
  );
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof (value as { message: unknown }).message === "string") {
    return (value as { message: string }).message;
  }
  try { return JSON.stringify(value); } catch { return "unknown provider error"; }
}

function mapUsage(value: unknown): StructuredUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  return {
    ...(typeof usage.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {}),
  };
}

/** 提取 json_object 模式下的内容并解析（带 <think> 剥离兜底）。 */
export function parseModelJson<T>(content: string): T {
  const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? stripped.slice(start, end + 1) : stripped;
  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    throw new StructuredModelError(
      "invalid-json",
      `模型输出不是合法 JSON 对象: ${errorMessage(error)}（前 200 字: ${candidate.slice(0, 200)}）`,
      false,
    );
  }
}

export class DeepSeekStructuredModel implements StructuredModelPort {
  private readonly options: ResolvedOptions;
  readonly provider = "deepseek-api";
  readonly modelId: string;

  constructor(options: DeepSeekStructuredModelOptions = {}) {
    this.options = resolveOptions(options);
    this.modelId = this.options.model;
  }

  async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
    if (!this.options.apiKey) {
      throw new StructuredModelError("not-configured", "DEEPSEEK_API_KEY is not configured", false);
    }
    const timeoutMs = Math.min(request.timeoutMs, this.options.timeoutMs) || this.options.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("DeepSeek structured timeout"));
    }, timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await this.options.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: JSON.stringify(request.userPayload) },
          ],
          temperature: 0,
          max_completion_tokens: request.maxCompletionTokens ?? this.options.maxCompletionTokens,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw mapHttpError(response.status, detail);
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: unknown;
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) {
        throw new StructuredModelError("provider-error", "DeepSeek returned empty content", true);
      }
      return {
        value: parseModelJson<T>(content),
        modelId: this.options.model,
        promptVersion: request.promptVersion,
        usage: mapUsage(body.usage),
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof StructuredModelError) throw error;
      if (request.signal?.aborted) {
        throw new StructuredModelError("cancelled", "structured completion cancelled", false);
      }
      if (timedOut) {
        throw new StructuredModelError("timeout", `DeepSeek structured timed out after ${timeoutMs}ms`, true);
      }
      throw new StructuredModelError(
        "provider-error",
        `DeepSeek request failed: ${errorMessage(error)}`.slice(0, 400),
        true,
      );
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

import { STREAM_COACH_SYSTEM_PROMPT } from "../application/coachTextPrompt";
import {
  streamFromIterable,
  TextGenerationError,
  type EventStream,
  type Result,
  type TextCoachEngine,
  type TextCoachInput,
  type TextGenerationEvent,
  type UsageSummary,
} from "../ports/TextCoachEngine";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOKENS = 256;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface DeepSeekTextCoachEngineOptions {
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

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveOptions(options: DeepSeekTextCoachEngineOptions): ResolvedOptions {
  return {
    apiKey: options.apiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || "",
    baseUrl: trimTrailingSlash(options.baseUrl?.trim()
      || process.env.DEEPSEEK_BASE_URL?.trim()
      || DEFAULT_BASE_URL),
    model: options.model?.trim() || process.env.COACH_DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
    timeoutMs: positiveInteger(
      options.timeoutMs ?? Number(process.env.COACH_DEEPSEEK_TIMEOUT_MS),
      DEFAULT_TIMEOUT_MS,
    ),
    maxCompletionTokens: positiveInteger(
      options.maxCompletionTokens ?? Number(process.env.COACH_DEEPSEEK_MAX_TOKENS),
      DEFAULT_MAX_TOKENS,
    ),
    fetchImpl: options.fetchImpl ?? fetch,
  };
}

function mapHttpError(status: number, detail: string): TextGenerationError {
  const suffix = detail.trim() ? `: ${detail.trim().slice(0, 300)}` : "";
  if (status === 401 || status === 403) {
    return new TextGenerationError("auth-error", `DeepSeek authentication failed (${status})${suffix}`, false);
  }
  if (status === 429) {
    return new TextGenerationError("rate-limited", `DeepSeek rate limited the coach (${status})${suffix}`, true);
  }
  return new TextGenerationError(
    "provider-error",
    `DeepSeek request failed (${status})${suffix}`,
    status >= 500 || status === 408,
  );
}

function errorMessage(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") {
    return value.message;
  }
  try { return JSON.stringify(value); } catch { return "unknown provider error"; }
}

function mapUsage(value: unknown, model: string): UsageSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as Record<string, unknown>;
  return {
    ...(typeof usage.prompt_tokens === "number" ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === "number" ? { outputTokens: usage.completion_tokens } : {}),
    model,
  };
}

/**
 * Direct OpenAI-compatible DeepSeek adapter. It intentionally disables
 * thinking: a short classroom reply must start speaking quickly, and hidden
 * reasoning tokens cannot be sent to the segmenter/TTS pipeline.
 */
export class DeepSeekTextCoachEngine implements TextCoachEngine {
  private readonly options: ResolvedOptions;
  readonly telemetryIdentity: { provider: string; model: string };

  constructor(options: DeepSeekTextCoachEngineOptions = {}) {
    this.options = resolveOptions(options);
    this.telemetryIdentity = { provider: "deepseek-api", model: this.options.model };
  }

  async streamReply(
    input: TextCoachInput,
    signal: AbortSignal,
  ): Promise<Result<EventStream<TextGenerationEvent>, TextGenerationError>> {
    if (!input.studentQuestion.trim()) {
      return { ok: false, error: new TextGenerationError("empty-question", "Student question is empty", false) };
    }
    if (!this.options.apiKey) {
      return { ok: false, error: new TextGenerationError("not-configured", "DEEPSEEK_API_KEY is not configured", false) };
    }
    if (signal.aborted) {
      return { ok: false, error: new TextGenerationError("cancelled", "Coach text generation cancelled", false) };
    }

    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("DeepSeek coach timeout"));
    }, this.options.timeoutMs);

    let response: Response;
    try {
      response = await this.options.fetchImpl(`${this.options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: "system", content: STREAM_COACH_SYSTEM_PROMPT },
            { role: "user", content: JSON.stringify(input) },
          ],
          temperature: 0,
          max_completion_tokens: this.options.maxCompletionTokens,
          thinking: { type: "disabled" },
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (signal.aborted) {
        return { ok: false, error: new TextGenerationError("cancelled", "Coach text generation cancelled", false) };
      }
      if (timedOut) {
        return { ok: false, error: new TextGenerationError("timeout", `DeepSeek coach timed out after ${this.options.timeoutMs}ms`, true) };
      }
      return {
        ok: false,
        error: new TextGenerationError("provider-error", `DeepSeek request failed: ${errorMessage(error)}`.slice(0, 400), true),
      };
    }

    if (!response.ok || !response.body) {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      const detail = await response.text().catch(() => "");
      return { ok: false, error: mapHttpError(response.status, detail) };
    }

    const events = this.readEvents(response.body, signal, controller, timer, onAbort, () => timedOut);
    return { ok: true, value: streamFromIterable(events) };
  }

  private async *readEvents(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
    controller: AbortController,
    timer: NodeJS.Timeout,
    onAbort: () => void,
    timedOut: () => boolean,
  ): AsyncGenerator<TextGenerationEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawText = false;
    let usage: UsageSummary | undefined;
    let completed = false;

    const consumeLine = (rawLine: string): { text?: string; done?: boolean; usage?: UsageSummary; error?: TextGenerationError } => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return {};
      const data = line.slice(5).trim();
      if (data === "[DONE]") return { done: true };
      let payload: Record<string, any>;
      try { payload = JSON.parse(data); } catch { return {}; }
      if (payload.error) {
        return { error: new TextGenerationError("provider-error", `DeepSeek stream error: ${errorMessage(payload.error)}`.slice(0, 400), true) };
      }
      const mappedUsage = mapUsage(payload.usage, this.options.model);
      const text = payload.choices?.[0]?.delta?.content;
      return {
        ...(typeof text === "string" && text.length > 0 ? { text } : {}),
        ...(mappedUsage ? { usage: mappedUsage } : {}),
      };
    };

    try {
      while (!completed) {
        const { done, value } = await reader.read();
        if (done) { completed = true; break; }
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const rawLine = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          const step = consumeLine(rawLine);
          if (step.error) throw step.error;
          if (step.usage) usage = step.usage;
          if (step.text) {
            sawText = true;
            yield { type: "text-delta", text: step.text };
          }
          if (step.done) completed = true;
        }
      }
      if (!sawText) throw new TextGenerationError("empty-response", "DeepSeek returned no coach text", true);
      yield { type: "text-completed", usage: usage ?? { model: this.options.model } };
    } catch (error) {
      if (error instanceof TextGenerationError) throw error;
      if (signal.aborted) throw new TextGenerationError("cancelled", "Coach text generation cancelled", false);
      if (timedOut()) throw new TextGenerationError("timeout", `DeepSeek coach timed out after ${this.options.timeoutMs}ms`, true);
      throw new TextGenerationError("provider-error", `DeepSeek stream failed: ${errorMessage(error)}`.slice(0, 400), true);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (!completed) controller.abort();
      try { await reader.cancel(); } catch { /* already closed */ }
    }
  }
}

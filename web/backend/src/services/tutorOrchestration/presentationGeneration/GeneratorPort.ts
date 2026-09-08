import { VISUAL_PRESENTER_PROMPT_VERSION, LEGACY_VISUAL_PRESENTER_PROMPT_VERSION, PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION, isVisualPresenterPromptVersion } from "./PresenterPrompts";
import { VISUAL_CONTEXT_BUILDER_VERSION, VISUAL_TOOL_CATALOG_VERSION } from "./VisualPresentationTools";
/**
 * PresenterGeneratorPort（F7 RT3 — 真实模型一次生成 interleaved speech/tool intents）。
 *
 * 复用既有 StructuredModelPort 基础设施（不建第三套模型设施；独立 Presenter pin
 * 与判题链 model_gate_pin、教学策略链 policy_profile 分开——state/v4 描述）。
 * Provider 组合（组合根 createPresenterModelPort）：
 * - deepseek（缺省）：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / TUTOR_PRESENTER_MODEL；
 * - dashscope：只取 DASHSCOPE_API_KEY + DashScope OpenAI 兼容模式
 *   （TUTOR_PRESENTER_DASHSCOPE_BASE_URL，缺省 compatible-mode 端点）——
 *   供应商严格隔离（F7 P2-B/B7）：缺键不回退 DEEPSEEK_API_KEY，provider 标记
 *   「dashscope」（经 DashScopePresenterModelPort 委托既有适配器，非第三套设施）。
 * 键名环境变量只检测存在性，绝不记录值；键缺失 ⇒ not-configured 错误如实上抛
 * （协调者登记受阻，不伪造模型输出，不以 stub 冒充 AP-01/02 通过）。
 *
 * 输出经 canonical generation/v2 presentation-draft 判定（模型原始输出不要求
 * 携带 request_id——服务器包装时填写）。draft 是不可信结构：合法 ≠ 正确，
 * 内容绑定/预演由 IntentCompiler/SequencePreflight 承担。
 */
import type { z } from "zod";

import { presentationDraftV2Schema } from "../../../../../shared/canonical";
import { DeepSeekStructuredModel } from "../../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel";
import { StructuredModelError, type StructuredCompletionRequest, type StructuredCompletionResult, type StructuredModelPort } from "../../tutorIntelligence/structuredModelPort";
import { CONTEXT_BUILDER_VERSION } from "./ContextBuilder";
import { PRESENTER_PROMPT_VERSION, LEGACY_PRESENTER_PROMPT_VERSION, PREVIOUS_PRESENTER_PROMPT_VERSION, TOOL_INVOCATION_PRESENTER_PROMPT_VERSION } from "./PresenterPrompts";
import { PRESENTATION_TOOL_CATALOG_VERSION } from "./PresentationToolCatalog";

/** canonical generation/v2 draft（服务器包装后的可信形状）。 */
export type PresentationDraftV2 = z.infer<typeof presentationDraftV2Schema>;

/** state/v4 presenter_generation_pin（会话级；请求 pin 必须与之相等——镜像规则②）。 */
export interface PresenterGenerationPin {
  readonly provider: string;
  readonly model_id: string;
  readonly prompt_version: string;
  readonly context_builder_version: string;
  readonly tool_catalog_version: string;
}

/** 生成失败分类（state/v4 generation_error_class + RETRY_EXHAUSTED 的非预算成员）。 */
export type GenerationFailureClass =
  | "provider_failure"
  | "timeout"
  | "draft_invalid"
  | "preflight_failed"
  | "context_irreproducible"
  | "internal_error";

export class PresenterGenerationError extends Error {
  constructor(
    readonly failureClass: GenerationFailureClass,
    message: string,
    readonly retryable: boolean,
    readonly diagnostic?: {stage:"draft_validation";issues:readonly {path:readonly (string|number)[];code:string;message:string}[]} | {stage:"provider";code:StructuredModelError["code"]},
  ) {
    super(message);
    this.name = "PresenterGenerationError";
  }
}

/** Explicitly allowlisted review diagnostics: never serialize arbitrary Error fields. */
export function presenterFailureDiagnostic(error:unknown) {
  return error instanceof PresenterGenerationError
    ? {name:error.name,failure_class:error.failureClass,retryable:error.retryable,...(error.diagnostic?{diagnostic:error.diagnostic}:{})}
    : {name:error instanceof Error?error.name:"Error"};
}

/** 端口接口（测试注入 scripted port；生产 = StructuredModelPort 包装）。 */
export interface PresenterGeneratorPort {
  readonly provider: string;
  readonly modelId: string;
  readonly pin: PresenterGenerationPin;
  /** 一次联合生成（事务外调用；调用方负责重试预算/取消）。 */
  generatePresentationDraft(request: {
    readonly request_id: string;
    readonly systemPrompt: string;
    readonly promptVersion: string;
    readonly userPayload: unknown;
    readonly timeoutMs: number;
    readonly maxCompletionTokens?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly draft: PresentationDraftV2; readonly latencyMs: number }>;
}

const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const DEFAULT_PRESENTER_TIMEOUT_MS = 30_000;
const DEFAULT_PRESENTER_MAX_TOKENS = 2_048;

/**
 * DashScope 严格隔离端口（F7 P2-B/B7）：provider 身份=「dashscope」，密钥只取
 * DASHSCOPE_API_KEY——缺失 ⇒ 端口构造成功但调用时 not-configured 如实失败，
 * 绝不回退 DEEPSEEK_API_KEY（跨供应商密钥不得互发；文件头声明的意图在此收口）。
 * 有键时委托既有 DeepSeekStructuredModel（OpenAI 兼容协议复用，非第三套设施）；
 * 显式传入的非空 apiKey/baseUrl/model 在适配器内按传入值生效（无 env 回退）。
 */
class DashScopePresenterModelPort implements StructuredModelPort {
  readonly provider = "dashscope";
  readonly modelId: string;
  private readonly apiKey: string;
  private readonly delegate: DeepSeekStructuredModel | undefined;

  constructor(options: { readonly apiKey?: string; readonly baseUrl: string; readonly model?: string; readonly timeoutMs: number; readonly maxCompletionTokens: number }) {
    this.apiKey = options.apiKey?.trim() ?? "";
    this.modelId = options.model?.trim() ?? "";
    this.delegate = this.apiKey && this.modelId
      ? new DeepSeekStructuredModel({
        apiKey: this.apiKey,
        baseUrl: options.baseUrl,
        model: this.modelId,
        timeoutMs: options.timeoutMs,
        maxCompletionTokens: options.maxCompletionTokens,
      })
      : undefined;
  }

  async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
    if (!this.apiKey || !this.modelId || !this.delegate) {
      // 如实受阻：键/模型名缺失不是 DeepSeek 的 not-configured——供应商身份准确。
      throw new StructuredModelError(
        "not-configured",
        !this.apiKey
          ? "DASHSCOPE_API_KEY is not configured (dashscope presenter never falls back to another provider's key)"
          : "TUTOR_PRESENTER_MODEL is not configured for the dashscope presenter",
        false,
      );
    }
    return this.delegate.complete<T>(request);
  }
}

function presenterTimeoutMs(): number {
  const raw = Number(process.env.TUTOR_PRESENTER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_PRESENTER_TIMEOUT_MS;
}

function presenterMaxTokens(): number {
  const raw = Number(process.env.TUTOR_PRESENTER_MAX_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_PRESENTER_MAX_TOKENS;
}

/** Provider 组合根：按环境选择 presenter 模型端口（键缺失 → 端口构造成功但调用时 not-configured 如实失败）。 */
export function createPresenterModelPort(): StructuredModelPort {
  const provider = (process.env.TUTOR_PRESENTER_PROVIDER ?? "deepseek").trim().toLowerCase();
  const model = process.env.TUTOR_PRESENTER_MODEL?.trim();
  if (provider === "dashscope") {
    // F7 P2-B（B7）：供应商严格隔离——只取 DASHSCOPE_API_KEY；空键交给
    // DashScopePresenterModelPort 在调用时如实 not-configured（显式空键不得
    // 触发适配器对 DEEPSEEK_API_KEY 的回退）；provider 标记 dashscope。
    return new DashScopePresenterModelPort({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseUrl: process.env.TUTOR_PRESENTER_DASHSCOPE_BASE_URL?.trim() || DEFAULT_DASHSCOPE_BASE_URL,
      ...(model !== undefined ? { model } : {}),
      timeoutMs: presenterTimeoutMs(),
      maxCompletionTokens: presenterMaxTokens(),
    });
  }
  return new DeepSeekStructuredModel({
    ...(model !== undefined ? { model } : {}),
    timeoutMs: presenterTimeoutMs(),
    maxCompletionTokens: presenterMaxTokens(),
  });
}

/** StructuredModelError → 生成失败分类（closed set；retryable 供重试预算判定）。 */
export function mapStructuredModelError(error: unknown): PresenterGenerationError {
  if (error instanceof PresenterGenerationError) return error;
  if (error instanceof StructuredModelError) {
    const diagnostic={stage:"provider" as const,code:error.code};
    switch (error.code) {
      case "timeout":
        return new PresenterGenerationError("timeout", error.message, true, diagnostic);
      case "rate-limited":
      case "provider-error":
        return new PresenterGenerationError("provider_failure", error.message, true, diagnostic);
      case "not-configured":
      case "auth-error":
        return new PresenterGenerationError("provider_failure", `${error.code}: ${error.message}`, false, diagnostic);
      case "invalid-json":
        return new PresenterGenerationError("draft_invalid", error.message, false, diagnostic);
      case "cancelled":
        return new PresenterGenerationError("internal_error", error.message, false, diagnostic);
    }
  }
  return new PresenterGenerationError(
    "internal_error",
    error instanceof Error ? error.message : String(error),
    false,
  );
}

/** StructuredModelPort → PresenterGeneratorPort 适配（draft 校验在这里收口）。 */
export function structuredPresenterGenerator(port: StructuredModelPort, options: { readonly promptVersion?: string } = {}): PresenterGeneratorPort {
  const promptVersion = options.promptVersion ?? PRESENTER_PROMPT_VERSION;
  if (![LEGACY_PRESENTER_PROMPT_VERSION, PREVIOUS_PRESENTER_PROMPT_VERSION, TOOL_INVOCATION_PRESENTER_PROMPT_VERSION, PRESENTER_PROMPT_VERSION, VISUAL_PRESENTER_PROMPT_VERSION, LEGACY_VISUAL_PRESENTER_PROMPT_VERSION, PREVIOUS_VISUAL_PRESENTER_PROMPT_VERSION].includes(promptVersion)) {
    throw new Error(`unsupported Presenter prompt version: ${promptVersion}`);
  }
  return {
    provider: port.provider,
    modelId: port.modelId,
    pin: {
      provider: port.provider,
      model_id: port.modelId,
      prompt_version: promptVersion,
      context_builder_version: isVisualPresenterPromptVersion(promptVersion) ? VISUAL_CONTEXT_BUILDER_VERSION : CONTEXT_BUILDER_VERSION,
      tool_catalog_version: isVisualPresenterPromptVersion(promptVersion) ? VISUAL_TOOL_CATALOG_VERSION : PRESENTATION_TOOL_CATALOG_VERSION,
    },
    async generatePresentationDraft(request) {
      let raw: unknown;
      let latencyMs = 0;
      try {
        const result = await port.complete<unknown>({
          systemPrompt: request.systemPrompt,
          promptVersion: request.promptVersion,
          userPayload: request.userPayload,
          timeoutMs: request.timeoutMs,
          ...(request.maxCompletionTokens !== undefined ? { maxCompletionTokens: request.maxCompletionTokens } : {}),
          ...(request.signal !== undefined ? { signal: request.signal } : {}),
        });
        raw = result.value;
        latencyMs = result.latencyMs;
      } catch (error) {
        throw mapStructuredModelError(error);
      }
      // 模型按 prompt 约定输出 {items:[...]}；服务器拥有的 schema/request_id 放在
      // 展开之后（模型不可注入/覆盖身份字段）。模型夹带其他字段 ⇒ additionalProperties:
      // false 判 draft_invalid（fail closed，不部分采用）。
      const candidate = {
        ...(raw as Record<string, unknown>),
        schema: "ai_teaching_presentation_draft/v2",
        request_id: request.request_id,
      };
      const parsed = presentationDraftV2Schema.safeParse(candidate);
      if (!parsed.success) {
        throw new PresenterGenerationError(
          "draft_invalid",
          `model output fails canonical presentation-draft/v2: ${parsed.error.issues
            .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
            .join("; ")}`,
          false,
          {stage:"draft_validation",issues:parsed.error.issues.map(issue=>({path:issue.path,code:issue.code,message:issue.message}))},
        );
      }
      return { draft: parsed.data, latencyMs };
    },
  };
}

/** 生产组合（HTTP/Orchestrator 装配点）。 */
export function createPresenterGenerator(options: { readonly promptVersion?: string } = {}): PresenterGeneratorPort {
  return structuredPresenterGenerator(createPresenterModelPort(), options);
}

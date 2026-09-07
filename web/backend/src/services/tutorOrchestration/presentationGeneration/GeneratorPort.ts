/**
 * PresenterGeneratorPort（F7 RT3 — 真实模型一次生成 interleaved speech/tool intents）。
 *
 * 复用既有 StructuredModelPort 基础设施（不建第三套模型设施；独立 Presenter pin
 * 与判题链 model_gate_pin、教学策略链 policy_profile 分开——state/v4 描述）。
 * Provider 组合（组合根 createPresenterModelPort）：
 * - deepseek（缺省）：DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / TUTOR_PRESENTER_MODEL；
 * - dashscope：DASHSCOPE_API_KEY + DashScope OpenAI 兼容模式
 *   （TUTOR_PRESENTER_DASHSCOPE_BASE_URL，缺省 compatible-mode 端点）。
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
import { StructuredModelError, type StructuredModelPort } from "../../tutorIntelligence/structuredModelPort";
import { CONTEXT_BUILDER_VERSION } from "./ContextBuilder";
import { PRESENTER_PROMPT_VERSION } from "./PresenterPrompts";
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
  ) {
    super(message);
    this.name = "PresenterGenerationError";
  }
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
    return new DeepSeekStructuredModel({
      apiKey: process.env.DASHSCOPE_API_KEY?.trim() || "",
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
    switch (error.code) {
      case "timeout":
        return new PresenterGenerationError("timeout", error.message, true);
      case "rate-limited":
      case "provider-error":
        return new PresenterGenerationError("provider_failure", error.message, true);
      case "not-configured":
      case "auth-error":
        return new PresenterGenerationError("provider_failure", `${error.code}: ${error.message}`, false);
      case "invalid-json":
        return new PresenterGenerationError("draft_invalid", error.message, false);
      case "cancelled":
        return new PresenterGenerationError("internal_error", error.message, false);
    }
  }
  return new PresenterGenerationError(
    "internal_error",
    error instanceof Error ? error.message : String(error),
    false,
  );
}

/** StructuredModelPort → PresenterGeneratorPort 适配（draft 校验在这里收口）。 */
export function structuredPresenterGenerator(port: StructuredModelPort): PresenterGeneratorPort {
  return {
    provider: port.provider,
    modelId: port.modelId,
    pin: {
      provider: port.provider,
      model_id: port.modelId,
      prompt_version: PRESENTER_PROMPT_VERSION,
      context_builder_version: CONTEXT_BUILDER_VERSION,
      tool_catalog_version: PRESENTATION_TOOL_CATALOG_VERSION,
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
        );
      }
      return { draft: parsed.data, latencyMs };
    },
  };
}

/** 生产组合（HTTP/Orchestrator 装配点）。 */
export function createPresenterGenerator(): PresenterGeneratorPort {
  return structuredPresenterGenerator(createPresenterModelPort());
}

/**
 * F7 — vNext 学生端出口的 Gate 裁决模型组合根（HTTP 层唯一组装点）。
 *
 * 生产（缺省）：`DeepSeekStructuredModel`（既有 StructuredModelPort 实现，
 * DEEPSEEK_API_KEY/BASE_URL/TUTOR_DEEPSEEK_MODEL 环境变量）→
 * `StructuredModelGateProvider`（F6 薄边界适配器，不建第三套模型设施）。
 *
 * e2e/测试（TUTOR_VNEXT_SCRIPTED_GATE=1，仅限非生产环境）：脚本化端口对
 * 裁决上下文返回「首个候选 gate pass + 锚定其 expected_fact」的确定性
 * 响应——走与生产完全相同的 StructuredModelGateProvider 边界校验链路
 * （validateAdjudicationResponse 不绕过：grounding 出 plan 外会被拒）。
 * 固定响应 provider 的先例口径 = R3（模型真实性由 R3 真模型实证单独覆盖）。
 */
import { DeepSeekStructuredModel } from "../tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel";
import { StructuredModelError } from "../tutorIntelligence/structuredModelPort";
import type { StructuredCompletionRequest, StructuredModelPort } from "../tutorIntelligence/structuredModelPort";
import { StructuredModelGateProvider } from "./StructuredModelGateProvider";
import type { OrchestratorModelInput } from "./TutorSessionOrchestratorV5";

/**
 * 脚本化 Gate 端口：对 gate 裁决/提问提示返回确定性响应（e2e 专用）。
 *
 * 文本敏感分支（e2e 驱动多样输入路径；仅此端口的行为，生产端口不受影响）：
 * - 作答含「不会」「不知道」→ unclear（mixed_or_ambiguous）→ scaffold 分支接住；
 * - 作答含「并不相似」「答错」→ fail（misaligned）→ 不推进 + 老师重锚定（D-3）；
 * - 其余 → pass（首个候选 gate + 锚定 expected_fact）。
 */
class ScriptedGateModelPort implements StructuredModelPort {
  readonly provider = "scripted-gate";
  readonly modelId = "scripted-gate/v1";

  async complete<T>(request: StructuredCompletionRequest): Promise<{ value: T; modelId: string; promptVersion: string; latencyMs: number }> {
    const payload = request.userPayload as
      | {
          student_input?: { intent_kind?: string; text?: string };
          eligible_gates?: Array<{ gate_id: string; expected_fact?: { fact_id: string } }>;
          relevant_solution_context?: Array<{ fact_id: string; in_current_beat?: boolean }>;
        }
      | undefined;
    const anchor =
      payload?.eligible_gates?.[0]?.expected_fact?.fact_id
      ?? payload?.relevant_solution_context?.find((fact) => fact.in_current_beat)?.fact_id
      ?? payload?.relevant_solution_context?.[0]?.fact_id;
    // 提问/求助提示（intent_kind 区分——上下文恒带 eligible_gates，不能只按
    // 候选集判断）：锚定当前 Beat 首个细图事实（等价 questionOn("FN-xx")——
    // 打开 Approved inquiry 分支而非 out-of-bound）。
    if (payload?.student_input?.intent_kind === "ask_question" || payload?.student_input?.intent_kind === "request_scaffold" || payload?.student_input?.intent_kind === "request_rephrase") {
      const value = anchor
        ? {
            response_kind: "question",
            verdict: "not_applicable",
            reasoning_location: "aligned",
            grounding_refs: [anchor],
            brief_reason: "scripted e2e in-bound question",
          }
        : {
            response_kind: "question",
            verdict: "not_applicable",
            reasoning_location: "unknown",
            grounding_refs: [],
            brief_reason: "scripted e2e question without context",
          };
      return { value: value as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
    }
    const text = String(payload?.student_input?.text ?? "");
    const gate = payload?.eligible_gates?.[0];
    if (/不会|不知道/.test(text)) {
      // 模糊作答 → unclear 降级（scaffold 分支接住）。
      const value = {
        response_kind: "mixed_or_ambiguous",
        verdict: "unclear",
        reasoning_location: "unknown",
        grounding_refs: [],
        brief_reason: "scripted e2e unclear answer",
      };
      return { value: value as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
    }
    if (/并不相似|答错/.test(text) && gate) {
      // 明确答错 → fail（misaligned）——不推进 + D-3 重锚定路径。
      const value = {
        response_kind: "final_answer",
        matched_gate_id: gate.gate_id,
        verdict: "fail",
        reasoning_location: "misaligned",
        grounding_refs: gate.expected_fact ? [gate.expected_fact.fact_id] : anchor ? [anchor] : [],
        brief_reason: "scripted e2e wrong answer",
      };
      return { value: value as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
    }
    if (gate) {
      // 作答裁决：首个候选 gate pass + 锚定其 expected_fact（薄边界校验仍生效）。
      // scaffold 分支 gate 可能无 graph_fact_id（如 GT-01「指出卡住的细图事实」）
      // ——回退锚定当前 Beat 首个细图事实（等价 node 链 passFor("GT-01","FN-05")）。
      const value = {
        response_kind: "final_answer",
        matched_gate_id: gate.gate_id,
        verdict: "pass",
        reasoning_location: "aligned",
        grounding_refs: anchor ? [anchor] : [],
        brief_reason: "scripted e2e gate pass",
      };
      return { value: value as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
    }
    // 其余提示（或空上下文）：invalid-json 降级 unclear，不发明裁决。
    throw new StructuredModelError("invalid-json", "scripted gate: userPayload has neither gates nor solution context", false);
  }
}

/** 组合根：按环境构造 orchestrator 的 model 输入（provider + session pin）。 */
export function vNextGateModel(): OrchestratorModelInput {
  const scripted = process.env.TUTOR_VNEXT_SCRIPTED_GATE === "1";
  const port: StructuredModelPort = scripted ? new ScriptedGateModelPort() : new DeepSeekStructuredModel();
  const provider = new StructuredModelGateProvider(port);
  return { provider, pin: provider.modelGatePin() };
}

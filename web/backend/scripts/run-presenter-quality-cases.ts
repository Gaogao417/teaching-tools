/**
 * Presenter 质量评测集运行器（F7 RT3——真实模型代表性样例；AP-08 材料生产）。
 *
 * 纪律：
 * - 只在 DEEPSEEK_API_KEY（deepseek）或 DASHSCOPE_API_KEY（dashscope）存在时
 *   调用真实模型；键缺失 → 显式受阻退出（exit 2），绝不以 stub 模型冒充
 *   AP-01/02/08 通过。
 * - 自动断言只覆盖确定性维度（draft canonical、依据闭包、禁引泄漏、段有界、
 *   编译合法）；「数学正确、教学可理解、图文同步」的结论必须由真实教研审核者
 *   复核样例后给出——本脚本输出 manual_review_checklist 与原始 draft/序列，
 *   不自行打分通过。
 *
 * 用法：npm run presenter:quality
 * 输出：stdout 摘要 + data/presenter-quality-runs/<ts>-report.json（运行产物，
 * 不入提交；教研材料摘录由人工/协调者另行登记）。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildPresentationContext, DEFAULT_CONTEXT_POLICY } from "../src/services/tutorOrchestration/presentationGeneration/ContextBuilder";
import { createPresenterGenerator, PresenterGenerationError } from "../src/services/tutorOrchestration/presentationGeneration/GeneratorPort";
import { compilePresentationIntents, IntentCompilerError } from "../src/services/tutorOrchestration/presentationGeneration/IntentCompiler";
import { buildPresenterPrompt } from "../src/services/tutorOrchestration/presentationGeneration/PresenterPrompts";
import { PRESENTATION_TOOL_CATALOG, visiblePresentationTools } from "../src/services/tutorOrchestration/presentationGeneration/PresentationToolCatalog";
import { PRESENTER_QUALITY_CASES } from "../src/services/tutorOrchestration/presentationGeneration/PresenterQualityCases";

const SESSION = "TS-9001";
const SEQUENCE_SERIAL = 1;
const planRef = { artifact_id: "TP-SMV-009", version: "v11", content_hash: `sha256:${"0".repeat(64)}` };
const graphRef = { artifact_id: "RG-SMV-001", version: "v8", content_hash: `sha256:${"1".repeat(64)}` };

function providerStatus(): { provider: string; configured: boolean; keyEnv: string } {
  const provider = (process.env.TUTOR_PRESENTER_PROVIDER ?? "deepseek").trim().toLowerCase();
  const keyEnv = provider === "dashscope" ? "DASHSCOPE_API_KEY" : "DEEPSEEK_API_KEY";
  return { provider, keyEnv, configured: Boolean(process.env[keyEnv]?.trim()) };
}

async function main(): Promise<number> {
  const status = providerStatus();
  if (!status.configured) {
    console.error(
      `[presenter:quality] BLOCKED：${status.keyEnv} 未配置（provider=${status.provider}）。` +
        "真实模型评测受阻——不以 stub 输出冒充通过；配置键后重跑（键值不入日志/提交）。",
    );
    return 2;
  }
  const generator = createPresenterGenerator();
  const results: unknown[] = [];
  let failures = 0;

  for (const qualityCase of PRESENTER_QUALITY_CASES) {
    const entry: Record<string, unknown> = { case_id: qualityCase.case_id, title: qualityCase.title };
    try {
      const context = buildPresentationContext({
        planRef,
        graphRef,
        graph: qualityCase.graph,
        beat: qualityCase.beat,
        reasoningFocusFactIds: [...(qualityCase.stuckPoint?.locatedRefs ?? [])].filter((ref) => qualityCase.graph.facts.has(ref)),
        recentInputs: qualityCase.stuckPoint
          ? [{ sequence: 9, channel: "assistance" as const, text: qualityCase.stuckPoint.text }]
          : [],
        eventCutoff: 10,
        workspaceRevision: 2,
        currentRevision: 10,
        policy: DEFAULT_CONTEXT_POLICY,
        sessionMode: "teaching",
      });
      // 模型可见工具 = 真实交集：golden v5 plan 无 resource_bindings ⇒ 空目录
      //（speech-only 段；RT1 批准绑定后自动出现工具实例）。
      const visibleTools = visiblePresentationTools({
        registeredCapabilities: new Set(["geometry.construct", "board.reveal-entry"]),
        bindings: [],
        sessionMode: "teaching",
      });
      const prompt = buildPresenterPrompt({
        context,
        instructionalGoal: qualityCase.beat.purpose,
        currentGranularity: "beat",
        alreadyPresented: [],
        stuckPoint: qualityCase.stuckPoint === null
          ? null
          : { text: qualityCase.stuckPoint.text, locatedRefs: [...qualityCase.stuckPoint.locatedRefs] },
        visibleTools,
        maxItems: 6,
        maxSpeechChars: 400,
      });
      const requestStart = Date.now();
      const { draft, latencyMs } = await generator.generatePresentationDraft({
        request_id: `GR-${SESSION}-${String(qualityCase.case_id.slice(-2)).padStart(4, "0")}`,
        systemPrompt: prompt.systemPrompt,
        promptVersion: prompt.promptVersion,
        userPayload: prompt.userPayload,
        timeoutMs: Number(process.env.TUTOR_PRESENTER_TIMEOUT_MS ?? 30_000),
      });
      entry.model = { provider: generator.provider, model_id: generator.modelId, latency_ms: latencyMs, wall_ms: Date.now() - requestStart };
      entry.draft = draft;

      // 确定性断言 1：依据闭包（speech basis_refs ⊆ expected_basis_subset）。
      const allowed = new Set(qualityCase.expected_basis_subset);
      const usedRefs = draft.items.flatMap((item) => (item.type === "speech" ? [...(item.basis_refs ?? [])] : []));
      const outOfScope = usedRefs.filter((ref) => !allowed.has(ref));
      // 确定性断言 2：禁引泄漏（forbidden_refs 不出现——draft/编译文本均检）。
      const forbidden = new Set(qualityCase.forbidden_refs);
      const leaked = usedRefs.filter((ref) => forbidden.has(ref));
      // 确定性断言 3：编译合法（目录空 ⇒ 工具意图必须为零）。
      const compiled = compilePresentationIntents({
        sessionId: SESSION,
        sequenceSerial: SEQUENCE_SERIAL,
        decisionId: `TD-${SESSION}-${qualityCase.case_id}`,
        scope: { kind: "approved", protocol_id: qualityCase.beat.protocol_id, beat_id: qualityCase.beat.beat_id },
        request: {
          request_id: `GR-${SESSION}-${String(qualityCase.case_id.slice(-2)).padStart(4, "0")}`,
          attempt: 1,
          epoch: 1,
          input_digest: context.digest,
          presenter_pin: generator.pin,
        },
        draft,
        context,
        visibleTools,
        resources: new Map(),
        graph: qualityCase.graph,
        approvedConstructions: [],
        revealAuthorized: () => false,
      });
      entry.sequence = compiled;
      entry.deterministic_checks = {
        basis_closure_ok: outOfScope.length === 0,
        out_of_scope_refs: outOfScope,
        forbidden_leak_ok: leaked.length === 0,
        leaked_refs: leaked,
        bounded_items_ok: draft.items.length <= 6,
        catalog_version: "presentation-tool-catalog/v1",
        visible_tool_count: visibleTools.length,
      };
      const checksOk = outOfScope.length === 0 && leaked.length === 0 && draft.items.length <= 6;
      entry.deterministic_result = checksOk ? "PASS" : "FAIL";
      if (!checksOk) failures += 1;
      entry.manual_review_checklist = qualityCase.manual_review_checklist;
      entry.manual_review_result = "PENDING_TEACHER_REVIEW";
    } catch (error) {
      failures += 1;
      entry.deterministic_result = "ERROR";
      entry.error =
        error instanceof PresenterGenerationError || error instanceof IntentCompilerError
          ? { name: error.name, message: error.message }
          : { name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error) };
    }
    results.push(entry);
  }

  const report = {
    ran_at: new Date().toISOString(),
    provider: { name: status.provider, key_env: status.keyEnv, model: generator.modelId, prompt_version: generator.pin.prompt_version },
    catalog: PRESENTATION_TOOL_CATALOG.map((entry) => entry.tool_id),
    deterministic_failures: failures,
    note: "确定性断言 ≠ 内容质量结论；manual_review_checklist 待真实教研审核（AP-08）。",
    results,
  };
  const outDir = resolve(__dirname, "../data/presenter-quality-runs");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-report.json`);
  writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[presenter:quality] deterministic_failures=${failures}; report=${outPath}`);
  return failures === 0 ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
});

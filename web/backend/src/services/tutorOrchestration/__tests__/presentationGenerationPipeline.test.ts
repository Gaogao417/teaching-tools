/**
 * RT3 生成管线测试（PresenterPrompts / GeneratorPort / IntentCompiler /
 * SequencePreflight / 质量评测集）。
 *
 * 确定性部分（本文件）：prompt 版本与 payload 组装、draft 校验（越权字段
 * 拒绝）、编译器正例 + AP-05 确定性反例（非法工具/目标/参数/来源/揭示）、
 * 预演（未注册能力 fail closed；golden 构造模板解析）。
 * 真实模型部分：不在此文件——scripts/run-presenter-quality-cases.ts 需
 * DEEPSEEK_API_KEY/DASHSCOPE_API_KEY；键缺失时如实受阻，不以 stub 冒充
 * AP-01/02/08 通过（评测集样例留待教研人工复核）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { presentationDraftV2Schema } from "../../../../../shared/canonical";
import { StructuredModelError, type StructuredCompletionRequest, type StructuredModelPort } from "../../tutorIntelligence/structuredModelPort";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import {
  buildPresentationContext,
  DEFAULT_CONTEXT_POLICY,
  type BuiltPresentationContext,
  type ContextBuildInput,
} from "../presentationGeneration/ContextBuilder";
import {
  structuredPresenterGenerator,
  mapStructuredModelError,
  type PresenterGenerationPin,
} from "../presentationGeneration/GeneratorPort";
import {
  IntentCompilerError,
  compilePresentationIntents,
  type IntentCompilerInput,
} from "../presentationGeneration/IntentCompiler";
import { PRESENTER_PROMPT_VERSION, STUCK_POINT_PROMPT_VERSION, buildPresenterPrompt } from "../presentationGeneration/PresenterPrompts";
import { PRESENTATION_TOOL_CATALOG, toolSpecById, type PresentationResourceBinding, type VisibleToolInstance } from "../presentationGeneration/PresentationToolCatalog";
import { preflightPresentationSequence } from "../presentationGeneration/SequencePreflight";
import { PRESENTER_QUALITY_CASES } from "../presentationGeneration/PresenterQualityCases";

const SESSION = "TS-8102";
const planRef = { artifact_id: "TP-SMV-009", version: "v11", content_hash: `sha256:${"a".repeat(64)}` };
const graphRef = { artifact_id: "RG-SMV-001", version: "v8", content_hash: `sha256:${"b".repeat(64)}` };

function testGraph() {
  const facts = new Map([
    ["FN-03", { fact_id: "FN-03", role: "given" as const, statement: "翻折条件", reveals_answer: false }],
    ["FN-04", { fact_id: "FN-04", role: "given" as const, statement: "点 D 在 AB 上", reveals_answer: false }],
    ["FN-12", { fact_id: "FN-12", role: "given" as const, statement: "折叠等角关系", reveals_answer: false }],
    ["FN-13", { fact_id: "FN-13", role: "derived" as const, statement: "第一组子母型相似对应角相等", reveals_answer: false }],
    ["FN-14", { fact_id: "FN-14", role: "derived" as const, statement: "第二组子母型相似成立", reveals_answer: false }],
    ["FN-15", { fact_id: "FN-15", role: "derived" as const, statement: "第二组相似的比例关系", reveals_answer: false }],
    ["FN-23", { fact_id: "FN-23", role: "goal" as const, statement: "最终答案", reveals_answer: true }],
  ]);
  const inferences = new Map([
    ["IF-09", { inference_id: "IF-09", premises: ["FN-03", "FN-04"], conclusion: "FN-13", derivation: "公共角+等量代换" }],
    ["IF-12", { inference_id: "IF-12", premises: ["FN-03", "FN-04"], conclusion: "FN-14", derivation: "翻折等角代换" }],
    ["IF-13", { inference_id: "IF-13", premises: ["FN-12", "FN-13"], conclusion: "FN-15", derivation: "对应边成比例" }],
    ["IF-18", { inference_id: "IF-18", premises: ["FN-14"], conclusion: "FN-23", derivation: "代入求值" }],
  ]);
  return { facts, inferences };
}

function builtContext(): BuiltPresentationContext {
  const input: ContextBuildInput = {
    planRef,
    graphRef,
    graph: testGraph(),
    beat: {
      protocol_id: "PR-SMV-001",
      beat_id: "BT-04",
      graph_fact_refs: ["FN-14", "FN-15"],
      inference_refs: ["IF-12", "IF-13"],
      resource_ids: ["RES3", "RES4"],
    },
    recentInputs: [],
    eventCutoff: 10,
    workspaceRevision: 2,
    currentRevision: 10,
    policy: DEFAULT_CONTEXT_POLICY,
    sessionMode: "teaching",
  };
  return buildPresentationContext(input);
}

function explanationBinding(): PresentationResourceBinding {
  return {
    binding_id: "VB-02",
    binding_kind: "explanation",
    purpose: "第二组相似解释依据",
    basis_refs: { fact_ids: ["FN-03", "FN-04", "FN-14"], inference_ids: ["IF-12"] },
    presentation_resource: "RES3",
  } as PresentationResourceBinding;
}

function boardBinding(): PresentationResourceBinding {
  return {
    binding_id: "VB-03",
    binding_kind: "board",
    purpose: "第二组相似结论条目",
    board_entry_id: "BE-07",
    reveal_after_gate: { protocol_id: "PR-SMV-001", gate_id: "GT-04" },
  } as PresentationResourceBinding;
}

function geometryBinding(): PresentationResourceBinding {
  return {
    binding_id: "VB-01",
    binding_kind: "geometry",
    purpose: "第二组相似角对",
    geometry_target: "pt-O",
    semantic_role: "angle-pair",
    allowed_template_ids: ["pt-O"],
  } as PresentationResourceBinding;
}

function visibleInstances(bindings: readonly PresentationResourceBinding[]): VisibleToolInstance[] {
  const instances: VisibleToolInstance[] = [];
  const explain = toolSpecById("board.explain");
  if (explain) instances.push({ spec: explain, bindings: bindings.filter((binding) => binding.binding_kind !== "geometry") });
  const reveal = toolSpecById("board.reveal-entry");
  if (reveal) instances.push({ spec: reveal, bindings: bindings.filter((binding) => binding.binding_kind === "board") });
  const construct = toolSpecById("geometry.construct");
  if (construct) instances.push({ spec: construct, bindings: bindings.filter((binding) => binding.binding_kind === "geometry") });
  return instances;
}

function compilerInput(overrides: Partial<IntentCompilerInput> = {}): IntentCompilerInput {
  return {
    sessionId: SESSION,
    sequenceSerial: 3,
    decisionId: "TD-TS8102-exec04",
    scope: { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-04" },
    request: {
      request_id: `GR-${SESSION}-0001`,
      attempt: 1,
      epoch: 1,
      input_digest: `sha256:${"c".repeat(64)}`,
      presenter_pin: {
        provider: "deepseek-api",
        model_id: "deepseek-v4-flash",
        prompt_version: PRESENTER_PROMPT_VERSION,
        context_builder_version: "presentation-context-builder/v1",
        tool_catalog_version: "presentation-tool-catalog/v1",
      },
    },
    draft: { schema: "ai_teaching_presentation_draft/v2", request_id: `GR-${SESSION}-0001`, items: [] } as never,
    context: builtContext(),
    visibleTools: visibleInstances([explanationBinding()]),
    resources: new Map(),
    graph: testGraph(),
    approvedConstructions: [],
    revealAuthorized: () => false,
    ...overrides,
  };
}

function draftOf(items: unknown[]): { schema: "ai_teaching_presentation_draft/v2"; request_id: string; items: unknown[] } {
  const candidate = { schema: "ai_teaching_presentation_draft/v2" as const, request_id: `GR-${SESSION}-0001`, items };
  const parsed = presentationDraftV2Schema.safeParse(candidate);
  assert.ok(parsed.success, "test draft must be canonical");
  return parsed.data as { schema: "ai_teaching_presentation_draft/v2"; request_id: string; items: unknown[] };
}

// --------------------------------------------------------------------------- //
// Prompts
// --------------------------------------------------------------------------- //

test("prompt versions are frozen and presenter payload carries tools/basis/budget", () => {
  assert.equal(STUCK_POINT_PROMPT_VERSION, "stuck-point-locator/v1");
  assert.equal(PRESENTER_PROMPT_VERSION, "presenter-interleaved/v4-board-proof");
  const prompt = buildPresenterPrompt({
    context: builtContext(),
    instructionalGoal: "讲解第二组子母型相似",
    currentGranularity: "beat",
    alreadyPresented: ["先圈出三类条件"],
    stuckPoint: { text: "为什么对应角相等", locatedRefs: ["IF-09"] },
    visibleTools: visibleInstances([explanationBinding()]),
    maxItems: 6,
    maxSpeechChars: 400,
  });
  assert.equal(prompt.promptVersion, PRESENTER_PROMPT_VERSION);
  const payload = prompt.userPayload;
  assert.ok(payload.allowed_knowledge.length >= 4);
  assert.deepEqual(payload.tools[0].binding_refs, ["VB-02"]);
  assert.deepEqual(payload.output_budget, { max_items: 6, max_speech_chars: 400 });
  assert.equal(payload.student_stuck_point?.located_refs[0], "IF-09");
});

// --------------------------------------------------------------------------- //
// GeneratorPort（scripted StructuredModelPort；真实 provider 见质量脚本）
// --------------------------------------------------------------------------- //

class ScriptedPort implements StructuredModelPort {
  readonly provider = "scripted-presenter";
  readonly modelId = "scripted-presenter/v1";
  constructor(private readonly respond: (request: StructuredCompletionRequest) => unknown) {}
  async complete<T>(request: StructuredCompletionRequest): Promise<{ value: T; modelId: string; promptVersion: string; latencyMs: number }> {
    return { value: this.respond(request) as T, modelId: this.modelId, promptVersion: request.promptVersion, latencyMs: 1 };
  }
}

test("generator wraps model items with server-owned identity and validates canonical draft", async () => {
  const port = structuredPresenterGenerator(
    new ScriptedPort(() => ({ items: [{ type: "speech", text: "先看这一组角。", basis_refs: ["FN-14"] }] })),
  );
  const result = await port.generatePresentationDraft({
    request_id: `GR-${SESSION}-0001`,
    systemPrompt: "s",
    promptVersion: PRESENTER_PROMPT_VERSION,
    userPayload: {},
    timeoutMs: 1000,
  });
  assert.equal(result.draft.request_id, `GR-${SESSION}-0001`);
  assert.equal(result.draft.items[0].type, "speech");
  const pin: PresenterGenerationPin = port.pin;
  assert.equal(pin.prompt_version, PRESENTER_PROMPT_VERSION);
  assert.equal(pin.context_builder_version, "presentation-context-builder/v1");
  assert.equal(pin.tool_catalog_version, "presentation-tool-catalog/v1");
});

test("generator rejects model outputs carrying forbidden fields (draft_invalid, not retried)", async () => {
  const port = structuredPresenterGenerator(
    new ScriptedPort(() => ({ items: [{ type: "speech", text: "x" }], session_id: "TS-9999" })),
  );
  await assert.rejects(
    () => port.generatePresentationDraft({ request_id: `GR-${SESSION}-0001`, systemPrompt: "s", promptVersion: PRESENTER_PROMPT_VERSION, userPayload: {}, timeoutMs: 1000 }),
    (error: unknown) => error instanceof Error && (error as { failureClass?: string }).failureClass === "draft_invalid",
  );
});

test("structured model errors map to closed failure classes with retryability", () => {
  const timeout = mapStructuredModelError(new StructuredModelError("timeout", "t", true));
  assert.equal(timeout.failureClass, "timeout");
  assert.equal(timeout.retryable, true);
  const rate = mapStructuredModelError(new StructuredModelError("rate-limited", "r", true));
  assert.equal(rate.failureClass, "provider_failure");
  const unconfigured = mapStructuredModelError(new StructuredModelError("not-configured", "DEEPSEEK_API_KEY is not configured", false));
  assert.equal(unconfigured.failureClass, "provider_failure");
  assert.equal(unconfigured.retryable, false);
  const badJson = mapStructuredModelError(new StructuredModelError("invalid-json", "j", false));
  assert.equal(badJson.failureClass, "draft_invalid");
});

// --------------------------------------------------------------------------- //
// F7 P2-B（B7）：供应商严格隔离——合成密钥 + 拦截 fetch，不发送真实网络请求。
// --------------------------------------------------------------------------- //

const generatorPortModule = require("../presentationGeneration/GeneratorPort") as typeof import("../presentationGeneration/GeneratorPort");

/** 临时环境变量隔离（结束时逐键复原；undefined ⇒ delete，不残留 "undefined"）。 */
async function withEnv(mutations: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const saved: Array<[string, string | undefined]> = [];
  for (const [key, value] of Object.entries(mutations)) {
    saved.push([key, process.env[key]]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("B7 dashscope with a missing key fails not-configured and never borrows another provider's key (zero network)", async () => {
  let fetchCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("the isolation probe must not reach the network");
  }) as typeof fetch;
  try {
    await withEnv({
      TUTOR_PRESENTER_PROVIDER: "dashscope",
      TUTOR_PRESENTER_MODEL: "synthetic-qwen",
      // 显式空串 = 未配置（不得触发适配器对 DEEPSEEK_API_KEY 的回退）。
      DASHSCOPE_API_KEY: "",
      DEEPSEEK_API_KEY: "synthetic-deepseek-probe",
      TUTOR_PRESENTER_DASHSCOPE_BASE_URL: "https://synthetic-dashscope.invalid/v1",
    }, async () => {
      const port = generatorPortModule.createPresenterModelPort();
      assert.equal(port.provider, "dashscope", "provider identity must be dashscope even when unconfigured");
      await assert.rejects(
        () => port.complete({ systemPrompt: "probe", promptVersion: "probe", userPayload: {}, timeoutMs: 1_000 }),
        (error: unknown) => error instanceof StructuredModelError
          && error.code === "not-configured"
          && error.message.includes("DASHSCOPE_API_KEY")
          && !error.message.includes("DEEPSEEK_API_KEY"),
      );
    });
    assert.equal(fetchCalls, 0, "missing dashscope key must not send any request (no cross-provider borrowing)");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("B7 dashscope with both keys present sends the dashscope key to the dashscope endpoint; pin provider is dashscope", async () => {
  const seen: { url: string; authorization: string; model: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(input),
      authorization: String((init?.headers as Record<string, string>).Authorization),
      model: JSON.parse(String(init?.body)).model,
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"items\":[{\"type\":\"speech\",\"text\":\"合成讲解。\",\"basis_refs\":[\"FN-14\"]}]}" } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    await withEnv({
      TUTOR_PRESENTER_PROVIDER: "dashscope",
      TUTOR_PRESENTER_MODEL: "synthetic-qwen",
      DASHSCOPE_API_KEY: "synthetic-dashscope-probe",
      DEEPSEEK_API_KEY: "synthetic-deepseek-probe",
      TUTOR_PRESENTER_DASHSCOPE_BASE_URL: "https://synthetic-dashscope.invalid/v1",
    }, async () => {
      const port = generatorPortModule.createPresenterModelPort();
      const generator = structuredPresenterGenerator(port);
      assert.equal(port.provider, "dashscope");
      assert.equal(generator.pin.provider, "dashscope", "presenter pin provider must be dashscope");
      const result = await generator.generatePresentationDraft({
        request_id: `GR-${SESSION}-0002`,
        systemPrompt: "s",
        promptVersion: PRESENTER_PROMPT_VERSION,
        userPayload: {},
        timeoutMs: 1_000,
      });
      assert.equal(result.draft.items.length, 1);
      assert.equal(result.draft.items[0].type, "speech");
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://synthetic-dashscope.invalid/v1/chat/completions");
    assert.equal(seen[0].authorization, "Bearer synthetic-dashscope-probe", "dashscope endpoint must receive the dashscope key");
    assert.equal(seen[0].model, "synthetic-qwen");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --------------------------------------------------------------------------- //
// IntentCompiler（正例 + AP-05 确定性反例）
// --------------------------------------------------------------------------- //

test("compiler emits interleaved voice + board.explain fragment sequence (canonical v4)", () => {
  const draft = draftOf([
    { type: "speech", text: "我们先看第二组子母型的对应角。", basis_refs: ["FN-14", "IF-12"] },
    { type: "tool_intent", tool: "board.explain", args: { binding_ref: "VB-02", params: { note_kind: "relation_note" } } },
    { type: "speech", text: "把这条关系记下来，再看比例。", basis_refs: ["FN-15"] },
  ]);
  const plan = compilePresentationIntents(compilerInput({ draft: draft as never }));
  assert.equal(plan.actions.length, 3);
  assert.equal(plan.actions[0].kind, "voice");
  assert.equal(plan.actions[0].voice_action?.source, "model-generated");
  assert.match(plan.actions[0].voice_action?.generation_id ?? "", /^VG-TS-8102-/);
  assert.equal(plan.actions[1].kind, "workspace");
  assert.equal(plan.actions[1].workspace_action?.capability, "board.explain");
  const fragment = plan.explanation_fragments?.[0];
  assert.ok(fragment);
  assert.match(fragment.fragment_id, /^EF-TS-8102-/);
  assert.equal(fragment.origin_generation, `GR-${SESSION}-0001`);
  assert.equal(plan.actions[1].workspace_action?.command_payload, fragment.fragment_id);
  assert.deepEqual(fragment.basis_refs, ["FN-03", "FN-04", "FN-14", "IF-12"]);
  assert.equal(plan.generation?.request_id, `GR-${SESSION}-0001`);
  assert.deepEqual(plan.scope, { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-04" });
});

test("AP-05 negatives: illegal tool / target / param / source ref / reveal are rejected whole-segment", () => {
  // 非法工具（目录外）。
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "tool_intent", tool: "geometry.laser", args: { binding_ref: "VB-02", params: {} } }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_TOOL",
  );
  // 非法目标（binding_ref 不在该工具可用绑定内）。
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "tool_intent", tool: "board.explain", args: { binding_ref: "VB-77", params: { note_kind: "relation_note" } } }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_TARGET",
  );
  // 非法参数（enum 外值 + 未知参数名）。
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "tool_intent", tool: "board.explain", args: { binding_ref: "VB-02", params: { note_kind: "poem" } } }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_PARAM",
  );
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "tool_intent", tool: "board.explain", args: { binding_ref: "VB-02", params: { note_kind: "relation_note", font_size: 99 } } }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_PARAM",
  );
  // 非法来源（basis_ref 越出冻结上下文——私有答案 FN-23/IF-18 或未知 ref）。
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "speech", text: "答案是 8。", basis_refs: ["FN-23"] }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_SOURCE_REF",
  );
  assert.throws(
    () => compilePresentationIntents(compilerInput({ draft: draftOf([{ type: "speech", text: "根据 IF-18 …", basis_refs: ["IF-18"] }]) as never })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_SOURCE_REF",
  );
  // 提前揭示：reveal 授权查询为 false。
  assert.throws(
    () => compilePresentationIntents(compilerInput({
      visibleTools: visibleInstances([boardBinding()]),
      revealAuthorized: () => false,
      draft: draftOf([{ type: "tool_intent", tool: "board.reveal-entry", args: { binding_ref: "VB-03", params: {} } }]) as never,
    })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_REVEAL",
  );
  // highlight/annotate 未注册能力：编译器对漏网意图显式拒绝。
  const emphasize = toolSpecById("geometry.emphasize");
  assert.throws(
    () => compilePresentationIntents(compilerInput({
      visibleTools: emphasize ? [{ spec: emphasize, bindings: [geometryBinding()] }] : [],
      draft: draftOf([{ type: "tool_intent", tool: "geometry.emphasize", args: { binding_ref: "VB-01", params: { emphasis: "pulse" } } }]) as never,
    })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_TOOL",
  );
});

// --------------------------------------------------------------------------- //
// SequencePreflight（golden 真实 Approved 链）
// --------------------------------------------------------------------------- //

const importerModule = require("../../planBuild/v5/ImportApprovedPlanV5") as typeof import("../../planBuild/v5/ImportApprovedPlanV5");
const navigatorPlanModule = require("../../tutorNavigator/NavigatorPlanV5") as typeof import("../../tutorNavigator/NavigatorPlanV5");
const catalogModule = require("../GoldenWorkspaceCatalog") as typeof import("../GoldenWorkspaceCatalog");
const adjudicationModule = require("../WorkspaceActionAdjudication") as typeof import("../WorkspaceActionAdjudication");
const foldModule = require("../../tutorSession/WorkspaceRuntimeReducerV5") as typeof import("../../tutorSession/WorkspaceRuntimeReducerV5");

const ROOT = realCanonicalRoot();
const imported = importerModule.importApprovedPlanV5({ canonicalRoot: ROOT, anchored: true }, "TP-SMV-009");
if (!imported.ok) throw new Error(imported.errors.join("; "));
const importedPlan = imported.imported;
const plan = navigatorPlanModule.buildNavigatorPlan(importedPlan);
const golden = catalogModule.buildGoldenWorkspaceCatalogV5(importedPlan);

test("preflight: voice-only segment passes with zero workspace effects", () => {
  const draft = draftOf([{ type: "speech", text: "纯语音段。", basis_refs: ["FN-14"] }]);
  const compiled = compilePresentationIntents(compilerInput({ draft: draft as never }));
  const fold = foldModule.initialWorkspaceFold(SESSION, golden.catalog);
  const result = preflightPresentationSequence({ fold, catalog: golden.catalog, plan: compiled });
  assert.equal(result.resultingWorkspaceRevision, fold.state.revision);
});

test("preflight: board.explain without committed decision causation fails closed on an isolated fold", () => {
  const draft = draftOf([
    { type: "speech", text: "记一条关系。", basis_refs: ["FN-14"] },
    { type: "tool_intent", tool: "board.explain", args: { binding_ref: "VB-02", params: { note_kind: "relation_note" } } },
  ]);
  const compiled = compilePresentationIntents(compilerInput({ draft: draft as never }));
  const fold = foldModule.initialWorkspaceFold(SESSION, golden.catalog);
  assert.throws(
    () => preflightPresentationSequence({ fold, catalog: golden.catalog, plan: compiled }),
    (error: unknown) => error instanceof Error && /wrong-decision-causation/.test(error.message),
  );
  // 真实 fold 零污染（隔离副本预演）。
  assert.equal(fold.state.revision, 0);
});

test("compiler construct intent resolves only approved golden construction templates (BT-04 RES7)", () => {
  const beat = plan.mainline.beats.get("BT-04");
  assert.ok(beat, "golden BT-04 must exist");
  const constructions = adjudicationModule.resolveBeatConstructions(importedPlan.plan.resources, beat) ?? [];
  assert.ok(constructions.length >= 5, "golden BT-04 carries the O + carrier constructions");
  const output = adjudicationModule.constructionOutputId(constructions[0]);
  assert.ok(output);
  const binding: PresentationResourceBinding = {
    binding_id: "VB-01",
    binding_kind: "geometry",
    purpose: "O 构造",
    geometry_target: output,
    semantic_role: "carrier",
    allowed_template_ids: [output],
  } as PresentationResourceBinding;
  const constructSpec = toolSpecById("geometry.construct");
  assert.ok(constructSpec);
  const draft = draftOf([
    { type: "speech", text: "先构造点 O。", basis_refs: ["FN-14"] },
    { type: "tool_intent", tool: "geometry.construct", args: { binding_ref: "VB-01", params: { template_id: output } } },
  ]);
  const compilerTestInput = compilerInput({
    approvedConstructions: constructions,
    visibleTools: [{ spec: constructSpec, bindings: [binding] }],
    draft: draft as never,
  });
  const compiled = compilePresentationIntents(compilerTestInput);
  const action = compiled.actions[1].workspace_action;
  assert.equal(action?.capability, "geometry.construct");
  assert.equal(action?.target_ids?.[0], output);
  assert.ok(action?.command_payload?.includes("commandId"));
  // 预演：golden fold + 已提交决策因果（F3 五重校验的真实前提）。
  const baseFold = foldModule.initialWorkspaceFold(SESSION, golden.catalog, undefined, {
    task_id: golden.catalog.taskId,
    protocol_refs: [{ artifact_id: plan.mainline.protocol_id }],
    initial_cursor: { protocol_id: plan.mainline.protocol_id, beat_id: "BT-04" },
  });
  const seeded = foldModule.seedWorkspaceGateLedger({
    task_id: golden.catalog.taskId,
    protocol_refs: [{ artifact_id: plan.mainline.protocol_id }],
    initial_cursor: { protocol_id: plan.mainline.protocol_id, beat_id: "BT-04" },
  });
  const decisionId = compilerTestInput.decisionId;
  const fold = {
    ...baseFold,
    context: {
      ...baseFold.context,
      gateLedger: {
        ...seeded,
        cursor: { protocolId: plan.mainline.protocol_id, beatId: "BT-04" },
        decisions: new Map([[decisionId, { decisionId, protocolId: plan.mainline.protocol_id, beatId: "BT-04", sequence: 2 }]]),
      },
    },
  };
  const result = preflightPresentationSequence({ fold, catalog: golden.catalog, plan: compiled });
  assert.ok(result.resultingWorkspaceRevision > fold.state.revision);
  // 模板不在批准集 → ILLEGAL_TARGET。
  assert.throws(
    () => compilePresentationIntents(compilerInput({
      approvedConstructions: constructions,
      visibleTools: [{ spec: constructSpec, bindings: [binding] }],
      draft: draftOf([{ type: "tool_intent", tool: "geometry.construct", args: { binding_ref: "VB-01", params: { template_id: "pt-NOPE" } } }]) as never,
    })),
    (error: unknown) => error instanceof IntentCompilerError && error.code === "ILLEGAL_TARGET",
  );
});

// --------------------------------------------------------------------------- //
// 质量评测集（确定性断言面；内容结论留待教研）
// --------------------------------------------------------------------------- //

test("quality case set: cases are distinct, basis expectations are within graph closure, forbidden refs never listed as allowed", () => {
  assert.equal(PRESENTER_QUALITY_CASES.length, 3);
  for (const qualityCase of PRESENTER_QUALITY_CASES) {
    assert.ok(qualityCase.manual_review_checklist.length >= 2, `${qualityCase.case_id} must carry manual review checklist`);
    for (const ref of qualityCase.expected_basis_subset) {
      assert.ok(
        qualityCase.graph.facts.has(ref) || qualityCase.graph.inferences.has(ref) || qualityCase.beat.resource_ids.includes(ref),
        `${qualityCase.case_id}: expected basis ${ref} must exist in the case graph`,
      );
    }
    for (const forbidden of qualityCase.forbidden_refs) {
      assert.ok(!qualityCase.expected_basis_subset.includes(forbidden), `${qualityCase.case_id}: forbidden ref ${forbidden} must not be an allowed basis`);
    }
  }
});

test("quality cases build contexts through RT2 builder (pipeline integrity)", () => {
  for (const qualityCase of PRESENTER_QUALITY_CASES) {
    const built = buildPresentationContext({
      planRef,
      graphRef,
      graph: qualityCase.graph,
      beat: qualityCase.beat,
      // 卡点定位输出可含 inference ref；上下文聚焦面只收 fact id（orchestrator
      // 接线同型过滤——inference 影响经 region/inference 候选进入）。
      reasoningFocusFactIds: [...(qualityCase.stuckPoint?.locatedRefs ?? [])].filter((ref) => qualityCase.graph.facts.has(ref)),
      recentInputs: qualityCase.stuckPoint ? [{ sequence: 9, channel: "assistance", text: qualityCase.stuckPoint.text }] : [],
      eventCutoff: 10,
      workspaceRevision: 2,
      currentRevision: 10,
      policy: DEFAULT_CONTEXT_POLICY,
      sessionMode: "teaching",
    });
    for (const forbidden of qualityCase.forbidden_refs) {
      assert.ok(
        !built.context.selected_fact_ids.includes(forbidden) && !built.context.selected_inference_ids.includes(forbidden),
        `${qualityCase.case_id}: forbidden ${forbidden} leaked into the built context`,
      );
    }
  }
});

test("frozen catalog is the visibility naming source used by compiler inputs", () => {
  // 编译器只接受 PRESENTATION_TOOL_CATALOG 内的 spec（目录=命名真源；禁自造）。
  const ids = new Set(PRESENTATION_TOOL_CATALOG.map((entry) => entry.tool_id));
  for (const tool of ["geometry.construct", "geometry.emphasize", "board.explain", "board.reveal-entry"]) {
    assert.ok(ids.has(tool));
  }
});

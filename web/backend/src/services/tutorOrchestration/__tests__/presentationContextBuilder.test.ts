/**
 * PresentationContextBuilder 测试（F7 RT2 — 上下文展开执行规格验收）。
 *
 * 规格验收逐条：
 * - 加入更细依据不改变 Beat/Gate/cursor（纯函数：输出仅 context/digest/basis，
 *   断言无任何导航/状态输出面）；
 * - 更换选取策略只改变 context/质量样例（budget/截断差异），不引入状态迁移；
 * - 同一冻结任务重试 digest 不变；策略升级改变 policy_version 后 digest 变化
 *   （只影响新任务）；
 * - 预算按完整依据组截断：可选组整组省略（premises 随组消失，无半组），
 *   核心组超限 → CONTEXT_BUDGET_EXCEEDED（不截断必要前提）；
 * - 无输入首段合法（recentInputs=[]）；未知引用 → CONTEXT_LOOKUP_FAILED；
 *   reveals_answer（私有答案）无授权 → CONTEXT_FORBIDDEN / 不进上下文；
 *   assessment → CONTEXT_FORBIDDEN；cutoff 超前 → STALE_CONTEXT；
 *   空图/空结果 → CONTEXT_UNAVAILABLE；失败零状态写入（纯函数天然满足）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createHash } from "node:crypto";

import {
  CONTEXT_BUILDER_VERSION,
  DEFAULT_CONTEXT_POLICY,
  PresentationContextError,
  buildPresentationContext,
  type ContextBuildInput,
  type ContextGraphIndex,
} from "../presentationGeneration/ContextBuilder";
import type { GraphFactNode, GraphInferenceNode } from "../../planBuild/canonicalInputs";

const planRef = { artifact_id: "TP-SMV-009", version: "v11", content_hash: `sha256:${"a".repeat(64)}` };
const graphRef = { artifact_id: "RG-SMV-001", version: "v8", content_hash: `sha256:${"b".repeat(64)}` };

function fact(factId: string, overrides: Partial<GraphFactNode> = {}): GraphFactNode {
  return { fact_id: factId, role: "derived", statement: `事实 ${factId}`, reveals_answer: false, ...overrides };
}

function inference(inferenceId: string, premises: string[], conclusion: string, overrides: Partial<GraphInferenceNode> = {}): GraphInferenceNode {
  return { inference_id: inferenceId, premises, conclusion, derivation: `推导 ${inferenceId}`, ...overrides };
}

/** golden 结构切片：BT-04 第二组相似（FN-14/15 核心；FN-01..04 批准前提）。 */
function goldenSlice(): ContextGraphIndex {
  const facts = [
    fact("FN-01", { role: "given" }),
    fact("FN-02", { role: "given" }),
    fact("FN-03", { role: "given" }),
    fact("FN-04", { role: "given" }),
    fact("FN-12", { role: "given" }),
    fact("FN-13"),
    fact("FN-14"),
    fact("FN-15"),
    fact("FN-23", { role: "goal", reveals_answer: true }),
  ];
  const inferences = [
    inference("IF-09", ["FN-01", "FN-02"], "FN-13"),
    inference("IF-12", ["FN-03", "FN-04"], "FN-14"),
    inference("IF-13", ["FN-12", "FN-13"], "FN-15"),
    inference("IF-18", ["FN-14"], "FN-23"),
  ];
  return {
    facts: new Map(facts.map((node) => [node.fact_id, node])),
    inferences: new Map(inferences.map((node) => [node.inference_id, node])),
  };
}

function baseInput(overrides: Partial<ContextBuildInput> = {}): ContextBuildInput {
  return {
    planRef,
    graphRef,
    graph: goldenSlice(),
    beat: {
      protocol_id: "PR-SMV-001",
      beat_id: "BT-04",
      graph_fact_refs: ["FN-14", "FN-15"],
      inference_refs: ["IF-12", "IF-13"],
      resource_ids: ["RES3", "RES4"],
    },
    recentInputs: [],
    eventCutoff: 12,
    workspaceRevision: 3,
    currentRevision: 12,
    policy: DEFAULT_CONTEXT_POLICY,
    sessionMode: "teaching",
    ...overrides,
  };
}

test("core context builds with premise closure and stays a pure read-only projection", () => {
  const built = buildPresentationContext(baseInput());
  // 核心组：FN-14/15 + 前提闭包（IF-12→FN-03/04；IF-13→FN-12/13）。
  assert.deepEqual(built.context.selected_fact_ids, ["FN-03", "FN-04", "FN-12", "FN-13", "FN-14", "FN-15"]);
  assert.deepEqual(built.context.selected_inference_ids, ["IF-12", "IF-13"]);
  assert.deepEqual(built.context.plan_ref, planRef);
  assert.deepEqual(built.context.graph_ref, graphRef);
  assert.equal(built.context.event_cutoff, 12);
  assert.equal(built.context.workspace_revision, 3);
  assert.deepEqual(built.context.resource_ids, ["RES3", "RES4"]);
  // digest 形状：sha256: + 64 hex。
  assert.match(built.digest, /^sha256:[0-9a-f]{64}$/);
  // 无导航输出面：展开不产生 Beat/Gate/cursor/tag/frame 字段（规格验收 1）。
  const serialized = JSON.stringify(built);
  for (const forbidden of ["cursor", "gate_id", "frame", "frontier", "transition"]) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `context output must not carry navigation field ${forbidden}`);
  }
});

test("frozen retry keeps the same digest; policy upgrade changes it (new tasks only)", () => {
  const first = buildPresentationContext(baseInput());
  const retry = buildPresentationContext(baseInput());
  assert.equal(first.digest, retry.digest);
  const expected = `sha256:${createHash("sha256").update(JSON.stringify({ context: first.context, policy_version: DEFAULT_CONTEXT_POLICY.policy_version, builder: CONTEXT_BUILDER_VERSION })).digest("hex")}`;
  assert.equal(first.digest, expected);

  const upgraded = buildPresentationContext(baseInput({
    policy: { ...DEFAULT_CONTEXT_POLICY, policy_version: "context-policy/v2" },
  }));
  assert.notEqual(first.digest, upgraded.digest);
});

test("expansion (fine region refs) only adds model context, never navigation state", () => {
  const plain = buildPresentationContext(baseInput());
  const expanded = buildPresentationContext(baseInput({
    regionFineRefs: { fact_ids: ["FN-01", "FN-02"], inference_ids: ["IF-09"] },
    reasoningFocusFactIds: ["FN-13"],
    recentInputs: [{ sequence: 9, channel: "assistance", text: "为什么对应角相等？" }],
  }));
  // 扩充加入 IF-09 组（FN-01/02 前提）+ 直接 fine facts。
  assert.ok(expanded.context.selected_inference_ids.includes("IF-09"));
  assert.ok(expanded.context.selected_fact_ids.includes("FN-01"));
  assert.ok(expanded.context.selected_fact_ids.includes("FN-02"));
  // 教学任务引用（plan/beat）保持不变。
  assert.deepEqual(expanded.context.plan_ref, plain.context.plan_ref);
  assert.equal(expanded.context.event_cutoff, plain.context.event_cutoff);
});

test("budget truncation drops whole optional groups and never splits a premise set", () => {
  const tight = buildPresentationContext(baseInput({
    policy: { ...DEFAULT_CONTEXT_POLICY, max_facts: 6 },
    regionFineRefs: { fact_ids: [], inference_ids: ["IF-09"] },
  }));
  // 预算 6：核心组已用 6 facts ⇒ IF-09 组（+FN-01/02）整组省略。
  assert.ok(!tight.context.selected_inference_ids.includes("IF-09"));
  assert.deepEqual(tight.truncated_inference_ids, ["IF-09"]);
  assert.ok(!tight.context.selected_fact_ids.includes("FN-01"));
  // 已选内容保持完整（无半组截断）。
  assert.deepEqual(tight.context.selected_fact_ids, ["FN-03", "FN-04", "FN-12", "FN-13", "FN-14", "FN-15"]);
});

test("core group over budget fails explicitly (CONTEXT_BUDGET_EXCEEDED, no truncation)", () => {
  assert.throws(
    () => buildPresentationContext(baseInput({ policy: { ...DEFAULT_CONTEXT_POLICY, max_facts: 2 } })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_BUDGET_EXCEEDED",
  );
});

test("private answer facts never enter context without authorization (expand never widens reveal)", () => {
  // FN-23 是最终答案（reveals_answer）：不在 Beat refs、不在授权内。
  const withRegion = buildPresentationContext(baseInput({
    regionFineRefs: { fact_ids: ["FN-23"], inference_ids: [] },
  }));
  assert.ok(!withRegion.context.selected_fact_ids.includes("FN-23"));
  // 依赖私有前提的可选组整组放弃，而不是把前提塞进上下文。
  const withLeakyInference = buildPresentationContext(baseInput({
    regionFineRefs: { fact_ids: [], inference_ids: ["IF-18"] },
  }));
  assert.ok(!withLeakyInference.context.selected_inference_ids.includes("IF-18"));
  assert.ok(!withLeakyInference.context.selected_fact_ids.includes("FN-23"));
  // 授权的唯一路径 = Beat 计划内容本身包含该 fact（见下一用例）；核心 refs
  // 之外不存在让私有答案进入上下文的输入面（factVisible 对 reveals_answer
  // 只认 beat.graph_fact_refs 成员资格）。
});

test("authorized answer fact inside the current beat plan stays visible", () => {
  // 若 Beat 计划内容本身包含 FN-23（披露已被授权的收束 Beat），核心组允许。
  const built = buildPresentationContext(baseInput({
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-05", graph_fact_refs: ["FN-23"], inference_refs: ["IF-18"], resource_ids: [] },
  }));
  assert.ok(built.context.selected_fact_ids.includes("FN-23"));
});

test("negative failures: unknown refs, stale cutoff, assessment, empty graph, empty result", () => {
  assert.throws(
    () => buildPresentationContext(baseInput({ beat: { protocol_id: "PR-SMV-001", beat_id: "BT-09", graph_fact_refs: ["FN-99"], inference_refs: [], resource_ids: [] } })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_LOOKUP_FAILED",
  );
  assert.throws(
    () => buildPresentationContext(baseInput({ eventCutoff: 13, currentRevision: 12 })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "STALE_CONTEXT",
  );
  assert.throws(
    () => buildPresentationContext(baseInput({ sessionMode: "assessment" })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_FORBIDDEN",
  );
  assert.throws(
    () => buildPresentationContext(baseInput({ graph: { facts: new Map(), inferences: new Map() } })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_UNAVAILABLE",
  );
  assert.throws(
    () => buildPresentationContext(baseInput({ beat: { protocol_id: "PR-SMV-001", beat_id: "BT-00", graph_fact_refs: [], inference_refs: [], resource_ids: [] } })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_UNAVAILABLE",
  );
});

test("first-segment build without student input is legal (recentInputs empty)", () => {
  const built = buildPresentationContext(baseInput({ recentInputs: [] }));
  assert.ok(built.basis.length >= 4);
  assert.equal(built.truncated_inference_ids.length, 0);
});

// --------------------------------------------------------------------------- //
// F7 P2-B（B5/B6）：字符预算按完整依据组收口 + 核心推理 conclusion 权限纪律
// --------------------------------------------------------------------------- //

/** 带超长 fact 的图切片（预算反例构造）。 */
function graphWithLongFact(): ContextGraphIndex {
  const slice = goldenSlice();
  return {
    facts: new Map([...slice.facts, ["FN-LONG", fact("FN-LONG", { statement: "长".repeat(5000) })]]),
    inferences: slice.inferences,
  };
}

test("B5 core group exceeding max_total_chars fails CONTEXT_BUDGET_EXCEEDED (no silent oversized build)", () => {
  assert.throws(
    () => buildPresentationContext(baseInput({
      graph: graphWithLongFact(),
      beat: { protocol_id: "PR-SMV-001", beat_id: "BT-10", graph_fact_refs: ["FN-LONG"], inference_refs: [], resource_ids: [] },
      policy: { ...DEFAULT_CONTEXT_POLICY, max_total_chars: 100 },
    })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_BUDGET_EXCEEDED",
  );
});

test("B5 region fine fact exceeding the char budget is omitted as a whole group and registered (context_truncated)", () => {
  const built = buildPresentationContext(baseInput({
    graph: graphWithLongFact(),
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-04", graph_fact_refs: ["FN-14"], inference_refs: [], resource_ids: [] },
    regionFineRefs: { fact_ids: ["FN-LONG"], inference_ids: [] },
    policy: { ...DEFAULT_CONTEXT_POLICY, max_total_chars: 100 },
  }));
  assert.ok(!built.context.selected_fact_ids.includes("FN-LONG"), "oversized fine fact must not enter the frozen refs");
  assert.ok(!built.basis.some((item) => item.ref === "FN-LONG"), "oversized fine fact must not enter the prompt basis");
  assert.deepEqual(built.truncated_group_refs, ["FN-LONG"]);
  assert.equal(built.context_truncated, true);
  assert.equal(built.truncated_inference_ids.length, 0);
});

test("B5 optional inference group exceeding the char budget is dropped whole and registered", () => {
  const built = buildPresentationContext(baseInput({
    graph: (() => {
      const slice = goldenSlice();
      return {
        facts: slice.facts,
        inferences: new Map([...slice.inferences, ["IF-LONG", inference("IF-LONG", ["FN-01"], "FN-13", { derivation: "推".repeat(5000) })]]),
      };
    })(),
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-04", graph_fact_refs: ["FN-14"], inference_refs: [], resource_ids: [] },
    regionFineRefs: { fact_ids: [], inference_ids: ["IF-LONG"] },
    policy: { ...DEFAULT_CONTEXT_POLICY, max_total_chars: 100 },
  }));
  assert.ok(!built.context.selected_inference_ids.includes("IF-LONG"));
  assert.deepEqual(built.truncated_inference_ids, ["IF-LONG"]);
  assert.deepEqual(built.truncated_group_refs, ["IF-LONG"]);
  assert.equal(built.context_truncated, true);
});

test("B5 resource group exceeding the char budget is omitted from the frozen refs and registered; small resources still pass", () => {
  const oversized = buildPresentationContext(baseInput({
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-04", graph_fact_refs: ["FN-14"], inference_refs: [], resource_ids: ["RES-BIG"] },
    resourceContent: () => "资".repeat(5000),
    policy: { ...DEFAULT_CONTEXT_POLICY, max_total_chars: 100 },
  }));
  assert.deepEqual(oversized.context.resource_ids, [], "oversized resource must not stay in the frozen refs (drive recomputes basis from them)");
  assert.ok(!oversized.basis.some((item) => item.ref === "RES-BIG"));
  assert.deepEqual(oversized.truncated_group_refs, ["RES-BIG"]);
  assert.equal(oversized.context_truncated, true);
  // 正例：小资源照常进入（预算内）。
  const small = buildPresentationContext(baseInput({
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-04", graph_fact_refs: ["FN-14"], inference_refs: [], resource_ids: ["RES-OK"] },
    resourceContent: () => "小资源",
    policy: { ...DEFAULT_CONTEXT_POLICY, max_total_chars: 100 },
  }));
  assert.deepEqual(small.context.resource_ids, ["RES-OK"]);
  assert.ok(small.basis.some((item) => item.ref === "RES-OK"));
  assert.equal(small.context_truncated, false);
});

test("B6 core inference concluding in an unauthorized answer fact is refused CONTEXT_FORBIDDEN (never silently dropped)", () => {
  // IF-18 结论 FN-23（reveals_answer）且不在本 Beat 授权 refs 内。
  assert.throws(
    () => buildPresentationContext(baseInput({
      beat: { protocol_id: "PR-SMV-001", beat_id: "BT-11", graph_fact_refs: ["FN-14"], inference_refs: ["IF-18"], resource_ids: [] },
    })),
    (error: unknown) => error instanceof PresentationContextError && error.kind === "CONTEXT_FORBIDDEN",
  );
  // 同一推理作为可选扩充（region）时维持既有语义：整组静默放弃（不进上下文）。
  const asRegion = buildPresentationContext(baseInput({
    beat: { protocol_id: "PR-SMV-001", beat_id: "BT-04", graph_fact_refs: ["FN-14"], inference_refs: [], resource_ids: [] },
    regionFineRefs: { fact_ids: [], inference_ids: ["IF-18"] },
  }));
  assert.ok(!asRegion.context.selected_inference_ids.includes("IF-18"));
});

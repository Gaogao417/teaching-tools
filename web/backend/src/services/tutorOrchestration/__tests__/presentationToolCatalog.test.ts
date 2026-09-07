/**
 * PresentationToolCatalog 测试（F7 RT3 — 公开工具目录）。
 *
 * 覆盖：
 * - 冻结条目逐条通过 canonical presentation-tool-spec/v1 判定（装载自证）；
 * - 共享 fixtures 快照（web/shared/fixtures/presentation-tool-catalog.v1.json，
 *   A 轨 adapter 命名真源）与代码目录逐字段一致；
 * - 语义反例：reveal 效果 ceiling=none 拒绝、enum 参数缺 allowed_values 拒绝
 *   （canonical 判定面）；
 * - visibility 交集 fail closed：未注册 capability 不暴露；无 Approved 绑定
 *   （golden v5 plan 现状）不暴露；assessment 全关；scope 过滤生效；
 *   effect_class × binding_kind 非法配对不暴露；
 * - 目录版本门禁（presenter pin 对账）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { presentationToolSpecV1Schema } from "../../../../../shared/canonical";
import {
  PRESENTATION_TOOL_CATALOG,
  PRESENTATION_TOOL_CATALOG_VERSION,
  PUBLIC_TOOL_IDS,
  assertToolCatalogVersion,
  toolSpecById,
  visiblePresentationTools,
  type PresentationResourceBinding,
} from "../presentationGeneration/PresentationToolCatalog";

function geometryBinding(overrides: Partial<PresentationResourceBinding> = {}): PresentationResourceBinding {
  return {
    binding_id: "VB-01",
    binding_kind: "geometry",
    purpose: "第二组子母型的角对（测试绑定）",
    geometry_target: "angle-DAB",
    semantic_role: "angle-pair",
    allowed_template_ids: ["intersect-lines@pt-O"],
    ...overrides,
  } as PresentationResourceBinding;
}

function explanationBinding(overrides: Partial<PresentationResourceBinding> = {}): PresentationResourceBinding {
  return {
    binding_id: "VB-02",
    binding_kind: "explanation",
    purpose: "第二组相似的临场解释依据（测试绑定）",
    basis_refs: { fact_ids: ["FN-14"], inference_ids: ["IF-09"] },
    presentation_resource: "RES3",
    ...overrides,
  } as PresentationResourceBinding;
}

function boardBinding(overrides: Partial<PresentationResourceBinding> = {}): PresentationResourceBinding {
  return {
    binding_id: "VB-03",
    binding_kind: "board",
    purpose: "第二组相似结论条目（测试绑定）",
    board_entry_id: "BE-07",
    reveal_after_gate: { protocol_id: "PR-SMV-001", gate_id: "GT-04" },
    ...overrides,
  } as PresentationResourceBinding;
}

test("frozen catalog entries all pass canonical presentation-tool-spec/v1", () => {
  assert.ok(PRESENTATION_TOOL_CATALOG.length >= 4);
  for (const entry of PRESENTATION_TOOL_CATALOG) {
    const parsed = presentationToolSpecV1Schema.safeParse(entry);
    assert.ok(parsed.success, `${entry.tool_id} must pass canonical validation`);
  }
  assert.deepEqual(PUBLIC_TOOL_IDS, [
    "geometry.construct",
    "geometry.emphasize",
    "board.explain",
    "board.reveal-entry",
  ]);
  assert.equal(PRESENTATION_TOOL_CATALOG_VERSION, "presentation-tool-catalog/v1");
});

test("shared fixtures snapshot matches the frozen code catalog (A-track naming source)", () => {
  const fixturePath = resolve(__dirname, "../../../../../../../shared/fixtures/presentation-tool-catalog.v1.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    catalog_version: string;
    tools: Array<Record<string, unknown>>;
  };
  assert.equal(fixture.catalog_version, PRESENTATION_TOOL_CATALOG_VERSION);
  assert.equal(fixture.tools.length, PRESENTATION_TOOL_CATALOG.length);
  for (const toolFixture of fixture.tools) {
    const spec = toolSpecById(String(toolFixture.tool_id));
    assert.ok(spec, `fixture tool ${String(toolFixture.tool_id)} must exist in the code catalog`);
    for (const key of ["version", "capability", "surface", "effect_class", "reveal_scope_ceiling", "requires_binding", "teaching_mode_only"] as const) {
      assert.deepEqual(toolFixture[key], (spec as unknown as Record<string, unknown>)[key], `${spec.tool_id}.${key} must match the fixture`);
    }
    assert.deepEqual(toolFixture.parameters, spec.parameters, `${spec.tool_id}.parameters must match the fixture`);
  }
});

test("canonical negatives: reveal with none ceiling and enum parameter without allowed_values are rejected", () => {
  const revealNone = presentationToolSpecV1Schema.safeParse({
    ...toolSpecById("board.reveal-entry"),
    reveal_scope_ceiling: "none",
  });
  assert.ok(!revealNone.success, "reveal effect_class with ceiling=none must fail canonical validation");

  const enumWithoutValues = presentationToolSpecV1Schema.safeParse({
    ...toolSpecById("board.explain"),
    parameters: [{ name: "note_kind", value_type: "enum", required: true }],
  });
  assert.ok(!enumWithoutValues.success, "enum parameter without allowed_values must fail canonical validation");
});

test("visibility is a fail-closed intersection of registered capabilities and approved bindings", () => {
  // golden plan 现状（planning/v5 无 resource_bindings）：即使 capability 已注册，
  // 绑定交集为空 ⇒ 模型可见工具集为空（如实投影，不伪造实例）。
  const goldenLike = visiblePresentationTools({
    registeredCapabilities: new Set(["geometry.construct", "board.reveal-entry"]),
    bindings: [],
    sessionMode: "teaching",
  });
  assert.deepEqual(goldenLike, []);

  // 未注册 capability（RT1 G1/G2：geometry.emphasize / solution_board.explain_fragment
  // 尚未进入 capability registry）⇒ 即使有绑定也不暴露。
  const unregistered = visiblePresentationTools({
    registeredCapabilities: new Set(["geometry.construct"]),
    bindings: [explanationBinding()],
    sessionMode: "teaching",
  });
  assert.deepEqual(unregistered, [], "board.explain must stay invisible until its capability is registered");

  // 注册 + 匹配绑定 ⇒ 可见，且 binding 引用进入合法值域。
  const visible = visiblePresentationTools({
    registeredCapabilities: new Set(["solution_board.explain_fragment"]),
    bindings: [explanationBinding(), boardBinding()],
    sessionMode: "teaching",
  });
  assert.equal(visible.length, 1);
  assert.equal(visible[0].spec.tool_id, "board.explain");
  // explain_fragment 合法配对 = explanation | board 绑定，两个都进入值域。
  assert.deepEqual(visible[0].bindings.map((binding) => binding.binding_id), ["VB-02", "VB-03"]);

  // board 绑定对 explain_fragment 也合法（effect_class 映射允许 explanation|board）。
  const withBoard = visiblePresentationTools({
    registeredCapabilities: new Set(["solution_board.explain_fragment"]),
    bindings: [boardBinding()],
    sessionMode: "teaching",
  });
  assert.equal(withBoard.length, 1);
  assert.deepEqual(withBoard[0].bindings.map((binding) => binding.binding_id), ["VB-03"]);

  // assessment 全关（teaching_mode_only）。
  const assessment = visiblePresentationTools({
    registeredCapabilities: new Set(["solution_board.explain_fragment", "geometry.emphasize"]),
    bindings: [explanationBinding(), geometryBinding()],
    sessionMode: "assessment",
  });
  assert.deepEqual(assessment, []);

  // scope 过滤：当前教学范围外的绑定不进入值域。
  const scoped = visiblePresentationTools({
    registeredCapabilities: new Set(["solution_board.explain_fragment"]),
    bindings: [explanationBinding(), boardBinding()],
    sessionMode: "teaching",
    scopeAllows: (binding) => binding.binding_kind === "board",
  });
  assert.equal(scoped.length, 1);
  assert.deepEqual(scoped[0].bindings.map((binding) => binding.binding_id), ["VB-03"]);
});

test("effect_class x binding_kind mismatches never expose a tool", () => {
  // geometry 绑定不能喂给 board 工具；explanation 绑定不能喂给 construct。
  const mismatched = visiblePresentationTools({
    registeredCapabilities: new Set(["geometry.construct", "board.reveal-entry", "solution_board.explain_fragment"]),
    bindings: [geometryBinding()],
    sessionMode: "teaching",
  });
  assert.deepEqual(
    mismatched.map((instance) => instance.spec.tool_id),
    ["geometry.construct"],
  );
});

test("tool catalog version gate rejects drifted presenter pins", () => {
  assert.doesNotThrow(() => assertToolCatalogVersion(PRESENTATION_TOOL_CATALOG_VERSION));
  assert.throws(() => assertToolCatalogVersion("presentation-tool-catalog/v0"));
});

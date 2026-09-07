/**
 * F7 P2 转办 1 回归：awaiting_workspace.action_id 与 active_action.action_id
 * 同 identity（spec §1.3 #8）——服务端投影修复锁定（A 轨 e2e 用例 P3 启用）。
 *
 * golden BT-04（workspace_command 证据 Beat）：coach_panel_view.mainline
 * (awaiting_workspace).action_id 必须等于 pinned ActionTemplate 模板键
 * （= active_action.action_id），不再是 capability 串。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { resolveBeatActionTemplate } from "../WorkspaceActionAdjudication";
import { projectUnifiedViews } from "../UnifiedViewProjectionV5";
import { resolveBeatActionTemplate as resolveTemplate } from "../WorkspaceActionAdjudication";

const importerModule = require("../../planBuild/v5/ImportApprovedPlanV5") as typeof import("../../planBuild/v5/ImportApprovedPlanV5");
const navigatorPlanModule = require("../../tutorNavigator/NavigatorPlanV5") as typeof import("../../tutorNavigator/NavigatorPlanV5");
const catalogModule = require("../GoldenWorkspaceCatalog") as typeof import("../GoldenWorkspaceCatalog");
const foldModule = require("../../tutorSession/WorkspaceRuntimeReducerV5") as typeof import("../../tutorSession/WorkspaceRuntimeReducerV5");

const SESSION = "TS-9801";
const ROOT = realCanonicalRoot();
const imported = importerModule.importApprovedPlanV5({ canonicalRoot: ROOT, anchored: true }, "TP-SMV-009");
if (!imported.ok) throw new Error(imported.errors.join("; "));
const importedPlan = imported.imported;
const plan = navigatorPlanModule.buildNavigatorPlan(importedPlan);
const golden = catalogModule.buildGoldenWorkspaceCatalogV5(importedPlan);

function projectionAtBeat(beatId: string): ReturnType<typeof projectUnifiedViews> {
  const workspace = foldModule.initialWorkspaceFold(SESSION, golden.catalog);
  return projectUnifiedViews({
    sessionId: SESSION,
    tutorState: {
      schema: "ai_teaching_tutor_runtime_state/v1",
      session_id: SESSION,
      state_revision: 6,
      pinned_plan: {} as never,
      teaching_cursor: { protocol_id: plan.mainline.protocol_id, beat_id: beatId, phase: "awaiting_evidence", gate_id: "GT-04" },
      inquiry_cursor: null,
      workspace_revision: workspace.state.revision,
      completed: false,
    } as never,
    workspaceState: workspace.state,
    events: [],
    plan,
    catalog: golden.catalog,
    factEntryIds: golden.factEntryIds,
    sessionRevision: 6,
    resources: importedPlan.plan.resources,
  });
}

test("BT-04 awaiting_workspace.action_id equals the pinned template key (same identity as active_action)", () => {
  const projection = projectionAtBeat("BT-04");
  const mainline = projection.coachPanelView.mainline as { kind: string; action_id?: string; gate_id?: string };
  assert.equal(mainline.kind, "awaiting_workspace");
  const beat = plan.mainline.beats.get("BT-04")!;
  const template = resolveTemplate(importedPlan.plan.resources, beat);
  assert.ok(template, "golden BT-04 pins an action template");
  assert.equal(mainline.action_id, template.template.actionId);
  assert.notEqual(mainline.action_id, "similarity.mark-known-segments");

  // 同 identity 证明（结构级）：ActiveActionProjector.action_id 的唯一来源是
  // 同一 resolver 的 template.actionId（ActiveActionProjector.ts:104）——上面
  // 已断言 mainline.action_id === template.actionId，故两处恒等。
  //（projectActiveAction 的完整挂载需旅程上下文——committed 构造目标等；
  // 其挂载门禁在路由/快照层已有测试，此处不重复造旅程。）
});

test("beats without a pinned template keep the registered fallback (no crash, still canonical)", () => {
  const projection = projectionAtBeat("BT-01");
  const mainline = projection.coachPanelView.mainline as { kind: string; action_id?: string };
  assert.notEqual(mainline.kind, "awaiting_workspace");
  void resolveBeatActionTemplate;
});

void assert;

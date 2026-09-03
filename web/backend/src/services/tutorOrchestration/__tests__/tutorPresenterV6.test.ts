/**
 * F7 Step 3 门禁测试（node 链，纯函数）：TutorPresenterV6。
 *
 * 冻结顺序（PLAN.md §3 Step 3 / ADR-011）：Geometry 构造 → Voice 讲解 →
 * Solution Board reveal；缺类跳过、剩余 ordinal==下标连续；资源纪律（只消费
 * approved 资源）；构造幂等过滤；assessment 模式；canonical plan/v2 校验。
 * 输入 = F4 importer 真实 Approved 链（TP-SMV-009，同 G5/G6 口径）。
 */
import assert from "node:assert/strict";
import type { NavigatorDecision } from "../../tutorNavigator/TutorNavigatorV5";
import type { WorkspaceGateLedger } from "../../tutorSession/WorkspaceRuntimeReducerV5";
import { seedWorkspaceGateLedger } from "../../tutorSession/WorkspaceRuntimeReducerV5";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";

const importerModule = require("../../planBuild/v5/ImportApprovedPlanV5") as typeof import("../../planBuild/v5/ImportApprovedPlanV5");
const navigatorPlanModule = require("../../tutorNavigator/NavigatorPlanV5") as typeof import("../../tutorNavigator/NavigatorPlanV5");
const catalogModule = require("../GoldenWorkspaceCatalog") as typeof import("../GoldenWorkspaceCatalog");
const presenterModule = require("../TutorPresenterV6") as typeof import("../TutorPresenterV6");
const adjudicationModule = require("../../tutorOrchestration/WorkspaceActionAdjudication") as typeof import("../WorkspaceActionAdjudication");

const { importApprovedPlanV5 } = importerModule;
const { buildNavigatorPlan } = navigatorPlanModule;
const { buildGoldenWorkspaceCatalogV5 } = catalogModule;
const { realizePresentationPlanV6, TutorPresenterV6Error } = presenterModule;
const { constructionOutputId, resolveBeatConstructions } = adjudicationModule;

const ROOT = realCanonicalRoot();
const SESSION = "TS-8101";

const imported = importApprovedPlanV5({ canonicalRoot: ROOT, anchored: true }, "TP-SMV-009");
if (!imported.ok) throw new Error(imported.errors.join("; "));
const importedPlan = imported.imported;
const plan = buildNavigatorPlan(importedPlan);
const golden = buildGoldenWorkspaceCatalogV5(importedPlan);
const resources = new Map(importedPlan.plan.resources.map((resource) => [resource.resource_id, resource]));

function decisionFor(beatId: string): NavigatorDecision {
  return {
    decision_id: `TD-${SESSION}-${beatId}`,
    decision_kind: "execute_beat",
    protocol_id: plan.mainline.protocol_id,
    beat_id: beatId,
    policy_version: "protocol-navigator/v5-deterministic",
    source_event_sequence: 2,
    source_state_revision: 2,
  };
}

function ledgerFor(beatId: string): WorkspaceGateLedger {
  const seeded = seedWorkspaceGateLedger({
    task_id: golden.catalog.taskId,
    protocol_refs: [{ artifact_id: plan.mainline.protocol_id }],
    initial_cursor: { protocol_id: plan.mainline.protocol_id, beat_id: plan.mainline.entry_beat_id },
  });
  const decision = decisionFor(beatId);
  return {
    ...seeded,
    cursor: { protocolId: plan.mainline.protocol_id, beatId: beatId },
    decisions: new Map([
      [decision.decision_id, {
        decisionId: decision.decision_id,
        protocolId: decision.protocol_id,
        beatId: decision.beat_id,
        sequence: 2,
      }],
    ]),
  };
}

function presentationIntentOf(beatId: string) {
  const protocol = importedPlan.protocols.get(plan.mainline.protocol_id);
  const beat = protocol?.beats.find((candidate: { beat_id: string }) => candidate.beat_id === beatId);
  return (beat as { presentation_intent?: unknown } | undefined)?.presentation_intent as never;
}

function hiddenEntryIds(): Set<string> {
  return new Set(golden.catalog.boardEntries.map((entry) => entry.entryId));
}

function baseInput(beatId: string, overrides: Record<string, unknown> = {}) {
  const beat = plan.mainline.beats.get(beatId)!;
  return {
    sessionId: SESSION,
    sequenceSerial: 1,
    decision: decisionFor(beatId),
    beat,
    presentationIntent: presentationIntentOf(beatId),
    resources,
    catalog: golden.catalog,
    factEntryIds: golden.factEntryIds,
    gateLedger: ledgerFor(beatId),
    hiddenEntryIds: hiddenEntryIds(),
    committedElementIds: new Set<string>(),
    ...overrides,
  };
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function main(): Promise<void> {
  await runTest("BT-04 冻结顺序：Geometry 构造×N → Voice → Board reveal（ordinal 连续）", () => {
    const realized = realizePresentationPlanV6(baseInput("BT-04"));
    assert.match(realized.sequence_id, /^PS-[0-9]{4,}$/);
    assert.equal(realized.schema, "ai_teaching_presentation_plan/v2");
    assert.equal(realized.beat_id, "BT-04");
    const kinds = realized.actions.map((action) => action.kind);
    const surfaces = realized.actions.map((action) => (action.kind === "workspace" ? action.workspace_action?.surface : "voice"));
    // 顺序：全部 geometry 构造在前，voice 居中，board reveal 收尾。
    const firstVoice = kinds.indexOf("voice");
    const boardReveals = realized.actions.filter((action) => action.kind === "workspace" && action.workspace_action?.capability === "board.reveal-entry");
    const geometryConstructions = realized.actions.filter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    assert.ok(geometryConstructions.length >= 4, `BT-04 应携带 approved 构造资源（got ${geometryConstructions.length}）`);
    for (const action of geometryConstructions) {
      assert.ok(action.ordinal! < firstVoice, "构造必须先于 voice");
      assert.equal(action.workspace_action?.reveal_scope, "none");
      assert.equal(action.workspace_action?.origin, "tutor");
    }
    for (const reveal of boardReveals) {
      assert.ok(reveal.ordinal! > firstVoice, "board reveal 必须后于 voice");
      assert.equal(reveal.workspace_action?.reveal_scope, "step_narration");
    }
    void surfaces;
    // ordinal == 下标（canonical 镜像 superRefine 已强制；显式断言）。
    realized.actions.forEach((action, index) => assert.equal(action.ordinal, index));
    // 构造命令来自 approved 资源（DomainCommand 补戳 commandId/actionId）。
    for (const action of geometryConstructions) {
      const parsed = JSON.parse(action.workspace_action!.command_payload!) as { commandId: string; actionId: string };
      assert.equal(parsed.actionId, action.workspace_action!.action_id);
    }
  });

  await runTest("缺类跳过：BT-01（无构造资源）剩余 ordinal 连续", () => {
    const realized = realizePresentationPlanV6(baseInput(plan.mainline.entry_beat_id));
    const constructions = realized.actions.filter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    assert.equal(constructions.length, 0, "BT-01 不携带构造资源");
    realized.actions.forEach((action, index) => assert.equal(action.ordinal, index));
    assert.ok(realized.actions.length >= 1);
    assert.equal(realized.actions[0].kind, "voice", "无构造时 voice 为队首");
  });

  await runTest("构造幂等过滤：committed 输出跳过、剩余 ordinal 连续", () => {
    const beat = plan.mainline.beats.get("BT-04")!;
    const constructions = resolveBeatConstructions([...beat.resource_ids].map((id) => resources.get(id)!).filter(Boolean), beat)!;
    const firstOutput = constructionOutputId(constructions[0])!;
    const realized = realizePresentationPlanV6(baseInput("BT-04", { committedElementIds: new Set([firstOutput]) }));
    const remaining = realized.actions.filter((action) => action.kind === "workspace" && action.workspace_action?.capability === "geometry.construct");
    assert.equal(remaining.length, constructions.length - 1, "已 committed 的构造输出被跳过");
    realized.actions.forEach((action, index) => assert.equal(action.ordinal, index));
  });

  await runTest("资源纪律：voice 只消费 approved 资源（resource_ref ⊆ beat 资源）或 deterministic 回退", () => {
    for (const [beatId] of plan.mainline.beats) {
      const realized = realizePresentationPlanV6(baseInput(beatId));
      const voice = realized.actions.find((action) => action.kind === "voice")!;
      const payload = voice.voice_action!;
      if (payload.source === "approved-resource") {
        assert.ok(payload.resource_ref, "approved-resource 必须携带 resource_ref");
        assert.ok(beat_resourceIds(beatId).includes(payload.resource_ref!), "resource_ref 必须在 Beat 绑定资源内");
      } else {
        assert.equal(payload.source, "deterministic-scaffold");
        assert.equal(payload.resource_ref, undefined);
        assert.equal(payload.text, plan.mainline.beats.get(beatId)!.purpose);
      }
    }
  });

  await runTest("决策因果可见性：未 committed 的 decision 显式拒绝（零产出）", () => {
    const input = baseInput("BT-04");
    const ghost = { ...input.decision, decision_id: "TD-ghost-0001" };
    assert.throws(() => realizePresentationPlanV6({ ...input, decision: ghost }), (error: unknown) =>
      error instanceof TutorPresenterV6Error && error.code === "PLAN_VALIDATION_FAILED" && /no committed policy_decision_made fact/.test(error.message));
    // ledger 记录的 decision 产出 Beat 与被呈现 Beat 不一致 → 显式拒绝。
    const realDecision = input.decision as { decision_id: string };
    const driftedLedger: WorkspaceGateLedger = {
      ...ledgerFor("BT-04"),
      decisions: new Map([
        [realDecision.decision_id, {
          decisionId: realDecision.decision_id,
          protocolId: plan.mainline.protocol_id,
          beatId: "BT-01",
          sequence: 2,
        }],
      ]),
    };
    assert.throws(() => realizePresentationPlanV6({ ...input, gateLedger: driftedLedger }), (error: unknown) =>
      error instanceof TutorPresenterV6Error && /produces beat/.test(error.message));
  });

  await runTest("assessment 模式：仅确定性收束 voice、零 workspace 动作", () => {
    const realized = realizePresentationPlanV6(baseInput("BT-04", { assessmentMode: true }));
    assert.equal(realized.actions.length, 1);
    assert.equal(realized.actions[0].kind, "voice");
    assert.equal(realized.actions[0].voice_action!.source, "deterministic-scaffold");
    assert.equal(realized.actions[0].voice_action!.interruptible, false);
  });

  await runTest("final 条目不越权：BT-04 的 final reveal 不进入未授权计划", () => {
    // BT-04 阶段 gate 未满足（ledger 无 satisfied 评估）——final 条目（goal/
    // reveals_answer）不得进入计划；intermediate 条目正常进入。
    const realized = realizePresentationPlanV6(baseInput("BT-04"));
    const reveal = realized.actions.find((action) => action.kind === "workspace" && action.workspace_action?.capability === "board.reveal-entry");
    if (reveal) {
      for (const target of reveal.workspace_action!.target_ids!) {
        const entry = golden.catalog.boardEntries.find((candidate) => candidate.entryId === target)!;
        assert.notEqual(entry.revealRequirement, "final", `final 条目 ${target} 不得在 gate 未满足时进入计划`);
      }
    }
  });
}

function beat_resourceIds(beatId: string): string[] {
  return [...plan.mainline.beats.get(beatId)!.resource_ids];
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);

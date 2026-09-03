/**
 * F7 Step 2 返工门禁测试：TutorTaskBindingResolver 的**完整 binding/pin 对账**
 * （真实 golden canonical root）。
 *
 * 审核修复（Rework P0-2）：此前测试直接用假 TutorPlan ref 调 provider 并期待
 * 成功——只证明了「task_id 能查到当前 binding」，没有证明 pin 对账。本套件
 * 以 resolveForStart 得到的**真实 refs** 为基准构造 session_started payload：
 * - 完整正例（TP/question/scenario/catalog 全对账）通过；
 * - TP 版本/哈希漂移、question ref 漂移、scenario 漂移、catalog pin 缺失、
 *   catalog hash 漂移全部 fail closed（artifact 升版后旧会话不得恢复到
 *   「当前」Plan/registry）；
 * - unknown task / 缺 task_id fail closed（无 allowlist/默认回退）。
 */
import { describe, expect, it } from "vitest";

import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import {
  TutorTaskBindingError,
  TutorTaskBindingResolver,
  resolvableTaskIds,
} from "../TutorTaskBindingResolver";
import { workspaceCatalogPin } from "../../tutorSession/WorkspacePresentationCatalogV5";
import type { V5SessionStartedPayload } from "../../tutorSession/TutorSessionEventV5";

const resolver = new TutorTaskBindingResolver(realCanonicalRoot());
const GOLDEN_TASK_ID = "goldenMinhangFold2020";

/** 以 resolveForStart 的真实 binding refs 为基准的完整 session_started payload。 */
function goldenSessionStarted(overrides: {
  tutorPlanRef?: { artifact_id: string; version: string; content_hash: string };
  questionRef?: { artifact_id: string; version: string; content_hash: string };
  scenarioId?: string;
  omitCatalogPin?: boolean;
  catalogHash?: string;
}): Record<string, unknown> {
  const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
  const payload: V5SessionStartedPayload = {
    task_id: GOLDEN_TASK_ID,
    scenario_id: overrides.scenarioId ?? binding.scenarioId,
    question_ref: overrides.questionRef ?? { ...binding.plan.question_ref },
    approach_set_ref: { ...binding.plan.approach_set_ref },
    solution_graph_ref: { ...binding.plan.solution_graph_ref },
    protocol_refs: [],
    tutor_plan_ref: overrides.tutorPlanRef ?? { ...binding.plan.tutor_plan_ref },
    initial_cursor: { protocol_id: binding.plan.mainline.protocol_id, beat_id: binding.plan.mainline.entry_beat_id },
  };
  const record: Record<string, unknown> = { ...payload };
  if (!overrides.omitCatalogPin) {
    const pin = workspaceCatalogPin(binding.golden.catalog);
    record.workspace_catalog_pin = {
      catalog_schema_version: pin.catalog_schema_version,
      content_hash: overrides.catalogHash ?? pin.content_hash,
    };
  }
  return record;
}

describe("F7 Step 2 TutorTaskBindingResolver（完整 pin 对账）", () => {
  it("resolvableTaskIds：F7 绑定表只含 golden task", () => {
    expect(resolvableTaskIds()).toEqual([GOLDEN_TASK_ID]);
  });

  it("start：golden task 唯一解析 question/scenario/approved TutorPlan/catalog", () => {
    const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
    expect(binding.taskId).toBe(GOLDEN_TASK_ID);
    expect(binding.tpId).toBe("TP-SMV-009");
    expect(binding.scenarioId).toBe("golden-similarity-mvp-001:QT-SMV-001");
    expect(binding.question.artifact_id).toBe("QT-SMV-001");
    expect(binding.question.stem.length).toBeGreaterThan(0);
    expect(binding.golden.catalog.boardEntries.length).toBeGreaterThan(0);
    expect(binding.plan.tutor_plan_ref.artifact_id).toBe("TP-SMV-009");
  });

  it("unknown task / 缺 task_id fail closed：无 allowlist/默认回退（start 与 restore 同一纪律）", () => {
    expect(() => resolver.resolveForStart("someLegacyTask")).toThrowError(TutorTaskBindingError);
    expect(() => resolver.resolveForRestore("anotherTaskId")).toThrowError(/no pinned task binding/);
    expect(() => resolver.v6RegistryProvider({})).toThrowError(/no pinned task_id/);
    try {
      resolver.resolveForStart("someLegacyTask");
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as TutorTaskBindingError).code).toBe("UNKNOWN_TASK");
    }
  });

  it("restore：只读 pinned task_id，与 start 同一绑定（确定性重导出）", () => {
    const fromStart = resolver.resolveForStart(GOLDEN_TASK_ID);
    const fromRestore = resolver.resolveForRestore(GOLDEN_TASK_ID);
    expect(fromRestore.tpId).toBe(fromStart.tpId);
    expect(fromRestore.plan.tutor_plan_ref.content_hash).toBe(fromStart.plan.tutor_plan_ref.content_hash);
    expect(fromRestore.golden.catalog.canonicalPathEntryIds).toEqual(fromStart.golden.catalog.canonicalPathEntryIds);
  });

  it("完整正例：真实 TP/question/scenario refs + 正确 catalog pin 全对账通过", () => {
    const registry = resolver.v6RegistryProvider(goldenSessionStarted({}));
    expect(registry.capabilities.get("geometry.construct")).toMatchObject({ surface: "geometry", origin: "tutor" });
    expect(registry.capabilities.get("board.reveal-entry")).toMatchObject({ surface: "solution_board", origin: "tutor" });
    expect(registry.capabilities.get("geometry.draft")).toBeUndefined();
    expect(registry.targetUniverse.has("segment-AB")).toBe(true);
    expect([...registry.targetUniverse].some((id) => /^BE-\d+$/.test(id))).toBe(true);
    const declaredOutputs = [...registry.targetUniverse].filter((id) => id.startsWith("line-") || id.startsWith("pt-"));
    expect(declaredOutputs.length).toBeGreaterThan(0);
  });

  it("TP pin 漂移 fail closed：版本漂移与哈希漂移均拒绝（artifact 升版不得漂移旧会话）", () => {
    const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
    const versionDrift = goldenSessionStarted({
      tutorPlanRef: { artifact_id: "TP-SMV-009", version: "v3", content_hash: binding.plan.tutor_plan_ref.content_hash },
    });
    expect(() => resolver.v6RegistryProvider(versionDrift)).toThrowError(/PIN_MISMATCH|tutor_plan_ref/);
    try {
      resolver.v6RegistryProvider(versionDrift);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as TutorTaskBindingError).code).toBe("PIN_MISMATCH");
    }
    const hashDrift = goldenSessionStarted({
      tutorPlanRef: { artifact_id: "TP-SMV-009", version: binding.plan.tutor_plan_ref.version, content_hash: "sha256:tampered-plan" },
    });
    expect(() => resolver.v6RegistryProvider(hashDrift)).toThrowError(/PIN_MISMATCH|tutor_plan_ref/);
  });

  it("question/scenario pin 漂移 fail closed", () => {
    const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
    const questionDrift = goldenSessionStarted({
      questionRef: { ...binding.plan.question_ref, content_hash: "sha256:tampered-question" },
    });
    expect(() => resolver.v6RegistryProvider(questionDrift)).toThrowError(/PIN_MISMATCH|question_ref/);
    const scenarioDrift = goldenSessionStarted({ scenarioId: "golden-similarity-mvp-001:QT-SMV-999" });
    expect(() => resolver.v6RegistryProvider(scenarioDrift)).toThrowError(/PIN_MISMATCH|scenario_id/);
  });

  it("catalog pin 缺失/漂移 fail closed：v6 会话必须 pin catalog", () => {
    const missing = goldenSessionStarted({ omitCatalogPin: true });
    expect(() => resolver.v6RegistryProvider(missing)).toThrowError(/CATALOG_PIN_MISMATCH|no workspace_catalog_pin/);
    try {
      resolver.v6RegistryProvider(missing);
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as TutorTaskBindingError).code).toBe("CATALOG_PIN_MISMATCH");
    }
    expect(() => resolver.v6RegistryProvider(goldenSessionStarted({ catalogHash: "sha256:tampered" }))).toThrowError(
      /CATALOG_PIN_MISMATCH|does not match the pinned task binding catalog/,
    );
  });
});

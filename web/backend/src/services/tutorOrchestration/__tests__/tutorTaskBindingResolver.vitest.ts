/**
 * F7 Step 2：TutorTaskBindingResolver 门禁测试（真实 golden canonical root）。
 *
 * 覆盖 PLAN.md Step 2 / spec §2.3 / P1.9：
 * - start 显式 task_id：golden 唯一解析（question/scenario/approved TutorPlan）；
 * - unknown task → fail closed（无 allowlist 第一项/默认题回退——task A 会话
 *   不得加载 task B/default）；
 * - restore 只读已 pin 的 session_started.task_id；
 * - session-pinned capability registry：由 pinned binding 确定性导出（authored
 *   基座 ∪ Board 条目 ∪ 主线 Beat 绑定构造资源输出）；workspace_catalog_pin
 *   对账不符 → CATALOG_PIN_MISMATCH（零事件、零状态变更）。
 */
import { describe, expect, it } from "vitest";

import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import {
  TutorTaskBindingError,
  TutorTaskBindingResolver,
  resolvableTaskIds,
} from "../TutorTaskBindingResolver";
import { workspaceCatalogPin } from "../../tutorSession/WorkspacePresentationCatalogV5";

const resolver = new TutorTaskBindingResolver(realCanonicalRoot());
const GOLDEN_TASK_ID = "goldenMinhangFold2020";

describe("F7 Step 2 TutorTaskBindingResolver", () => {
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

  it("unknown task fail closed：无 allowlist/默认回退（start 与 restore 同一纪律）", () => {
    expect(() => resolver.resolveForStart("someLegacyTask")).toThrowError(TutorTaskBindingError);
    expect(() => resolver.resolveForStart("someLegacyTask")).toThrowError(/no pinned task binding/);
    expect(() => resolver.resolveForRestore("anotherTaskId")).toThrowError(TutorTaskBindingError);
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
    expect(fromRestore.question.artifact_id).toBe(fromStart.question.artifact_id);
    expect(fromRestore.golden.catalog.canonicalPathEntryIds).toEqual(fromStart.golden.catalog.canonicalPathEntryIds);
  });

  it("session-pinned registry：tutor 能力面 + authored 基座/Board/构造输出 target 宇宙", () => {
    const registry = resolver.v6RegistryProvider({
      task_id: GOLDEN_TASK_ID,
      tutor_plan_ref: { artifact_id: "TP-SMV-009", version: "v2", content_hash: "sha256:x" },
    });
    // tutor 能力面（F3 静态表的 tutor-origin 子集）。
    expect(registry.capabilities.get("geometry.construct")).toMatchObject({ surface: "geometry", origin: "tutor" });
    expect(registry.capabilities.get("board.reveal-entry")).toMatchObject({ surface: "solution_board", origin: "tutor" });
    expect(registry.capabilities.get("geometry.draft")).toBeUndefined();
    // authored 基座元素 + Board BE- 条目。
    expect(registry.targetUniverse.has("segment-AB")).toBe(true);
    expect([...registry.targetUniverse].some((id) => /^BE-\d+$/.test(id))).toBe(true);
    // 主线 Beat 绑定构造资源输出（RG 辅助构造 line-*/pt-*）。
    const declaredOutputs = [...registry.targetUniverse].filter((id) => id.startsWith("line-") || id.startsWith("pt-"));
    expect(declaredOutputs.length).toBeGreaterThan(0);
  });

  it("registry provider：catalog pin 不符 → fail closed（零事件、零状态变更）", () => {
    expect(() =>
      resolver.v6RegistryProvider({
        task_id: GOLDEN_TASK_ID,
        workspace_catalog_pin: { catalog_schema_version: 5, content_hash: "sha256:tampered" },
      }),
    ).toThrowError(TutorTaskBindingError);
    try {
      resolver.v6RegistryProvider({
        task_id: GOLDEN_TASK_ID,
        workspace_catalog_pin: { catalog_schema_version: 5, content_hash: "sha256:tampered" },
      });
      expect.unreachable("must throw");
    } catch (error) {
      expect((error as TutorTaskBindingError).code).toBe("CATALOG_PIN_MISMATCH");
    }
  });

  it("registry provider：缺 pinned task_id → fail closed", () => {
    expect(() => resolver.v6RegistryProvider({})).toThrowError(TutorTaskBindingError);
  });

  it("registry provider：携带正确 catalog pin 时通过对账", () => {
    const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
    const pin = workspaceCatalogPin(binding.golden.catalog);
    const registry = resolver.v6RegistryProvider({
      task_id: GOLDEN_TASK_ID,
      workspace_catalog_pin: { catalog_schema_version: pin.catalog_schema_version, content_hash: pin.content_hash },
    });
    expect(registry.capabilities.size).toBeGreaterThan(0);
  });
});

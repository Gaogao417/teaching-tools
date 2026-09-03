/**
 * TutorTaskBindingResolver（F7 Step 2 — task→question→Plan 唯一绑定解析）。
 *
 * PLAN.md Step 2 / spec §2.3 / P1.9：
 * - F7 只支持 golden task；start 显式传 task_id，resolver 唯一返回 question、
 *   scenario、approved TutorPlan（原子 pin 后会话才创建成功）；
 * - restore 从 `session_started.task_id` 恢复 task→question→Plan，**禁止再次
 *   读取 allowlist 第一项**或环境默认题（task A 会话不得加载 task B/default）；
 * - session-pinned capability registry 由 pinned binding 确定性导出（approved
 *   plan → golden catalog + 主线 Beat 绑定构造资源输出），并经
 *   `session_started.workspace_catalog_pin.content_hash` 对账——不符 fail
 *   closed（不接受未经对账的任意 registry/catalog）。
 *
 * 绑定表当前仅 golden（F8 扩展为 supported+approved+enabled 路由）；unknown
 * task → TutorTaskBindingError("UNKNOWN_TASK")，无 allowlist/默认回退。
 */
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import { buildNavigatorPlan, type NavigatorPlanV5 } from "../tutorNavigator/NavigatorPlanV5";
import { buildGoldenWorkspaceCatalogV5, type GoldenWorkspaceCatalog } from "./GoldenWorkspaceCatalog";
import { constructionOutputId, resolveBeatConstructions } from "./WorkspaceActionAdjudication";
import { workspaceCatalogPin } from "../tutorSession/WorkspacePresentationCatalogV5";
import {
  buildSessionPinnedCapabilityRegistry,
  type SessionPinnedCapabilityRegistry,
} from "../tutorSession/SessionPinnedCapabilityRegistry";
import type { V6RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV6";

export type TutorTaskBindingErrorCode = "UNKNOWN_TASK" | "PLAN_IMPORT_FAILED" | "CATALOG_PIN_MISMATCH";

export class TutorTaskBindingError extends Error {
  readonly code: TutorTaskBindingErrorCode;

  constructor(code: TutorTaskBindingErrorCode, message: string) {
    super(message);
    this.name = "TutorTaskBindingError";
    this.code = code;
  }
}

/** F7 绑定表：golden task 唯一（TP/Scenario 显式声明，不读 allowlist/环境默认）。 */
const TASK_BINDINGS: ReadonlyMap<string, { tpId: string; scenarioId: string }> = new Map([
  ["goldenMinhangFold2020", { tpId: "TP-SMV-009", scenarioId: "golden-similarity-mvp-001:QT-SMV-001" }],
]);

export interface TutorTaskBinding {
  readonly taskId: string;
  readonly tpId: string;
  readonly scenarioId: string;
  readonly imported: ImportedApprovedPlanV5;
  readonly plan: NavigatorPlanV5;
  readonly golden: GoldenWorkspaceCatalog;
  readonly registry: SessionPinnedCapabilityRegistry;
  /** 学生安全题面（question stem/type；答案真值不出 resolver）。 */
  readonly question: { artifact_id: string; question_type: string; stem: string };
}

/**
 * 主线 Beat 绑定构造资源的输出元素 id（RG 辅助构造：O 及 line-AO 等）——
 * session-pinned target 宇宙的任务声明部分：authored 基座 ∪ Board 条目 之外，
 * 允许后续 sequence 高亮/引用本 plan 声明的构造产物。
 */
function declaredConstructionOutputIds(imported: ImportedApprovedPlanV5): string[] {
  const outputs: string[] = [];
  const resources = imported.plan.resources;
  for (const protocol of imported.protocols.values()) {
    if (protocol.protocol_kind !== "mainline") continue;
    for (const beat of protocol.beats) {
      const constructions = resolveBeatConstructions(resources, {
        beat_id: beat.beat_id,
        resource_ids: [...(beat.resource_ids ?? [])],
      } as never);
      if (!constructions) continue;
      for (const command of constructions) {
        const output = constructionOutputId(command);
        if (output) outputs.push(output);
      }
    }
  }
  return [...new Set(outputs)];
}

/** 唯一绑定解析（start 与 restore 共用；unknown task fail closed）。 */
function resolveBinding(canonicalRoot: string, taskId: string): TutorTaskBinding {
  const entry = TASK_BINDINGS.get(taskId);
  if (!entry) {
    throw new TutorTaskBindingError(
      "UNKNOWN_TASK",
      `task ${taskId} has no pinned task binding (F7 supports the golden task only; no allowlist/default fallback)`,
    );
  }
  const imported = importApprovedPlanV5({ canonicalRoot, anchored: true }, entry.tpId);
  if (!imported.ok) {
    throw new TutorTaskBindingError(
      "PLAN_IMPORT_FAILED",
      `approved plan import failed for task ${taskId} (fail closed): ${imported.errors.join("; ")}`,
    );
  }
  const plan = buildNavigatorPlan(imported.imported);
  const golden = buildGoldenWorkspaceCatalogV5(imported.imported);
  const registry = buildSessionPinnedCapabilityRegistry(golden, declaredConstructionOutputIds(imported.imported));
  return {
    taskId,
    tpId: entry.tpId,
    scenarioId: entry.scenarioId,
    imported: imported.imported,
    plan,
    golden,
    registry,
    question: {
      artifact_id: plan.question.artifact_id,
      question_type: plan.question.question_type,
      stem: plan.question.stem,
    },
  };
}

export class TutorTaskBindingResolver {
  constructor(private readonly canonicalRoot: string) {}

  /** start 路径：显式 task_id（无默认值；unknown → fail closed）。 */
  resolveForStart(taskId: string): TutorTaskBinding {
    return resolveBinding(this.canonicalRoot, taskId);
  }

  /**
   * restore 路径：只读已 pin 的 `session_started.task_id`（禁止 allowlist
   * 第一项/默认题；task A 会话不加载 task B）。
   */
  resolveForRestore(pinnedTaskId: string): TutorTaskBinding {
    return resolveBinding(this.canonicalRoot, pinnedTaskId);
  }

  /**
   * V6 registry provider：从已提交 session_started payload 重导出
   * session-pinned capability registry，并重算 catalog pin 对账（payload 带
   * workspace_catalog_pin 时必须与 pinned binding 重算值一致——不符 fail
   * closed，零事件、零状态变更）。
   */
  readonly v6RegistryProvider: V6RegistryProvider = (sessionStartedPayload): SessionPinnedCapabilityRegistry => {
    const taskId = sessionStartedPayload.task_id;
    if (typeof taskId !== "string" || taskId === "") {
      throw new TutorTaskBindingError(
        "UNKNOWN_TASK",
        "session_started payload carries no pinned task_id; cannot resolve the task binding (fail closed)",
      );
    }
    const binding = resolveBinding(this.canonicalRoot, taskId);
    const pinnedHash = (sessionStartedPayload.workspace_catalog_pin as { content_hash?: string } | undefined)
      ?.content_hash;
    if (typeof pinnedHash === "string" && pinnedHash !== workspaceCatalogPin(binding.golden.catalog).content_hash) {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        `session_started workspace_catalog_pin ${pinnedHash} does not match the pinned task binding catalog (fail closed; zero events, zero state change)`,
      );
    }
    return binding.registry;
  };
}

/** 支持 start 显式选择的任务清单（availability 面；绑定解析仍走 fail-closed 表）。 */
export function resolvableTaskIds(): readonly string[] {
  return [...TASK_BINDINGS.keys()];
}

/**
 * TutorTaskBindingResolver（F7 Step 2 — task→question→Plan 唯一绑定解析）。
 *
 * PLAN.md Step 2 / spec §2.3 / P1.9：
 * - F7 只支持 golden task；start 显式传 task_id，resolver 唯一返回 question、
 *   scenario、approved TutorPlan（原子 pin 后会话才创建成功）；
 * - restore 从 `session_started.task_id` 恢复 task→question→Plan，**禁止再次
 *   读取 allowlist 第一项**或环境默认题（task A 会话不得加载 task B/default）；
 * - session-pinned capability registry 由 pinned binding 确定性导出（approved
 *   plan → golden catalog + 主线 Beat 绑定构造资源输出）；restore 经
 *   `v6RegistryProvider` 做**完整 binding/pin 对账**（tutor_plan_ref /
 *   question_ref 三元组、scenario_id、必带的 workspace_catalog_pin——不符即
 *   fail closed，不接受未经对账的任意 registry/catalog，也不接受「重读当前
 *   版本 Plan 冒充创建时 binding」）。
 *
 * 绑定表当前仅 golden（F8 扩展为 supported+approved+enabled 路由）；unknown
 * task → TutorTaskBindingError("UNKNOWN_TASK")，无 allowlist/默认回退。
 */
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../planBuild/v5/ImportApprovedPlanV5";
import { buildNavigatorPlan, type NavigatorPlanV5 } from "../tutorNavigator/NavigatorPlanV5";
import { buildGoldenWorkspaceCatalogV5, goldenWorkspaceCatalogForPin, type GoldenWorkspaceCatalog } from "./GoldenWorkspaceCatalog";
import { constructionOutputId, resolveBeatConstructions } from "./WorkspaceActionAdjudication";
import { workspaceCatalogPin } from "../tutorSession/WorkspacePresentationCatalogV5";
import {
  buildSessionPinnedCapabilityRegistry,
  type SessionPinnedCapabilityRegistry,
} from "../tutorSession/SessionPinnedCapabilityRegistry";
import {
  listPublishedTaskIds,
  loadPublishedTaskBinding,
  loadPublishedWorkspaceCatalog,
  publishedCatalogPin,
  type PublishedTaskBinding,
} from "./PublishedProductionBinding";
import type { V6RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV6";
import type { V7RegistryProvider } from "../tutorSession/RuntimeStateRebuilderV7";
import type { WorkspacePresentationCatalogV5 } from "../tutorSession/WorkspacePresentationCatalogV5";

export type TutorTaskBindingErrorCode =
  | "UNKNOWN_TASK"
  | "PLAN_IMPORT_FAILED"
  | "PIN_MISMATCH"
  | "CATALOG_PIN_MISMATCH";

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

/** 唯一绑定解析（start 与 restore 共用；unknown task fail closed）。

 * golden 绑定表（F7 冻结）之外，允许消费**生产 driver 发布进本 canonical
 * root** 的 vnext-task-bindings.yaml（F4 题图/生产补强）：catalog 来自生产
 * 发布文件（全量校验），restore 按 pin 对账；缺发布物 → UNKNOWN_TASK，
 * 无 allowlist/默认回退。 */
function resolveBinding(canonicalRoot: string, taskId: string, importer: typeof importApprovedPlanV5, pinnedCatalog?: unknown, mode?: "teaching" | "assessment"): TutorTaskBinding {
  const entry = TASK_BINDINGS.get(taskId);
  if (!entry) {
    return resolvePublishedBinding(canonicalRoot, taskId, importer, pinnedCatalog, mode);
  }
  const imported = importer({ canonicalRoot, anchored: true }, entry.tpId);
  if (!imported.ok) {
    throw new TutorTaskBindingError(
      "PLAN_IMPORT_FAILED",
      `approved plan import failed for task ${taskId} (fail closed): ${imported.errors.join("; ")}`,
    );
  }
  const plan = buildNavigatorPlan(imported.imported);
  let golden: GoldenWorkspaceCatalog;
  try {
    golden = pinnedCatalog === undefined ? buildGoldenWorkspaceCatalogV5(imported.imported)
      : goldenWorkspaceCatalogForPin(imported.imported, pinnedCatalog, mode);
  } catch (error) {
    throw new TutorTaskBindingError("CATALOG_PIN_MISMATCH", `CATALOG_PIN_MISMATCH: ${error instanceof Error ? error.message : "unsupported catalog pin"}`);
  }
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

/** 生产发布绑定的解析（catalog 全量校验 + restore pin 对账；fail closed）。 */
function resolvePublishedBinding(canonicalRoot: string, taskId: string, importer: typeof importApprovedPlanV5, pinnedCatalog: unknown, mode?: "teaching" | "assessment"): TutorTaskBinding {
  let published: PublishedTaskBinding;
  try {
    const found = loadPublishedTaskBinding(canonicalRoot, taskId);
    if (!found) {
      throw new TutorTaskBindingError(
        "UNKNOWN_TASK",
        `task ${taskId} has no pinned task binding (golden or published production binding required; no allowlist/default fallback)`,
      );
    }
    published = found;
  } catch (error) {
    if (error instanceof TutorTaskBindingError) throw error;
    throw new TutorTaskBindingError("UNKNOWN_TASK", `published binding for task ${taskId} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const imported = importer({ canonicalRoot, anchored: true }, published.tpId);
  if (!imported.ok) {
    throw new TutorTaskBindingError(
      "PLAN_IMPORT_FAILED",
      `approved plan import failed for published task ${taskId} (fail closed): ${imported.errors.join("; ")}`,
    );
  }
  const plan = buildNavigatorPlan(imported.imported);
  let catalog: WorkspacePresentationCatalogV5;
  try {
    catalog = loadPublishedWorkspaceCatalog(canonicalRoot, published.catalogPath, taskId);
  } catch (error) {
    throw new TutorTaskBindingError("PLAN_IMPORT_FAILED", `published workspace catalog for task ${taskId} failed validation (fail closed): ${error instanceof Error ? error.message : String(error)}`);
  }
  if (mode === "assessment") catalog = { ...catalog, initialInteractionMode: "locked" };
  if (pinnedCatalog !== undefined) {
    const pin = pinnedCatalog as { content_hash?: unknown };
    if (typeof pin.content_hash !== "string" || pin.content_hash !== publishedCatalogPin(catalog).content_hash) {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        `session_started workspace_catalog_pin does not match the published task catalog (fail closed; zero events, zero state change)`,
      );
    }
  }
  const factEntryIds = new Map(imported.imported.graph.facts.map((fact, index) => [fact.fact_id, `BE-${String(index + 1).padStart(2, "0")}`]));
  const golden: GoldenWorkspaceCatalog = { catalog, factEntryIds };
  const registry = buildSessionPinnedCapabilityRegistry(golden, declaredConstructionOutputIds(imported.imported));
  return {
    taskId,
    tpId: published.tpId,
    scenarioId: published.scenarioId,
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
  /** Explicit composition injection for local author review; production remains Approved-only. */
  constructor(private readonly canonicalRoot: string, private readonly importer: typeof importApprovedPlanV5 = importApprovedPlanV5) {}

  /** start 路径：显式 task_id（无默认值；unknown → fail closed）。 */
  resolveForStart(taskId: string): TutorTaskBinding {
    return resolveBinding(this.canonicalRoot, taskId, this.importer);
  }

  /**
   * restore 路径：只读已 pin 的 `session_started.task_id`（禁止 allowlist
   * 第一项/默认题；task A 会话不加载 task B）。
   */
  resolveForRestore(pinnedTaskId: string, sessionStartedPayload?: Record<string, unknown>): TutorTaskBinding {
    if (sessionStartedPayload && (sessionStartedPayload.task_id !== pinnedTaskId || !sessionStartedPayload.workspace_catalog_pin))
      throw new TutorTaskBindingError("PIN_MISMATCH", "restore requires the committed task and workspace_catalog_pin");
    return resolveBinding(this.canonicalRoot, pinnedTaskId, this.importer, sessionStartedPayload?.workspace_catalog_pin,
      sessionStartedPayload?.session_mode === "assessment" ? "assessment" : "teaching");
  }

  /**
   * V6 registry provider：从已提交 session_started payload 重导出
   * session-pinned capability registry，并做**完整 binding/pin 对账**（F7 Step 2
   * 返工 P0-2：不只对 task_id——artifact 升版后旧会话不得恢复到「当前」
   * Plan/registry，必须回到创建时的 binding）：
   * - task_id → 绑定表唯一解析（unknown fail closed）；
   * - `tutor_plan_ref` / `question_ref` 三元组、`scenario_id` 与 pinned binding
   *   逐项一致（不符 → PIN_MISMATCH，零事件、零状态变更）；
   * - `workspace_catalog_pin` 对 v6 会话**必带**（缺 pin 即 fail closed——不
   *   接受无对账的任意 catalog），content_hash 与 binding 重算值一致。
   */
  readonly v6RegistryProvider: V6RegistryProvider = (sessionStartedPayload): SessionPinnedCapabilityRegistry => {
    const taskId = sessionStartedPayload.task_id;
    if (typeof taskId !== "string" || taskId === "") {
      throw new TutorTaskBindingError(
        "UNKNOWN_TASK",
        "session_started payload carries no pinned task_id; cannot resolve the task binding (fail closed)",
      );
    }
    const binding = resolveBinding(this.canonicalRoot, taskId, this.importer, sessionStartedPayload.workspace_catalog_pin, "teaching");
    assertPinnedRefMatches("tutor_plan_ref", sessionStartedPayload.tutor_plan_ref, binding.plan.tutor_plan_ref);
    assertPinnedRefMatches("question_ref", sessionStartedPayload.question_ref, binding.plan.question_ref);
    if (sessionStartedPayload.scenario_id !== binding.scenarioId) {
      throw new TutorTaskBindingError(
        "PIN_MISMATCH",
        `session_started scenario_id=${String(sessionStartedPayload.scenario_id)} does not match the pinned task binding (${binding.scenarioId}) (fail closed; zero events, zero state change)`,
      );
    }
    const pinnedCatalog = sessionStartedPayload.workspace_catalog_pin as { content_hash?: unknown } | undefined;
    if (!pinnedCatalog || typeof pinnedCatalog.content_hash !== "string") {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        "session_started carries no workspace_catalog_pin; v6 sessions must pin the catalog at start (fail closed; zero events, zero state change)",
      );
    }
    if (pinnedCatalog.content_hash !== workspaceCatalogPin(binding.golden.catalog).content_hash) {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        `session_started workspace_catalog_pin ${pinnedCatalog.content_hash} does not match the pinned task binding catalog (fail closed; zero events, zero state change)`,
      );
    }
    return binding.registry;
  };

  /**
   * V7 registry provider（F7 Step 4）：与 v6 同源对账 + **session_mode ↔ catalog
   * 双重对账**（assessment 不再由 catalog hash 间接推断）：
   * - session_mode 必填（teaching|assessment；缺省/非法 → fail closed）；
   * - session_mode=teaching ⇒ catalog pin 必须是 construction 形态 hash；
   * - session_mode=assessment ⇒ catalog pin 必须是 locked 变体 hash
   *   （{...golden.catalog, initialInteractionMode:"locked"}——V5 语义镜像：
   *   locked 交互、教学工具禁用，但仍收集独立作答）。任一不符 fail closed。
   */
  readonly v7RegistryProvider: V7RegistryProvider = (sessionStartedPayload): SessionPinnedCapabilityRegistry => {
    const taskId = sessionStartedPayload.task_id;
    if (typeof taskId !== "string" || taskId === "") {
      throw new TutorTaskBindingError(
        "UNKNOWN_TASK",
        "session_started payload carries no pinned task_id; cannot resolve the task binding (fail closed)",
      );
    }
    const mode = sessionStartedPayload.session_mode;
    if (mode !== "teaching" && mode !== "assessment") {
      throw new TutorTaskBindingError(
        "PIN_MISMATCH",
        `session_started session_mode=${String(mode)} is missing or illegal (v7 requires teaching|assessment; fail closed; zero events, zero state change)`,
      );
    }
    const binding = resolveBinding(this.canonicalRoot, taskId, this.importer, sessionStartedPayload.workspace_catalog_pin, mode);
    assertPinnedRefMatches("tutor_plan_ref", sessionStartedPayload.tutor_plan_ref, binding.plan.tutor_plan_ref);
    assertPinnedRefMatches("question_ref", sessionStartedPayload.question_ref, binding.plan.question_ref);
    if (sessionStartedPayload.scenario_id !== binding.scenarioId) {
      throw new TutorTaskBindingError(
        "PIN_MISMATCH",
        `session_started scenario_id=${String(sessionStartedPayload.scenario_id)} does not match the pinned task binding (${binding.scenarioId}) (fail closed; zero events, zero state change)`,
      );
    }
    const pinnedCatalog = sessionStartedPayload.workspace_catalog_pin as { content_hash?: unknown } | undefined;
    if (!pinnedCatalog || typeof pinnedCatalog.content_hash !== "string") {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        "session_started carries no workspace_catalog_pin; v7 sessions must pin the catalog at start (fail closed; zero events, zero state change)",
      );
    }
    const expectedHash = workspaceCatalogPin(
      mode === "assessment" ? assessmentCatalogVariant(binding) : binding.golden.catalog,
    ).content_hash;
    if (pinnedCatalog.content_hash !== expectedHash) {
      throw new TutorTaskBindingError(
        "CATALOG_PIN_MISMATCH",
        `session_started workspace_catalog_pin ${pinnedCatalog.content_hash} does not match the ${mode}-mode catalog of the pinned task binding (expected ${expectedHash}; fail closed; zero events, zero state change)`,
      );
    }
    return binding.registry;
  };
}

/**
 * assessment 变体 catalog（F7 Step 4；V5 语义镜像 TutorSessionOrchestratorV5）：
 * locked 交互（review-only）——无教学帮助、无答案揭示，但仍收集并评价学生
 * 独立作答（mainline utterance/confirm/continue 与确定性指示 voice 允许）。
 */
export function assessmentCatalogVariant(binding: TutorTaskBinding): WorkspacePresentationCatalogV5 {
  return { ...binding.golden.catalog, initialInteractionMode: "locked" as const };
}

/** 会话 pin 的 artifact 三元组对账（缺失/任一字段不符 → PIN_MISMATCH fail closed）。 */
function assertPinnedRefMatches(
  field: string,
  pinned: unknown,
  binding: { artifact_id: string; version: string; content_hash: string },
): void {
  const record = pinned as { artifact_id?: unknown; version?: unknown; content_hash?: unknown } | undefined;
  const same =
    record !== undefined &&
    record.artifact_id === binding.artifact_id &&
    record.version === binding.version &&
    record.content_hash === binding.content_hash;
  if (!same) {
    throw new TutorTaskBindingError(
      "PIN_MISMATCH",
      `session_started ${field} ${JSON.stringify(record ?? null)} does not match the pinned task binding (${binding.artifact_id}@${binding.version}) (fail closed; zero events, zero state change)`,
    );
  }
}

/** 支持 start 显式选择的任务清单（availability 面；绑定解析仍走 fail-closed 表）。 */
export function resolvableTaskIds(canonicalRoot?: string): readonly string[] {
  const ids = [...TASK_BINDINGS.keys()];
  if (canonicalRoot) {
    // F4 production roots additionally expose tasks published via
    // vnext-task-bindings.yaml; corrupted manifests fail closed.
    const published = listPublishedTaskIds(canonicalRoot);
    for (const id of published) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

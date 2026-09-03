/**
 * Session-pinned capability registry（F7 Step 2 — V6 presentation 门禁的会话 pin 面）。
 *
 * ADR-011 / f7-scope-ledger 增补 10 #3：`capability` 是可扩展 registry key，
 * 不在 canonical schema 冻结枚举；unknown kind 属 schema 负例，unknown
 * **capability/target** 属服务端 Presenter/validator 门禁——必须以
 * session-pinned registry 校验每个 workspace presentation action，unknown 即
 * 零事件、零状态变更、零 delivery。
 *
 * 「session-pinned」语义：
 * - registry 内容在 session_started 写入时由 pinned task binding 确定性导出
 *   （golden：approved plan → buildGoldenWorkspaceCatalogV5 产物），并经
 *   workspace_catalog_pin.content_hash 对账（不符 fail closed，不接受未经
 *   对账的任意 registry）；
 * - fold 侧（reducer）经 codec.resolveFoldContext 拿到 registry——append 事务
 *   与 verified rebuild 都从已提交 session_started pin 重解析，同一 registry
 *   裁决同一事件流（在线=重放，无第二份真源）；
 * - target 宇宙 = authored 基座元素 id（catalog.baseGeometry）∪ Board BE- 条目
 *   ∪ 任务声明的构图输出 id（resolver 侧从 approved 构造资源补充；测试可注入
 *   合成宇宙）。
 *
 * 与 F3 静态注册表（WorkspaceCapabilityRegistryV5）的关系：静态表仍裁决
 * workspace 命令执行（Step 3 orchestrator 经 F3 validator 应用语义）；本
 * registry 是 v6 presentation 流入流前的会话级 fail-closed 面——两层都拒绝
 * unknown capability（defense in depth，kernel 测试锁定本层）。
 */
import type { GoldenWorkspaceCatalog } from "../tutorOrchestration/GoldenWorkspaceCatalog";
import { listWorkspaceCapabilities } from "./WorkspaceCapabilityRegistryV5";

export interface SessionPinnedCapabilitySpec {
  readonly capability: string;
  readonly surface: "geometry" | "solution_board";
  readonly origin: "tutor" | "student";
}

export interface SessionPinnedCapabilityRegistry {
  /** capability → 登记面（surface/origin 必须同时匹配；unknown key = 未登记）。 */
  readonly capabilities: ReadonlyMap<string, SessionPinnedCapabilitySpec>;
  /** 本会话授权的 target id 宇宙（authored 基座 + Board 条目 + 任务声明构图输出）。 */
  readonly targetUniverse: ReadonlySet<string>;
}

/** 合成 registry（kernel 测试用：不依赖真实 plan 导入）。 */
export function syntheticSessionPinnedRegistry(
  capabilities: readonly SessionPinnedCapabilitySpec[],
  targetUniverse: readonly string[],
): SessionPinnedCapabilityRegistry {
  return {
    capabilities: new Map(capabilities.map((spec) => [spec.capability, spec])),
    targetUniverse: new Set(targetUniverse),
  };
}

/**
 * 从 golden catalog 确定性构造 session-pinned registry（resolver 侧装配；
 * 同一 imported plan → 同一 registry，与 catalog pin 一致）。
 *
 * 能力面 = F3 静态注册表中 tutor-origin 能力（presentation action origin 恒为
 * tutor；student-origin 能力属学生命令链，经 F3 validator 校验，不入本表）。
 * target 宇宙 = baseGeometry authored 元素 ∪ Board BE- 条目；任务声明的构图
 * 输出 id（如 RG 辅助构造）由调用方以 extraTargetIds 并入。
 */
export function buildSessionPinnedCapabilityRegistry(
  golden: Pick<GoldenWorkspaceCatalog, "catalog">,
  extraTargetIds: readonly string[] = [],
): SessionPinnedCapabilityRegistry {
  const tutorCapabilities = listWorkspaceCapabilities()
    .filter((spec) => spec.origin === "tutor")
    .map((spec) => ({ capability: spec.capability, surface: spec.surface, origin: spec.origin }));
  const targets = new Set<string>(extraTargetIds);
  const baseGeometry = golden.catalog.baseGeometry;
  if (baseGeometry) {
    for (const point of baseGeometry.points) targets.add(point.id);
    for (const segment of baseGeometry.segments) targets.add(segment.id);
  }
  for (const entry of golden.catalog.boardEntries) targets.add(entry.entryId);
  return {
    capabilities: new Map(tutorCapabilities.map((spec) => [spec.capability, spec])),
    targetUniverse: targets,
  };
}

/**
 * presentation workspace action 的登记校验（reducer capability 门禁的判定核）：
 * capability ∈ registry 且 surface/origin 匹配；target_ids（若携带）⊆ 会话
 * target 宇宙。任一不满足 → 返回首个错误（调用方 fail closed 整批拒绝）。
 */
export function resolveSessionPresentationAction(
  registry: SessionPinnedCapabilityRegistry,
  action: { capability: string; surface: "geometry" | "solution_board"; target_ids?: string[] },
): { ok: true } | { ok: false; reason: string } {
  const spec = registry.capabilities.get(action.capability);
  if (!spec) {
    return { ok: false, reason: `capability ${action.capability} is not registered in the session-pinned registry` };
  }
  if (spec.surface !== action.surface || spec.origin !== "tutor") {
    return {
      ok: false,
      reason: `capability ${action.capability} is registered for surface=${spec.surface}/origin=${spec.origin}, not surface=${action.surface}/origin=tutor`,
    };
  }
  if (action.target_ids) {
    for (const target of action.target_ids) {
      if (!registry.targetUniverse.has(target)) {
        return { ok: false, reason: `target ${target} is outside the session-pinned target universe` };
      }
    }
  }
  return { ok: true };
}

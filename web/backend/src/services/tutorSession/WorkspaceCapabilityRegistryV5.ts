/**
 * Workspace Capability Registry（F3 — Workspace 状态转换内核）。
 *
 * 统一 action envelope 的能力面：WorkspaceSurfaceAction（origin=tutor）与
 * StudentWorkspaceCommand（origin=student）共用本注册表（ADR-008 §2 同一外层
 * 安全边界）。surface validator 只接受或拒绝命令，不选择 TeachingBeat、不
 * 推断教学重点（ADR-008 不变量 3）。
 *
 * 能力语义（f3-scope-ledger「Workspace 侧 reducer 约定」）：
 * - geometry.construct / geometry.annotate / geometry.draft：command 形状 =
 *   既有 Geometry 内核 DomainCommand（web/shared/actionWorld.ts，复用不重写），
 *   新元素 id 前缀纪律（pt-/seg-/line-/label-）在此强制（View kind 纯推导依赖）；
 * - board.reveal-entry：reveal_scope 必须声明内容暴露级别；final 类条目要求
 *   reveal_scope=final_result 且 gate 已满足（truth boundary fail closed）；
 * - similarity.foreground-segment：presentation-only（canonical fixture 能力），
 *   不改 canonical state、不推 workspace revision；
 * - 学生命令产出一律入 draft（student_authored），board 生命周期
 *   none→attempted→confirmed（attempted≠confirmed）。
 *
 * 未登记 capability / surface 与 origin 不匹配 / interaction_mode 越界 →
 * fail closed（拒绝，无副作用）。mode 约束（R2 2026-08-31）：session mode
 * 来源 = catalog.initialInteractionMode（Plan/任务级定义）→ 运行期由
 * workspace.lock-interaction 与 session_completed（teaching 终态）迁移；locked
 * = review 只读，任何能力（tutor/student）一律拒绝——ADR-007 §4 五重校验
 * （schema/capability/target/mode/truth-leak）的 mode 腿。Assessment 完整
 * session 入口隔离与 Presenter/工具禁用集成归 F6（f3-scope-ledger 登记门禁）。
 */
import type { DomainCommand } from "../../../../shared/actionWorld";

export type WorkspaceSurfaceKind = "geometry" | "solution_board";
export type WorkspaceOrigin = "tutor" | "student";

/**
 * workspace interaction mode（state/v1 geometry.interaction_mode；F3 ledger 冻结
 * 口径：catalog.initialInteractionMode=Plan/任务级定义，默认 construction；
 * workspace.lock-interaction（tutor 决策）与 session_completed（teaching 终态）
 * 置 locked；locked=review 只读——任何能力都不得执行）。
 */
export type WorkspaceInteractionMode = "free" | "construction" | "locked";

export type WorkspaceViewElementKind =
  | "point"
  | "segment"
  | "line"
  | "circle"
  | "polygon"
  | "label"
  | "measure";

/** DomainCommand 的唯一输出元素 id（构图/标注命令各恰有一个）。 */
export function domainCommandOutputId(command: DomainCommand): string {
  switch (command.type) {
    case "construct-parallel":
      return command.outputLineId;
    case "construct-carrier":
      return command.outputLineId;
    case "intersect-lines":
      return command.outputPointId;
    case "set-segment-label":
      return command.markId;
    case "set-correspondence-mark":
      return command.markId;
    case "set-emphasis":
      return command.markId;
  }
}

/** 新元素 id 前缀纪律（validator 强制；View kind 由前缀纯推导）。 */
const OUTPUT_ID_PREFIX_BY_COMMAND_TYPE: Record<DomainCommand["type"], WorkspaceViewElementKind> = {
  "construct-parallel": "line",
  "construct-carrier": "segment",
  "intersect-lines": "point",
  "set-segment-label": "label",
  "set-correspondence-mark": "label",
  "set-emphasis": "label",
};

const PREFIX_RULES: Array<{ prefix: string; kind: WorkspaceViewElementKind }> = [
  { prefix: "pt-", kind: "point" },
  { prefix: "seg-", kind: "segment" },
  { prefix: "line-", kind: "line" },
  { prefix: "circle-", kind: "circle" },
  { prefix: "poly-", kind: "polygon" },
  { prefix: "label-", kind: "label" },
  { prefix: "val-", kind: "measure" },
];

/** id → View kind（catalog authored 映射优先，缺省按前缀纪律推导；纯函数）。 */
export function elementKindFromId(
  elementId: string,
  authoredKinds?: Readonly<Record<string, WorkspaceViewElementKind>>,
): WorkspaceViewElementKind {
  const authored = authoredKinds?.[elementId];
  if (authored) return authored;
  for (const rule of PREFIX_RULES) {
    if (elementId.startsWith(rule.prefix)) return rule.kind;
  }
  return "label";
}

/** 值输入短名剥离的前缀集（含 canonical fixture 风格的 "segment-"）。 */
const STRIP_PREFIXES = ["segment-", "seg-", "line-", "point-", "pt-", "label-", "val-", "circle-", "poly-"];

/** 去掉 surface 前缀得到短名（学生值输入以短名为键，如 segment-AD → AD）。 */
export function shortElementName(elementId: string): string {
  for (const prefix of STRIP_PREFIXES) {
    if (elementId.startsWith(prefix)) return elementId.slice(prefix.length);
  }
  return elementId;
}

function requiredPrefixFor(commandType: DomainCommand["type"]): string {
  const kind = OUTPUT_ID_PREFIX_BY_COMMAND_TYPE[commandType];
  return (PREFIX_RULES.find((rule) => rule.kind === kind) ?? { prefix: "" }).prefix;
}

/** 构图/标注命令的输出 id 前缀纪律校验（fail closed）。 */
export function checkDomainCommandIdDiscipline(commands: readonly DomainCommand[]): string[] {
  const errors: string[] = [];
  for (const command of commands) {
    const prefix = requiredPrefixFor(command.type);
    const outputId = domainCommandOutputId(command);
    if (!prefix || !outputId.startsWith(prefix)) {
      errors.push(`${command.type} 输出元素 id ${outputId} 必须以 ${prefix} 前缀命名`);
    }
  }
  return errors;
}

// --------------------------------------------------------------------------- //
// 能力效果类别（executor 与 workspace reducer 共用；effects 在
// WorkspaceActionRuntimeV5 / WorkspaceRuntimeReducerV5 实现）
// --------------------------------------------------------------------------- //

export type WorkspaceCapabilityEffect =
  | "geometry_construct_tutor" // tutor 构图（construct-*）→ committed
  | "geometry_annotate_tutor" // tutor 标注（set-*）→ committed
  | "geometry_accept_draft_tutor" // tutor 接受学生草稿 → draft→committed
  | "geometry_foreground_tutor" // tutor 高亮（presentation-only，零状态效果）
  | "geometry_draft_student" // 学生构图/标注 → draft
  | "geometry_mark_known_student" // 学生标记已知线段（set-segment-label 草稿）
  | "board_explain_tutor"
  | "board_reveal_tutor" // hidden→visible（reveal_scope/truth 边界校验）
  | "board_activate_tutor" // visible→active（至多一个 active）
  | "board_attempt_student" // attempt none→attempted
  | "board_confirm_student" // attempt attempted→confirmed
  | "workspace_lock_tutor"; // interaction_mode→locked

export interface WorkspaceCapabilitySpec {
  readonly capability: string;
  readonly surface: WorkspaceSurfaceKind;
  readonly origin: WorkspaceOrigin;
  readonly effect: WorkspaceCapabilityEffect;
  /**
   * mode 约束（ADR-007 §4 五重校验之一；R2 2026-08-31 补齐）：当前
   * workspace interaction_mode 不在允许集 → fail closed（student 命令发
   * intent+outcome(rejected) 事实但零状态效果；tutor 动作零事实）。
   * locked（review/session 终态）拒绝一切能力。
   */
  readonly allowedInteractionModes: readonly WorkspaceInteractionMode[];
}

/** 未锁定模式集（free/construction；locked 一律拒绝——review 只读）。 */
const UNLOCKED_MODES: readonly WorkspaceInteractionMode[] = ["free", "construction"];

const REGISTRY: ReadonlyArray<WorkspaceCapabilitySpec> = [
  { capability: "board.explain", surface: "solution_board", origin: "tutor", effect: "board_explain_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "geometry.construct", surface: "geometry", origin: "tutor", effect: "geometry_construct_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "geometry.annotate", surface: "geometry", origin: "tutor", effect: "geometry_annotate_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "geometry.accept-draft", surface: "geometry", origin: "tutor", effect: "geometry_accept_draft_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "similarity.foreground-segment", surface: "geometry", origin: "tutor", effect: "geometry_foreground_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "board.reveal-entry", surface: "solution_board", origin: "tutor", effect: "board_reveal_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "board.activate-entry", surface: "solution_board", origin: "tutor", effect: "board_activate_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "workspace.lock-interaction", surface: "geometry", origin: "tutor", effect: "workspace_lock_tutor", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "geometry.draft", surface: "geometry", origin: "student", effect: "geometry_draft_student", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "similarity.mark-known-segments", surface: "geometry", origin: "student", effect: "geometry_mark_known_student", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "board.submit-attempt", surface: "solution_board", origin: "student", effect: "board_attempt_student", allowedInteractionModes: UNLOCKED_MODES },
  { capability: "board.confirm-entry", surface: "solution_board", origin: "student", effect: "board_confirm_student", allowedInteractionModes: UNLOCKED_MODES },
];

const BY_CAPABILITY: ReadonlyMap<string, WorkspaceCapabilitySpec> = new Map(
  REGISTRY.map((spec) => [spec.capability, spec]),
);

/** 能力解析：未登记 / surface 不符 / origin 不符 → undefined（调用方 fail closed）。 */
export function resolveWorkspaceCapability(
  capability: string,
  surface: WorkspaceSurfaceKind,
  origin: WorkspaceOrigin,
): WorkspaceCapabilitySpec | undefined {
  const spec = BY_CAPABILITY.get(capability);
  if (!spec) return undefined;
  if (spec.surface !== surface || spec.origin !== origin) return undefined;
  return spec;
}

export function listWorkspaceCapabilities(): readonly WorkspaceCapabilitySpec[] {
  return REGISTRY;
}

/** reveal_scope 与 Board 条目 reveal 要求的匹配（truth boundary 的 scope 腿）。 */
export type BoardRevealScope = "none" | "target_highlight" | "step_narration" | "intermediate_result" | "final_result";
export type BoardRevealRequirement = "intermediate" | "final";

export interface RevealBoundaryInput {
  revealScope: BoardRevealScope;
  requirement: BoardRevealRequirement;
  /**
   * 五级绑定（Plan→Protocol→Beat→Gate→resource）裁决结果（R2 2026-08-31）：
   * 由 WorkspaceRuntimeReducerV5.authorizeBoardRevealBinding 按 fold 内
   * gate ledger（committed gate_evaluated/policy_decision_made + cursor）+
   * catalog 条目 revealGate 绑定全链判定；不再是「只比 teaching phase」。
   */
  gateSatisfied: boolean;
}

export interface RevealBoundaryVerdict {
  allowed: boolean;
  reason?: string;
}

export function checkBoardRevealBoundary(input: RevealBoundaryInput): RevealBoundaryVerdict {
  if (input.revealScope === "none") {
    return { allowed: false, reason: "board reveal 必须声明内容暴露级别（reveal_scope=none 非法——无声明呈现 hidden 内容）" };
  }
  if (input.requirement === "final") {
    if (input.revealScope !== "final_result") {
      return { allowed: false, reason: "final 类条目只允许 reveal_scope=final_result" };
    }
    if (!input.gateSatisfied) {
      return { allowed: false, reason: "final_result 越界：gate 未满足（须 gate_satisfied 后的核验 Beat）" };
    }
    return { allowed: true };
  }
  // intermediate 类条目：任一内容级 scope 合法（final 亦覆盖更严核验路径）
  const contentScopes: BoardRevealScope[] = ["step_narration", "intermediate_result", "final_result"];
  if (!contentScopes.includes(input.revealScope)) {
    return { allowed: false, reason: `intermediate 类条目不允许 reveal_scope=${input.revealScope}` };
  }
  return { allowed: true };
}

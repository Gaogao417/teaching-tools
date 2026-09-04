/**
 * WorkspaceRuntimeState v1 纯 reducer（F3 — Workspace 状态转换内核）。
 *
 * State = f(catalog/seed + 有序 committed v5 events) 的纯函数：
 * - 输出合同：state/v1/workspace-runtime-state（PRDS 真源 contracts/schemas/state/v1/
 *   workspace-runtime-state.schema.json；TS 镜像 workspaceRuntimeStateV1Schema）；
 * - 在线与重建共用同一 fold（G3 结构性保证，镜像 F2 约定）：
 *   WorkspaceSessionRuntimeV5（逐批增量）与 WorkspaceStateRebuilderV5（全量重放）
 *   都只经 initialWorkspaceFold / applyWorkspaceV5Event / foldWorkspaceV5Events，
 *   无第二条 workspace state machine；
 * - 六态区分：issued（workspace_surface_action_issued / student_intent_recorded
 *   内嵌 workspace_command）零状态效果；仅 action_outcome_recorded outcome=
 *   completed 落效果并推进 workspace revision（恰 +1）；rejected/interrupted/
 *   failed 零状态效果——与 F2 reducer 约定 5 逐字对齐；
 * - 流不变量 fail closed（WORKSPACE_STREAM_INVARIANT 家族）：孤儿完成（outcome
 *   无对应 issued）、resulting_revision 违反「恰 +1 或不变」、completed 的
 *   student command 内嵌 expected_workspace_revision 与注册时不符、批间污染
 *   （pending 注册后 revision 被其它 transition 推走）、重复 action_id/command_id、
 *   未登记 capability——这些流不可能由执行器产生，重建时即损坏。
 *
 * gate 上下文（R2 2026-08-31 五级绑定改造）：fold context 内维护
 * WorkspaceGateLedger——由 committed 事件本身增量推导（session_started pin /
 * gate_evaluated / policy_decision_made / session_completed），在线与重建走
 * 同一推导（旧「teaching phase === gate_satisfied」单点比较已删除）。final
 * reveal 授权 = `Plan → Protocol → Beat → Gate → resource` 全链绑定：
 * Plan（catalog.taskId 对 session_started.task_id）、Protocol（条目
 * revealGate.protocolId ∈ session_started.protocol_refs）、Beat（gate 绑定
 * Beat == 当前 cursor Beat——Beat 推进即 stale-gate）、Gate（绑定 gate 于绑定
 * Beat 有 committed satisfied 评估）、resource（授权逐条目声明，不得跨条目
 * 挪用——wrong-resource 拒绝）；且 tutor 动作必须有 committed decision 因果
 * （ADR-007 不变量 4），decision/action Beat 必须等于当前 Beat。
 */
import type { z } from "zod";
import { workspaceRuntimeStateV1Schema } from "../../../../shared/canonical";
import {
  applyDomainCommands,
  isDomainCommand,
  type DomainCommand,
} from "../../../../shared/actionWorld";
import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { StoredV5Event } from "./TutorSessionEventV5";
import {
  checkDomainCommandIdDiscipline,
  domainCommandOutputId,
  resolveWorkspaceCapability,
  shortElementName,
  type BoardRevealScope,
  type WorkspaceCapabilitySpec,
} from "./WorkspaceCapabilityRegistryV5";
import {
  boardEntryById,
  type WorkspacePresentationCatalogV5,
  type WorkspaceSeedOverlay,
} from "./WorkspacePresentationCatalogV5";

/** state/v1 WorkspaceRuntimeState（canonical Zod 推导类型，唯一形状）。 */
export type WorkspaceRuntimeStateV5 = z.infer<typeof workspaceRuntimeStateV1Schema>;

/** 流不变量违反（重建 fail closed 分类）。 */
export class WorkspaceRuntimeReducerError extends Error {
  constructor(readonly code: "WORKSPACE_STREAM_INVARIANT", message: string, readonly sequence?: number) {
    super(message);
    this.name = "WorkspaceRuntimeReducerError";
  }
}

/** 执行期拒绝（executor 捕获 → rejected outcome；fold 到达即流损坏）。 */
export class WorkspaceTransitionRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "WorkspaceTransitionRejectedError";
  }
}

/** tutor 侧已提交 WSA 事件的 payload 窄形状（canonical 已校验）。 */
export interface PendingTutorActionPayload {
  action_id: string;
  decision_id: string;
  beat_id?: string;
  surface: "geometry" | "solution_board";
  capability: string;
  target_ids?: string[];
  command_payload?: string;
  reveal_scope: BoardRevealScope;
  presentation_only?: boolean;
}

/** student_intent_recorded 内嵌 workspace_command 窄形状（canonical 已校验）。 */
export interface PendingStudentCommandBody {
  command_id: string;
  surface: "geometry" | "solution_board";
  capability: string;
  target_ids: string[];
  params?: Record<string, unknown>;
  expected_workspace_revision: number;
  client_command_id: string;
}

export interface WorkspaceFoldContext {
  /** tutor 已提交构图/标注命令（world 组合与 dry-run 的真源序列）。 */
  tutorCommands: DomainCommand[];
  /** 学生草稿命令（student_authored 世界）。 */
  draftCommands: DomainCommand[];
  pendingTutorActions: ReadonlyMap<string, { payload: PendingTutorActionPayload; observedRevision: number }>;
  pendingStudentCommands: ReadonlyMap<string, { command: PendingStudentCommandBody; observedRevision: number }>;
  /** gate/decision 账本（reveal 授权五级绑定的裁决输入；事件增量推导）。 */
  gateLedger: WorkspaceGateLedger;
}

export interface WorkspaceFold {
  state: WorkspaceRuntimeStateV5;
  context: WorkspaceFoldContext;
}

// --------------------------------------------------------------------------- //
// gate ledger（Plan → Protocol → Beat → Gate → resource 五级绑定的裁决输入）
// --------------------------------------------------------------------------- //

/** committed gate_evaluated 评估事实（按 `${gateId}@${beatId}` 键）。 */
export interface WorkspaceGateEvaluation {
  readonly gateId: string;
  readonly beatId: string;
  readonly satisfied: boolean;
  readonly sequence: number;
  readonly evidenceSequence?: number;
}

/** committed policy_decision_made 决策事实（按 decision_id 键）。 */
export interface WorkspaceGateDecision {
  readonly decisionId: string;
  readonly protocolId: string;
  readonly beatId: string;
  readonly toBeatId?: string;
  readonly sequence: number;
}

export interface WorkspaceGateLedger {
  readonly evaluations: ReadonlyMap<string, WorkspaceGateEvaluation>;
  readonly decisions: ReadonlyMap<string, WorkspaceGateDecision>;
  /** 主线 cursor（session_started.initial_cursor 起步；to_beat_id 决策推进 Beat）。 */
  readonly cursor: { protocolId: string; beatId: string };
  /** session_started pin 的 protocol refs（Plan → Protocol 绑定）。 */
  readonly pinnedProtocols: readonly string[];
  /** session_started pin 的 task（Plan → catalog.taskId 对账）。 */
  readonly pinnedTaskId?: string;
  /** session_completed 终态（终态后 reveal/命令一律非法——interaction locked）。 */
  readonly completed: boolean;
}

/** session_started payload 的账本种子输入（窄形状，canonical 已校验）。 */
export interface WorkspaceSessionStartedLedgerInput {
  task_id?: string;
  protocol_refs?: ReadonlyArray<{ artifact_id: string }>;
  initial_cursor?: { protocol_id: string; beat_id: string };
}

export function emptyWorkspaceGateLedger(): WorkspaceGateLedger {
  return {
    evaluations: new Map(),
    decisions: new Map(),
    cursor: { protocolId: "", beatId: "" },
    pinnedProtocols: [],
    completed: false,
  };
}

/** 从 session_started payload 播种账本（Plan/Protocol pin + 初始 cursor）。 */
export function seedWorkspaceGateLedger(
  sessionStarted: WorkspaceSessionStartedLedgerInput,
): WorkspaceGateLedger {
  return {
    evaluations: new Map(),
    decisions: new Map(),
    cursor: {
      protocolId: sessionStarted.initial_cursor?.protocol_id ?? "",
      beatId: sessionStarted.initial_cursor?.beat_id ?? "",
    },
    pinnedProtocols: (sessionStarted.protocol_refs ?? []).map((ref) => ref.artifact_id),
    ...(sessionStarted.task_id !== undefined ? { pinnedTaskId: sessionStarted.task_id } : {}),
    completed: false,
  };
}

function cloneLedger(ledger: WorkspaceGateLedger): WorkspaceGateLedger {
  return {
    evaluations: new Map(ledger.evaluations),
    decisions: new Map(ledger.decisions),
    cursor: { ...ledger.cursor },
    pinnedProtocols: ledger.pinnedProtocols,
    ...(ledger.pinnedTaskId !== undefined ? { pinnedTaskId: ledger.pinnedTaskId } : {}),
    completed: ledger.completed,
  };
}

export interface BoardRevealAuthorization {
  allowed: boolean;
  reason?: string;
}

/**
 * final reveal 的五级绑定授权（R2 2026-08-31；替换「只比 teaching phase」）：
 * Plan（catalog.taskId 对 session_started.task_id）→ Protocol（条目绑定
 * protocolId ∈ pinned protocol refs）→ Beat（绑定 Beat == 当前 cursor Beat；
 * Beat 推进后即 stale-gate）→ Gate（绑定 gate@绑定 Beat 有 committed
 * satisfied 评估）→ resource（本函数逐条目调用：授权声明即条目自身
 * revealGate，其它条目/其它 gate 的满足事实不得挪用）。
 */
export function authorizeBoardRevealBinding(args: {
  catalog: WorkspacePresentationCatalogV5;
  ledger: WorkspaceGateLedger;
  entryId: string;
}): BoardRevealAuthorization {
  const entry = boardEntryById(args.catalog, args.entryId);
  if (!entry) {
    return { allowed: false, reason: `illegal target：未知 Board 条目 ${args.entryId}` };
  }
  // gate 授权只约束 final 类条目（truth boundary）；intermediate 类的暴露
  // 边界是 reveal_scope 匹配（reducer 分支保证本函数只对 final 条目被依赖）。
  if (entry.revealRequirement !== "final") {
    return { allowed: true };
  }
  const binding = entry.revealGate;
  if (!binding) {
    return {
      allowed: false,
      reason: `条目 ${entry.entryId} 为 final 但 catalog 未声明 revealGate（缺 reveal 语义 fail closed）`,
    };
  }
  // Plan：catalog 与 session pin 的任务一致。
  if (args.ledger.pinnedTaskId !== undefined && args.ledger.pinnedTaskId !== args.catalog.taskId) {
    return {
      allowed: false,
      reason: `Plan 不符：catalog.taskId=${args.catalog.taskId} ≠ session_started.task_id=${args.ledger.pinnedTaskId}`,
    };
  }
  // Protocol：授权协议必须被本会话 pin。
  if (!args.ledger.pinnedProtocols.includes(binding.protocolId)) {
    return {
      allowed: false,
      reason: `Protocol 未 pin：${binding.protocolId} 不在 session_started.protocol_refs`,
    };
  }
  // Beat：gate 属于当前 Beat（cursor 已推进 → stale-gate）。
  if (args.ledger.cursor.beatId !== binding.beatId) {
    return {
      allowed: false,
      reason: `stale-gate/Beat 不符：条目 ${entry.entryId} 绑定 ${binding.gateId}@${binding.beatId}，当前 cursor Beat=${args.ledger.cursor.beatId}`,
    };
  }
  // Gate：绑定 gate 于绑定 Beat 有 committed satisfied 评估。
  const evaluation = args.ledger.evaluations.get(`${binding.gateId}@${binding.beatId}`);
  if (!evaluation || !evaluation.satisfied) {
    return {
      allowed: false,
      reason: `gate 未满足：条目 ${entry.entryId} 绑定 ${binding.gateId}@${binding.beatId}（五级绑定：其它 gate/Beat 的满足事实不得挪用）`,
    };
  }
  return { allowed: true };
}

/**
 * tutor 动作决策因果（ADR-007 不变量 4：每个实际呈现动作必须关联
 * TutorPolicyDecision、Beat）：decision 必须是 committed 事实，且产出 Beat ==
 * 当前 cursor Beat；action 携带 beat_id 时必须等于当前 Beat。
 */
function assertTutorActionCausation(
  action: PendingTutorActionPayload,
  ledger: WorkspaceGateLedger,
): void {
  const decision = ledger.decisions.get(action.decision_id);
  if (!decision) {
    throw new WorkspaceTransitionRejectedError(
      `wrong-decision-causation：decision ${action.decision_id} 无 committed policy_decision_made 因果（ADR-007 不变量 4）`,
    );
  }
  if (decision.beatId !== ledger.cursor.beatId) {
    throw new WorkspaceTransitionRejectedError(
      `wrong-beat：决策 ${action.decision_id} 产出 Beat=${decision.beatId} ≠ 当前 Beat=${ledger.cursor.beatId}`,
    );
  }
  if (action.beat_id !== undefined && action.beat_id !== ledger.cursor.beatId) {
    throw new WorkspaceTransitionRejectedError(
      `wrong-beat：action.beat_id=${action.beat_id} ≠ 当前 Beat=${ledger.cursor.beatId}`,
    );
  }
}

function cloneState(state: WorkspaceRuntimeStateV5): WorkspaceRuntimeStateV5 {
  return {
    ...state,
    geometry: {
      ...state.geometry,
      committed_element_ids: [...state.geometry.committed_element_ids],
      draft_element_ids: [...state.geometry.draft_element_ids],
    },
    solution_board: {
      ...state.solution_board,
      entries: state.solution_board.entries.map((entry) => ({ ...entry })),
    },
  };
}

function cloneContext(context: WorkspaceFoldContext): WorkspaceFoldContext {
  return {
    tutorCommands: [...context.tutorCommands],
    draftCommands: [...context.draftCommands],
    pendingTutorActions: new Map(context.pendingTutorActions),
    pendingStudentCommands: new Map(context.pendingStudentCommands),
    gateLedger: cloneLedger(context.gateLedger),
  };
}

/**
 * 初始 workspace state：catalog 全量条目 hidden/none + seed 覆写（bootstrap）。
 * sessionStarted 用于播种 gate ledger（Plan/Protocol pin + 初始 cursor）；
 * 缺省时空账本（无 pin ⇒ 无决策因果可证 ⇒ tutor 动作 fail closed）。
 */
export function initialWorkspaceFold(
  sessionId: string,
  catalog: WorkspacePresentationCatalogV5,
  seed?: WorkspaceSeedOverlay,
  sessionStarted?: WorkspaceSessionStartedLedgerInput,
): WorkspaceFold {
  return {
    state: {
      schema: "ai_teaching_workspace_runtime_state/v1",
      session_id: sessionId,
      revision: 0,
      geometry: {
        committed_element_ids: [...(seed?.committedElementIds ?? [])],
        draft_element_ids: [],
        interaction_mode: seed?.interactionMode ?? catalog.initialInteractionMode,
      },
      solution_board: {
        entries: catalog.boardEntries.map((entry) => ({
          entry_id: entry.entryId,
          visibility: seed?.boardVisibility?.[entry.entryId] ?? "hidden",
          attempt_state: "none" as const,
          presentation_group: entry.presentationGroup,
        })),
        ...(catalog.canonicalPathEntryIds.length
          ? { canonical_path_entry_ids: [...catalog.canonicalPathEntryIds] }
          : {}),
      },
    },
    context: {
      tutorCommands: [],
      draftCommands: [],
      pendingTutorActions: new Map(),
      pendingStudentCommands: new Map(),
      gateLedger: sessionStarted ? seedWorkspaceGateLedger(sessionStarted) : emptyWorkspaceGateLedger(),
    },
  };
}

// --------------------------------------------------------------------------- //
// 已知元素与世界组合（Geometry 内核复用：applyDomainCommands dry-run）
// --------------------------------------------------------------------------- //

function knownElementIds(fold: WorkspaceFold, catalog: WorkspacePresentationCatalogV5): Set<string> {
  const known = new Set<string>();
  const base = catalog.baseGeometry;
  if (base) {
    base.points.forEach((point) => known.add(point.id));
    base.segments.forEach((segment) => known.add(segment.id));
  }
  fold.state.geometry.committed_element_ids.forEach((id) => known.add(id));
  fold.state.geometry.draft_element_ids.forEach((id) => known.add(id));
  return known;
}

function authoredSegmentIds(catalog: WorkspacePresentationCatalogV5): Set<string> {
  return new Set((catalog.baseGeometry?.segments ?? []).map((segment) => segment.id));
}

function composeWorld(
  catalog: WorkspacePresentationCatalogV5,
): { revision: number; geometry: TopicGeometryModel | undefined } {
  return { revision: 0, geometry: catalog.baseGeometry };
}

/** 命令 dry-run（抛 WorkspaceTransitionRejectedError 于非法引用/退化/重复输出）。 */
function dryRunCommand(
  fold: WorkspaceFold,
  catalog: WorkspacePresentationCatalogV5,
  command: DomainCommand,
  worldCommands: readonly DomainCommand[],
): void {
  if (!catalog.baseGeometry) {
    throw new WorkspaceTransitionRejectedError("workspace 无 authored 题图，构图命令非法（missing-geometry）");
  }
  try {
    applyDomainCommands(composeWorld(catalog), [...worldCommands, command]);
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new WorkspaceTransitionRejectedError(`Geometry 内核拒绝命令（${reason}）`);
  }
}

function parseCommandPayload(payload: string | undefined): DomainCommand {
  if (!payload) throw new WorkspaceTransitionRejectedError("geometry 命令能力必须携带 command_payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new WorkspaceTransitionRejectedError("command_payload 不是合法 JSON");
  }
  if (!isDomainCommand(parsed)) {
    throw new WorkspaceTransitionRejectedError("command_payload 不是合法 DomainCommand");
  }
  return parsed;
}

const CONSTRUCT_TYPES = new Set(["construct-parallel", "construct-carrier", "intersect-lines"]);
const ANNOTATE_TYPES = new Set(["set-segment-label", "set-correspondence-mark", "set-emphasis"]);

// --------------------------------------------------------------------------- //
// 效果应用（executor 与 fold 共用同一组纯函数——结构性保证）
// --------------------------------------------------------------------------- //

export interface WorkspaceEffectArgs {
  fold: WorkspaceFold;
  catalog: WorkspacePresentationCatalogV5;
  spec: WorkspaceCapabilitySpec;
  /** tutor: WSA payload；student: command body。 */
  action: PendingTutorActionPayload | PendingStudentCommandBody;
}

function asTutorAction(action: WorkspaceEffectArgs["action"]): PendingTutorActionPayload {
  if (!("decision_id" in action)) {
    throw new WorkspaceTransitionRejectedError("内部错误：tutor 效果收到 student 命令形状");
  }
  return action;
}

function asStudentCommand(action: WorkspaceEffectArgs["action"]): PendingStudentCommandBody {
  if ("decision_id" in action) {
    throw new WorkspaceTransitionRejectedError("内部错误：student 效果收到 tutor 动作形状");
  }
  return action;
}

/** 应用一个能力效果；返回 changed=false 表示 presentation-only（零 revision 推进）。
 *
 * 前置校验（五重校验的 capability 后两腿在此合流，schema/capability 在 executor）：
 * - mode：interaction_mode 不在 capability 允许集 → 拒绝（locked=review 只读）；
 * - tutor 决策因果：decision 须为 committed 事实且 Beat 对齐（ADR-007 不变量 4）；
 * - target/truth 边界在各 effect 分支内逐项校验（final reveal 走五级绑定授权）。
 */
export function applyWorkspaceEffect(args: WorkspaceEffectArgs): { fold: WorkspaceFold; changed: boolean } {
  const { catalog, spec } = args;
  const state = cloneState(args.fold.state);
  const context = cloneContext(args.fold.context);
  const next: WorkspaceFold = { state, context };
  const known = knownElementIds(args.fold, catalog);

  // canonical state/v1 的 interaction_mode 可选（缺省=construction，f3 ledger 约定 1）。
  const interactionMode = state.geometry.interaction_mode ?? "construction";
  if (!spec.allowedInteractionModes.includes(interactionMode)) {
    throw new WorkspaceTransitionRejectedError(
      `mode 不匹配：interaction_mode=${interactionMode} 不允许 ${spec.capability}（${spec.origin}；fail closed 零状态效果——locked=review 只读）`,
    );
  }
  if (spec.origin === "tutor") {
    assertTutorActionCausation(asTutorAction(args.action), args.fold.context.gateLedger);
  }

  // F7 Step 3 rework（additive）：presentation-only 重呈现——服务端语义已在
  // 先前 sequence 的 applied 落定（浏览器 failed/interrupted 后 retry_recovery
  // 重新呈现该动作）。零效果、零 revision（changed=false）；mode/causation 校验
  // 已过，target 存在性仍校验。v5 流不产生 presentation_only 动作，行为零影响。
  if (spec.origin === "tutor" && asTutorAction(args.action).presentation_only === true) {
    const tutorAction = asTutorAction(args.action);
    const targets = tutorAction.target_ids ?? [];
    if (spec.surface === "solution_board") {
      const missing = targets.filter((id) => !state.solution_board.entries.some((entry) => entry.entry_id === id));
      if (missing.length) {
        throw new WorkspaceTransitionRejectedError(`illegal target：未知 Board 条目 ${missing.join(", ")}`);
      }
    } else if (targets.length) {
      const missing = targets.filter((id) => !known.has(id));
      if (missing.length) {
        throw new WorkspaceTransitionRejectedError(`illegal target：元素不存在 ${missing.join(", ")}`);
      }
    }
    return { fold: next, changed: false };
  }

  const commitGeometryCommand = (command: DomainCommand, owner: "tutor" | "student"): void => {
    const outputId = domainCommandOutputId(command);
    if (known.has(outputId)) {
      throw new WorkspaceTransitionRejectedError(`输出元素 ${outputId} 已存在（duplicate-output）`);
    }
    const discipline = checkDomainCommandIdDiscipline([command]);
    if (discipline.length) {
      throw new WorkspaceTransitionRejectedError(discipline.join("; "));
    }
    const worldCommands = owner === "tutor" ? context.tutorCommands : [...context.tutorCommands, ...context.draftCommands];
    dryRunCommand(args.fold, catalog, command, worldCommands);
    if (owner === "tutor") {
      context.tutorCommands = [...context.tutorCommands, command];
      state.geometry.committed_element_ids = [...state.geometry.committed_element_ids, outputId];
    } else {
      context.draftCommands = [...context.draftCommands, command];
      state.geometry.draft_element_ids = [...state.geometry.draft_element_ids, outputId];
    }
  };

  switch (spec.effect) {
    case "geometry_construct_tutor":
    case "geometry_annotate_tutor": {
      const action = asTutorAction(args.action);
      const command = parseCommandPayload(action.command_payload);
      const family = spec.effect === "geometry_construct_tutor" ? CONSTRUCT_TYPES : ANNOTATE_TYPES;
      if (!family.has(command.type)) {
        throw new WorkspaceTransitionRejectedError(`${spec.capability} 不接受命令类型 ${command.type}`);
      }
      if (action.reveal_scope !== "none") {
        throw new WorkspaceTransitionRejectedError("geometry 构图/标注是纯呈现构造，reveal_scope 必须为 none");
      }
      commitGeometryCommand(command, "tutor");
      return { fold: next, changed: true };
    }
    case "geometry_foreground_tutor": {
      const action = asTutorAction(args.action);
      const targets = action.target_ids ?? [];
      if (targets.length === 0) {
        throw new WorkspaceTransitionRejectedError("foreground 必须携带 target_ids");
      }
      const missing = targets.filter((id) => !known.has(id));
      if (missing.length) {
        throw new WorkspaceTransitionRejectedError(`illegal target：元素不存在 ${missing.join(", ")}`);
      }
      return { fold: next, changed: false };
    }
    case "geometry_accept_draft_tutor": {
      const action = asTutorAction(args.action);
      const targets = action.target_ids ?? [];
      if (targets.length === 0) {
        throw new WorkspaceTransitionRejectedError("accept-draft 必须携带 target_ids");
      }
      const draft = new Set(state.geometry.draft_element_ids);
      const unknown = targets.filter((id) => !draft.has(id));
      if (unknown.length) {
        throw new WorkspaceTransitionRejectedError(`illegal target：非 draft 元素 ${unknown.join(", ")}`);
      }
      const accepted = new Set(targets);
      const movedCommands = context.draftCommands.filter((command) => accepted.has(domainCommandOutputId(command)));
      context.draftCommands = context.draftCommands.filter((command) => !accepted.has(domainCommandOutputId(command)));
      context.tutorCommands = [...context.tutorCommands, ...movedCommands];
      const acceptedIds = args.fold.state.geometry.draft_element_ids.filter((id) => accepted.has(id));
      state.geometry.draft_element_ids = state.geometry.draft_element_ids.filter((id) => !accepted.has(id));
      state.geometry.committed_element_ids = [...state.geometry.committed_element_ids, ...acceptedIds];
      return { fold: next, changed: true };
    }
    case "geometry_draft_student": {
      const commandBody = asStudentCommand(args.action);
      const raw = commandBody.params?.command;
      let command: DomainCommand;
      if (typeof raw === "string") {
        command = parseCommandPayload(raw);
      } else if (raw !== undefined && isDomainCommand(raw)) {
        command = raw;
      } else {
        throw new WorkspaceTransitionRejectedError("geometry.draft 必须携带 params.command（DomainCommand）");
      }
      if (!CONSTRUCT_TYPES.has(command.type) && !ANNOTATE_TYPES.has(command.type)) {
        throw new WorkspaceTransitionRejectedError(`geometry.draft 不接受命令类型 ${command.type}`);
      }
      commitGeometryCommand(command, "student");
      return { fold: next, changed: true };
    }
    case "geometry_mark_known_student": {
      const commandBody = asStudentCommand(args.action);
      const segments = authoredSegmentIds(catalog);
      const committedSegments = args.fold.state.geometry.committed_element_ids.filter((id) => id.startsWith("seg-"));
      const validSegments = new Set([...segments, ...committedSegments]);
      const missing = commandBody.target_ids.filter((id) => !validSegments.has(id));
      if (commandBody.target_ids.length === 0) {
        throw new WorkspaceTransitionRejectedError("mark-known-segments 必须携带 target_ids");
      }
      if (missing.length) {
        throw new WorkspaceTransitionRejectedError(`illegal target：非可见线段 ${missing.join(", ")}`);
      }
      const values = commandBody.params?.values;
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new WorkspaceTransitionRejectedError("mark-known-segments 必须携带 params.values");
      }
      const labels: DomainCommand[] = commandBody.target_ids.map((segmentId) => {
        const short = shortElementName(segmentId);
        const value = (values as Record<string, unknown>)[short];
        if (value === undefined || value === null || String(value).trim() === "") {
          throw new WorkspaceTransitionRejectedError(`线段 ${segmentId} 缺少已知值（params.values.${short}）`);
        }
        return {
          commandId: `cmd-${commandBody.command_id}-${short}`,
          actionId: commandBody.command_id,
          type: "set-segment-label" as const,
          segmentId,
          markId: `label-${short}`,
          valueLatex: String(value),
          labelKind: "length" as const,
        };
      });
      for (const label of labels) {
        commitGeometryCommand(label, "student");
      }
      return { fold: next, changed: true };
    }
    case "board_reveal_tutor": {
      const action = asTutorAction(args.action);
      const targets = action.target_ids ?? [];
      if (targets.length === 0) {
        throw new WorkspaceTransitionRejectedError("reveal-entry 必须携带 target_ids");
      }
      for (const entryId of targets) {
        const spec2 = boardEntryById(catalog, entryId);
        if (!spec2) {
          throw new WorkspaceTransitionRejectedError(`illegal target：未知 Board 条目 ${entryId}`);
        }
        const entry = state.solution_board.entries.find((candidate) => candidate.entry_id === entryId);
        if (!entry) {
          throw new WorkspaceTransitionRejectedError(`state 缺少条目 ${entryId}（catalog/state 漂移）`);
        }
        if (entry.visibility !== "hidden") {
          throw new WorkspaceTransitionRejectedError(`条目 ${entryId} 已不是 hidden（reveal 非法）`);
        }
        if (action.reveal_scope === "none") {
          throw new WorkspaceTransitionRejectedError("board reveal 必须声明内容暴露级别（reveal_scope=none 非法）");
        }
        if (spec2.revealRequirement === "final") {
          if (action.reveal_scope !== "final_result") {
            throw new WorkspaceTransitionRejectedError("final 类条目只允许 reveal_scope=final_result");
          }
          const authorization = authorizeBoardRevealBinding({
            catalog,
            ledger: args.fold.context.gateLedger,
            entryId,
          });
          if (!authorization.allowed) {
            throw new WorkspaceTransitionRejectedError(
              `${authorization.reason}（truth boundary violation）`,
            );
          }
        } else if (!["step_narration", "intermediate_result", "final_result"].includes(action.reveal_scope)) {
          throw new WorkspaceTransitionRejectedError(`intermediate 类条目不允许 reveal_scope=${action.reveal_scope}`);
        }
        entry.visibility = "visible";
      }
      return { fold: next, changed: true };
    }
    case "board_activate_tutor": {
      const action = asTutorAction(args.action);
      const targets = action.target_ids ?? [];
      if (targets.length !== 1) {
        throw new WorkspaceTransitionRejectedError("activate-entry 必须恰好携带一个 target");
      }
      const entryId = targets[0];
      const entry = state.solution_board.entries.find((candidate) => candidate.entry_id === entryId);
      if (!entry) {
        throw new WorkspaceTransitionRejectedError(`illegal target：未知 Board 条目 ${entryId}`);
      }
      if (entry.visibility === "hidden") {
        throw new WorkspaceTransitionRejectedError(`条目 ${entryId} 仍为 hidden（activate 不得隐式 reveal）`);
      }
      if (entry.visibility === "active") {
        return { fold: next, changed: false };
      }
      state.solution_board.entries.forEach((candidate) => {
        if (candidate.visibility === "active") candidate.visibility = "visible";
      });
      entry.visibility = "active";
      return { fold: next, changed: true };
    }
    case "workspace_lock_tutor": {
      if (state.geometry.interaction_mode === "locked") {
        return { fold: next, changed: false };
      }
      state.geometry.interaction_mode = "locked";
      return { fold: next, changed: true };
    }
    case "board_attempt_student": {
      const commandBody = asStudentCommand(args.action);
      if (commandBody.target_ids.length !== 1) {
        throw new WorkspaceTransitionRejectedError("submit-attempt 必须恰好携带一个 target");
      }
      const entry = state.solution_board.entries.find((candidate) => candidate.entry_id === commandBody.target_ids[0]);
      if (!entry) {
        throw new WorkspaceTransitionRejectedError(`illegal target：未知 Board 条目 ${commandBody.target_ids[0]}`);
      }
      if (entry.visibility === "hidden") {
        throw new WorkspaceTransitionRejectedError(`条目 ${entry.entry_id} 仍为 hidden（学生不可对 hidden 条目作答）`);
      }
      if (entry.attempt_state !== "none") {
        throw new WorkspaceTransitionRejectedError(`条目 ${entry.entry_id} 的 attempt 已是 ${entry.attempt_state}`);
      }
      entry.attempt_state = "attempted";
      return { fold: next, changed: true };
    }
    case "board_confirm_student": {
      const commandBody = asStudentCommand(args.action);
      if (commandBody.target_ids.length !== 1) {
        throw new WorkspaceTransitionRejectedError("confirm-entry 必须恰好携带一个 target");
      }
      const entry = state.solution_board.entries.find((candidate) => candidate.entry_id === commandBody.target_ids[0]);
      if (!entry) {
        throw new WorkspaceTransitionRejectedError(`illegal target：未知 Board 条目 ${commandBody.target_ids[0]}`);
      }
      if (entry.visibility === "hidden") {
        throw new WorkspaceTransitionRejectedError(`条目 ${entry.entry_id} 仍为 hidden`);
      }
      if (entry.attempt_state !== "attempted") {
        throw new WorkspaceTransitionRejectedError(
          `条目 ${entry.entry_id} 的 attempt 是 ${entry.attempt_state}（attempted≠confirmed：不确认不产生完成事实）`,
        );
      }
      entry.attempt_state = "confirmed";
      return { fold: next, changed: true };
    }
  }
}

// --------------------------------------------------------------------------- //
// 事件 fold（在线逐批增量与重建全量重放共用）
// --------------------------------------------------------------------------- //

/**
 * 单事件归约（纯函数）。事件须已过 canonical 校验（store/rebuilder 保证）。
 * gate/decision 账本由事件增量维护（gate_evaluated / policy_decision_made /
 * session_completed），在线与重建同一推导——reveal 授权在效果应用点读账本。
 */
export function applyWorkspaceV5Event(
  fold: WorkspaceFold,
  event: StoredV5Event,
  catalog: WorkspacePresentationCatalogV5,
): WorkspaceFold {
  const state = cloneState(fold.state);
  const context = cloneContext(fold.context);

  switch (event.event_type) {
    case "gate_evaluated": {
      const payload = event.payload as unknown as {
        gate_id: string;
        beat_id: string;
        satisfied: boolean;
        evidence_sequence?: number;
      };
      context.gateLedger = {
        ...context.gateLedger,
        evaluations: new Map([
          ...context.gateLedger.evaluations,
          [`${payload.gate_id}@${payload.beat_id}`, {
            gateId: payload.gate_id,
            beatId: payload.beat_id,
            satisfied: payload.satisfied,
            sequence: event.sequence,
            ...(payload.evidence_sequence !== undefined ? { evidenceSequence: payload.evidence_sequence } : {}),
          }],
        ]),
      };
      return { state, context };
    }
    case "policy_decision_made": {
      const payload = event.payload as unknown as {
        decision_id: string;
        protocol_id: string;
        beat_id: string;
        to_beat_id?: string;
      };
      context.gateLedger = {
        ...context.gateLedger,
        decisions: new Map([
          ...context.gateLedger.decisions,
          [payload.decision_id, {
            decisionId: payload.decision_id,
            protocolId: payload.protocol_id,
            beatId: payload.beat_id,
            ...(payload.to_beat_id !== undefined ? { toBeatId: payload.to_beat_id } : {}),
            sequence: event.sequence,
          }],
        ]),
        // 主线 Beat 推进（transition/revisit/return 类决策携带 to_beat_id）：
        // cursor 离开绑定 Beat 后，先前满足的 gate 即 stale（reveal 拒绝）。
        cursor:
          payload.to_beat_id !== undefined
            ? { ...context.gateLedger.cursor, beatId: payload.to_beat_id }
            : context.gateLedger.cursor,
      };
      return { state, context };
    }
    case "workspace_surface_action_issued": {
      const payload = event.payload as unknown as PendingTutorActionPayload;
      if (context.pendingTutorActions.has(payload.action_id)) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `workspace action ${payload.action_id} 重复 issued`,
          event.sequence,
        );
      }
      context.pendingTutorActions = new Map([
        ...context.pendingTutorActions,
        [payload.action_id, { payload, observedRevision: state.revision }],
      ]);
      return { state, context };
    }
    case "student_intent_recorded": {
      const payload = event.payload as unknown as { workspace_command?: PendingStudentCommandBody };
      const command = payload.workspace_command;
      if (!command) return { state, context };
      if (context.pendingStudentCommands.has(command.command_id)) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `student command ${command.command_id} 重复注册`,
          event.sequence,
        );
      }
      context.pendingStudentCommands = new Map([
        ...context.pendingStudentCommands,
        [command.command_id, { command, observedRevision: state.revision }],
      ]);
      return { state, context };
    }
    case "action_outcome_recorded": {
      const outcome = event.payload as unknown as {
        action_id: string;
        action_kind: "voice" | "workspace_surface" | "student_command";
        outcome: "completed" | "rejected" | "interrupted" | "failed";
        resulting_revision?: number;
      };
      if (outcome.outcome !== "completed") {
        // rejected / interrupted / failed：清 pending、零状态效果（不产生完成副作用）。
        context.pendingTutorActions = new Map([...context.pendingTutorActions].filter(([id]) => id !== outcome.action_id));
        context.pendingStudentCommands = new Map(
          [...context.pendingStudentCommands].filter(([id]) => id !== outcome.action_id),
        );
        return { state, context };
      }
      if (outcome.action_kind === "voice") return { state, context };

      const isTutor = outcome.action_kind === "workspace_surface";
      const pendingTutor = isTutor ? context.pendingTutorActions.get(outcome.action_id) : undefined;
      const pendingStudent = isTutor ? undefined : context.pendingStudentCommands.get(outcome.action_id);
      const observedRevision = pendingTutor?.observedRevision ?? pendingStudent?.observedRevision;
      if (observedRevision === undefined) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `孤儿完成事实：action_outcome_recorded(completed) 无对应 issued/intent（${outcome.action_id}）`,
          event.sequence,
        );
      }
      if (observedRevision !== state.revision) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `批间污染：${outcome.action_id} 注册后 workspace revision ${observedRevision} → ${state.revision} 被其它 transition 推走`,
          event.sequence,
        );
      }
      const action: PendingTutorActionPayload | PendingStudentCommandBody = pendingTutor?.payload ?? pendingStudent!.command;
      if (pendingStudent) {
        if (pendingStudent.command.expected_workspace_revision !== pendingStudent.observedRevision) {
          throw new WorkspaceRuntimeReducerError(
            "WORKSPACE_STREAM_INVARIANT",
            `completed 的 student command ${outcome.action_id} 内嵌 expected_workspace_revision=${pendingStudent.command.expected_workspace_revision} 与提交时 workspace revision=${pendingStudent.observedRevision} 不符（stale 命令不得完成）`,
            event.sequence,
          );
        }
      }
      const origin = isTutor ? "tutor" : "student";
      const spec = resolveWorkspaceCapability(action.capability, action.surface, origin);
      if (!spec) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `未登记/不匹配 capability：${origin}:${action.surface}:${action.capability}`,
          event.sequence,
        );
      }
      let applied: { fold: WorkspaceFold; changed: boolean };
      try {
        applied = applyWorkspaceEffect({ fold: { state, context }, catalog, spec, action });
      } catch (error) {
        if (error instanceof WorkspaceTransitionRejectedError) {
          throw new WorkspaceRuntimeReducerError(
            "WORKSPACE_STREAM_INVARIANT",
            `committed 流含执行器必拒的 ${outcome.action_id}：${error.reason}`,
            event.sequence,
          );
        }
        throw error;
      }
      // resulting_revision 分配语义：changed ⇒ 恰 +1；presentation-only ⇒ 省略或等于当前。
      if (applied.changed) {
        if (outcome.resulting_revision !== state.revision + 1) {
          throw new WorkspaceRuntimeReducerError(
            "WORKSPACE_STREAM_INVARIANT",
            `${outcome.action_id} 推进状态但 resulting_revision=${outcome.resulting_revision}≠${state.revision + 1}（恰 +1 语义）`,
            event.sequence,
          );
        }
        applied.fold.state.revision = state.revision + 1;
      } else if (outcome.resulting_revision !== undefined && outcome.resulting_revision !== state.revision) {
        throw new WorkspaceRuntimeReducerError(
          "WORKSPACE_STREAM_INVARIANT",
          `${outcome.action_id} 零状态变化但 resulting_revision=${outcome.resulting_revision}≠${state.revision}`,
          event.sequence,
        );
      }
      // 清 pending（完成或拒绝后动作闭环）。
      const clearedTutors = new Map([...applied.fold.context.pendingTutorActions].filter(([id]) => id !== outcome.action_id));
      const clearedStudents = new Map([...applied.fold.context.pendingStudentCommands].filter(([id]) => id !== outcome.action_id));
      return { state: applied.fold.state, context: { ...applied.fold.context, pendingTutorActions: clearedTutors, pendingStudentCommands: clearedStudents } };
    }
    case "session_completed": {
      // teaching 侧终态覆写（不经 workspace transition、不推 revision——f3 ledger 约定 7）。
      state.geometry.interaction_mode = "locked";
      context.gateLedger = { ...context.gateLedger, completed: true };
      return { state, context };
    }
    default:
      return { state, context };
  }
}

/**
 * 全量折叠：session_started 起步（初始 state 来自 catalog+seed；gate ledger
 * 由 session_started payload 播种——Plan/Protocol pin + 初始 cursor）+ 逐事件
 * 归约。reveal 授权（五级绑定）与效果应用同点裁决，无第二真相源。
 */
export function foldWorkspaceV5Events(
  events: readonly StoredV5Event[],
  catalog: WorkspacePresentationCatalogV5,
  seed?: WorkspaceSeedOverlay,
): WorkspaceFold {
  if (events.length === 0) {
    throw new WorkspaceRuntimeReducerError("WORKSPACE_STREAM_INVARIANT", "committed event stream is empty");
  }
  if (events[0].event_type !== "session_started") {
    throw new WorkspaceRuntimeReducerError(
      "WORKSPACE_STREAM_INVARIANT",
      `first committed event must be session_started, got ${events[0].event_type}`,
      events[0].sequence,
    );
  }
  let fold = initialWorkspaceFold(
    events[0].session_id,
    catalog,
    seed,
    events[0].payload as unknown as WorkspaceSessionStartedLedgerInput,
  );
  for (const event of events.slice(1)) {
    fold = applyWorkspaceV5Event(fold, event, catalog);
  }
  return fold;
}

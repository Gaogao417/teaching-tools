/**
 * WorkspaceSessionRuntimeV5（F3 — Workspace 状态转换内核；在线侧包装）。
 *
 * 所有成功持久 workspace transition 的唯一写入口（f3-scope-ledger）：
 * - 持 F2 `TutorSessionKernelV5`（只消费不修改）：每次执行 = 两个真实 append
 *   事务——①issued/intent 事实批（causation 指向调用方给的决策事件 sequence）
 *   ②outcome 事实批（causation 指向①的 sequence）。两批之间崩溃 = mid-action
 *   crash 语义（issued 无 outcome ⇒ 零完成副作用，F2/G2 已覆盖，workspace
 *   fold 同口径）；事件 idempotency key 由 action/command id 派生（跨重试稳定）；
 * - append 后把「store 提交成功的 canonical 事件行」读回，经
 *   applyWorkspaceV5Event（与重建完全相同的纯函数）推进缓存 fold——在线=逐批
 *   增量，重建=全量重放，同一 fold（G3 结构性保证）；
 * - gate/decision 账本在 fold context 内由事件增量维护（R2 2026-08-31 五级
 *   绑定）；每次执行前 syncFold 补折 orchestrator 直经 kernel.append 提交的
 *   teaching 事实（决策/gate），在线与重建对账本同推导——不再读 kernel.state
 *   裁决 reveal（旧「teaching phase 单点比较」已删除）；
 * - catalog pin（R0 §4）：start 把服务端计算的 workspace_catalog_pin 写入
 *   session_started payload（canonical 可选字段；F3 写入门禁必带）；resume 经
 *   rebuildWorkspaceRuntimeStateV5 重算对账，不符即 HASH_MISMATCH fail closed；
 * - 幂等去重读事件流（client_command_id）：已完成命令重复提交 → 返回先前
 *   outcome，零新事实；intent 已提交但 outcome 缺失（前次崩溃）→ incomplete，
 *   不自动续写（恢复语义属 F6，ledger 登记）。
 */
import {
  readTutorSessionEventsV5,
  type StartTutorSessionV5Input,
} from "./TutorSessionEventStoreV5";
import { TutorSessionEventStoreV5Error } from "./TutorSessionEventV5";
import { TutorSessionKernelV5, type ResumeV5Options } from "./TutorSessionKernelV5";
import type { PendingV5Event, StoredV5Event, V5OutcomeKind } from "./TutorSessionEventV5";
import {
  applyWorkspaceV5Event,
  initialWorkspaceFold,
  type WorkspaceFold,
  type WorkspaceRuntimeStateV5,
} from "./WorkspaceRuntimeReducerV5";
import {
  executeStudentWorkspaceCommandV5,
  executeWorkspacePresentationV5,
  type WorkspacePresentationExecution,
  type WorkspaceStudentCommandExecution,
} from "./WorkspaceActionRuntimeV5";
import {
  rebuildWorkspaceRuntimeStateV5,
  compareWorkspaceStatesSemantically,
  type WorkspaceSemanticComparison,
} from "./WorkspaceStateRebuilderV5";
import {
  deriveMainlineParticipation,
  projectStudentWorkspaceViewV5,
  type MainlineParticipationSlice,
  type StudentWorkspaceViewV5,
} from "./WorkspaceViewProjectorV5";
import {
  workspaceCatalogPin,
  type WorkspacePresentationCatalogV5,
  type WorkspaceSeedOverlay,
} from "./WorkspacePresentationCatalogV5";

export interface WorkspaceExecutionReceipt {
  status: "completed" | "rejected" | "duplicate" | "incomplete";
  reason?: string;
  changed?: boolean;
  resultingRevision?: number;
  appendedSequences: number[];
  workspaceRevision: number;
}

const nowIso = (): string => new Date().toISOString();

export class WorkspaceSessionRuntimeV5 {
  readonly sessionId: string;
  private readonly kernelRef: TutorSessionKernelV5;
  private readonly catalog: WorkspacePresentationCatalogV5;
  private readonly seed?: WorkspaceSeedOverlay;
  private currentFold: WorkspaceFold;
  /** 已折入 currentFold 的最大事件 sequence（syncFold 增量补折的游标）。 */
  private lastFoldedSequence: number;

  private constructor(
    kernel: TutorSessionKernelV5,
    catalog: WorkspacePresentationCatalogV5,
    seed: WorkspaceSeedOverlay | undefined,
    initialFold: WorkspaceFold,
    lastFoldedSequence: number,
  ) {
    this.kernelRef = kernel;
    this.sessionId = kernel.sessionId;
    this.catalog = catalog;
    this.seed = seed;
    this.currentFold = initialFold;
    this.lastFoldedSequence = lastFoldedSequence;
  }

  /** F2 事实内核（只读暴露：F6 orchestrator 在此驱动决策/门事件；本类不改其行为）。 */
  get kernel(): TutorSessionKernelV5 {
    return this.kernelRef;
  }

  /**
   * 启动 v5 会话（原子 pin + session_started，经 F2 kernel）。R2 2026-08-31：
   * session_started payload 注入服务端 catalog 计算的 workspace_catalog_pin
   * （R0 §4 冻结口径；调用方自带 pin 一律被服务端计算值覆写——catalog 真源在服务端）。
   */
  static start(input: StartTutorSessionV5Input, catalog: WorkspacePresentationCatalogV5): WorkspaceSessionRuntimeV5 {
    const pinned: StartTutorSessionV5Input = {
      ...input,
      sessionStarted: {
        ...input.sessionStarted,
        workspace_catalog_pin: workspaceCatalogPin(catalog),
      },
    };
    const kernel = TutorSessionKernelV5.start(pinned);
    // session_started（sequence 1）已播种 gate ledger（Plan/Protocol pin + 初始 cursor）。
    return new WorkspaceSessionRuntimeV5(
      kernel,
      catalog,
      undefined,
      initialWorkspaceFold(input.sessionId, catalog, undefined, pinned.sessionStarted),
      1,
    );
  }

  /** 恢复：teaching 状态经 F2 verified rebuild；workspace 状态经同一 fold 全量重放。
   * catalog pin 由 rebuildWorkspaceRuntimeStateV5 重算对账（不符 → HASH_MISMATCH
   * fail closed——不接受未经对账的任意 catalog）。 */
  static resume(
    sessionId: string,
    catalog: WorkspacePresentationCatalogV5,
    seed?: WorkspaceSeedOverlay,
    options?: ResumeV5Options,
  ): WorkspaceSessionRuntimeV5 {
    const kernel = TutorSessionKernelV5.resume(sessionId, options);
    const rebuilt = rebuildWorkspaceRuntimeStateV5(sessionId, catalog, seed, options);
    return new WorkspaceSessionRuntimeV5(kernel, catalog, seed, { state: rebuilt.state, context: rebuilt.context }, rebuilt.lastSequence);
  }

  get workspaceState(): WorkspaceRuntimeStateV5 {
    return this.currentFold.state;
  }

  get fold(): WorkspaceFold {
    return this.currentFold;
  }

  get tutorState(): ReturnType<TutorSessionKernelV5["rebuild"]> {
    return this.kernelRef.state;
  }

  get sessionRevision(): number {
    return this.kernelRef.revision;
  }

  /**
   * 增量补折（R2 2026-08-31）：把 lastFoldedSequence 之后 committed 的事件行
   * 经同一 applyWorkspaceV5Event 折入缓存 fold（teaching 事实——决策/gate——
   * 更新 gate 账本；workspace 事实更新 state）。orchestrator 直经
   * kernel.append 提交的决策/gate 事件由此进入在线侧裁决输入，与重建同推导。
   */
  private syncFold(): void {
    const committed = readTutorSessionEventsV5(this.sessionId);
    for (const event of committed) {
      if (event.sequence <= this.lastFoldedSequence) continue;
      this.currentFold = applyWorkspaceV5Event(this.currentFold, event, this.catalog);
      this.lastFoldedSequence = event.sequence;
    }
  }

  /** 全量重建（启动/恢复/对账用；F2 六类损坏 + workspace 流不变量 fail closed）。 */
  rebuildWorkspace(): WorkspaceFold {
    const rebuilt = rebuildWorkspaceRuntimeStateV5(this.sessionId, this.catalog, this.seed);
    return { state: rebuilt.state, context: rebuilt.context };
  }

  /** G3 对账入口：在线缓存 workspace state vs 全量重建 state（白名单=空集）。 */
  assertWorkspaceReplayParity(): WorkspaceSemanticComparison {
    return compareWorkspaceStatesSemantically(this.currentFold.state, this.rebuildWorkspace().state);
  }

  /** 单一 projector 入口：同一 state 投影 View（participation 从 teaching 状态纯推导）。 */
  projectView(participation?: MainlineParticipationSlice): StudentWorkspaceViewV5 {
    return projectStudentWorkspaceViewV5(
      this.currentFold.state,
      this.catalog,
      participation ?? deriveMainlineParticipation(this.kernelRef.state),
    );
  }

  /**
   * Tutor 呈现动作（ExecutePresentation 在线入口）。
   * causationSequence：触发本动作的决策（policy_decision_made）事件 sequence。
   */
  executePresentation(action: unknown, causationSequence: number): WorkspaceExecutionReceipt {
    this.syncFold();
    const execution: WorkspacePresentationExecution = executeWorkspacePresentationV5({
      fold: this.currentFold,
      catalog: this.catalog,
      action,
    });
    if (execution.status === "rejected") {
      return {
        status: "rejected",
        reason: execution.reason,
        appendedSequences: [],
        workspaceRevision: this.currentFold.state.revision,
      };
    }
    const actionId = execution.events.issuedPayload.action_id;
    try {
      const issued = this.appendEvents(
        [{ event_type: "workspace_surface_action_issued", payload: execution.events.issuedPayload, causation_sequence: causationSequence, idempotency_key: `wsa-issued:${actionId}` }],
        `wsa-issued:${actionId}`,
      );
      const outcome = this.appendEvents(
        [{ event_type: "action_outcome_recorded", payload: execution.events.outcomePayload, causation_sequence: issued[0], idempotency_key: `wsa-outcome:${actionId}` }],
        `wsa-outcome:${actionId}`,
      );
      return {
        status: "completed",
        changed: execution.changed,
        resultingRevision: execution.resultingRevision,
        appendedSequences: [...issued, ...outcome],
        workspaceRevision: this.currentFold.state.revision,
      };
    } catch (error) {
      if (error instanceof WorkspaceIncompleteExecutionError) {
        return this.incompleteReceipt(error.duplicateKey);
      }
      throw error;
    }
  }

  private incompleteReceipt(duplicateKey: string): WorkspaceExecutionReceipt {
    return {
      status: "incomplete",
      reason: `${duplicateKey} 已提交（mid-action crash 重试；恢复语义属 F6，不自动续写）`,
      appendedSequences: [],
      workspaceRevision: this.currentFold.state.revision,
    };
  }

  /**
   * 学生命令（ExecuteStudentCommand 在线入口）：幂等（client_command_id）、
   * stale（expected_workspace_revision）、capability/target/truth 边界全部在
   * 此拒绝；canonical 合法的拒绝经 intent+outcome(rejected) 事实入流（零状态
   * 效果、零 revision 推进）。
   */
  executeStudentCommand(command: unknown): WorkspaceExecutionReceipt {
    this.syncFold();
    const prior = this.findPriorStudentCommand(command);
    if (prior?.kind === "duplicate") {
      return {
        status: "duplicate",
        reason: `client_command_id=${prior.clientCommandId} 已提交（先前 outcome=${prior.outcome}；幂等重放零新事实）`,
        appendedSequences: [],
        workspaceRevision: this.currentFold.state.revision,
      };
    }
    if (prior?.kind === "incomplete") {
      return {
        status: "incomplete",
        reason: `client_command_id=${prior.clientCommandId} 的 intent 已提交但 outcome 缺失（前次 mid-action crash；恢复语义属 F6，不自动续写）`,
        appendedSequences: [],
        workspaceRevision: this.currentFold.state.revision,
      };
    }
    const execution: WorkspaceStudentCommandExecution = executeStudentWorkspaceCommandV5({
      fold: this.currentFold,
      catalog: this.catalog,
      command,
    });
    if (execution.status === "rejected") {
      if (!execution.events) {
        return {
          status: "rejected",
          reason: execution.reason,
          appendedSequences: [],
          workspaceRevision: this.currentFold.state.revision,
        };
      }
      const commandId = execution.events.intentPayload.workspace_command.command_id;
      try {
        const intent = this.appendEvents(
          [{ event_type: "student_intent_recorded", payload: execution.events.intentPayload, idempotency_key: `sc-intent:${commandId}` }],
          `sc-intent:${commandId}`,
        );
        const outcome = this.appendEvents(
          [{ event_type: "action_outcome_recorded", payload: execution.events.outcomePayload, causation_sequence: intent[0], idempotency_key: `sc-outcome:${commandId}` }],
          `sc-outcome:${commandId}`,
        );
        return {
          status: "rejected",
          reason: execution.reason,
          appendedSequences: [...intent, ...outcome],
          workspaceRevision: this.currentFold.state.revision,
        };
      } catch (error) {
        if (error instanceof WorkspaceIncompleteExecutionError) {
          return this.incompleteReceipt(error.duplicateKey);
        }
        throw error;
      }
    }
    // execution.status === "completed"（上方 rejected 分支全部 return，narrowing 成立）
    const commandId = execution.events.intentPayload.workspace_command.command_id;
    try {
      const intent = this.appendEvents(
        [{ event_type: "student_intent_recorded", payload: execution.events.intentPayload, idempotency_key: `sc-intent:${commandId}` }],
        `sc-intent:${commandId}`,
      );
      const outcome = this.appendEvents(
        [{ event_type: "action_outcome_recorded", payload: execution.events.outcomePayload, causation_sequence: intent[0], idempotency_key: `sc-outcome:${commandId}` }],
        `sc-outcome:${commandId}`,
      );
      return {
        status: "completed",
        changed: execution.changed,
        resultingRevision: execution.resultingRevision,
        appendedSequences: [...intent, ...outcome],
        workspaceRevision: this.currentFold.state.revision,
      };
    } catch (error) {
      if (error instanceof WorkspaceIncompleteExecutionError) {
        return this.incompleteReceipt(error.duplicateKey);
      }
      throw error;
    }
  }

  /**
   * 追加一批事件并把提交行经同一 fold 折入缓存（真实提交路径）。
   * duplicateKey：DUPLICATE_EVENT（崩溃重试撞稳定 idempotency key）→ incomplete
   * 回执，缓存 fold 不动（store 已保证零新事实）。补折走 syncFold（含
   * lastFoldedSequence 游标推进），与重建同一 applyWorkspaceV5Event。
   */
  private appendEvents(
    events: Array<{ event_type: PendingV5Event["event_type"]; payload: unknown; causation_sequence?: number; idempotency_key?: string }>,
    duplicateKey?: string,
  ): number[] {
    const pending: PendingV5Event[] = events.map((event) => ({
      event_type: event.event_type,
      payload: event.payload,
      occurred_at: nowIso(),
      ...(event.causation_sequence !== undefined ? { causation_sequence: event.causation_sequence } : {}),
      ...(event.idempotency_key !== undefined ? { idempotency_key: event.idempotency_key } : {}),
    }));
    let result: { revision: number; appendedSequences: number[] };
    try {
      result = this.kernelRef.append(this.kernelRef.revision, pending);
    } catch (error) {
      if (duplicateKey && error instanceof TutorSessionEventStoreV5Error && error.code === "DUPLICATE_EVENT") {
        throw new WorkspaceIncompleteExecutionError(duplicateKey);
      }
      throw error;
    }
    const committed = readTutorSessionEventsV5(this.sessionId);
    const batch = committed.filter((event) => result.appendedSequences.includes(event.sequence));
    if (batch.length !== result.appendedSequences.length) {
      throw new Error(`append reported sequences ${result.appendedSequences.join(",")} but read-back mismatch`);
    }
    this.syncFold();
    return result.appendedSequences;
  }

  /** 事件流幂等扫描：同 client_command_id 的 intent/outcome 配对状态。 */
  private findPriorStudentCommand(
    command: unknown,
  ): { kind: "duplicate" | "incomplete"; clientCommandId: string; outcome?: V5OutcomeKind } | undefined {
    if (
      typeof command !== "object" ||
      command === null ||
      typeof (command as Record<string, unknown>).client_command_id !== "string"
    ) {
      return undefined;
    }
    const clientCommandId = (command as Record<string, unknown>).client_command_id as string;
    const events = readTutorSessionEventsV5(this.sessionId);
    const commandIds = new Set<string>();
    let matchedIntent = false;
    for (const event of events) {
      if (event.event_type !== "student_intent_recorded") continue;
      const payload = event.payload as { workspace_command?: { command_id: string; client_command_id: string } };
      const embedded = payload.workspace_command;
      if (embedded && embedded.client_command_id === clientCommandId) {
        matchedIntent = true;
        commandIds.add(embedded.command_id);
      }
    }
    if (!matchedIntent) return undefined;
    for (const event of events) {
      if (event.event_type !== "action_outcome_recorded") continue;
      const payload = event.payload as { action_id: string; outcome: V5OutcomeKind };
      if (commandIds.has(payload.action_id)) {
        return { kind: "duplicate", clientCommandId, outcome: payload.outcome };
      }
    }
    return { kind: "incomplete", clientCommandId };
  }
}

/** 崩溃重试撞稳定 idempotency key（issued 已提交、outcome 缺失）。 */
export class WorkspaceIncompleteExecutionError extends Error {
  constructor(readonly duplicateKey: string) {
    super(`workspace execution incomplete: ${duplicateKey} already committed (mid-action crash retry)`);
    this.name = "WorkspaceIncompleteExecutionError";
  }
}

export type { StoredV5Event };

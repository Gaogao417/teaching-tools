/**
 * TutorRuntimeApplicationV7（F7 Step 4 — HTTP application profile 的应用服务）。
 *
 * 生产组合链（复核 P0-1）：
 *
 * ```text
 * vnextTutorRoutes → TutorRuntimeApplicationV7 → TutorSessionOrchestratorV7
 *                                                 → TutorSessionKernelV7
 * ```
 *
 * 本层实现 TutorRuntimeClient 端口语义（ADR-011 §7）的服务端侧：
 * - Start：route policy（availability allowlist）→ StartRequestRegistry 原子幂等
 *   （同键同 payload 回放既有 session；同键异 payload → 409 REQUEST_PAYLOAD_DRIFT；
 *   登记与 session 创建同一 SQLite 事务，崩溃窗口不留悬空映射）→ OrchestratorV7
 *   新会话只创建 v7 行；
 * - Restore：只服务 v7（v5/v6 会话行 → SESSION_VERSION_UNSUPPORTED 409——V6
 *   reader 保留给历史测试/诊断/内部审计；复核 P0-3 冻结策略）；
 * - SubmitStudentInput / SubmitActionEvidence / SubmitWorkspaceCommand /
 *   ReportPresentationOutcome：薄委托 OrchestratorV7（教学判断零新增——本层
 *   零教学语义，与 route 纪律一致）。
 */
import type { PresenterGeneratorPort } from "./presentationGeneration/GeneratorPort";
import { TutorSessionOrchestratorV7, type OrchestratorV7ModelInput, type V7ActionEvidenceInput, type V7ActionSubmission, type V7CommandTurnResult, type V7StudentInputTurn, type V7InputTurnOptions, type V7InputTurnResult, type V7OutcomeTurnResult, type V7PresentationOutcomeRequest } from "./TutorSessionOrchestratorV7";
import { startAtomically, startPayloadHash, type StartReservation } from "./StartRequestRegistry";
import { resolvableTaskIds, TutorTaskBindingResolver } from "./TutorTaskBindingResolver";

export interface TutorRuntimeApplicationV7Deps {
  readonly canonicalRoot: string;
  readonly model: OrchestratorV7ModelInput;
  readonly modelTimeoutMs?: number;
  /**
   * F7 RT4：Presenter 生成端口（提供 ⇒ 新会话走 event_schema='v9' 生成生命
   * 周期；缺省 ⇒ v7 既有链零变化）。恢复 v9 会话驱动 pending 生成必需。
   */
  readonly presenter?: PresenterGeneratorPort;
}

export type V7StartOutcome =
  | { kind: "created"; orchestrator: TutorSessionOrchestratorV7 }
  | { kind: "existing"; orchestrator: TutorSessionOrchestratorV7 }
  | { kind: "payload-drift"; clientRequestId: string; committedPayloadHash: string };

export interface V7StartInput {
  readonly task_id: string;
  readonly student_id: string;
  readonly assessment?: boolean;
  readonly client_request_id: string;
  /** session id 分配器（生产 = TS- 时间戳序号；测试可注入确定性序号）。 */
  readonly sessionIdAllocator?: () => string;
}

/** 会话 id：TS-<epoch 毫秒><两位序号>（满足 TS-[0-9]{4,}，进程内唯一）。 */
let sessionSerial = 0;
function defaultSessionIdAllocator(): string {
  sessionSerial = (sessionSerial + 1) % 100;
  return `TS-${Date.now()}${String(sessionSerial).padStart(2, "0")}`;
}

/** 应用层错误（route policy 面；路由映射 400 BAD_REQUEST）。 */
export type V7ApplicationErrorCode = "TASK_NOT_ENABLED";

export class TutorRuntimeApplicationV7Error extends Error {
  constructor(readonly code: V7ApplicationErrorCode, message: string) {
    super(message);
    this.name = "TutorRuntimeApplicationV7Error";
  }
}

export class TutorRuntimeApplicationV7 {
  private constructor(private readonly deps: TutorRuntimeApplicationV7Deps) {}

  static create(deps: TutorRuntimeApplicationV7Deps): TutorRuntimeApplicationV7 {
    return new TutorRuntimeApplicationV7(deps);
  }

  /** route policy 面（与 availability 端点同源；F7 = golden allowlist）。 */
  resolvableTaskIds(): readonly string[] {
    return resolvableTaskIds();
  }

  /** 绑定解析可用性（availability 端点；无副作用——不创建会话）。 */
  taskEnabled(taskId: string): boolean {
    return resolvableTaskIds().includes(taskId);
  }

  /**
   * 创建（或幂等回放）v7 会话：StartRequestRegistry 原子幂等 → 新会话只创建
   * v7 行（event_schema='v7'）。task 必须先通过 route policy（allowlist）再经
   * resolver 唯一解析（unknown → fail closed，无默认回退）。
   */
  start(input: V7StartInput): V7StartOutcome {
    if (!this.taskEnabled(input.task_id)) {
      throw new TutorRuntimeApplicationV7Error(
        "TASK_NOT_ENABLED",
        `task ${input.task_id} is not enabled for the v7 runtime (availability gate)`,
      );
    }
    const allocate = input.sessionIdAllocator ?? defaultSessionIdAllocator;
    const reservation: StartReservation = startAtomically({
      clientRequestId: input.client_request_id,
      payloadHash: startPayloadHash({
        task_id: input.task_id,
        student_id: input.student_id,
        ...(input.assessment !== undefined ? { assessment: input.assessment } : {}),
      }),
      createSession: () => {
        const sessionId = allocate();
        TutorSessionOrchestratorV7.start({
          sessionId,
          studentId: input.student_id,
          taskId: input.task_id,
          canonicalRoot: this.deps.canonicalRoot,
          model: this.deps.model,
          ...(this.deps.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.deps.modelTimeoutMs } : {}),
          ...(input.assessment !== undefined ? { assessment: input.assessment } : {}),
          ...(this.deps.presenter !== undefined ? { presenter: this.deps.presenter } : {}),
        });
        return sessionId;
      },
    });
    if (reservation.kind === "payload-drift") {
      return { kind: "payload-drift", clientRequestId: reservation.clientRequestId, committedPayloadHash: reservation.committedPayloadHash };
    }
    const orchestrator = this.restore(reservation.sessionId);
    return reservation.kind === "created"
      ? { kind: "created", orchestrator }
      : { kind: "existing", orchestrator };
  }

  /**
   * 恢复（refresh/reconnect）：verified rebuild 零模型调用。新生产 restore 只
   * 服务 v7——v5/v6 会话行 → SESSION_VERSION_UNSUPPORTED（kernel 边界；路由映射
   * 409，UI 明示重新开始）。
   */
  restore(sessionId: string): TutorSessionOrchestratorV7 {
    return TutorSessionOrchestratorV7.resume({
      sessionId,
      canonicalRoot: this.deps.canonicalRoot,
      model: this.deps.model,
      ...(this.deps.modelTimeoutMs !== undefined ? { modelTimeoutMs: this.deps.modelTimeoutMs } : {}),
      ...(this.deps.presenter !== undefined ? { presenter: this.deps.presenter } : {}),
    });
  }

  /**
   * F7 RT4：驱动会话 pending 生成直至终态（v7 会话 no-op）。GET/restore 不调用
   * ——本方法包含事务外模型调用；响应丢失场景按幂等身份经 restore+drive 取回
   * 已提交结果（coordinator 零重调模型路径）。
   */
  async drivePendingGeneration(orchestrator: TutorSessionOrchestratorV7): Promise<void> {
    if (!orchestrator.hasPendingGeneration()) return;
    await orchestrator.drivePendingGeneration();
  }

  async submitStudentInput(orchestrator: TutorSessionOrchestratorV7, input: V7StudentInputTurn, options?: V7InputTurnOptions): Promise<V7InputTurnResult> {
    return orchestrator.submitStudentInput(input, options);
  }

  submitActionEvidence(orchestrator: TutorSessionOrchestratorV7, evidence: V7ActionEvidenceInput, options: V7InputTurnOptions & { client_request_id: string }): V7ActionSubmission {
    return orchestrator.submitActionEvidence(evidence, options);
  }

  submitWorkspaceCommand(orchestrator: TutorSessionOrchestratorV7, command: Parameters<TutorSessionOrchestratorV7["submitWorkspaceCommand"]>[0], options?: V7InputTurnOptions): V7CommandTurnResult {
    return orchestrator.submitWorkspaceCommand(command, options);
  }

  reportPresentationOutcome(orchestrator: TutorSessionOrchestratorV7, request: V7PresentationOutcomeRequest): V7OutcomeTurnResult {
    return orchestrator.reportPresentationOutcome(request);
  }
}

export { TutorTaskBindingResolver };

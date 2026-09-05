/**
 * F7 Step 6：canonical experience 的 PresentationRuntime 装配（唯一实例的
 * 组装点——useTutorLearning 以 runtimeClient 为 scope 创建一次）。
 *
 * 依赖注入保持纯函数工厂（可测）；outcome port = 当前 TutorRuntimeClient
 * 的 reportPresentationOutcome（spec §0 裁决 8：presentation outcome 与
 * 其他输入同经唯一 client，组件不得直连 transport）。Voice adapter 复用
 * useTutorLearning 的既有 NarrationController + MediaSessionController 实例
 * （PLAN §3 Step 6：不建第二媒体会话）。
 */
import { TutorRuntimeHttpError, type TutorRuntimeClient, type ValidatedSessionSnapshot } from "../../api/tutorRuntimeClient";
import type { MediaSessionController } from "../audio/MediaSessionController";
import type { NarrationController } from "../narration/NarrationController";
import { createVoicePresentationAdapter } from "./adapters/voicePresentationAdapter";
import { createBoardPresentationAdapter, createGeometryPresentationAdapter } from "./adapters/workspaceSurfaceAdapters";
import { createCapabilityRegistry } from "./capabilityRegistry";
import { PresentationRuntimeController } from "./PresentationRuntimeController";
import type { PendingPresentationOutcomeRequest, PresentationRuntimePhase, PresentationRuntimePorts } from "./types";
import { createWorkspaceCommitPort, type WorkspaceCommitPort } from "./workspaceCommitPort";

export interface TutorPresentationRuntimeDependencies {
  client: TutorRuntimeClient;
  narration: NarrationController;
  media: MediaSessionController;
  /** outcome 响应快照经同一 adopt 门禁采用（useTutorLearning.adoptRuntimeSnapshot；
   *  expectedSessionId 供拒绝跨会话迟到响应）。 */
  adoptOutcomeSnapshot(snapshot: ValidatedSessionSnapshot, expectedSessionId: string): boolean;
  /** 协议异常（fail closed 通知；hook 映射到 protocolError 通道）。 */
  onProtocolAnomaly(message: string): void;
  /** 瞬时失败提示（hook 映射到 runtimeFailureNotice 通道）。 */
  onNotice(message: string): void;
  /** 执行状态投影（hook 落 React state 驱动播放控件）。 */
  onStateChanged(state: PresentationRuntimePhase): void;
}

export interface TutorPresentationRuntime {
  controller: PresentationRuntimeController;
  commitPort: WorkspaceCommitPort;
}

export function createTutorPresentationRuntime(deps: TutorPresentationRuntimeDependencies): TutorPresentationRuntime {
  const commitPort = createWorkspaceCommitPort();
  const voice = createVoicePresentationAdapter({ narration: deps.narration, media: deps.media });
  const geometry = createGeometryPresentationAdapter({ commitPort });
  const board = createBoardPresentationAdapter({ commitPort });
  const adapters = [voice, geometry, board];
  const registry = createCapabilityRegistry(adapters);

  const ports: PresentationRuntimePorts = {
    reportOutcome: (request: PendingPresentationOutcomeRequest) =>
      deps.client.reportPresentationOutcome(request.sessionId, request.actionId, {
        sequenceId: request.sequenceId,
        ordinal: request.ordinal,
        outcome: request.outcome,
        ...(request.failureClass !== undefined ? { failureClass: request.failureClass } : {}),
        ...(request.message !== undefined ? { message: request.message } : {}),
        clientRequestId: request.clientRequestId,
        expectedRevision: request.expectedRevision,
      }),
    adoptOutcomeSnapshot: (snapshot, expectedSessionId) => deps.adoptOutcomeSnapshot(snapshot, expectedSessionId),
    onProtocolAnomaly: deps.onProtocolAnomaly,
    onNotice: deps.onNotice,
    onStateChanged: deps.onStateChanged,
    isDefinitiveFailure: (failure: unknown) =>
      failure instanceof TutorRuntimeHttpError && failure.status >= 400 && failure.status < 500,
  };

  const controller = new PresentationRuntimeController(registry, adapters, ports);
  return { controller, commitPort };
}

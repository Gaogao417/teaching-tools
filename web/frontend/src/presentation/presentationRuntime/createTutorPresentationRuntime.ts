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
import {
  createBoardExplainPresentationAdapter,
  createBoardPresentationAdapter,
  createGeometryEmphasizePresentationAdapter,
  createGeometryPresentationAdapter,
} from "./adapters/workspaceSurfaceAdapters";
import { createCapabilityRegistry } from "./capabilityRegistry";
import { PresentationRuntimeController } from "./PresentationRuntimeController";
import type { PendingPresentationOutcomeRequest, PresentationRuntimePhase, PresentationRuntimePorts } from "./types";
import { createWorkspaceCommitPort, type WorkspaceCommitPort } from "./workspaceCommitPort";
import { createGeometryVisualPresentationAdapter } from "./adapters/geometryVisualPresentationAdapter";
import { presentationClientInstanceId } from "./PresentationExecutionOwner";
import { visualRuntimeSnapshot } from "./visualRuntimeSnapshot";

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
  /** F7 P2（S1 裁定①）：销毁 = controller 失效 + 停用 narration 挂起互斥
   *  （媒体 session 属主是 useTutorLearning，实例不在此销毁）。 */
  dispose(): void;
}

export function createTutorPresentationRuntime(deps: TutorPresentationRuntimeDependencies): TutorPresentationRuntime {
  const commitPort = createWorkspaceCommitPort();
  const voice = createVoicePresentationAdapter({ narration: deps.narration, media: deps.media });
  const geometry = createGeometryPresentationAdapter({ commitPort });
  const board = createBoardPresentationAdapter({ commitPort });
  // F7 P2（S1 R7）：动态板书解释（board.explain，EF- 内容链）——复用同一
  // commitPort/reveal 渲染链，不建第二 Board 状态机。
  const boardExplain = createBoardExplainPresentationAdapter({ commitPort });
  // F7 P3（FM-7-5）：geometry.emphasize（既有实体高亮）——同一 commitPort/
  // visualState 渲染链；服务端 capability 注册前不进模型可见集（B 轨前置）。
  const geometryEmphasize = createGeometryEmphasizePresentationAdapter({ commitPort });
  const adapters = [voice, geometry, board, boardExplain, geometryEmphasize, createGeometryVisualPresentationAdapter(commitPort)];
  const registry = createCapabilityRegistry(adapters);

  let baselineInstallation = 0;
  const ports: PresentationRuntimePorts = {
    visualSurfaceGeneration: () => commitPort.visualRenderer.generation(),
    clientInstanceId: presentationClientInstanceId(),
    visualSnapshotReady: snapshot => {
      const visual = visualRuntimeSnapshot(snapshot);
      return !visual || commitPort.visualRenderer.isReady(visual.view);
    },
    prepareVisualSnapshot: async (snapshot, abort) => {
      const visual = visualRuntimeSnapshot(snapshot);
      if (!visual) return true;
      if (!commitPort.visualRenderer.hasSurface()) return false;
      await commitPort.visualRenderer.render(visual.view, {
        sessionId: snapshot.session_id, executionKey: `baseline:${snapshot.session_id}:${visual.view.visual_revision}:${visual.view.digest}:${++baselineInstallation}`,
        visualRevision: visual.view.visual_revision, targetDigest: visual.view.digest, operation: "installed", abort,
      });
      return true;
    },
    suppressVisualSnapshot: snapshot => {
      const visual = visualRuntimeSnapshot(snapshot);
      if (visual) commitPort.visualRenderer.suppress("*");
    },
    reportOutcome: request => reportOutcomeWithVoiceAuthority(deps.client, request),
    adoptOutcomeSnapshot: (snapshot, expectedSessionId) => deps.adoptOutcomeSnapshot(snapshot, expectedSessionId),
    onProtocolAnomaly: deps.onProtocolAnomaly,
    onNotice: deps.onNotice,
    onStateChanged: deps.onStateChanged,
    isDefinitiveFailure: (failure: unknown) =>
      failure instanceof TutorRuntimeHttpError && failure.status >= 400 && failure.status < 500,
  };

  const controller = new PresentationRuntimeController(registry, adapters, ports);
  // F7 P2（S1 裁定①）：媒体 session 单一互斥——录音占用麦克风期间到达的
  // narration 播放挂起（delivered≠presented 延迟起播），capture 释放后自动起播；
  // 与 recorder 的 interruptPlaybackOnStart（录音开始打断在播 narration）同属
  // 本 session 的互斥规则。canonical runtime 生命周期内启用，销毁时停用。
  deps.media.setNarrationHoldDuringCapture(true);
  return {
    controller,
    commitPort,
    dispose() {
      deps.media.setNarrationHoldDuringCapture(false);
      controller.dispose();
    },
  };
}

/** A committed ACK can be delayed behind another page's claim. Before it starts
 * voice, read current authority; workspace-only outcomes do not add a read. */
export async function reportOutcomeWithVoiceAuthority(client: TutorRuntimeClient, request: PendingPresentationOutcomeRequest): Promise<ValidatedSessionSnapshot> {
  const snapshot = await client.reportPresentationOutcome(request.sessionId, request.actionId, {
    sequenceId: request.sequenceId, ordinal: request.ordinal, outcome: request.outcome,
    ...(request.failureClass !== undefined ? { failureClass: request.failureClass } : {}),
    ...(request.message !== undefined ? { message: request.message } : {}),
    clientRequestId: request.clientRequestId, expectedRevision: request.expectedRevision,
    ...(request.executionOwner ? { executionOwner: request.executionOwner } : {}),
    ...(request.holdForControl ? { holdForControl: request.holdForControl } : {}),
  });
  if (!request.executionOwner || !snapshot.presentation_execution_owner
    || snapshot.pending_presentation?.action.kind !== "voice"
    || (snapshot.turn && snapshot.turn.status !== "committed")) return snapshot;
  const fresh = await client.restore(request.sessionId);
  if (fresh.session_id !== request.sessionId || fresh.revision < snapshot.revision) {
    throw new Error("voice authority snapshot changed session or regressed revision");
  }
  return fresh;
}

/**
 * tutorPresentation 域出口（Phase 5 / P5-09/10；2026-08-21 追加裁定 §6）。
 */
export type { VoiceActionPlan, VoiceCompletion } from "./VoiceAction";
export type {
  WorkspaceActionPlan,
  WorkspaceCompletion,
  WorkspaceIssuedContext,
  ValidatedWorkspaceAction,
} from "./WorkspaceAction";
export { VOICE_SCAFFOLDS } from "./VoiceAction";
export {
  preparePresentation,
  resolveWorkspacePresentation,
  isVoiceResourceKind,
  isWorkspaceResourceKind,
  type PresentationPlan,
  type PresentationResult,
  type ValidatedPresentation,
  type WorkspaceResolution,
} from "./PreparePresentation";
export {
  validateWorkspaceAction,
  evaluateWorkspaceEvidence,
  type WorkspaceActionContext,
} from "./adapters/legacyActionRuntime/workspaceActionAdapter";

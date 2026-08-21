/**
 * tutorPresentation 域出口（Phase 5 / P5-09/10）。
 */
export type { VoiceActionPlan, VoiceCompletion } from "./VoiceAction";
export type { WorkspaceActionPlan, WorkspaceCompletion, WorkspaceIssuedContext } from "./WorkspaceAction";
export { VOICE_SCAFFOLDS } from "./VoiceAction";
export { preparePresentation, type PresentationPlan, type PresentationResult } from "./PreparePresentation";
export {
  validateWorkspaceAction,
  evaluateWorkspaceEvidence,
  type WorkspaceActionContext,
} from "./adapters/legacyActionRuntime/workspaceActionAdapter";

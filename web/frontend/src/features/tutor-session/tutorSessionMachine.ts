/**
 * Tutor 会话 XState 控制器（Phase 5 remediation 波次 E）。
 *
 * 状态机骨架（完整收口计划 §3.1）：starting / awaiting-input / thinking /
 * speaking / workspace-active / interrupted / recovering / completed。
 * 纯状态迁移——IO 全在 useTutorSession hook；machine 只回答「现在处于哪个
 * 教学相位、允许哪些学生动作」。刷新恢复走 RESTORE 事件（pending actions
 * 来自 backend GET，不靠前端内存重建）。
 */
import { setup } from "xstate";

export interface TutorSessionMachineContext {
  sessionId?: string;
  revision: number;
  lastTurnId?: string;
  errorMessage?: string;
  /** 最近一次打断→停止播放的时延（ms，barge-in 口径 <150）。 */
  lastBargeInLatencyMs?: number;
}

export type TutorSessionEvent =
  | { type: "SESSION_STARTED"; sessionId: string; revision: number }
  | { type: "RESTORED"; sessionId: string; revision: number }
  | { type: "TURN_RECEIVED"; revision: number; turnId: string; hasVoice: boolean; hasWorkspace: boolean; completed: boolean }
  | { type: "VOICE_DONE"; revision: number }
  | { type: "SUBMIT_INPUT" }
  | { type: "BARGE_IN"; latencyMs: number }
  | { type: "RESUME_FROM_INTERRUPT" }
  | { type: "WORKSPACE_SUBMITTED" }
  | { type: "RETRY" }
  | { type: "FAILED"; message: string }
  | { type: "COMPLETED" };

export const tutorSessionMachine = setup({
  types: {
    context: {} as TutorSessionMachineContext,
    events: {} as TutorSessionEvent,
  },
  actions: {
    rememberSession: ({ event, context }) => {
      if (event.type === "SESSION_STARTED" || event.type === "RESTORED") {
        context.sessionId = event.sessionId;
        context.revision = event.revision;
      }
    },
    applyTurn: ({ event, context }) => {
      if (event.type === "TURN_RECEIVED") {
        context.revision = event.revision;
        context.lastTurnId = event.turnId;
        context.errorMessage = undefined;
      }
    },
    applyVoiceDone: ({ event, context }) => {
      if (event.type === "VOICE_DONE") context.revision = event.revision;
    },
    recordBargeIn: ({ event, context }) => {
      if (event.type === "BARGE_IN") context.lastBargeInLatencyMs = event.latencyMs;
    },
    recordError: ({ event, context }) => {
      if (event.type === "FAILED") context.errorMessage = event.message;
    },
    clearError: ({ context }) => {
      context.errorMessage = undefined;
    },
  },
}).createMachine({
  id: "tutor-session",
  initial: "starting",
  context: {
    revision: 0,
  },
  states: {
    starting: {
      on: {
        SESSION_STARTED: { actions: "rememberSession", target: "speaking" },
        RESTORED: { actions: "rememberSession", target: "awaitingInput" },
        FAILED: { actions: "recordError", target: "recovering" },
      },
    },
    speaking: {
      on: {
        VOICE_DONE: [
          { target: "workspaceActive", guard: ({ event }) => (event as { hasWorkspace?: boolean }).hasWorkspace === true },
          { target: "awaitingInput" },
        ],
        BARGE_IN: { actions: "recordBargeIn", target: "interrupted" },
      },
    },
    awaitingInput: {
      on: {
        SUBMIT_INPUT: "thinking",
        BARGE_IN: { actions: "recordBargeIn", target: "interrupted" },
        COMPLETED: "completed",
      },
    },
    thinking: {
      on: {
        TURN_RECEIVED: [
          { actions: "applyTurn", target: "completed", guard: ({ event }) => event.type === "TURN_RECEIVED" && event.completed },
          { actions: "applyTurn", target: "speaking", guard: ({ event }) => event.type === "TURN_RECEIVED" && event.hasVoice },
          { actions: "applyTurn", target: "workspaceActive", guard: ({ event }) => event.type === "TURN_RECEIVED" && event.hasWorkspace },
          { actions: "applyTurn", target: "awaitingInput" },
        ],
        FAILED: { actions: "recordError", target: "recovering" },
      },
    },
    workspaceActive: {
      on: {
        WORKSPACE_SUBMITTED: "thinking",
        FAILED: { actions: "recordError", target: "recovering" },
        COMPLETED: "completed",
      },
    },
    interrupted: {
      on: {
        RESUME_FROM_INTERRUPT: "awaitingInput",
      },
    },
    recovering: {
      on: {
        RETRY: { actions: "clearError", target: "awaitingInput" },
        COMPLETED: "completed",
      },
    },
    completed: {
      type: "final",
    },
  },
});

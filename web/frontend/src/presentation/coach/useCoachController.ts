import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CoachAudioInput, LearningMode } from "../../../../shared/actionRuntime";
import { api } from "../../api/client";
import type { MediaSessionController } from "../audio/MediaSessionController";
import {
  CoachController,
  reduceCoachThread,
  type CoachControllerCallbacks,
  type CoachRuntimePort,
  type CoachThreadEvent,
  type CoachThreadMessage,
  type CoachTurnClient,
  type CoachTurnPlanContext,
  type CoachTurnTransport,
} from "./CoachController";
import { useCoachRecorder } from "./useCoachRecorder";
import { useRealtimeCoach, type RealtimeStartContext, type UseRealtimeCoach } from "./useRealtimeCoach";

/**
 * ADR-005 §Layer Responsibilities — the composition root that turns the
 * `CoachController` + the recorder/live capture hooks into a single typed view
 * the Frame consumes. This is where coach turn / recorder / live orchestration
 * now lives; `ActionRuntimeFrame` is pure presentation over this view.
 *
 * Responsibilities kept here (moved out of the Frame):
 *  - coach thread state + composer text,
 *  - wiring the recorder's audio into a coach turn,
 *  - merging the live transcript into the thread,
 *  - cancelling in-flight coach/TTS on Action switch, unmount, and live start.
 */

export interface UseCoachControllerParams {
  media: MediaSessionController;
  canHelp: boolean;
  transport: CoachTurnTransport | undefined;
  local: boolean;
  sessionId: string;
  taskId?: string;
  exerciseId: string;
  mode: LearningMode;
  currentActionId: string;
  instruction: string;
  runtime: CoachRuntimePort;
  /** Play a coach reply audio URL (non-stream path). Typically narration's speak(). */
  playSpeechUrl?: (url: string) => void;
}

export interface CoachView {
  busy: boolean;
  thread: CoachThreadMessage[];
  studentMessage: string;
  setStudentMessage(text: string): void;
  recording: boolean;
  toggleRecorder(): void;
  realtime: UseRealtimeCoach;
  askCoach(input?: { message?: string; audio?: CoachAudioInput }): Promise<boolean>;
}

export function useCoachController(params: UseCoachControllerParams): CoachView {
  const { media, runtime, playSpeechUrl, currentActionId, instruction } = params;

  // Latest plan/session context held in refs so the stable controller and the
  // recorder's onAudio callback always read the current Action without forcing
  // the controller (and thus the turn AbortController) to be recreated.
  const planContextRef = useRef(params);
  planContextRef.current = params;
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const playSpeechUrlRef = useRef(playSpeechUrl);
  playSpeechUrlRef.current = playSpeechUrl;

  const client = useMemo<CoachTurnClient>(() => ({
    stream: (payload, onEvent, signal) => api.streamActionCoach(payload, onEvent, signal),
    request: (payload, options) => api.conductActionCoach(payload, options),
  }), []);

  const [thread, setThread] = useState<CoachThreadMessage[]>([]);
  const [studentMessage, setStudentMessage] = useState("");
  const threadRef = useRef(thread);
  threadRef.current = thread;
  const studentMessageRef = useRef(studentMessage);
  studentMessageRef.current = studentMessage;

  const onThreadEvent = useCallback((event: CoachThreadEvent) => {
    setThread((current) => reduceCoachThread(current, event));
  }, []);

  const callbacks = useMemo<CoachControllerCallbacks>(() => ({
    runtime: {
      recordAssistance: (kind) => runtimeRef.current.recordAssistance(kind),
      getTrace: (message) => runtimeRef.current.getTrace(message),
      applyCoach: (directive) => runtimeRef.current.applyCoach(directive),
    },
    playSpeechUrl: (url) => playSpeechUrlRef.current?.(url),
    onThreadEvent,
  }), [onThreadEvent]);

  const controller = useMemo(() => new CoachController({ media, client, callbacks }), [media, client, callbacks]);

  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(controller.getStatus().busy);
    return controller.subscribe(() => setBusy(controller.getStatus().busy));
  }, [controller]);

  const askCoach = useCallback(async (input?: { message?: string; audio?: CoachAudioInput }): Promise<boolean> => {
    const p = planContextRef.current;
    if (!p.canHelp) return false;
    const ctx: CoachTurnPlanContext = {
      transport: p.transport,
      local: p.local,
      sessionId: p.sessionId,
      taskId: p.taskId,
      exerciseId: p.exerciseId,
      mode: p.mode,
      currentActionId: p.currentActionId,
      studentText: studentMessageRef.current,
      previousConversation: threadRef.current
        .filter((turn) => !turn.pending && !turn.error)
        .map(({ role, text }) => ({ role, text })),
    };
    const assistanceKind = input?.message?.includes("没听懂") ? "hint" : "coach";
    const started = await controller.startTurn(input ?? {}, ctx, assistanceKind);
    if (started) setStudentMessage("");
    return started;
  }, [controller]);

  const realtime = useRealtimeCoach(media);

  // Merge the live transcript into the shared coach thread.
  useEffect(() => {
    if (!realtime.transcript.length) return;
    setThread((current) => {
      const liveIds = new Set(realtime.transcript.map((item) => item.id));
      return [
        ...current.filter((item) => !liveIds.has(item.id)),
        ...realtime.transcript.map((item) => ({ id: item.id, role: item.role, text: item.text })),
      ];
    });
  }, [realtime.transcript]);

  // Keep the live session apprised of the current Action while it is active.
  useEffect(() => {
    if (realtime.active) realtime.updateContext(currentActionId, instruction);
  }, [realtime.active, realtime.updateContext, currentActionId, instruction]);

  // Advancing to a new Action (or unmounting) cancels any in-flight coach turn
  // and its audio. This is also what lets a new turn preempt an old one.
  useEffect(() => {
    return () => { controller.cancel("action-switch"); };
  }, [controller, currentActionId]);

  // Full controller teardown on unmount.
  useEffect(() => () => controller.dispose(), [controller]);

  const recorder = useCoachRecorder({
    media,
    disabled: busy || realtime.active,
    onAudio: (audio) => { void askCoach({ audio }); },
    onError: (text) => setThread((current) => [...current, { id: crypto.randomUUID(), role: "coach" as const, text, error: true }]),
  });

  // Starting a live session preempts any in-flight coach/TTS request.
  const startRealtime = useCallback((ctx: RealtimeStartContext): Promise<void> => {
    controller.cancel("live-start");
    return realtime.start(ctx);
  }, [controller, realtime]);

  return {
    busy,
    thread,
    studentMessage,
    setStudentMessage,
    recording: recorder.recording,
    toggleRecorder: recorder.toggle,
    realtime: { ...realtime, start: startRealtime },
    askCoach,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import {
  COACH_MEDIA_PROTOCOL_VERSION,
  isLiveCoachServerEvent,
  type LiveCoachClientEvent,
} from "../../../../shared/coachMedia";
import type { CaptureLease, MediaSessionController } from "../audio/MediaSessionController";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export interface RealtimeTranscriptItem { id: string; role: "student" | "coach"; text: string }
export interface RealtimeStartContext {
  sessionId?: string;
  taskId?: string;
  exerciseId: string;
  actionId: string;
  mode: "learn" | "guided-practice";
}
export interface UseRealtimeCoach {
  active: boolean; connecting: boolean; error: string | null; transcript: RealtimeTranscriptItem[];
  start: (ctx: RealtimeStartContext) => Promise<void>; updateContext: (actionId: string, instruction: string) => void; stop: () => void;
}
type ClientPayload = LiveCoachClientEvent extends infer Event
  ? Event extends LiveCoachClientEvent ? Omit<Event, "version" | "correlationId" | "sessionId" | "sequence" | "at"> : never
  : never;

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value); const out = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) out[index] = binary.charCodeAt(index);
  return out;
}

/** Provider-neutral live Coach client. Capture starts only after the backend emits live.ready. */
export function useRealtimeCoach(media?: MediaSessionController): UseRealtimeCoach {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<RealtimeTranscriptItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef = useRef(0);
  const sequenceRef = useRef(0);
  const correlationRef = useRef("");
  const sessionRef = useRef("");
  // ADR-005 §Exclusive media session: the mic lease acquired on live.ready and
  // released on teardown, so a turn recording and a live session never share it.
  const captureLeaseRef = useRef<CaptureLease | null>(null);

  const interruptPlayback = useCallback(() => {
    scheduledRef.current.forEach((node) => { try { node.onended = null; node.stop(); } catch { /* ended */ } });
    scheduledRef.current = [];
    if (audioCtxRef.current) nextStartRef.current = audioCtxRef.current.currentTime;
  }, []);

  const teardownAudio = useCallback(() => {
    interruptPlayback();
    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    try { sourceRef.current?.disconnect(); } catch { /* ignore */ }
    workletRef.current = null; sourceRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    captureLeaseRef.current?.release();
    captureLeaseRef.current = null;
    media?.release("live");
  }, [interruptPlayback, media]);

  const stop = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    teardownAudio();
    setActive(false); setConnecting(false);
  }, [teardownAudio]);

  const envelope = useCallback((event: ClientPayload): LiveCoachClientEvent => ({
    ...event,
    version: COACH_MEDIA_PROTOCOL_VERSION,
    correlationId: correlationRef.current,
    sessionId: sessionRef.current,
    sequence: sequenceRef.current++,
    at: new Date().toISOString(),
  } as LiveCoachClientEvent), []);

  const setupAudio = useCallback(async (ws: WebSocket, inputSampleRate: number) => {
    const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) throw new Error("此浏览器不支持 AudioContext");
    // ADR-005 §Exclusive media session: acquire the mic before getUserMedia.
    // A turn recording holding the mic denies this — live fails gracefully with
    // a user-facing error instead of silently sharing the microphone.
    const captureLease = media?.acquireCapture("live") ?? null;
    if (media && !captureLease) throw new Error("录音正在进行，无法同时开始实时通话，请先停止录音。");
    captureLeaseRef.current = captureLease;
    const audioCtx = new AudioCtor();
    audioCtxRef.current = audioCtx;
    try {
      await audioCtx.audioWorklet.addModule("/realtime-capture-worklet.js");
      await audioCtx.resume();
      nextStartRef.current = audioCtx.currentTime;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const source = audioCtx.createMediaStreamSource(stream);
      sourceRef.current = source;
      const worklet = new AudioWorkletNode(audioCtx, "pcm16-capture");
      workletRef.current = worklet;
      source.connect(worklet);
      worklet.port.onmessage = (message: MessageEvent) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify(envelope({ type: "live.audio", audioBase64: base64FromBytes(new Uint8Array(message.data as ArrayBuffer)), mimeType: "audio/pcm", sampleRate: inputSampleRate })));
      };
    } catch (error) {
      // Permission denied / worklet load failed / device error: release the mic
      // so a turn recording is not blocked, then propagate the failure.
      captureLeaseRef.current?.release();
      captureLeaseRef.current = null;
      throw error;
    }
    media?.acquire("live", () => { try { ws.close(); } catch { /* ignore */ } teardownAudio(); }, correlationRef.current);
  }, [envelope, media, teardownAudio]);

  const playPcm = useCallback((audioBase64: string, sampleRate: number) => {
    const audioCtx = audioCtxRef.current; if (!audioCtx) return;
    const int16 = new Int16Array(bytesFromBase64(audioBase64).buffer);
    const buffer = audioCtx.createBuffer(1, int16.length, sampleRate);
    const channel = new Float32Array(int16.length);
    for (let index = 0; index < int16.length; index += 1) channel[index] = int16[index] / 0x8000;
    buffer.copyToChannel(channel, 0);
    const node = audioCtx.createBufferSource(); node.buffer = buffer; node.connect(audioCtx.destination);
    media?.notifyAudioStarted("live");
    const startAt = Math.max(nextStartRef.current, audioCtx.currentTime); node.start(startAt); nextStartRef.current = startAt + buffer.duration;
    node.onended = () => { scheduledRef.current = scheduledRef.current.filter((item) => item !== node); };
    scheduledRef.current.push(node);
  }, [media]);

  const appendTranscript = useCallback((role: "student" | "coach", text: string) => {
    if (!text) return;
    setTranscript((current) => {
      const last = current[current.length - 1];
      if (last?.role === role) return [...current.slice(0, -1), { ...last, text: (last.text + text).slice(-600) }];
      return [...current, { id: crypto.randomUUID(), role, text }];
    });
  }, []);

  const start = useCallback(async (ctx: RealtimeStartContext) => {
    if (wsRef.current || connecting || active || ctx.mode === ("assessment" as string)) return;
    setError(null); setTranscript([]); setConnecting(true);
    correlationRef.current = crypto.randomUUID(); sessionRef.current = ctx.sessionId || `learn:${ctx.taskId}`; sequenceRef.current = 0;
    const params = new URLSearchParams(ctx.sessionId ? { sessionId: ctx.sessionId } : { taskId: ctx.taskId || "" });
    const ws = new WebSocket(`${API_BASE_URL.replace(/^http/i, "ws")}/api/coach-realtime?${params.toString()}`);
    wsRef.current = ws;
    ws.onopen = () => ws.send(JSON.stringify(envelope({ type: "live.start", exerciseId: ctx.exerciseId, actionId: ctx.actionId, mode: ctx.mode })));
    ws.onmessage = (message) => {
      let event: unknown; try { event = JSON.parse(String(message.data)); } catch { return; }
      if (!isLiveCoachServerEvent(event)) { setError("实时对话协议错误"); stop(); return; }
      switch (event.type) {
        case "live.ready":
          void setupAudio(ws, event.inputSampleRate).then(() => { setActive(true); setConnecting(false); }).catch((reason) => { setError((reason as Error).message); stop(); });
          break;
        case "live.audio": playPcm(event.audioBase64, event.sampleRate); break;
        case "live.interrupted": interruptPlayback(); break;
        case "live.transcript.delta": appendTranscript(event.role, event.text); break;
        case "live.error": setError(event.code); stop(); break;
        default: break;
      }
    };
    ws.onerror = () => { setError("实时对话连接出错"); stop(); };
    ws.onclose = () => { wsRef.current = null; teardownAudio(); setActive(false); setConnecting(false); };
  }, [active, appendTranscript, connecting, envelope, interruptPlayback, playPcm, setupAudio, stop, teardownAudio]);

  const updateContext = useCallback((actionId: string, instruction: string) => {
    const ws = wsRef.current;
    if (!active || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(envelope({ type: "live.update-context", actionId, instruction })));
  }, [active, envelope]);

  useEffect(() => () => stop(), [stop]);
  return { active, connecting, error, transcript, start, updateContext, stop };
}

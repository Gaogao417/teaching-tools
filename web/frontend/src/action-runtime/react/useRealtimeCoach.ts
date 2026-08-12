import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
const PLAYBACK_SAMPLE_RATE = 24_000;

export interface RealtimeTranscriptItem {
  id: string;
  role: "student" | "coach";
  text: string;
}

export interface RealtimeStartContext {
  sessionId?: string;
  taskId?: string;
  exerciseId?: string;
}

export interface UseRealtimeCoach {
  active: boolean;
  connecting: boolean;
  error: string | null;
  transcript: RealtimeTranscriptItem[];
  start: (ctx: RealtimeStartContext) => Promise<void>;
  stop: () => void;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function bytesFromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Full-duplex realtime voice coach. Opens a WebSocket to the backend relay
 * (which bridges to DashScope qwen-omni-realtime), streams microphone audio
 * (16 kHz Int16 PCM via an AudioWorklet), plays the model's 24 kHz PCM replies
 * through a gapless scheduled buffer queue, and exposes a live transcript.
 *
 * All audio I/O lives here; the host component only renders the button + the
 * transcript so the integration footprint on shared files stays minimal.
 */
export function useRealtimeCoach(): UseRealtimeCoach {
  const [active, setActive] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<RealtimeTranscriptItem[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const scheduledRef = useRef<AudioBufferSourceNode[]>([]);
  const nextStartRef = useRef(0);

  const teardownAudio = useCallback(() => {
    scheduledRef.current.forEach((node) => {
      try { node.onended = null; node.stop(); } catch { /* already stopped */ }
    });
    scheduledRef.current = [];
    try { workletRef.current?.disconnect(); } catch { /* ignore */ }
    workletRef.current = null;
    try { sourceNodeRef.current?.disconnect(); } catch { /* ignore */ }
    sourceNodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
  }, []);

  const stop = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    teardownAudio();
    setActive(false);
    setConnecting(false);
  }, [teardownAudio]);

  const start = useCallback(async (ctx: RealtimeStartContext) => {
    if (wsRef.current || connecting || active) return;
    setError(null);
    setTranscript([]);
    setConnecting(true);

    let ws: WebSocket | null = null;
    try {
      const params = new URLSearchParams();
      if (ctx.sessionId) params.set("sessionId", ctx.sessionId);
      if (ctx.taskId) params.set("taskId", ctx.taskId);
      if (ctx.exerciseId) params.set("exerciseId", ctx.exerciseId);
      const wsBase = API_BASE_URL.replace(/^http/i, "ws");
      ws = new WebSocket(`${wsBase}/api/coach-realtime?${params.toString()}`);
      wsRef.current = ws;

      // Dedicated AudioContext for both capture (worklet) and 24 kHz playback.
      const AudioCtor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtor) throw new Error("此浏览器不支持 AudioContext");
      const audioCtx = new AudioCtor();
      audioCtxRef.current = audioCtx;
      await audioCtx.audioWorklet.addModule("/realtime-capture-worklet.js");
      await audioCtx.resume();
      nextStartRef.current = audioCtx.currentTime;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const sourceNode = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;
      const worklet = new AudioWorkletNode(audioCtx, "pcm16-capture");
      workletRef.current = worklet;
      sourceNode.connect(worklet);
      worklet.port.onmessage = (event: MessageEvent) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: "input_audio_buffer.append",
          audio: base64FromBytes(new Uint8Array(event.data as ArrayBuffer)),
        }));
      };

      const interruptPlayback = () => {
        scheduledRef.current.forEach((node) => {
          try { node.onended = null; node.stop(); } catch { /* ignore */ }
        });
        scheduledRef.current = [];
        nextStartRef.current = audioCtx.currentTime;
      };
      const playPcm = (base64: string) => {
        const int16 = new Int16Array(bytesFromBase64(base64).buffer);
        const float = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float[i] = int16[i] / 0x8000;
        const buffer = audioCtx.createBuffer(1, float.length, PLAYBACK_SAMPLE_RATE);
        buffer.copyToChannel(float, 0);
        const node = audioCtx.createBufferSource();
        node.buffer = buffer;
        node.connect(audioCtx.destination);
        const startAt = Math.max(nextStartRef.current, audioCtx.currentTime);
        node.start(startAt);
        nextStartRef.current = startAt + buffer.duration;
        node.onended = () => {
          scheduledRef.current = scheduledRef.current.filter((item) => item !== node);
        };
        scheduledRef.current.push(node);
      };
      const appendCoachDelta = (delta: string) => {
        if (!delta) return;
        setTranscript((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "coach") {
            const updated = prev.slice();
            updated[updated.length - 1] = { ...last, text: (last.text + delta).slice(-600) };
            return updated;
          }
          return [...prev, { id: crypto.randomUUID(), role: "coach", text: delta }];
        });
      };
      const pushStudent = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        setTranscript((prev) => [...prev, { id: crypto.randomUUID(), role: "student", text: trimmed }]);
      };
      const handleEvent = (raw: string) => {
        let event: Record<string, any>;
        try { event = JSON.parse(raw); } catch { return; }
        switch (event.type) {
          case "response.audio.delta":
            if (typeof event.delta === "string") playPcm(event.delta);
            break;
          case "input_audio_buffer.speech_started":
            interruptPlayback();
            break;
          case "response.audio_transcript.delta":
            appendCoachDelta(String(event.delta || ""));
            break;
          case "conversation.item.input_audio_transcription.completed":
            pushStudent(String(event.transcript || event.item?.content?.[0]?.transcript || ""));
            break;
          case "error":
            setError(String(event.error?.message || "模型返回错误"));
            break;
          default:
            break;
        }
      };

      ws.onopen = () => { setActive(true); setConnecting(false); };
      ws.onmessage = (event) => handleEvent(String(event.data));
      ws.onerror = () => { setError("实时对话连接出错"); stop(); };
      ws.onclose = () => { stop(); };
    } catch (e) {
      setError((e as Error).message || "无法开始实时对话");
      if (ws) { try { ws.close(); } catch { /* ignore */ } wsRef.current = null; }
      teardownAudio();
      setConnecting(false);
      setActive(false);
    }
  }, [active, connecting, stop, teardownAudio]);

  useEffect(() => () => stop(), [stop]);

  return { active, connecting, error, transcript, start, stop };
}

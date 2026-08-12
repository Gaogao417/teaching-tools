import WebSocket from "ws";
import type { Result } from "../ports/TextCoachEngine";
import type {
  CoachContext,
  RealtimeVoiceCommand,
  RealtimeVoiceEvent,
  RealtimeVoiceProvider,
  RealtimeVoiceSession,
} from "../ports/RealtimeVoiceProvider";
import { RealtimeVoiceError } from "../ports/RealtimeVoiceProvider";
import { AsyncQueue } from "../application/asyncQueue";
import { SYSTEM_PROMPT } from "../claudeCodeCoachService";

/**
 * DashScope (Qwen-Omni-Realtime) adapter for the provider-neutral
 * {@link RealtimeVoiceProvider} port. This is the ONLY place that knows about the
 * upstream provider: its WebSocket URL, model id, API key, voice id and raw
 * event protocol. Everything reachable from the application and transport sees
 * only typed public events.
 *
 * Provider/model/voice names appear here, in the composition root and in
 * telemetry — nowhere else (ADR-005 §Backend effect ports, §Architectural
 * Invariants #7).
 */

const VOICE_STYLE = "语音风格：像耐心的中学数学老师，语速稍慢、重点清楚；数学表达使用自然口语，不念 LaTeX 命令。";
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

function realtimeHost(): string {
  return (process.env.DASHSCOPE_REALTIME_WS_URL?.trim() || "wss://dashscope.aliyuncs.com/api-ws/v1/realtime").replace(/\/+$/, "");
}
function realtimeModel(): string {
  return process.env.COACH_REALTIME_MODEL?.trim() || "qwen3.5-omni-plus-realtime";
}
function realtimeVoice(): string {
  return process.env.COACH_REALTIME_VOICE?.trim() || "Ethan";
}
function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new Error("realtime provider is not configured");
  return key;
}

/** Render the safe public context into the provider's instruction string. The
 *  context is already Assessment-stripped by the shared builder. */
function renderInstructions(context: CoachContext): string {
  return `${SYSTEM_PROMPT}\n\n当前题目：${context.problemLatex}\n教学模式：${context.mode}\n当前教学动作：${context.action.title}——${context.action.instruction}\n\n${VOICE_STYLE}`;
}

function sessionUpdate(context: CoachContext): Record<string, unknown> {
  return {
    type: "session.update",
    session: {
      modalities: ["text", "audio"],
      voice: realtimeVoice(),
      input_audio_format: "pcm",
      output_audio_format: "pcm",
      instructions: renderInstructions(context),
      turn_detection: { type: "semantic_vad", threshold: 0.5, silence_duration_ms: 800 },
    },
  };
}

export class DashScopeRealtimeVoiceAdapter implements RealtimeVoiceProvider {
  async open(context: CoachContext, signal: AbortSignal): Promise<Result<RealtimeVoiceSession, RealtimeVoiceError>> {
    let socket: WebSocket;
    try {
      const key = apiKey();
      socket = new WebSocket(`${realtimeHost()}?model=${encodeURIComponent(realtimeModel())}`, { headers: { Authorization: `Bearer ${key}` } });
    } catch {
      return { ok: false, error: new RealtimeVoiceError("provider-setup", "realtime provider is not configured", true) };
    }

    const queue = new AsyncQueue<RealtimeVoiceEvent>();
    let ready = false;
    let settled = false;

    return new Promise<Result<RealtimeVoiceSession, RealtimeVoiceError>>((resolve) => {
      const failOnce = (code: string, retryable: boolean): void => {
        if (settled) return;
        settled = true;
        queue.push({ type: "error", code, retryable });
        try { socket.close(); } catch { /* ignore */ }
        // If open never resolved, resolve it to an error; otherwise the pump surfaces the error event.
        resolve({ ok: false, error: new RealtimeVoiceError(code, "realtime provider handshake failed", retryable) });
      };

      const onAbort = (): void => {
        queue.push({ type: "closed", reason: "aborted" });
        try { socket.close(); } catch { /* ignore */ }
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });

      socket.on("open", () => {
        try { socket.send(JSON.stringify(sessionUpdate(context))); }
        catch { failOnce("provider-setup", true); }
      });

      socket.on("message", (data) => {
        let event: Record<string, any>;
        try { event = JSON.parse(data.toString()); } catch { failOnce("provider-protocol", true); return; }
        switch (event.type) {
          case "session.created":
          case "session.updated":
            if (!ready) {
              ready = true;
              queue.push({ type: "ready", inputSampleRate: INPUT_SAMPLE_RATE, outputSampleRate: OUTPUT_SAMPLE_RATE });
              if (!settled) { settled = true; resolve({ ok: true, value: makeSession(socket, queue, signal) }); }
            }
            break;
          case "response.audio.delta":
            if (typeof event.delta === "string") queue.push({ type: "audio-delta", audioBase64: event.delta, mimeType: "audio/pcm", sampleRate: OUTPUT_SAMPLE_RATE });
            break;
          case "input_audio_buffer.speech_started":
            queue.push({ type: "interrupted" });
            break;
          case "response.audio_transcript.delta":
            queue.push({ type: "transcript-delta", role: "coach", text: String(event.delta || "") });
            break;
          case "conversation.item.input_audio_transcription.completed":
            queue.push({ type: "transcript-delta", role: "student", text: String(event.transcript || event.item?.content?.[0]?.transcript || "") });
            break;
          case "response.done":
            queue.push({ type: "completed" });
            break;
          case "error":
            queue.push({ type: "error", code: String(event.error?.code || "provider-error"), retryable: true });
            break;
          default: break;
        }
      });

      socket.on("error", () => {
        if (!settled) failOnce("provider-connection", true);
        else queue.push({ type: "error", code: "provider-connection", retryable: true });
      });

      socket.on("close", () => {
        if (!settled) failOnce("provider-closed", false);
        else queue.push({ type: "closed", reason: "provider-closed" });
      });
    });
  }
}

function makeSession(socket: WebSocket, queue: AsyncQueue<RealtimeVoiceEvent>, signal: AbortSignal): RealtimeVoiceSession {
  const ensureOpen = (): void => {
    if (socket.readyState !== WebSocket.OPEN) {
      throw new RealtimeVoiceError("not-ready", "realtime session is not open", true);
    }
  };
  return {
    next: () => queue.next(),
    async send(command: RealtimeVoiceCommand): Promise<void> {
      switch (command.type) {
        case "update-context":
          ensureOpen();
          socket.send(JSON.stringify(sessionUpdate(command.context)));
          queue.push({ type: "context-updated", actionId: command.context.action.actionId });
          return;
        case "append-audio":
          ensureOpen();
          if (command.sampleRate !== INPUT_SAMPLE_RATE) {
            throw new RealtimeVoiceError("unsupported-sample-rate", `input must be ${INPUT_SAMPLE_RATE}Hz pcm`, false);
          }
          socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: command.audioBase64 }));
          return;
        case "commit-turn":
          ensureOpen();
          socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
          return;
        case "interrupt":
          ensureOpen();
          socket.send(JSON.stringify({ type: "response.cancel" }));
          return;
        case "close":
          try { socket.close(); } catch { /* ignore */ }
          queue.push({ type: "closed", reason: command.reason });
          return;
      }
    },
    async close(reason: string): Promise<void> {
      signal.removeEventListener("abort", () => {});
      try { socket.close(1000, reason); } catch { /* ignore */ }
      queue.push({ type: "closed", reason });
    },
  };
}

import http from "node:http";
import { URLSearchParams } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import type { TaskId } from "../../../../shared/contracts";
import {
  COACH_MEDIA_PROTOCOL_VERSION,
  isLiveCoachClientEvent,
  type LiveCoachClientEvent,
  type LiveCoachServerEvent,
} from "../../../../shared/coachMedia";
import type { ExercisePlan } from "../../../../shared/actionRuntime";
import { SYSTEM_PROMPT } from "./claudeCodeCoachService";
import { getLearningActionPlan } from "../learningService";
import { getActionRuntimePlan } from "../runtime/platform/sessionRuntimeService";

const VOICE_STYLE = "语音风格：像耐心的中学数学老师，语速稍慢、重点清楚；数学表达使用自然口语，不念 LaTeX 命令。";
const MAX_SESSION_MS = Number(process.env.COACH_REALTIME_MAX_MS || 600_000);
const MAX_MESSAGE_BYTES = Number(process.env.COACH_REALTIME_MAX_MESSAGE_BYTES || 512_000);
const MAX_BUFFERED_BYTES = Number(process.env.COACH_REALTIME_MAX_BUFFERED_BYTES || 1_000_000);
const MAX_AUDIO_BYTES = Number(process.env.COACH_REALTIME_MAX_AUDIO_BYTES || 32_000_000);
const MAX_CONCURRENT = Number(process.env.COACH_REALTIME_MAX_CONCURRENT || 20);
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
let activeSessions = 0;
type ServerPayload = LiveCoachServerEvent extends infer Event
  ? Event extends LiveCoachServerEvent ? Omit<Event, "version" | "correlationId" | "sessionId" | "sequence" | "at"> : never
  : never;

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new Error("realtime provider is not configured");
  return key;
}
function originAllowed(origin: string | undefined): boolean {
  const allow = process.env.FRONTEND_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean);
  return !allow?.length || Boolean(origin && allow.includes(origin));
}
function query(req: http.IncomingMessage): { sessionId?: string; taskId?: string } {
  const raw = req.url || ""; const params = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?")) : "");
  return { sessionId: params.get("sessionId") || undefined, taskId: params.get("taskId") || undefined };
}
function resolvePlan(context: { sessionId?: string; taskId?: string }): ExercisePlan {
  if (context.sessionId) return getActionRuntimePlan(context.sessionId).plan;
  if (context.taskId) return getLearningActionPlan(context.taskId as TaskId);
  throw new Error("live Coach requires a session or task");
}
function instructions(plan: ExercisePlan, actionId: string): string {
  const action = plan.actions.find((candidate) => candidate.actionId === actionId);
  if (!action) throw new Error("live Coach action context is stale");
  return `${SYSTEM_PROMPT}\n\n当前题目：${plan.metadata.promptLatex}\n教学模式：${plan.mode}\n当前教学动作：${action.title}——${action.instruction}\n\n${VOICE_STYLE}`;
}

function relay(browser: WebSocket, req: http.IncomingMessage): void {
  const context = query(req);
  let upstream: WebSocket | undefined;
  let plan: ExercisePlan | undefined;
  let closed = false;
  let ready = false;
  let started = false;
  let correlationId: string = crypto.randomUUID();
  let publicSessionId = context.sessionId || `learn:${context.taskId || "unknown"}`;
  let sequence = 0;
  let currentActionId = "";
  let audioBytes = 0;
  activeSessions += 1;

  const send = (event: ServerPayload) => {
    if (browser.readyState !== WebSocket.OPEN) return;
    if (browser.bufferedAmount > MAX_BUFFERED_BYTES) { shutdown("browser-backpressure", 1013); return; }
    browser.send(JSON.stringify({ ...event, version: COACH_MEDIA_PROTOCOL_VERSION, correlationId, sessionId: publicSessionId, sequence: sequence++, at: new Date().toISOString() }));
  };
  const shutdown = (reason: string, code = 1000) => {
    if (closed) return;
    closed = true; activeSessions = Math.max(0, activeSessions - 1); clearTimeout(timer);
    try { upstream?.close(code, reason); } catch { /* ignore */ }
    try { browser.close(code, reason); } catch { /* ignore */ }
  };
  const fail = (code: string, retryable: boolean, closeCode = 1011) => { send({ type: "live.error", code, retryable }); shutdown(code, closeCode); };
  const timer = setTimeout(() => fail("session-limit", false, 1000), MAX_SESSION_MS);

  if (activeSessions > MAX_CONCURRENT) { fail("concurrency-limit", true, 1013); return; }

  const sessionUpdate = (actionId: string) => ({
    type: "session.update",
    session: {
      modalities: ["text", "audio"], voice: process.env.COACH_REALTIME_VOICE?.trim() || "Ethan",
      input_audio_format: "pcm", output_audio_format: "pcm", instructions: instructions(plan!, actionId),
      turn_detection: { type: "semantic_vad", threshold: 0.5, silence_duration_ms: 800 },
    },
  });

  const openUpstream = () => {
    const host = (process.env.DASHSCOPE_REALTIME_WS_URL?.trim() || "wss://dashscope.aliyuncs.com/api-ws/v1/realtime").replace(/\/+$/, "");
    const model = process.env.COACH_REALTIME_MODEL?.trim() || "qwen3.5-omni-plus-realtime";
    try {
      upstream = new WebSocket(`${host}?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${apiKey()}` } });
    } catch { fail("provider-setup", true); return; }
    upstream.on("open", () => upstream?.send(JSON.stringify(sessionUpdate(currentActionId))));
    upstream.on("message", (data) => {
      if (closed) return;
      let event: Record<string, any>; try { event = JSON.parse(data.toString()); } catch { fail("provider-protocol", true); return; }
      switch (event.type) {
        case "session.created":
        case "session.updated":
          if (!ready) { ready = true; send({ type: "live.ready", inputSampleRate: INPUT_SAMPLE_RATE, outputSampleRate: OUTPUT_SAMPLE_RATE }); }
          break;
        case "response.audio.delta": if (typeof event.delta === "string") send({ type: "live.audio", audioBase64: event.delta, mimeType: "audio/pcm", sampleRate: OUTPUT_SAMPLE_RATE }); break;
        case "input_audio_buffer.speech_started": send({ type: "live.interrupted" }); break;
        case "response.audio_transcript.delta": send({ type: "live.transcript.delta", role: "coach", text: String(event.delta || "") }); break;
        case "conversation.item.input_audio_transcription.completed": send({ type: "live.transcript.delta", role: "student", text: String(event.transcript || event.item?.content?.[0]?.transcript || "") }); break;
        case "response.done": send({ type: "live.completed" }); break;
        case "error": send({ type: "live.error", code: String(event.error?.code || "provider-error"), retryable: true }); break;
        default: break;
      }
    });
    upstream.on("error", () => fail("provider-connection", true));
    upstream.on("close", () => { if (!closed) shutdown("provider-closed", 1011); });
  };

  browser.on("message", (data) => {
    if (closed || data.toString().length > MAX_MESSAGE_BYTES) { fail("payload-limit", false, 1009); return; }
    let event: unknown; try { event = JSON.parse(data.toString()); } catch { fail("invalid-json", false, 1003); return; }
    if (!isLiveCoachClientEvent(event)) { fail("invalid-public-event", false, 1003); return; }
    correlationId = event.correlationId; publicSessionId = event.sessionId;
    if (event.type === "live.start") {
      if (started) { fail("duplicate-start", false, 1008); return; }
      try {
        plan = resolvePlan(context);
        if (plan.mode === "assessment" || event.mode !== plan.mode || event.exerciseId !== plan.exerciseId) { fail("mode-not-allowed", false, 1008); return; }
        instructions(plan, event.actionId);
      } catch { fail("invalid-context", false, 1008); return; }
      currentActionId = event.actionId; started = true; openUpstream(); return;
    }
    if (!started || !ready || !upstream || upstream.readyState !== WebSocket.OPEN) { fail("not-ready", true, 1008); return; }
    if (upstream.bufferedAmount > MAX_BUFFERED_BYTES) { fail("provider-backpressure", true, 1013); return; }
    switch (event.type) {
      case "live.audio":
        if (event.sampleRate !== INPUT_SAMPLE_RATE) { fail("unsupported-sample-rate", false, 1003); return; }
        audioBytes += Math.floor(event.audioBase64.length * 0.75);
        if (audioBytes > MAX_AUDIO_BYTES) { fail("usage-limit", false, 1009); return; }
        upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: event.audioBase64 })); break;
      case "live.commit": upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" })); break;
      case "live.interrupt": upstream.send(JSON.stringify({ type: "response.cancel" })); break;
      case "live.update-context":
        try { instructions(plan!, event.actionId); currentActionId = event.actionId; upstream.send(JSON.stringify(sessionUpdate(currentActionId))); send({ type: "live.context-updated", actionId: currentActionId }); }
        catch { send({ type: "live.error", code: "invalid-context-update", retryable: false }); }
        break;
      case "live.stop": shutdown("client-stop"); break;
      default: break;
    }
  });
  browser.on("close", () => shutdown("browser-closed"));
  browser.on("error", () => shutdown("browser-error", 1011));
}

export function attachRealtimeCoach(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/api/coach-realtime", verifyClient: (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => originAllowed(info.origin) });
  wss.on("connection", relay);
  wss.on("error", (error) => console.error("realtime coach WebSocket server error:", error));
}

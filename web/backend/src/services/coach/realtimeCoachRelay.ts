import http from "node:http";
import { URL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import type { TaskId } from "../../../../shared/contracts";
import { SYSTEM_PROMPT } from "./claudeCodeCoachService";
import { getLearningActionPlan } from "../learningService";
import { getActionRuntimePlan } from "../runtime/platform/sessionRuntimeService";

/**
 * Full-duplex realtime voice coach relay.
 *
 * Browser <--WebSocket--> this server <--WebSocket--> DashScope
 * qwen-omni-realtime (OpenAI-realtime protocol, semantic VAD). The server
 * injects the current teaching scenario into the upstream `session.update`
 * instructions and transparently relays every event/audio frame both ways.
 *
 * Verified: the generic `wss://dashscope.aliyuncs.com/api-ws/v1/realtime`
 * host accepts a plain DashScope key (no workspace id) for
 * qwen3.5-omni-plus-realtime; the browser speaks OpenAI-realtime JSON events
 * (audio carried as base64 PCM inside JSON, so all frames are text).
 */

const VOICE_STYLE = "语音风格：像耐心的中学数学老师——语速稍慢，停顿自然，重点清楚，语气鼓励但不夸张。涉及数学可自然口语化描述，不要念 LaTeX 命令或美元符号。";
const MAX_SESSION_MS = Number(process.env.COACH_REALTIME_MAX_MS || 600_000);

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new Error("DASHSCOPE_API_KEY is not configured");
  return key;
}

function buildInstructions(sessionId: string | undefined, taskId: string | undefined): string {
  let plan;
  if (sessionId) {
    plan = getActionRuntimePlan(sessionId).plan;
  } else if (taskId) {
    plan = getLearningActionPlan(taskId as TaskId);
  } else {
    throw new Error("realtime coach requires sessionId or taskId");
  }
  const action = plan.actions.find((a) => a.actionId === plan.currentActionId) || plan.actions[0];
  const scenario = [
    `当前题目：${plan.metadata.promptLatex}`,
    `教学模式：${plan.mode}`,
    action ? `当前教学动作：${action.title}——${action.instruction}` : "",
  ].filter(Boolean).join("\n");
  return `${SYSTEM_PROMPT}\n\n${scenario}\n\n${VOICE_STYLE}`;
}

/** Allow the same origins as the HTTP CORS config; permissive when unset. */
function originAllowed(origin: string | undefined): boolean {
  const allow = process.env.FRONTEND_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean);
  if (!allow || allow.length === 0) return true;
  return origin ? allow.includes(origin) : false;
}

function parseQuery(req: http.IncomingMessage): { sessionId?: string; taskId?: string; exerciseId?: string } {
  const resolved = req.url || "";
  const search = resolved.includes("?") ? resolved.slice(resolved.indexOf("?")) : "";
  const params = new URLSearchParams(search);
  const sessionId = params.get("sessionId") || undefined;
  const taskId = params.get("taskId") || undefined;
  const exerciseId = params.get("exerciseId") || undefined;
  return { sessionId, taskId, exerciseId };
}

function relay(browserWs: WebSocket, req: http.IncomingMessage): void {
  const query = parseQuery(req);
  let upstream: WebSocket | null = null;
  let closed = false;
  const shutdown = (reason: string, code = 1011) => {
    if (closed) return;
    closed = true;
    try { upstream?.close(code, reason); } catch { /* ignore */ }
    try { browserWs.close(code, reason); } catch { /* ignore */ }
  };

  // Hard ceiling so a forgotten tab cannot hold an upstream session forever.
  const maxTimer = setTimeout(() => shutdown("realtime session max duration reached"), MAX_SESSION_MS);

  let instructions: string;
  try {
    instructions = buildInstructions(query.sessionId, query.taskId);
  } catch (error) {
    browserWs.send(JSON.stringify({ type: "error", error: { message: (error as Error).message } }));
    shutdown("failed to resolve teaching scenario", 1011);
    clearTimeout(maxTimer);
    return;
  }

  const realtimeHost = (process.env.DASHSCOPE_REALTIME_WS_URL?.trim()
    || "wss://dashscope.aliyuncs.com/api-ws/v1/realtime").replace(/\/+$/, "");
  const model = process.env.COACH_REALTIME_MODEL?.trim() || "qwen3.5-omni-plus-realtime";
  const voice = process.env.COACH_REALTIME_VOICE?.trim() || "Ethan";

  upstream = new WebSocket(`${realtimeHost}?model=${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });

  upstream.on("open", () => {
    upstream!.send(JSON.stringify({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice,
        input_audio_format: "pcm",
        output_audio_format: "pcm",
        instructions,
        turn_detection: { type: "semantic_vad", threshold: 0.5, silence_duration_ms: 800 },
      },
    }));
  });

  // Upstream -> browser: forward every server event verbatim (audio deltas,
  // transcripts, VAD signals, errors). Stop relaying once either side closed.
  upstream.on("message", (data) => {
    if (closed) return;
    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data.toString());
  });
  upstream.on("error", (error: Error) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: "error", error: { message: error.message } }));
    }
    shutdown("upstream error", 1011);
  });
  upstream.on("close", () => shutdown("upstream closed", 1000));

  // Browser -> upstream: forward client events (input_audio_buffer.append, etc.).
  browserWs.on("message", (data) => {
    if (closed) return;
    if (upstream && upstream.readyState === WebSocket.OPEN) upstream.send(data.toString());
  });
  browserWs.on("close", () => { clearTimeout(maxTimer); shutdown("browser closed", 1000); });
  browserWs.on("error", () => { clearTimeout(maxTimer); shutdown("browser error", 1011); });
}

/** Attach the realtime coach WebSocket server to the given HTTP server. */
export function attachRealtimeCoach(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    path: "/api/coach-realtime",
    verifyClient: (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => originAllowed(info.origin),
  });
  wss.on("connection", (ws, req) => relay(ws, req));
  wss.on("error", (error) => console.error("realtime coach WebSocket server error:", error));
}

import http from "node:http";
import { URLSearchParams } from "node:url";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import type { TaskId } from "../../../../shared/contracts";
import type { ExercisePlan } from "../../../../shared/actionRuntime";
import {
  isLiveCoachClientEvent,
  type LiveCoachClientEvent,
  type LiveCoachServerEvent,
} from "../../../../shared/coachMedia";
import { getLearningActionPlan } from "../../services/learningService";
import { getActionRuntimePlan } from "../../services/runtime/platform/sessionRuntimeService";
import { liveCoachApplication } from "../../services/coach/composition";
import type { LiveCoachClientCommand, LiveCoachSession } from "../../services/coach/application/LiveCoachApplication";

/**
 * Thin transport for the live coach WebSocket. It owns ONLY connection-lifecycle
 * concerns: origin/auth, schema/size limits, concurrency, max session duration,
 * backpressure, and forwarding of the provider-neutral public protocol between
 * the browser and {@link LiveCoachApplication}. It does no coaching work and
 * imports no provider client, model name or socket (ADR-005 §Transport and
 * Safety Rules, §Architectural Invariants #7, #8).
 *
 * The browser speaks only the versioned, allowlisted `LiveCoachClientEvent` /
 * `LiveCoachServerEvent` protocol; raw provider events never cross this
 * boundary.
 */

const MAX_SESSION_MS = Number(process.env.COACH_REALTIME_MAX_MS || 600_000);
const MAX_MESSAGE_BYTES = Number(process.env.COACH_REALTIME_MAX_MESSAGE_BYTES || 512_000);
const MAX_BUFFERED_BYTES = Number(process.env.COACH_REALTIME_MAX_BUFFERED_BYTES || 1_000_000);
const MAX_AUDIO_BYTES = Number(process.env.COACH_REALTIME_MAX_AUDIO_BYTES || 32_000_000);
const MAX_CONCURRENT = Number(process.env.COACH_REALTIME_MAX_CONCURRENT || 20);
const INPUT_SAMPLE_RATE = 16_000;

let activeSessions = 0;

function originAllowed(origin: string | undefined): boolean {
  const allow = process.env.FRONTEND_ORIGIN?.split(",").map((item) => item.trim()).filter(Boolean);
  return !allow?.length || Boolean(origin && allow.includes(origin));
}

function query(req: http.IncomingMessage): { sessionId?: string; taskId?: string } {
  const raw = req.url || "";
  const params = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?")) : "");
  return { sessionId: params.get("sessionId") || undefined, taskId: params.get("taskId") || undefined };
}

function resolvePlan(context: { sessionId?: string; taskId?: string }): ExercisePlan {
  if (context.sessionId) return getActionRuntimePlan(context.sessionId).plan;
  if (context.taskId) return getLearningActionPlan(context.taskId as TaskId);
  throw new Error("live Coach requires a session or task");
}

/** Build a minimal but schema-valid `live.error` envelope. The application owns
 *  sequence numbers for real events; an out-of-band transport error uses a
 *  local counter so it does not collide with the application stream. */
function errorEvent(correlationId: string, sessionId: string, sequence: number, code: string, retryable: boolean): LiveCoachServerEvent {
  return {
    version: 3, correlationId, sessionId, sequence, at: new Date().toISOString(),
    type: "live.error", code, retryable,
  } as LiveCoachServerEvent;
}

function handleConnection(browser: WebSocket, req: http.IncomingMessage): void {
  const connection = query(req);
  let started = false;
  let closed = false;
  let audioBytes = 0;
  let errorSequence = 0;
  let correlationId: string = crypto.randomUUID();
  let publicSessionId = connection.sessionId || `learn:${connection.taskId || "unknown"}`;
  let session: LiveCoachSession | undefined;
  const controller = new AbortController();
  activeSessions += 1;

  const shutdown = (reason: string, code = 1000): void => {
    if (closed) return;
    closed = true;
    activeSessions = Math.max(0, activeSessions - 1);
    clearTimeout(timer);
    controller.abort();
    try { browser.close(code, reason); } catch { /* ignore */ }
  };
  const send = (event: LiveCoachServerEvent): void => {
    if (browser.readyState !== browser.OPEN) return;
    if (browser.bufferedAmount > MAX_BUFFERED_BYTES) { shutdown("browser-backpressure", 1013); return; }
    browser.send(JSON.stringify(event));
  };
  const fail = (code: string, retryable: boolean, closeCode = 1011): void => {
    send(errorEvent(correlationId, publicSessionId, errorSequence++, code, retryable));
    shutdown(code, closeCode);
  };
  const timer = setTimeout(() => fail("session-limit", false, 1000), MAX_SESSION_MS);

  if (activeSessions > MAX_CONCURRENT) { fail("concurrency-limit", true, 1013); return; }

  browser.on("message", async (data) => {
    if (closed || data.toString().length > MAX_MESSAGE_BYTES) { fail("payload-limit", false, 1009); return; }
    let event: unknown;
    try { event = JSON.parse(data.toString()); } catch { fail("invalid-json", false, 1003); return; }
    if (!isLiveCoachClientEvent(event)) { fail("invalid-public-event", false, 1003); return; }
    const clientEvent = event as LiveCoachClientEvent;
    correlationId = clientEvent.correlationId;
    publicSessionId = clientEvent.sessionId;

    if (clientEvent.type === "live.start") {
      if (started) { fail("duplicate-start", false, 1008); return; }
      let plan: ExercisePlan;
      try { plan = resolvePlan(connection); }
      catch { fail("invalid-context", false, 1008); return; }
      // Defense-in-depth: the client-claimed mode/exercise must match the
      // server-resolved plan. Assessment is additionally rejected by the
      // application's shared mode policy.
      if (clientEvent.mode !== plan.mode || clientEvent.exerciseId !== plan.exerciseId) { fail("mode-not-allowed", false, 1008); return; }
      if (!plan.actions.some((action) => action.actionId === clientEvent.actionId)) { fail("invalid-context", false, 1008); return; }

      const result = await liveCoachApplication.start({
        plan,
        actionId: clientEvent.actionId,
        correlationId,
        sessionId: publicSessionId,
        signal: controller.signal,
      });
      if (!result.ok) {
        const retryable = result.error.code !== "NOT_ALLOWED";
        const closeCode = result.error.status === 403 ? 1008 : 1011;
        fail(result.error.code, retryable, closeCode);
        return;
      }
      session = result.value;
      started = true;
      // Drain the typed public event stream to the browser until it ends.
      void (async () => {
        try {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (closed) break;
            const { value: serverEvent, done } = await session!.events.next();
            if (done) break;
            send(serverEvent);
          }
        } catch { /* a transport close follows */ }
        if (!closed) shutdown("stream-ended");
      })();
      return;
    }

    if (!started || !session) { fail("not-ready", true, 1008); return; }

    let command: LiveCoachClientCommand;
    if (clientEvent.type === "live.audio") {
      if (clientEvent.sampleRate !== INPUT_SAMPLE_RATE) { fail("unsupported-sample-rate", false, 1003); return; }
      audioBytes += Math.floor(clientEvent.audioBase64.length * 0.75);
      if (audioBytes > MAX_AUDIO_BYTES) { fail("usage-limit", false, 1009); return; }
      command = { type: "audio", audioBase64: clientEvent.audioBase64, mimeType: "audio/pcm", sampleRate: clientEvent.sampleRate };
    } else if (clientEvent.type === "live.commit") {
      command = { type: "commit" };
    } else if (clientEvent.type === "live.interrupt") {
      command = { type: "interrupt" };
    } else if (clientEvent.type === "live.update-context") {
      command = { type: "update-context", actionId: clientEvent.actionId };
    } else {
      command = { type: "stop" };
    }

    try {
      await session.send(command);
      if (command.type === "stop") shutdown("client-stop");
    } catch {
      send(errorEvent(correlationId, publicSessionId, errorSequence++, "not-ready", true));
    }
  });

  browser.on("close", () => shutdown("browser-closed"));
  browser.on("error", () => shutdown("browser-error", 1011));
}

export function attachRealtimeCoach(server: http.Server): void {
  const wss = new WebSocketServer({
    server,
    path: "/api/coach-realtime",
    verifyClient: (info: { origin: string; secure: boolean; req: http.IncomingMessage }) => originAllowed(info.origin),
  });
  wss.on("connection", handleConnection);
  wss.on("error", (error) => console.error("realtime coach WebSocket server error:", error));
}

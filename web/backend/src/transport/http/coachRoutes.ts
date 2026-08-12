import { Router } from "express";
import { isCoachTurnRequest, type CoachTurnRequest } from "../../../../shared/actionRuntime";
import { streamCoachTurn } from "../../services/coach/application/streamCoachTurn";
import { isVoiceTelemetryEvent, type VoiceTelemetryEvent } from "../../../../shared/coachMedia";
import { sanitizeTimeline } from "../../services/coach/ports/TelemetrySink";
import { telemetrySink } from "../../services/coach/composition";

export function createCoachRoutes() {
  const router = Router();
  // ADR-005 §Observability Contract: provider-neutral browser-telemetry channel.
  // The browser reports playback marks (notably `browser-audio-started`, i.e.
  // `browser_first_audio_at`) fire-and-forget; the route merges them into the
  // matching server-side correlationId timeline. Best-effort: never throws into
  // the request path and never changes attempt/world.
  router.post("/telemetry", (req, res) => {
    if (!isVoiceTelemetryEvent(req.body)) { res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid voice telemetry" } }); return; }
    const event = req.body as VoiceTelemetryEvent;
    telemetrySink.recordBrowserMark(event.correlationId, event.owner, event.stage, event.browserTimeMs);
    res.json({ accepted: true });
  });
  // Assessment-safe, provider-neutral read accessor for the merged per-correlation
  // timeline (provider/model are stripped server-side). Used to verify end-to-end
  // correlation of server stages with the browser first-audio moment.
  router.get("/telemetry/:correlationId", (req, res) => {
    const timeline = telemetrySink.getTimeline(req.params.correlationId);
    if (!timeline) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Unknown correlationId" } }); return; }
    res.json(sanitizeTimeline(timeline));
  });
  router.post("/turn-stream", async (req, res, next) => {
    if (!isCoachTurnRequest(req.body)) { res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid coach turn" } }); return; }
    const request = req.body as CoachTurnRequest;
    if (request.context.kind === "practice") {
      // Assessment gating is also enforced by plan/context resolution in the application path.
      const { getActionRuntimePlan } = await import("../../services/runtime/platform/sessionRuntimeService");
      if (getActionRuntimePlan(request.context.sessionId).plan.mode === "assessment" && process.env.COACH_STREAM_ASSESSMENT_ENABLED !== "true") {
        res.status(403).json({ error: { code: "NOT_ALLOWED", message: "Streaming Coach is disabled in Assessment" } }); return;
      }
    }
    res.status(200); res.setHeader("Content-Type", "application/x-ndjson"); res.setHeader("Cache-Control", "no-store");
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      await streamCoachTurn(request, (event) => res.write(`${JSON.stringify(event)}\n`), abort.signal);
      res.end();
    } catch (error) { if (!res.headersSent) next(error); else res.end(); }
  });
  return router;
}

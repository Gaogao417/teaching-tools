import { Router } from "express";
import { isCoachTurnRequest, type CoachTurnRequest } from "../../../../shared/actionRuntime";
import { streamCoachTurn } from "../../services/coach/application/streamCoachTurn";
import { isVoiceTelemetryEvent } from "../../../../shared/coachMedia";

export function createCoachRoutes() {
  const router = Router();
  router.post("/telemetry", (req, res) => {
    if (!isVoiceTelemetryEvent(req.body)) { res.status(400).json({ error: { code: "BAD_REQUEST", message: "Invalid voice telemetry" } }); return; }
    console.info("voice_latency", JSON.stringify(req.body));
    res.json({ accepted: true });
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

import cors from "cors";
import express from "express";
import { z } from "zod";
import type { TaskId } from "../../shared/contracts";
import { TASK_TREE } from "../../shared/tasks";
import { getResult, getTaskHistory } from "./services/resultsService";
import {
  askActionRuntimeCoach,
  checkpointActionRuntime,
  finishPractice,
  getActionRuntimePlan,
  getChallengeDiagnosis,
  restorePractice,
  startChallenge,
  startPractice,
  startRemediation,
  submitRuntimeAction,
  submitActionEvaluation,
} from "./services/runtime/platform/sessionRuntimeService";
import { hasTaskDefinition } from "./services/tasks/catalogService";
import { getLearningActionPlan, getLearningProjection, submitLearningAction } from "./services/learningService";
import { getSimilarityLearningMap, recordSimilarityTopicProgress } from "./services/similarityProgressionService";
import { topicNodeByTaskId } from "../../shared/similarityLearningMap";
import {
  isActionCheckpointRequest,
  isActionCheckpointResponse,
  isActionEvaluationRequest,
  isActionEvaluationResponse,
  isActionPlanResponse,
  isCoachRequest,
  isCoachResponse,
  isCoachTurnRequest,
  isCoachTurnResponse,
  isDirectSpeechRequest,
  isDirectSpeechResponse,
  type ActionCheckpointRequest,
  type ActionEvaluationRequest,
  type CoachRequest,
  type CoachTurnRequest,
  type DirectSpeechRequest,
} from "../../shared/actionRuntime";
import { latexToSpokenChinese } from "../../shared/speechText";
import { conductCoachTurn } from "./services/coach/coachTurnService";
import { narrationApplication } from "./services/coach/composition";
import { createTrainingRoutes } from "./transport/http/trainingRoutes";
import { createCoachRoutes } from "./transport/http/coachRoutes";

const taskIdSchema = z.custom<TaskId>((value) => typeof value === "string" && hasTaskDefinition(value), {
  message: "Invalid taskId",
});

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.FRONTEND_ORIGIN?.split(",").map((item) => item.trim()) || true,
    }),
  );
  // Short browser recordings are base64 data URLs. Qwen ASR caps source audio
  // at 10 MB; the request guard applies the same boundary after JSON decoding.
  app.use(express.json({ limit: "14mb" }));
  app.use("/api/training", createTrainingRoutes());
  app.use("/api/coach", createCoachRoutes());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/task-tree", (_req, res) => {
    res.json(TASK_TREE);
  });

  app.get("/api/learning-maps/similarity", (req, res, next) => {
    try {
      const studentName = z.string().trim().min(1).max(64).parse(req.query.studentName);
      res.json(getSimilarityLearningMap(studentName));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/learning-maps/similarity/progress", (req, res, next) => {
    try {
      const body = z.object({
        studentName: z.string().trim().min(1).max(64),
        taskId: taskIdSchema,
        state: z.enum(["in_progress", "completed"]),
        lastStepId: z.string().optional(),
      }).parse(req.body);
      const node = topicNodeByTaskId(body.taskId);
      if (!node) {
        res.status(400).json({ error: { code: "BAD_REQUEST", message: "Task is not part of the similarity map" } });
        return;
      }
      recordSimilarityTopicProgress({ ...body, nodeId: node.id });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/challenges/:challengeId/start", (req, res, next) => {
    try {
      const studentName = z.string().trim().min(1).max(64).parse(req.body?.studentName);
      res.json(startChallenge(req.params.challengeId, studentName));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/challenges/session/:sessionId/diagnosis", (req, res, next) => {
    try {
      res.json(getChallengeDiagnosis(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/challenges/session/:sessionId/remediation", (req, res, next) => {
    try {
      res.json(startRemediation(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/learn/:taskId", (req, res, next) => {
    try {
      res.json(getLearningProjection(taskIdSchema.parse(req.params.taskId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/learn/:taskId/action-plan", (req, res, next) => {
    try {
      res.json(getLearningActionPlan(taskIdSchema.parse(req.params.taskId)));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/learn/runtime-action", (req, res, next) => {
    try {
      const body = z.object({
        taskId: taskIdSchema,
        stepId: z.string().min(1),
        value: z.string().max(10_000),
      }).parse(req.body);
      res.json(submitLearningAction(body.taskId, body.stepId, body.value));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/task-history/:taskId", (req, res, next) => {
    try {
      const taskId = taskIdSchema.parse(req.params.taskId);
      const studentName = z.string().min(1).parse(req.query.studentName);
      const limit = req.query.limit ? Number(req.query.limit) : 5;
      res.json({
        taskId,
        studentName,
        items: getTaskHistory(taskId, studentName, limit),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/practice/start", (req, res, next) => {
    try {
      const body = z
        .object({
          taskId: taskIdSchema,
          studentName: z.string().trim().min(1).max(64),
        })
        .parse(req.body);
      res.json(startPractice(body.taskId, body.studentName));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/practice/runtime-action", (req, res, next) => {
    try {
      const body = z
        .object({
          sessionId: z.string().min(1),
          instanceId: z.string().min(1),
          action: z.object({
            type: z.enum(["select", "input", "assign", "compose", "clear", "submit"]),
            targetId: z.string().optional(),
            value: z.string().optional(),
            sourceId: z.string().optional(),
            stepId: z.string().optional(),
          }),
        })
        .parse(req.body);
      res.json(submitRuntimeAction(body.sessionId, body.instanceId, body.action));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/practice/session/:sessionId", (req, res, next) => {
    try {
      res.json(restorePractice(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/practice/session/:sessionId/action-plan", (req, res, next) => {
    try {
      const response = getActionRuntimePlan(req.params.sessionId);
      if (!isActionPlanResponse(response)) throw new Error("Invalid Action Runtime plan projection");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/practice/action-evaluation", (req, res, next) => {
    try {
      const body = z.custom<ActionEvaluationRequest>(isActionEvaluationRequest, {
        message: "Invalid Action Runtime evaluation request",
      }).parse(req.body);
      const response = submitActionEvaluation(body);
      if (!isActionEvaluationResponse(response)) throw new Error("Invalid Action Runtime evaluation projection");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/practice/action-checkpoint", (req, res, next) => {
    try {
      const body = z.custom<ActionCheckpointRequest>(isActionCheckpointRequest, {
        message: "Invalid Action Runtime checkpoint request",
      }).parse(req.body);
      const response = checkpointActionRuntime(body);
      if (!isActionCheckpointResponse(response)) throw new Error("Invalid Action Runtime checkpoint projection");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/practice/action-coach", (req, res, next) => {
    try {
      const body = z.custom<CoachRequest>(isCoachRequest, {
        message: "Invalid Action Runtime coach request",
      }).parse(req.body);
      const response = askActionRuntimeCoach(body);
      if (!isCoachResponse(response)) throw new Error("Invalid Action Runtime coach projection");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // DEPRECATED request-response coach fallback. The default path is the
  // streaming turn at POST /api/coach/turn-stream. This whole-response route is
  // retained only as the explicit COACH_TURN_TRANSPORT=request-response rollback
  // and must not be called by the default capability projection.
  app.post("/api/action-coach", async (req, res, next) => {
    try {
      const body = z.custom<CoachTurnRequest>(isCoachTurnRequest, {
        message: "Invalid multimodal coach request",
      }).parse(req.body);
      const response = await conductCoachTurn(body);
      if (!isCoachTurnResponse(response)) throw new Error("Invalid multimodal coach response");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  // Stateless direct TTS for deterministic teacher copy. Synthesized by
  // CosyVoice via the shared LaTeX→spoken transform; never invokes the AI coach
  // and stores no audio on disk (audio is returned inline as a data URL).
  app.post("/api/action-speech", async (req, res, next) => {
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const body = z.custom<DirectSpeechRequest>(isDirectSpeechRequest, {
        message: "Invalid direct speech request",
      }).parse(req.body);
      const spokenText = /[\\$]/.test(body.text) ? latexToSpokenChinese(body.text) : body.text.trim();
      const response = await narrationApplication.synthesize(spokenText, abort.signal, body.correlationId);
      if (!isDirectSpeechResponse(response)) throw new Error("Invalid direct speech response");
      res.json(response);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/action-speech-stream", async (req, res, next) => {
    const abort = new AbortController();
    res.on("close", () => { if (!res.writableEnded) abort.abort(); });
    try {
      const body = z.custom<DirectSpeechRequest>(isDirectSpeechRequest, { message: "Invalid direct speech request" }).parse(req.body);
      const spokenText = /[\\$]/.test(body.text) ? latexToSpokenChinese(body.text) : body.text.trim();
      res.status(200); res.setHeader("Content-Type", "audio/mpeg"); res.setHeader("Cache-Control", "no-store"); res.flushHeaders();
      await narrationApplication.stream(spokenText, abort.signal, (chunk) => { if (!res.destroyed) res.write(chunk); }, body.correlationId);
      res.end();
    } catch (error) {
      if (!res.headersSent) next(error); else if (!res.destroyed) res.end();
    }
  });

  app.post("/api/practice/finish", (req, res, next) => {
    try {
      const body = z.object({ sessionId: z.string().min(1) }).parse(req.body);
      res.json(finishPractice(body.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/practice/result/:sessionId", (req, res, next) => {
    try {
      res.json(getResult(req.params.sessionId));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error?.body && error?.status) {
      res.status(error.status).json(error.body);
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: error.issues[0]?.message || "Invalid request",
        },
      });
      return;
    }
    if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
      res.status(error.status).json({ error: { code: "BAD_REQUEST", message: error.message || "Invalid request" } });
      return;
    }
    console.error(error);
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  });

  return app;
}

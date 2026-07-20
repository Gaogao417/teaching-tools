import cors from "cors";
import express from "express";
import { z } from "zod";
import type { TaskId } from "../../shared/contracts";
import { TASK_TREE } from "../../shared/tasks";
import { getResult, getTaskHistory } from "./services/resultsService";
import {
  finishPractice,
  getChallengeDiagnosis,
  restorePractice,
  startChallenge,
  startPractice,
  startRemediation,
  submitRuntimeAction,
} from "./services/runtime/platform/sessionRuntimeService";
import { hasTaskDefinition } from "./services/tasks/catalogService";
import { getLearningProjection } from "./services/learningService";
import { getSimilarityLearningMap, recordSimilarityTopicProgress } from "./services/similarityProgressionService";
import { topicNodeByTaskId } from "../../shared/similarityLearningMap";

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
  app.use(express.json());

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

import { Router } from "express";
import { ingestTrainingRecord } from "../../services/training/application/ingestTrainingRecord";
import { SqliteTrainingRecordRepository } from "../../services/training/adapters/sqliteTrainingRecordRepository";
import { readTrainingProgress, updateTrainingMastery } from "../../services/training/progress/readTrainingProgress";
import { advanceTrainingSession, validateTrainingSessionResult } from "../../services/training/progress/advanceTrainingSession";
import { isTrainingResult } from "../../../../shared/trainingRuntime";

export function createTrainingRoutes() {
  const router = Router();
  const repository = new SqliteTrainingRecordRepository();

  router.post("/checkpoints", (req, res, next) => {
    try { res.json(ingestTrainingRecord(repository, "checkpoint", req.body)); } catch (error) { next(error); }
  });
  router.post("/results", (req, res, next) => {
    try {
      if (isTrainingResult(req.body)) {
        const existing = repository.receiptFor(req.body.recordId);
        if (existing) { advanceTrainingSession(req.body); updateTrainingMastery(req.body); res.json(existing); return; }
        validateTrainingSessionResult(req.body);
      }
      const receipt = ingestTrainingRecord(repository, "result", req.body);
      if (!receipt.duplicate && isTrainingResult(req.body)) {
        advanceTrainingSession(req.body);
        updateTrainingMastery(req.body);
      }
      res.json(receipt);
    } catch (error) { next(error); }
  });
  router.get("/progress/:sessionId", (req, res, next) => {
    try { res.json(readTrainingProgress(repository, req.params.sessionId)); } catch (error) { next(error); }
  });
  return router;
}

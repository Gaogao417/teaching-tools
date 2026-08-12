import type {
  TrainingActionMetric,
  TrainingActionMetricV2,
  TrainingAssistance,
  TrainingResult,
} from "../../../../../shared/trainingRuntime";

/**
 * ADR-006 read-model normalization. The v1 envelope optionally carries v2
 * telemetry (actionMetricsV2). Aggregators derive from v2 when available and
 * fall back to v1 otherwise. This maps either shape onto the small set of
 * fields the mastery/result read-models need. It performs NO math correctness
 * judgment — it only re-shapes already-decided local training telemetry.
 */
export interface NormalizedActionMetric {
  actionId: string;
  actionKind: string;
  completed: boolean;
  durationMs: number;
  attemptCount: number;
  wrongAttemptCount: number;
  firstTryCorrect: boolean;
  assistanceUsed: TrainingAssistance[];
}

function fromV1(metric: TrainingActionMetric): NormalizedActionMetric {
  return {
    actionId: metric.actionId,
    actionKind: metric.actionKind,
    completed: metric.completed,
    durationMs: metric.durationMs,
    attemptCount: metric.attemptCount,
    wrongAttemptCount: metric.wrongAttemptCount,
    firstTryCorrect: metric.firstTryCorrect,
    assistanceUsed: metric.assistanceUsed,
  };
}

function fromV2(metric: TrainingActionMetricV2): NormalizedActionMetric {
  const assistanceUsed: TrainingAssistance[] = [];
  if (metric.backCount > 0) assistanceUsed.push("back");
  if (metric.clearCount > 0) assistanceUsed.push("clear");
  if (metric.hintCount > 0) assistanceUsed.push("hint");
  if (metric.coachCount > 0) assistanceUsed.push("coach");
  // A v2 metric in a result envelope has reached completion (completedAt is set).
  return {
    actionId: metric.actionId,
    actionKind: metric.actionKind,
    completed: true,
    durationMs: metric.duration.activeDurationMs,
    attemptCount: metric.correctAttemptCount + metric.wrongAttemptCount,
    wrongAttemptCount: metric.wrongAttemptCount,
    firstTryCorrect: metric.firstAttemptCorrect,
    assistanceUsed,
  };
}

/** Prefer v2 carry-on metrics when present, otherwise the v1 metrics. */
export function normalizedActionMetrics(record: TrainingResult): NormalizedActionMetric[] {
  if (record.actionMetricsV2?.length) return record.actionMetricsV2.map(fromV2);
  return record.actionMetrics.map(fromV1);
}

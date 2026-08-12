import type { ActionContract } from "../../../../shared/actionRuntime";
import {
  TRAINING_RUNTIME_VERSION,
  TRAINING_RUNTIME_V2_VERSION,
  type ActionDuration,
  type AssistanceLevel,
  type ErrorDistributionEntry,
  type SemanticCandidate,
  type TrainingActionMetric,
  type TrainingActionMetricV2,
  type TrainingAssistance,
  type TrainingAttemptEvent,
  type TrainingAttemptEventV2,
} from "../../../../shared/trainingRuntime";
import { ActionTimer, type MonotonicClock } from "./actionTimer";

type LegalOutcome = "correct-partial" | "correct-complete" | "wrong";

interface InternalAttempt {
  eventId: string;
  actionId: string;
  actionKind: string;
  candidate: SemanticCandidate;
  outcome: LegalOutcome;
  actionStateBefore: string;
  candidateId?: string;
  attemptIndex: number;
  sequence: number;
  elapsedMs: number;
  occurredAt: string;
  assistance: TrainingAssistance;
}

interface MutableMetric {
  actionId: string;
  actionKind: string;
  startedAt: string;
  completedAt?: string;
  /** v1: legal attempt count (correct + wrong). */
  attemptCount: number;
  correctAttemptCount: number;
  wrongAttemptCount: number;
  backCount: number;
  clearCount: number;
  hintCount: number;
  coachCount: number;
  completed: boolean;
  firstAttemptCorrect: boolean;
  assistanceUsed: Set<TrainingAssistance>;
  /** errorDistribution keyed by `${actionStateBefore}\u0000${candidateId}`. */
  errorDistribution: Map<string, ErrorDistributionEntry>;
}

export interface AttemptRecorderSnapshot {
  attempts: TrainingAttemptEvent[];
  actionMetrics: TrainingActionMetric[];
  /** ADR-006 v2 telemetry (additive; absent for v1-only producers). */
  attemptsV2?: TrainingAttemptEventV2[];
  actionMetricsV2?: TrainingActionMetricV2[];
}

const ERROR_DIST_SEP = "\u0000";

function candidateIdOf(candidate: SemanticCandidate): string | undefined {
  if (candidate.kind === "object") return candidate.objectId;
  if (candidate.kind === "answer") return candidate.slotId;
  if (candidate.kind === "action-evidence") return candidate.evidence.kind;
  return undefined;
}

function deriveAssistanceLevel(metric: MutableMetric): AssistanceLevel {
  if (metric.coachCount > 0) return "coach-used";
  if (metric.hintCount > 0) return "hint-used";
  // Immediate feedback received: the learner made at least one wrong legal
  // attempt (the local guard replied) without using a hint or coach.
  if (metric.wrongAttemptCount > 0) return "immediate-feedback-only";
  return "unassisted";
}

/**
 * ADR-006 §Training telemetry / §Metrics Semantics recorder. Owns per-Action
 * counters, the v2 errorDistribution(actionStateBefore, candidateId), and the
 * monotonic ActionTimer that produces ActionDuration for each Action.
 *
 * `ignored-illegal` candidates are never recorded (the caller skips them); every
 * recorded attempt is a legal candidate classified as `correct-candidate` or
 * `wrong-candidate`. The recorder produces BOTH the v1 wire shapes (so existing
 * checkpoints/queue keep uploading) and the v2 shapes (carried alongside).
 */
export class AttemptRecorder {
  private readonly attempts: InternalAttempt[] = [];
  private readonly metrics = new Map<string, MutableMetric>();
  private assistance: TrainingAssistance = "none";
  private readonly timer: ActionTimer;

  constructor(
    private readonly sessionId: string,
    private readonly exerciseId: string,
    private readonly now: () => number = () => Date.now(),
    private readonly id: () => string = () => crypto.randomUUID(),
    timer?: ActionTimer,
  ) {
    const clock: MonotonicClock = { now, utc: () => new Date(now()).toISOString() };
    this.timer = timer ?? new ActionTimer(clock);
  }

  /** Expose the internal ActionTimer so the page runtime can bind visibility. */
  get actionTimer(): ActionTimer { return this.timer; }

  start(action: ActionContract): void {
    if (!this.metrics.has(action.actionId)) {
      this.metrics.set(action.actionId, {
        actionId: action.actionId,
        actionKind: action.kind,
        startedAt: new Date(this.now()).toISOString(),
        attemptCount: 0,
        correctAttemptCount: 0,
        wrongAttemptCount: 0,
        backCount: 0,
        clearCount: 0,
        hintCount: 0,
        coachCount: 0,
        completed: false,
        firstAttemptCorrect: false,
        assistanceUsed: new Set(),
        errorDistribution: new Map(),
      });
    }
    this.timer.enter(action.actionId);
  }

  /** BACK re-entry into an already-left/completed Action: keep its prior counters
   * and segments, clear the completed flag so it can re-complete. */
  reopen(action: ActionContract): void {
    this.start(action);
    const metric = this.metrics.get(action.actionId);
    if (metric) {
      metric.completed = false;
      metric.completedAt = undefined;
      metric.firstAttemptCorrect = false;
    }
  }

  useAssistance(kind: Exclude<TrainingAssistance, "none">, action: ActionContract): void {
    this.start(action);
    this.assistance = kind;
    const metric = this.metrics.get(action.actionId)!;
    metric.assistanceUsed.add(kind);
    if (kind === "back") metric.backCount += 1;
    else if (kind === "clear") metric.clearCount += 1;
    else if (kind === "hint") metric.hintCount += 1;
    else if (kind === "coach") metric.coachCount += 1;
  }

  /** Record a legal candidate attempt. outcome maps directly from the guard. */
  record(
    action: ActionContract,
    candidate: SemanticCandidate,
    outcome: LegalOutcome,
    actionStateBefore = "",
  ): TrainingAttemptEvent {
    this.start(action);
    const metric = this.metrics.get(action.actionId)!;
    metric.attemptCount += 1;
    const candidateId = candidateIdOf(candidate);
    const isWrong = outcome === "wrong";
    if (isWrong) {
      metric.wrongAttemptCount += 1;
      if (candidateId !== undefined) {
        const key = `${actionStateBefore}${ERROR_DIST_SEP}${candidateId}`;
        const prior = metric.errorDistribution.get(key);
        metric.errorDistribution.set(key, {
          actionStateBefore,
          candidateId,
          wrongCount: (prior?.wrongCount ?? 0) + 1,
        });
      }
    } else {
      metric.correctAttemptCount += 1;
    }
    if (outcome === "correct-complete") {
      metric.completed = true;
      metric.completedAt = new Date(this.now()).toISOString();
      metric.firstAttemptCorrect = metric.wrongAttemptCount === 0;
      this.timer.complete(action.actionId);
    }
    const elapsedMs = Math.max(0, this.timer.activeMs(action.actionId));
    const attempt: InternalAttempt = {
      eventId: this.id(),
      actionId: action.actionId,
      actionKind: action.kind,
      candidate,
      outcome,
      actionStateBefore,
      candidateId,
      attemptIndex: metric.attemptCount,
      sequence: metric.attemptCount,
      elapsedMs,
      occurredAt: new Date(this.now()).toISOString(),
      assistance: this.assistance,
    };
    this.assistance = "none";
    this.attempts.push(attempt);
    return this.toV1Event(attempt);
  }

  /** Mark an Action completed (correct-completion) and close its timer. */
  complete(action: ActionContract): ActionDuration {
    this.start(action);
    const metric = this.metrics.get(action.actionId)!;
    metric.completed = true;
    if (!metric.completedAt) metric.completedAt = new Date(this.now()).toISOString();
    metric.firstAttemptCorrect = metric.wrongAttemptCount === 0;
    return this.timer.complete(action.actionId);
  }

  snapshot(): AttemptRecorderSnapshot {
    const at = this.now();
    const attempts = this.attempts.map((attempt) => this.toV1Event(attempt));
    const actionMetrics: TrainingActionMetric[] = [...this.metrics.values()].map((metric) => ({
      actionId: metric.actionId,
      actionKind: metric.actionKind,
      durationMs: Math.max(0, this.durationMsFor(metric, at)),
      attemptCount: metric.attemptCount,
      wrongAttemptCount: metric.wrongAttemptCount,
      firstTryCorrect: metric.completed && metric.attemptCount === 1 && metric.wrongAttemptCount === 0,
      completed: metric.completed,
      assistanceUsed: [...metric.assistanceUsed],
    }));
    return {
      attempts,
      actionMetrics,
      attemptsV2: this.attempts.map((attempt) => this.toV2Event(attempt)),
      actionMetricsV2: [...this.metrics.values()].map((metric) => this.toV2Metric(metric, at)),
    };
  }

  private durationMsFor(metric: MutableMetric, at: number): number {
    const duration = this.timer.duration(metric.actionId);
    if (duration) return duration.activeDurationMs;
    if (metric.completedAt) return Math.max(0, Date.parse(metric.completedAt) - Date.parse(metric.startedAt));
    return Math.max(0, at - Date.parse(metric.startedAt));
  }

  private toV1Event(attempt: InternalAttempt): TrainingAttemptEvent {
    return {
      version: TRAINING_RUNTIME_VERSION,
      eventId: attempt.eventId,
      sessionId: this.sessionId,
      exerciseId: this.exerciseId,
      actionId: attempt.actionId,
      actionKind: attempt.actionKind,
      candidate: { ...attempt.candidate },
      outcome: attempt.outcome,
      attemptIndex: attempt.attemptIndex,
      elapsedMs: attempt.elapsedMs,
      assistance: attempt.assistance,
      at: attempt.occurredAt,
    };
  }

  private toV2Event(attempt: InternalAttempt): TrainingAttemptEventV2 {
    return {
      version: TRAINING_RUNTIME_V2_VERSION,
      eventId: attempt.eventId,
      exerciseId: this.exerciseId,
      actionId: attempt.actionId,
      actionKind: attempt.actionKind,
      actionStateBefore: attempt.actionStateBefore,
      sequence: attempt.sequence,
      occurredAt: attempt.occurredAt,
      elapsedMs: attempt.elapsedMs,
      classification: attempt.outcome === "wrong" ? "wrong-candidate" : "correct-candidate",
      ...(attempt.candidateId !== undefined ? { candidateId: attempt.candidateId } : {}),
    };
  }

  private toV2Metric(metric: MutableMetric, at: number): TrainingActionMetricV2 {
    const duration = this.timer.duration(metric.actionId);
    const actionDuration: ActionDuration = duration ?? {
      startedAt: metric.startedAt,
      ...(metric.completedAt ? { completedAt: metric.completedAt } : {}),
      activeDurationMs: this.durationMsFor(metric, at),
      segments: [],
    };
    return {
      version: TRAINING_RUNTIME_V2_VERSION,
      actionId: metric.actionId,
      actionKind: metric.actionKind,
      startedAt: metric.startedAt,
      ...(metric.completedAt ? { completedAt: metric.completedAt } : {}),
      duration: actionDuration,
      correctAttemptCount: metric.correctAttemptCount,
      wrongAttemptCount: metric.wrongAttemptCount,
      backCount: metric.backCount,
      clearCount: metric.clearCount,
      hintCount: metric.hintCount,
      coachCount: metric.coachCount,
      firstAttemptCorrect: metric.completed && metric.wrongAttemptCount === 0,
      assistanceLevel: deriveAssistanceLevel(metric),
      errorDistribution: [...metric.errorDistribution.values()],
    };
  }
}

import type { ActionContract } from "../../../../shared/actionRuntime";
import {
  TRAINING_RUNTIME_VERSION,
  type SemanticCandidate,
  type TrainingActionMetric,
  type TrainingAssistance,
  type TrainingAttemptEvent,
} from "../../../../shared/trainingRuntime";

interface MutableMetric {
  actionId: string;
  actionKind: string;
  startedAt: number;
  finishedAt?: number;
  attemptCount: number;
  wrongAttemptCount: number;
  completed: boolean;
  assistanceUsed: Set<TrainingAssistance>;
}

export interface AttemptRecorderSnapshot {
  attempts: TrainingAttemptEvent[];
  actionMetrics: TrainingActionMetric[];
}

export class AttemptRecorder {
  private readonly attempts: TrainingAttemptEvent[] = [];
  private readonly metrics = new Map<string, MutableMetric>();
  private assistance: TrainingAssistance = "none";

  constructor(
    private readonly sessionId: string,
    private readonly exerciseId: string,
    private readonly now: () => number = () => Date.now(),
    private readonly id: () => string = () => crypto.randomUUID(),
  ) {}

  start(action: ActionContract): void {
    if (this.metrics.has(action.actionId)) return;
    this.metrics.set(action.actionId, {
      actionId: action.actionId,
      actionKind: action.kind,
      startedAt: this.now(),
      attemptCount: 0,
      wrongAttemptCount: 0,
      completed: false,
      assistanceUsed: new Set(),
    });
  }

  useAssistance(kind: Exclude<TrainingAssistance, "none">, action: ActionContract): void {
    this.start(action);
    this.assistance = kind;
    this.metrics.get(action.actionId)!.assistanceUsed.add(kind);
  }

  record(action: ActionContract, candidate: SemanticCandidate, outcome: TrainingAttemptEvent["outcome"]): TrainingAttemptEvent {
    this.start(action);
    const metric = this.metrics.get(action.actionId)!;
    metric.attemptCount += 1;
    if (outcome === "wrong") metric.wrongAttemptCount += 1;
    if (outcome === "correct-complete") {
      metric.completed = true;
      metric.finishedAt = this.now();
    }
    const event: TrainingAttemptEvent = {
      version: TRAINING_RUNTIME_VERSION,
      eventId: this.id(),
      sessionId: this.sessionId,
      exerciseId: this.exerciseId,
      actionId: action.actionId,
      actionKind: action.kind,
      candidate,
      outcome,
      attemptIndex: metric.attemptCount,
      elapsedMs: Math.max(0, this.now() - metric.startedAt),
      assistance: this.assistance,
      at: new Date(this.now()).toISOString(),
    };
    this.assistance = "none";
    this.attempts.push(event);
    return event;
  }

  snapshot(): AttemptRecorderSnapshot {
    const at = this.now();
    return {
      attempts: this.attempts.map((event) => ({ ...event, candidate: { ...event.candidate } })),
      actionMetrics: [...this.metrics.values()].map((metric) => ({
        actionId: metric.actionId,
        actionKind: metric.actionKind,
        durationMs: Math.max(0, (metric.finishedAt ?? at) - metric.startedAt),
        attemptCount: metric.attemptCount,
        wrongAttemptCount: metric.wrongAttemptCount,
        firstTryCorrect: metric.completed && metric.attemptCount === 1 && metric.wrongAttemptCount === 0,
        completed: metric.completed,
        assistanceUsed: [...metric.assistanceUsed],
      })),
    };
  }
}

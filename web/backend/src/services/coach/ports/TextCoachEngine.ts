import type { TaskId } from "../../../../../shared/contracts";

/**
 * Provider-neutral text generation port for the streaming coach. Only the safe
 * teaching context crosses this boundary; concrete model names live in the
 * adapter and telemetry, never in this contract.
 */

export type LearningMode = "learn" | "guided-practice" | "assessment";

export interface CoachActionInput {
  actionId: string;
  title: string;
  instruction: string;
}

/** Reviewed, mode-safe inputs derived from the plan. Adapters must not receive
 *  private answer truth here — the application builder strips it for assessment. */
export interface TextCoachInput {
  problemLatex: string;
  mode: LearningMode;
  action: CoachActionInput;
  visibleSolution: string[];
  reviewedTeachingTargets?: unknown;
  trace: unknown;
  conversation: Array<{ role: "student" | "coach"; text: string }>;
  studentQuestion: string;
}

export interface UsageSummary {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}

export type TextGenerationEvent =
  | { type: "text-delta"; text: string }
  | { type: "text-completed"; usage?: UsageSummary };

/** A pull-based event stream. The application awaits each event in turn, which
 *  gives it natural backpressure against a faster producer. */
export interface EventStream<T> {
  next(): Promise<IteratorResult<T>>;
}

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export class TextGenerationError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export interface TextCoachEngine {
  /**
   * Stream the coach's spoken reply as incremental text deltas. The adapter
   * must emit real `text-delta` events as tokens arrive from the provider — it
   * must never buffer the whole reply and then synthesize deltas afterwards.
   * `signal` aborts the provider request and stops further events.
   */
  streamReply(
    input: TextCoachInput,
    signal: AbortSignal,
  ): Promise<Result<EventStream<TextGenerationEvent>, TextGenerationError>>;
}

/** Convenience: an EventStream backed by an async generator. */
export function streamFromIterable<T>(iter: AsyncIterable<T>): EventStream<T> {
  const iterator = iter[Symbol.asyncIterator]();
  return { next: () => iterator.next() };
}

export type { TaskId };

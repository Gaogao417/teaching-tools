import { COACH_MEDIA_PROTOCOL_VERSION, type CoachTurnEvent } from "../../../../../shared/coachMedia";
import type { CoachTurnRequest } from "../../../../../shared/actionRuntime";
import { coachTurnApplication } from "../composition";

/**
 * Thin NDJSON bridge: drains the provider-neutral event stream produced by
 * {@link CoachTurnApplication} and forwards each fully-formed event to the
 * transport writer. The application owns correlation ids, ordering,
 * backpressure and cancellation; this function does no coaching work and emits
 * no acknowledgement — the browser's first audio is always a generated segment.
 */
export async function streamCoachTurn(
  request: CoachTurnRequest,
  emit: (event: CoachTurnEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const result = await coachTurnApplication.start(request, signal);
  if (!result.ok) {
    const correlationId = crypto.randomUUID();
    const sessionId = request.context.kind === "practice" ? request.context.sessionId : `learn:${request.context.taskId}`;
    emit({
      version: COACH_MEDIA_PROTOCOL_VERSION,
      correlationId,
      sessionId,
      sequence: 0,
      at: new Date().toISOString(),
      type: "turn.error",
      code: result.error.code,
      retryable: result.error.code !== "NOT_ALLOWED" && result.error.code !== "EMPTY_QUESTION",
    });
    return;
  }
  const stream = result.value;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) break;
    const { value, done } = await stream.next();
    if (done) break;
    emit(value);
  }
}

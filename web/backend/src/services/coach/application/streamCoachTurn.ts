import { COACH_MEDIA_PROTOCOL_VERSION, type CoachTurnEvent } from "../../../../../shared/coachMedia";
import type { CoachTurnRequest } from "../../../../../shared/actionRuntime";
import { conductCoachTurn } from "../coachTurnService";
import { SpokenSegmenter } from "./SpokenSegmenter";
import { narrationApplication } from "../composition";
type TurnPayload = CoachTurnEvent extends infer Event
  ? Event extends CoachTurnEvent ? Omit<Event, "version" | "correlationId" | "sessionId" | "sequence" | "at"> : never
  : never;

function inlineAudio(audioUrl: string): { mimeType: string; audioBase64: string } | undefined {
  const match = /^data:([^;]+);base64,(.+)$/.exec(audioUrl);
  return match ? { mimeType: match[1], audioBase64: match[2] } : undefined;
}

export async function streamCoachTurn(request: CoachTurnRequest, emit: (event: CoachTurnEvent) => void, signal: AbortSignal): Promise<void> {
  let sequence = 0;
  const correlationId = crypto.randomUUID();
  const sessionId = request.context.kind === "practice" ? request.context.sessionId : `learn:${request.context.taskId}`;
  const send = (event: TurnPayload) => {
    if (signal.aborted) return;
    emit({ ...event, version: COACH_MEDIA_PROTOCOL_VERSION, correlationId, sessionId, sequence: sequence++, at: new Date().toISOString() } as CoachTurnEvent);
  };
  send({ type: "turn.started" });
  const reply = conductCoachTurn({ ...request, synthesizeSpeech: false });
  try {
    const acknowledgement = "我先看当前这一步。";
    send({ type: "turn.transcript.delta", role: "coach", text: acknowledgement });
    if (request.synthesizeSpeech !== false) {
      const speech = inlineAudio((await narrationApplication.synthesize(acknowledgement, signal)).audioUrl);
      if (speech) send({ type: "turn.audio", segmentId: "ack", ...speech, final: false });
    }
    const result = await reply;
    const segments = new SpokenSegmenter().segment(result.directive.spokenText || result.directive.messageLatex);
    for (let index = 0; index < segments.length; index += 1) {
      if (signal.aborted) break;
      send({ type: "turn.transcript.delta", role: "coach", text: segments[index] });
      if (request.synthesizeSpeech !== false) {
        const speech = inlineAudio((await narrationApplication.synthesize(segments[index], signal)).audioUrl);
        if (speech) send({ type: "turn.audio", segmentId: `segment-${index}`, ...speech, final: index === segments.length - 1 });
      }
    }
    if (signal.aborted) { emit({ version: COACH_MEDIA_PROTOCOL_VERSION, correlationId, sessionId, sequence: sequence++, at: new Date().toISOString(), type: "turn.cancelled" }); return; }
    send({ type: "turn.directive", directive: { ...result.directive, spokenText: result.directive.spokenText || result.directive.messageLatex } });
    send({ type: "turn.completed" });
  } catch {
    send({ type: "turn.error", code: "coach-stream-failed", retryable: true });
  }
}

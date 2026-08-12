import { describe, expect, it } from "vitest";
import { COACH_MEDIA_PROTOCOL_VERSION, isCoachTurnEvent, isLiveCoachClientEvent, isNarrationEvent } from "../../../shared/coachMedia";
import { isTrainingAttemptEvent, TRAINING_RUNTIME_VERSION } from "../../../shared/trainingRuntime";

const envelope = { version: COACH_MEDIA_PROTOCOL_VERSION, correlationId: "c1", sessionId: "s1", sequence: 0, at: "2026-08-12T00:00:00.000Z" };

describe("provider-neutral media contracts", () => {
  it("accepts known public events and fails closed on provider or unknown events", () => {
    expect(isNarrationEvent({ ...envelope, type: "narration.completed", utteranceId: "u1" })).toBe(true);
    expect(isCoachTurnEvent({ ...envelope, type: "turn.transcript.delta", role: "coach", text: "继续" })).toBe(true);
    expect(isLiveCoachClientEvent({ ...envelope, type: "live.start", exerciseId: "e1", actionId: "a1", mode: "guided-practice" })).toBe(true);
    expect(isLiveCoachClientEvent({ ...envelope, type: "input_audio_buffer.append", audio: "raw-provider-event" })).toBe(false);
    expect(isCoachTurnEvent({ ...envelope, type: "response.audio.delta", model: "provider-model" })).toBe(false);
  });
});

describe("training telemetry contracts", () => {
  it("accepts semantic candidates and rejects pointer/hover/keystroke noise", () => {
    const base = { version: TRAINING_RUNTIME_VERSION, eventId: "evt-1", sessionId: "s1", exerciseId: "e1", actionId: "a1", actionKind: "select-option", outcome: "wrong", attemptIndex: 1, elapsedMs: 120, assistance: "none", at: "2026-08-12T00:00:00.000Z" };
    expect(isTrainingAttemptEvent({ ...base, candidate: { kind: "answer", slotId: "choice", value: "B" } })).toBe(true);
    expect(isTrainingAttemptEvent({ ...base, candidate: { kind: "pointer", x: 1, y: 2 } })).toBe(false);
    expect(isTrainingAttemptEvent({ ...base, candidate: { kind: "keystroke", key: "B" } })).toBe(false);
  });
});

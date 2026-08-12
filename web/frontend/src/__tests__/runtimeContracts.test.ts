import { describe, expect, it } from "vitest";
import { COACH_MEDIA_PROTOCOL_VERSION, isCoachTurnEvent, isLiveCoachClientEvent, isNarrationEvent } from "../../../shared/coachMedia";
import { isTrainingAttemptEvent, isTrainingActionMetricV2, isTrainingAttemptEventV2, TRAINING_RUNTIME_VERSION, TRAINING_RUNTIME_V2_VERSION } from "../../../shared/trainingRuntime";

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

describe("training telemetry v2 contracts", () => {
  const metric = {
    version: TRAINING_RUNTIME_V2_VERSION,
    actionId: "a1", actionKind: "select-option",
    startedAt: "2026-08-12T00:00:00.000Z", completedAt: "2026-08-12T00:00:12.000Z",
    duration: { startedAt: "2026-08-12T00:00:00.000Z", completedAt: "2026-08-12T00:00:12.000Z", activeDurationMs: 9000, segments: [{ startedAt: "2026-08-12T00:00:00.000Z", endedAt: "2026-08-12T00:00:09.000Z", durationMs: 9000 }] },
    correctAttemptCount: 2, wrongAttemptCount: 1, backCount: 0, clearCount: 1, hintCount: 0, coachCount: 0,
    firstAttemptCorrect: false, assistanceLevel: "immediate-feedback-only",
    errorDistribution: [{ actionStateBefore: "[]", candidateId: "B", wrongCount: 1 }],
  };

  it("accepts a well-formed v2 Action metric and rejects negative counts, bad assistance and bad version", () => {
    expect(isTrainingActionMetricV2(metric)).toBe(true);
    expect(isTrainingActionMetricV2({ ...metric, version: 1 })).toBe(false);
    expect(isTrainingActionMetricV2({ ...metric, backCount: -1 })).toBe(false);
    expect(isTrainingActionMetricV2({ ...metric, assistanceLevel: "provider-llm" })).toBe(false);
    expect(isTrainingActionMetricV2({ ...metric, duration: { ...metric.duration, activeDurationMs: -5 } })).toBe(false);
  });

  it("classifies only legal candidate attempts; illegal never enters v2 telemetry", () => {
    const attempt = { version: TRAINING_RUNTIME_V2_VERSION, eventId: "evt-2", exerciseId: "e1", actionId: "a1", actionKind: "select-option", actionStateBefore: "[]", sequence: 1, occurredAt: "2026-08-12T00:00:01.000Z", elapsedMs: 120, classification: "wrong-candidate", candidateId: "B" };
    expect(isTrainingAttemptEventV2(attempt)).toBe(true);
    expect(isTrainingAttemptEventV2({ ...attempt, classification: "ignored-illegal" })).toBe(false);
    expect(isTrainingAttemptEventV2({ ...attempt, sequence: 0 })).toBe(false);
    expect(isTrainingAttemptEventV2({ ...attempt, version: TRAINING_RUNTIME_VERSION })).toBe(false);
  });
});

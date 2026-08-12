import { describe, expect, it } from "vitest";
import type { MakeParallelAction } from "../../../../../shared/actionRuntime";
import { isTrainingActionMetricV2, isTrainingAttemptEventV2 } from "../../../../../shared/trainingRuntime";
import { AttemptRecorder } from "../attemptRecorder";

const action: MakeParallelAction = {
  actionId: "mp1", sourceStepId: "s1", kind: "make-parallel", version: 1, title: "平行", instruction: "作平行线",
  input: { throughPointId: "P", referenceLineId: "L", availablePointIds: ["P", "Q"], availableLineIds: ["L", "M"], outputLineId: "OL" },
  localTruth: { throughPointId: "P", referenceLineId: "L" }, capabilities: [], answerSlots: [],
  validationPolicy: "local-training", submitOnComplete: false,
};

describe("AttemptRecorder v2 telemetry", () => {
  it("tracks counts, errorDistribution, segments, assistanceLevel and firstAttemptCorrect", () => {
    let now = 1000;
    let seq = 0;
    const recorder = new AttemptRecorder("session", "exercise", () => now, () => `id-${++seq}`);
    recorder.start(action);
    now += 50;
    // wrong candidate Q (plausible but not the truth), actionStateBefore = "select-through-point"
    recorder.record(action, { kind: "object", objectKind: "point", objectId: "Q" }, "wrong", "select-through-point");
    // student uses a hint
    recorder.useAssistance("hint", action);
    now += 80;
    // correct-completion: point P then line L would complete; we record the completion candidate
    recorder.record(action, { kind: "object", objectKind: "line", objectId: "L" }, "correct-complete", "select-reference-line");

    const snap = recorder.snapshot();

    // v1 back-compat snapshot still valid and consistent
    expect(snap.actionMetrics[0]).toMatchObject({ attemptCount: 2, wrongAttemptCount: 1, completed: true });
    expect(snap.attempts.map((event) => event.outcome)).toEqual(["wrong", "correct-complete"]);

    // v2 snapshot present and structurally valid
    expect(snap.actionMetricsV2).toBeDefined();
    expect(snap.attemptsV2).toBeDefined();
    for (const metric of snap.actionMetricsV2!) expect(isTrainingActionMetricV2(metric)).toBe(true);
    for (const event of snap.attemptsV2!) expect(isTrainingAttemptEventV2(event)).toBe(true);

    const metric = snap.actionMetricsV2![0];
    expect(metric.correctAttemptCount).toBe(1);
    expect(metric.wrongAttemptCount).toBe(1);
    expect(metric.hintCount).toBe(1);
    expect(metric.coachCount).toBe(0);
    expect(metric.backCount).toBe(0);
    expect(metric.clearCount).toBe(0);
    expect(metric.firstAttemptCorrect).toBe(false);          // had a wrong attempt
    expect(metric.assistanceLevel).toBe("hint-used");         // coach > hint > immediate-feedback > unassisted
    expect(metric.errorDistribution).toEqual([
      { actionStateBefore: "select-through-point", candidateId: "Q", wrongCount: 1 },
    ]);
    // Monotonic foreground time recorded as active segments.
    expect(metric.duration.activeDurationMs).toBeGreaterThan(0);
    expect(metric.duration.segments.length).toBeGreaterThanOrEqual(1);

    // Attempt classification mapping
    expect(snap.attemptsV2!.map((event) => event.classification)).toEqual(["wrong-candidate", "correct-candidate"]);
    expect(snap.attemptsV2![0].candidateId).toBe("Q");
    expect(snap.attemptsV2![0].actionStateBefore).toBe("select-through-point");
  });

  it("derives assistanceLevel precedence (coach > hint > immediate-feedback > unassisted)", () => {
    let now = 0;
    const mk = () => new AttemptRecorder("s", "e", () => (now += 10), () => `i-${now}`);

    const coach = mk();
    coach.start(action);
    coach.useAssistance("coach", action);
    coach.record(action, { kind: "object", objectKind: "point", objectId: "P" }, "correct-complete", "x");
    expect(coach.snapshot().actionMetricsV2![0].assistanceLevel).toBe("coach-used");

    const immediate = mk();
    immediate.start(action);
    immediate.record(action, { kind: "object", objectKind: "point", objectId: "Q" }, "wrong", "x");
    immediate.record(action, { kind: "object", objectKind: "point", objectId: "P" }, "correct-complete", "y");
    expect(immediate.snapshot().actionMetricsV2![0].assistanceLevel).toBe("immediate-feedback-only");

    const clean = mk();
    clean.start(action);
    clean.record(action, { kind: "object", objectKind: "point", objectId: "P" }, "correct-complete", "x");
    expect(clean.snapshot().actionMetricsV2![0].assistanceLevel).toBe("unassisted");
    expect(clean.snapshot().actionMetricsV2![0].firstAttemptCorrect).toBe(true);
  });

  it("accumulates back/clear counts via useAssistance and reopens after completion", () => {
    let now = 0;
    let seq = 0;
    const recorder = new AttemptRecorder("s", "e", () => (now += 5), () => `i-${++seq}`);
    recorder.start(action);
    recorder.useAssistance("back", action);
    recorder.useAssistance("clear", action);
    recorder.record(action, { kind: "object", objectKind: "point", objectId: "P" }, "correct-complete", "x");
    const before = recorder.snapshot().actionMetricsV2![0];
    expect(before.backCount).toBe(1);
    expect(before.clearCount).toBe(1);

    // BACK re-entry: reopen preserves counters and startedAt, clears completed.
    recorder.reopen(action);
    const reopened = recorder.snapshot().actionMetricsV2![0];
    expect(reopened.completedAt).toBe(reopened.startedAt); // completed flag cleared → completedAt fallback
    // startedAt is preserved (segments continue accumulating).
    expect(reopened.duration.startedAt).toBe(before.duration.startedAt);
  });
});

import assert from "node:assert/strict";
import { coachModePolicy, segmentSpeakable } from "../application/coachModePolicy";
import type { LearningMode } from "../ports/TextCoachEngine";

async function main(): Promise<void> {
  // 1. Live voice is denied in Assessment (fail-closed) and allowed elsewhere.
  const liveAssessment = coachModePolicy.allowLive("assessment" as LearningMode);
  assert.ok(!liveAssessment.ok, "live must be denied in assessment");
  if (!liveAssessment.ok) assert.equal(liveAssessment.code, "NOT_ALLOWED", "denial carries NOT_ALLOWED");
  assert.ok(coachModePolicy.allowLive("learn" as LearningMode).ok, "live allowed in learn");
  assert.ok(coachModePolicy.allowLive("guided-practice" as LearningMode).ok, "live allowed in guided-practice");

  // 2. The streaming turn is denied in Assessment by default (no env opt-in).
  const previous = process.env.COACH_STREAM_ASSESSMENT_ENABLED;
  delete process.env.COACH_STREAM_ASSESSMENT_ENABLED;
  assert.ok(!coachModePolicy.allowTurn("assessment" as LearningMode).ok, "turn denied in assessment by default");
  process.env.COACH_STREAM_ASSESSMENT_ENABLED = "true";
  assert.ok(coachModePolicy.allowTurn("assessment" as LearningMode).ok, "turn respects the explicit assessment opt-in");
  if (previous === undefined) delete process.env.COACH_STREAM_ASSESSMENT_ENABLED; else process.env.COACH_STREAM_ASSESSMENT_ENABLED = previous;
  assert.ok(coachModePolicy.allowTurn("learn" as LearningMode).ok, "turn allowed in learn");

  // 3. Turn and live share ONE policy and are consistent for allowed modes.
  for (const mode of ["learn", "guided-practice"] as LearningMode[]) {
    assert.ok(coachModePolicy.allowTurn(mode).ok && coachModePolicy.allowLive(mode).ok, `${mode} allows both turn and live`);
  }

  // 4. The per-segment gate reuses the same Assessment source of truth.
  assert.equal(segmentSpeakable("assessment" as LearningMode), false, "no generative spoken segment in assessment");
  assert.equal(segmentSpeakable("learn" as LearningMode), true, "spoken segments allowed in learn");
  assert.equal(coachModePolicy.canSpeakSegment("assessment" as LearningMode), false, "policy canSpeakSegment agrees with segmentSpeakable");

  console.log("PASS coachModePolicy denies live in assessment, keeps the turn opt-in, and is shared by turn+live");
}

void main().catch((error) => { console.error(error); process.exit(1); });

import { describe, expect, it } from "vitest";
// `?raw` is typed by vite/client (referenced via src/vite-env.d.ts).
import frameSource from "../../runtime/ActionRuntimeFrame.tsx?raw";

/**
 * ADR-005 §Layer Responsibilities — structural conformance for the voice
 * frontend boundary. `ActionRuntimeFrame` must be presentation: it consumes the
 * `CoachController` (via `useCoachController`) and must not directly own coach
 * turn / recorder / live orchestration, nor touch `getUserMedia` itself.
 */
describe("ActionRuntimeFrame voice frontend conformance (ADR-005)", () => {
  it("consumes the CoachController boundary instead of the raw recorder/realtime hooks", () => {
    expect(frameSource).toContain("useCoachController");
    // The raw orchestration hooks are no longer imported or called by the Frame.
    expect(frameSource).not.toContain("useCoachRecorder");
    expect(frameSource).not.toContain("useRealtimeCoach");
  });

  it("does not call getUserMedia, instantiate the recorder, or build coach turn payloads itself", () => {
    // Capture + transport ownership moved to the controller / hooks.
    expect(frameSource).not.toMatch(/getUserMedia/);
    expect(frameSource).not.toMatch(/streamActionCoach|conductActionCoach/);
    // The AbortController for coach turns is owned by the controller now.
    expect(frameSource).not.toMatch(/coachAbortRef/);
    // The NDJSON decode moved into the controller.
    expect(frameSource).not.toMatch(/decodeBase64ToBytes/);
  });
});

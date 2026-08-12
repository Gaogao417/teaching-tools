import { describe, expect, it } from "vitest";
import { MediaSessionController } from "../MediaSessionController";

describe("MediaSessionController capture arbitration (ADR-005 §Exclusive media session)", () => {
  it("grants the first capture lease and denies a concurrent owner the mic (mutex)", () => {
    const media = new MediaSessionController();
    const turnLease = media.acquireCapture("coach-turn");
    expect(turnLease).not.toBeNull();
    expect(turnLease!.owner).toBe("coach-turn");
    expect(media.getCaptureOwner()).toBe("coach-turn");

    // A live session starting while the turn recorder holds the mic is DENIED.
    // The loser must not call getUserMedia — capture is mutually exclusive.
    const liveLease = media.acquireCapture("live");
    expect(liveLease).toBeNull();
    expect(media.getCaptureOwner()).toBe("coach-turn");
    media.dispose();
  });

  it("re-acquiring while already holding returns null (no double-grant)", () => {
    const media = new MediaSessionController();
    const first = media.acquireCapture("live");
    expect(first).not.toBeNull();
    // Same owner re-acquiring is still denied: it already holds the mic.
    expect(media.acquireCapture("live")).toBeNull();
    expect(media.getCaptureOwner()).toBe("live");
    media.dispose();
  });

  it("releasing the lease allows another owner to acquire the mic", () => {
    const media = new MediaSessionController();
    const turnLease = media.acquireCapture("coach-turn");
    expect(turnLease).not.toBeNull();
    expect(media.acquireCapture("live")).toBeNull();

    turnLease!.release();
    expect(media.getCaptureOwner()).toBeUndefined();

    const liveLease = media.acquireCapture("live");
    expect(liveLease).not.toBeNull();
    expect(media.getCaptureOwner()).toBe("live");
    media.dispose();
  });

  it("release is idempotent and only the current holder releases", () => {
    const media = new MediaSessionController();
    const turnLease = media.acquireCapture("coach-turn");
    // A stale lease object released after the owner already changed is a no-op.
    const liveLease = media.acquireCapture("live");
    expect(liveLease).toBeNull();
    turnLease!.release();
    turnLease!.release(); // idempotent
    expect(media.getCaptureOwner()).toBeUndefined();

    // releaseCapture for a non-holder does nothing.
    media.acquireCapture("live");
    media.releaseCapture("coach-turn");
    expect(media.getCaptureOwner()).toBe("live");
    media.dispose();
  });

  it("dispose clears the capture owner", () => {
    const media = new MediaSessionController();
    media.acquireCapture("live");
    expect(media.getCaptureOwner()).toBe("live");
    media.dispose();
    expect(media.getCaptureOwner()).toBeUndefined();
  });

  it("capture arbitration is independent of playback arbitration", () => {
    // A live session can hold the mic (capture) while narration owns playback,
    // and vice-versa — the two leases are orthogonal.
    const media = new MediaSessionController();
    const capture = media.acquireCapture("live");
    expect(capture).not.toBeNull();
    // Playback side still usable independently.
    expect(typeof media.startAudioStream).toBe("function");
    media.stop();
    // Stopping playback does not release the capture lease.
    expect(media.getCaptureOwner()).toBe("live");
    capture!.release();
    media.dispose();
  });
});

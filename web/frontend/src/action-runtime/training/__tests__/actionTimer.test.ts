import { describe, expect, it } from "vitest";
import { ActionTimer, VisibilityTimerAdapter, type MonotonicClock, type VisibilityListener } from "../actionTimer";

/** Deterministic fake clock: monotonic `now()` advanced explicitly, fixed UTC. */
function fakeClock(): MonotonicClock & { advance(ms: number): number; t: number } {
  let t = 0;
  return {
    get t() { return t; },
    now: () => t,
    utc: () => new Date(t).toISOString(),
    advance(ms: number) { t += ms; return t; },
  };
}

/** A controllable visibility listener whose `hidden` flag we toggle in tests. */
function fakeVisibility(initiallyHidden = false): VisibilityListener & { setHidden(hidden: boolean): void } {
  let hidden = initiallyHidden;
  const listeners = new Set<() => void>();
  return {
    get hidden() { return hidden; },
    setHidden(value: boolean) { hidden = value; for (const listener of listeners) listener(); },
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
}

describe("ActionTimer", () => {
  it("accumulates foreground time across a single active segment", () => {
    const clock = fakeClock();
    const timer = new ActionTimer(clock);
    timer.enter("a1");
    clock.advance(120);
    const duration = timer.complete("a1");
    expect(duration.activeDurationMs).toBe(120);
    expect(duration.segments).toHaveLength(1);
    expect(duration.completedAt).toBe(clock.utc());
  });

  it("stops accumulation while the page is hidden and resumes on return", () => {
    const clock = fakeClock();
    const timer = new ActionTimer(clock);
    const visibility = fakeVisibility();
    const adapter = new VisibilityTimerAdapter(timer, visibility);
    const release = adapter.bind();

    timer.enter("a1");
    clock.advance(50);
    visibility.setHidden(true);          // pause
    clock.advance(1000);                 // hidden time must NOT count
    visibility.setHidden(false);         // resume → new segment
    clock.advance(70);
    const duration = timer.complete("a1");
    release();

    expect(duration.activeDurationMs).toBe(120);   // 50 + 70
    expect(duration.segments).toHaveLength(2);     // paused → 2 segments
  });

  it("continues accumulating the original Action's segments on BACK reopen", () => {
    const clock = fakeClock();
    const timer = new ActionTimer(clock);
    timer.enter("a1");
    clock.advance(40);
    const first = timer.complete("a1");
    expect(first.activeDurationMs).toBe(40);

    clock.advance(500);                  // gap between completion and reopen must NOT count
    timer.reopen("a1");                   // BACK re-entry: same action, new segment
    clock.advance(25);
    const second = timer.complete("a1");
    expect(second.activeDurationMs).toBe(65);      // 40 + 25
    expect(second.segments).toHaveLength(2);
    expect(second.startedAt).toBe(first.startedAt); // startedAt preserved across reopen
  });

  it("switching the active action pauses the previous action's segment", () => {
    const clock = fakeClock();
    const timer = new ActionTimer(clock);
    timer.enter("a1");
    clock.advance(30);
    timer.enter("a2");                    // entering a2 pauses a1
    clock.advance(80);
    expect(timer.activeMs("a1")).toBe(30);
    expect(timer.activeMs("a2")).toBe(80);
  });

  it("no-op when no document is available (SSR/test safe)", () => {
    const clock = fakeClock();
    const timer = new ActionTimer(clock);
    const adapter = new VisibilityTimerAdapter(timer, undefined);
    expect(() => adapter.bind()).not.toThrow();
  });
});

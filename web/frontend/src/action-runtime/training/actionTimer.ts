import type { ActionDuration, ActiveSegment } from "../../../../shared/trainingRuntime";

/**
 * ADR-006 §Metrics Semantics — the single monotonic ActionTimer that measures
 * real foreground time per Action. There is ONE timer for the whole page (never
 * per React component). It pauses on `document.visibilitychange` hidden and
 * resumes on visible; BACK re-entry into the same Action continues accumulating
 * that Action's original active segments.
 *
 * Time accounting uses `performance.now()` (monotonic) for deltas and ISO UTC
 * strings for cross-device correlation stamps, exactly as the ADR requires.
 *
 * The clock and calendar sources are injectable so tests can drive a fake
 * monotonic clock and deterministic UTC stamps.
 */

export interface MonotonicClock {
  /** Monotonic milliseconds, like performance.now(). */
  now(): number;
  /** UTC ISO string, like new Date().toISOString(). */
  utc(): string;
}

export const systemClock: MonotonicClock = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  utc: () => new Date().toISOString(),
};

interface ActiveAction {
  actionId: string;
  /** ISO UTC stamp of the Action's very first enter (never changes on reopen). */
  startedAt: string;
  /** ISO UTC stamp set when the Action reaches correct-completion. */
  completedAt?: string;
  /** Closed segments (paused/completed). The currently-open segment is `open`. */
  segments: ActiveSegment[];
  /** The currently-accumulating segment, or undefined while paused/hidden. */
  open?: { startedAtMonotonic: number; startedAtUtc: string };
  /** True once complete() has closed the Action. Reopen reopens accumulation. */
  completed: boolean;
}

export class ActionTimer {
  private readonly actions = new Map<string, ActiveAction>();
  /** The actionId whose open segment we resume after visibility returns. */
  private activeActionId?: string;

  constructor(private readonly clock: MonotonicClock = systemClock) {}

  /**
   * Start (or replace) the active segment for `actionId` at the monotonic clock.
   * Entering a different action pauses the previous one. Re-entering the SAME
   * action while it already has an open segment is a no-op for that segment.
   */
  enter(actionId: string): void {
    if (this.activeActionId && this.activeActionId !== actionId) this.pause();
    this.activeActionId = actionId;
    let action = this.actions.get(actionId);
    if (!action) {
      action = { actionId, startedAt: this.clock.utc(), segments: [], completed: false };
      this.actions.set(actionId, action);
    }
    if (action.completed) action.completed = false; // reopen path falls through
    if (!action.open) action.open = { startedAtMonotonic: this.clock.now(), startedAtUtc: this.clock.utc() };
  }

  /** Close the currently-open segment (page hidden). Keeps the active actionId. */
  pause(): void {
    const action = this.activeActionId ? this.actions.get(this.activeActionId) : undefined;
    if (!action?.open) return;
    const endedMonotonic = this.clock.now();
    action.segments.push(this.closeSegment(action.open, endedMonotonic));
    action.open = undefined;
  }

  /** Open a fresh segment for the active action after a pause. */
  resume(): void {
    if (!this.activeActionId) return;
    const action = this.actions.get(this.activeActionId);
    if (!action || action.open) return;
    action.open = { startedAtMonotonic: this.clock.now(), startedAtUtc: this.clock.utc() };
  }

  /**
   * BACK re-entry into an action that was left/completed: resume accumulating
   * the SAME action's segments, preserving its original startedAt and prior
   * segments. Distinct from enter() only in intent/documentation — both append a
   * new segment to the same action and never reset startedAt.
   */
  reopen(actionId: string): void {
    this.enter(actionId);
  }

  /**
   * Close the active segment for `actionId`, mark completedAt, and return the
   * ADR-006 ActionDuration (UTC start/completion + activeDurationMs + segments).
   * Calling complete on an already-completed action is idempotent.
   */
  complete(actionId: string): ActionDuration {
    const action = this.actions.get(actionId);
    if (!action) {
      // Defensive: complete() without enter(). Synthesize an empty duration so
      // callers never crash; this should not happen in normal page flow.
      const empty: ActionDuration = { startedAt: this.clock.utc(), completedAt: this.clock.utc(), activeDurationMs: 0, segments: [] };
      return empty;
    }
    if (this.activeActionId === actionId) this.pause();
    if (!action.completedAt) action.completedAt = this.clock.utc();
    action.completed = true;
    return this.durationFor(action);
  }

  /** Read-only view of an action's duration without closing it. */
  duration(actionId: string): ActionDuration | undefined {
    const action = this.actions.get(actionId);
    return action ? this.durationFor(action) : undefined;
  }

  /** Total active ms accumulated so far for an action (open segment included). */
  activeMs(actionId: string): number {
    const action = this.actions.get(actionId);
    if (!action) return 0;
    const closed = action.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
    const open = action.open ? Math.max(0, this.clock.now() - action.open.startedAtMonotonic) : 0;
    return closed + open;
  }

  /** True if complete() has been called and the action hasn't been reopened. */
  isCompleted(actionId: string): boolean {
    return Boolean(this.actions.get(actionId)?.completed);
  }

  private durationFor(action: ActiveAction): ActionDuration {
    const segments = [...action.segments];
    if (action.open) segments.push(this.closeSegment(action.open, this.clock.now()));
    const activeDurationMs = segments.reduce((sum, segment) => sum + segment.durationMs, 0);
    return {
      startedAt: action.startedAt,
      completedAt: action.completedAt,
      activeDurationMs,
      segments,
    };
  }

  private closeSegment(open: { startedAtMonotonic: number; startedAtUtc: string }, endedMonotonic: number): ActiveSegment {
    return {
      startedAt: open.startedAtUtc,
      endedAt: this.clock.utc(),
      durationMs: Math.max(0, endedMonotonic - open.startedAtMonotonic),
    };
  }
}

/**
 * Binds an ActionTimer's pause/resume to `document.visibilitychange`. Injectable
 * document so tests (and SSR where `document` is undefined) can supply a fake.
 * Returns a disposer that removes the listener.
 */
export interface VisibilityListener {
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
  readonly hidden: boolean;
}

export class VisibilityTimerAdapter {
  private readonly listener: () => void;
  private bound = false;

  constructor(
    private readonly timer: ActionTimer,
    private readonly document?: VisibilityListener,
  ) {
    this.listener = () => {
      if (this.document?.hidden) this.timer.pause();
      else this.timer.resume();
    };
  }

  /** Start listening. Safe to call when no document is available (no-op). */
  bind(): () => void {
    if (!this.document || this.bound) return () => undefined;
    this.document.addEventListener("visibilitychange", this.listener);
    this.bound = true;
    return () => this.unbind();
  }

  unbind(): void {
    if (!this.document || !this.bound) return;
    this.document.removeEventListener("visibilitychange", this.listener);
    this.bound = false;
  }
}

/** The browser document as a VisibilityListener, or undefined in SSR/test. */
export const browserVisibilityListener: VisibilityListener | undefined =
  typeof document !== "undefined"
    ? {
        addEventListener: (type, listener) => document.addEventListener(type, listener),
        removeEventListener: (type, listener) => document.removeEventListener(type, listener),
        get hidden() { return document.visibilityState === "hidden"; },
      }
    : undefined;

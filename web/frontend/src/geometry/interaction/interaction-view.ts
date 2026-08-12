/**
 * InteractionView — the only tool state the Canvas needs to understand.
 *
 * The Canvas never reads `state.value` directly to infer prompts. Every machine
 * snapshot passes through a pure projector that returns this view. Static
 * descriptions live in the projector; dynamic `selected`/`preview` belong there
 * too.
 *
 * Affordance model (per PRD-03 §4): the view carries a per-entity table, NOT a
 * kind-level accept list. Two independent dimensions:
 *  - `enabled` — may the learner click this entity right now? The Canvas filters
 *    ONLY on this. Wrong-but-clickable objects stay enabled so the machine can
 *    diagnose them and produce teaching feedback.
 *  - `expected` — is this the teaching-truth target of the current step? Read by
 *    the machine's guards to decide advance vs wrong-feedback. NEVER read by the
 *    Canvas to filter clicks.
 * `visualState` is display-only (derived from enabled/expected/selection/wrong).
 */
import type { EntityKind, EntityRef } from "./events";

export type PreviewSpec =
  | { type: "parallel-fixed"; throughPointId: string; referenceLineId: string }
  | { type: "intersection-fixed"; parallelLineId: string; carrierPointIds: string[] }
  /**
   * Show a line through the given (hovered) world point, parallel to the
   * reference entity already in `selected`. The renderer reads the hovered
   * coordinates itself — they never enter the machine.
   */
  | { type: "parallel-through-hover"; referenceLineId?: string }
  /**
   * Show a circle centered on the selected center point, passing through the
   * current (hovered) world point.
   */
  | { type: "circle-through-hover"; centerId?: string }
  /**
   * construct-parallel carrier preview (plan 第五阶段). Shown once the through
   * point, reference line, and first carrier point are chosen and the learner is
   * picking the second carrier. The renderer draws the carrier line from the
   * fixed first carrier to the hovered world point, the parallel line (through
   * `throughPointId`, parallel to `referenceLineId`), and their intersection —
   * so the learner sees where the construction will land before clicking. All
   * geometry is computed in the render layer from the pointer + model; the
   * machine never sees the hovered coordinates.
   */
  | {
      type: "carrier-preview";
      throughPointId: string;
      referenceLineId: string;
      carrier0Id: string;
    };

/**
 * Per-entity interaction state for ONE step. `id` + `kind` identify the entity;
 * the three fields below are the affordance the Canvas/machine consume.
 */
export interface EntityAffordance {
  id: string;
  kind: EntityKind;
  /**
   * May this entity be clicked right now? The ONLY field the Canvas filters on.
   * A wrong-but-relevant object stays `true` so its click reaches the machine.
   */
  enabled: boolean;
  /**
   * Is this the step's teaching-truth target? Consumed by machine guards, never
   * by the Canvas. Letting the Canvas see it would let it grade, which it must
   * not (answer-truth stays server-side in production).
   */
  expected: boolean;
  /**
   * Display-only lifecycle (PRD-03 §4): idle → available → selected → filled →
   * correct, with wrong as a side state. Drives styling only.
   */
  visualState: "idle" | "available" | "selected" | "filled" | "wrong" | "correct";
  /** Optional teaching feedback tied to this entity (e.g. why it's wrong). */
  feedback?: string;
}

export interface InteractionView {
  /** Learner-facing instruction for the current step. */
  prompt: string;
  /**
   * Entity affordances keyed by entity id. The Canvas reads `enabled` per entity
   * to decide clickability, and `visualState`/`feedback` for rendering.
   */
  entities: Record<string, EntityAffordance>;
  /** Entities already chosen in this tool run. */
  selected: readonly EntityRef[];
  cursor: "default" | "crosshair" | "pointer";
  /** Optional preview the renderer computes from snapshot + pointer + model. */
  preview?: PreviewSpec;
  canCancel: boolean;
  canGoBack: boolean;
  /**
   * Optional one-shot highlight for canvas elements that just changed. The
   * `key` is stable across re-renders and only changes when a new highlight is
   * due; renderers play the animation once per new key. Absent means idle.
   */
  emphasis?: TransientCanvasEmphasis;
}

/**
 * Frontend-only transient highlight for the geometry surface. `entityIds` covers
 * points/lines; `markIds` covers teaching marks. When a mark id references an
 * emphasis-kind mark that has no independent renderer node, the board falls back
 * to highlighting that mark's own entity ids.
 */
export interface TransientCanvasEmphasis {
  key: string;
  entityIds: readonly string[];
  markIds: readonly string[];
}

/** View shown when no tool is active. The Canvas renders an idle state. */
export const idleView: InteractionView = {
  prompt: "选择一个工具开始",
  entities: {},
  selected: [],
  cursor: "default",
  canCancel: false,
  canGoBack: false,
};

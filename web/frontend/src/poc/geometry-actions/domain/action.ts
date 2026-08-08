/**
 * Action abstraction — typed state machines that are pure and renderer-agnostic.
 *
 * DESIGN
 * =======
 * Each Action is a closed state machine over three type parameters:
 *   P  - params (declared at authoring time, e.g. makeParallel params)
 *   S  - per-instance state (a discriminated union of stages)
 *   R  - the Result committed to the WorldState on completion
 *
 * The four methods are PURE and carry NO React / JSXGraph knowledge:
 *   - init:   params + world -> initial S
 *   - reduce: S + event + params + world -> transition (continue/reject/complete)
 *   - view:   S + params + world -> InteractionView (generic projection)
 *   - commit: world + result + params -> new WorldState
 *
 * HETEROGENEITY & THE TYPE-ERASURE BOUNDARY
 * =========================================
 * A Program is a sequence of actions, each with *different* P/S/R. TypeScript
 * cannot express "a heterogeneous list where element i keeps its own types"
 * without existential types (not yet in the language). So we introduce ONE
 * type-erasure boundary: `defineAction` curries the params and erases S/R down
 * to `unknown`, returning a `RuntimeAction`. The Runtime then talks to every
 * action through that uniform interface — no `switch(actionKind)`, no
 * `Record<string, any>`.
 *
 * The casts (`as S`, `as R`) live in EXACTLY ONE function (`defineAction`).
 * Every action file outside that boundary stays fully typed with no `any`.
 * This is the same proven strategy the existing backend uses for engines
 * (defineEnginePlugin), but cleaner because params are curried at factory time
 * so the Runtime carries no per-action data at all.
 */
import type { GeometryEvent } from "./events.ts";
import type { InteractionView } from "./interaction.ts";
import type { WorldState } from "./geometry.ts";

export interface ActionDefinition<P, S, R> {
  /** Debug label only. NEVER used for dispatch. */
  readonly actionKind: string;
  init(params: P, world: WorldState): S;
  reduce(
    state: S,
    event: GeometryEvent,
    params: P,
    world: WorldState,
  ): ActionTransition<S, R>;
  view(state: S, params: P, world: WorldState): InteractionView;
  commit(world: WorldState, result: R, params: P): WorldState;
}

export type ActionTransition<S, R> =
  | { kind: "continue"; state: S }
  | { kind: "reject"; state: S; message: string }
  | { kind: "complete"; result: R };

// --- Runtime-facing (type-erased) surface ----------------------------------

export interface RuntimeAction {
  readonly actionKind: string;
  init(world: WorldState): unknown;
  reduce(state: unknown, event: GeometryEvent, world: WorldState): RuntimeTransition;
  view(state: unknown, world: WorldState): InteractionView;
  commit(world: WorldState, result: unknown): WorldState;
}

export type RuntimeTransition =
  | { kind: "continue"; state: unknown }
  | { kind: "reject"; state: unknown; message: string }
  | { kind: "complete"; result: unknown };

/**
 * The single type-erasure boundary. Binds params via currying and erases S/R
 * to `unknown`. All casts are confined to this function body.
 */
export function defineAction<P, S, R>(
  def: ActionDefinition<P, S, R>,
  params: P,
): RuntimeAction {
  return {
    actionKind: def.actionKind,
    init: (world) => def.init(params, world),
    reduce: (state, event, world) => def.reduce(state as S, event, params, world),
    view: (state, world) => def.view(state as S, params, world),
    commit: (world, result) => def.commit(world, result as R, params),
  };
}

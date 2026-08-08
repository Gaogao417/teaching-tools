/**
 * Program — a declarative sequence of RuntimeActions.
 *
 * `sequence(...)` does NOT execute anything eagerly. It merely packages the
 * actions for the Runtime to drive, one event at a time.
 */
import type { RuntimeAction } from "../domain/action.ts";

export type Program = readonly RuntimeAction[];

export function sequence(...actions: RuntimeAction[]): Program {
  return actions;
}

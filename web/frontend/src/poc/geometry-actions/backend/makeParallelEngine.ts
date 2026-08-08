/**
 * makeParallelEngine — the makeParallel action implemented AS A BACKEND ENGINE.
 *
 * This is the heart of the rewritten POC: the Action abstraction (init/reduce/
 * view/commit) now lives on the backend, holds the private answerKey, and
 * projects a public PocRuntimeSpec that contains NO answer truth.
 *
 * Compare with the old frontend `actions/makeParallel.ts`: same state machine,
 * same commit semantics, but reduce now judges against a private answerKey and
 * the result is a spec the frontend projects — the frontend never commits.
 *
 * No React. No JSXGraph. Pure functions. Fully unit-testable.
 */
import { withObject } from "../domain/geometry.ts";
import type {
  LineId,
  ParallelLineObject,
  IntersectionPointObject,
  PointId,
  SegmentId,
  WorldState,
} from "../domain/geometry.ts";
import type {
  ActionSpec,
  FlowSpec,
  FlowStep,
  RuntimeActionEvent,
  RuntimeStepStatus,
} from "../shared/runtimeContracts.ts";

// --- params + private answer key -------------------------------------------

export interface MakeParallelParams {
  /** The point the parallel line must pass through (public, shown in prompt). */
  through: PointId;
  /** The segment the parallel line must be parallel to (public). */
  parallelTo: SegmentId;
  /** Optional carrier to intersect; if set, an intersection point is derived. */
  intersectionWith?: SegmentId;
  /** Id to give the derived intersection point. */
  intersectionPoint?: PointId;
}

/**
 * PRIVATE answer key. Never serialized into PocRuntimeSpec. The engine reads it
 * inside reduce() to judge; the frontend only sees the prompt (which names the
 * points/segments) and the resulting geometry.
 */
export interface MakeParallelAnswerKey {
  through: PointId;
  parallelTo: SegmentId;
}

// --- state machine ----------------------------------------------------------

export type MakeParallelState =
  | { stage: "pick-through-point" }
  | { stage: "pick-parallel-segment"; through: PointId };

export interface MakeParallelResult {
  through: PointId;
  parallelTo: SegmentId;
  lineId: LineId;
}

export function parallelLineId(through: PointId, parallelTo: SegmentId): LineId {
  return `parallel:${through}:${parallelTo}`;
}

// --- the engine -------------------------------------------------------------

export interface EngineTransition<S> {
  kind: "continue" | "reject" | "complete";
  state: S;
  message?: string;
  result?: MakeParallelResult;
}

/**
 * A self-contained backend engine for one action. The mock backend drives a
 * sequence of these uniformly (no per-engine switch): it calls reduce/commit/
 * buildSpec through this interface.
 */
export interface MakeParallelEngine {
  readonly stepId: string;
  init(world: WorldState): MakeParallelState;
  reduce(
    state: MakeParallelState,
    action: RuntimeActionEvent,
    world: WorldState,
  ): EngineTransition<MakeParallelState>;
  commit(world: WorldState, result: MakeParallelResult): WorldState;
  /** Project this engine's contribution to the flow (the mock backend assembles the full spec). */
  buildFlow(state: MakeParallelState): FlowSpec;
}

export function createMakeParallelEngine(
  params: MakeParallelParams,
  answerKey: MakeParallelAnswerKey,
): MakeParallelEngine {
  const stepId = "make-parallel";
  const goal = `过点 ${params.through} 作线段 ${params.parallelTo} 的平行线`;

  return {
    stepId,

    init: () => ({ stage: "pick-through-point" }),

    reduce: (state, action, _world): EngineTransition<MakeParallelState> => {
      if (action.type !== "submit") {
        return { kind: "reject", state, message: "请通过提交完成本步骤。" };
      }

      // Parse the draft payload the frontend serialized: { selections, inputs }.
      const payload = parseDraftPayload(action.value);

      if (state.stage === "pick-through-point") {
        const picked = payload.selections["through-point"]?.[0];
        if (picked === answerKey.through) {
          return {
            kind: "continue",
            state: { stage: "pick-parallel-segment", through: picked },
            message: `已选择点 ${picked}，继续选择要平行的线段。`,
          };
        }
        return {
          kind: "reject",
          state,
          message: `请选择正确的点（点 ${params.through}）。`,
        };
      }

      // stage === "pick-parallel-segment"
      const pickedSeg = payload.selections["parallel-segment"]?.[0];
      if (pickedSeg === answerKey.parallelTo) {
        return {
          kind: "complete",
          state,
          message: "正确！已作出平行线。",
          result: {
            through: state.through,
            parallelTo: params.parallelTo,
            lineId: parallelLineId(state.through, params.parallelTo),
          },
        };
      }
      return {
        kind: "reject",
        state,
        message: `请选择正确的线段（线段 ${params.parallelTo}）。`,
      };
    },

    commit: (world, result): WorldState => {
      const parallel: ParallelLineObject = {
        kind: "parallel-line",
        id: result.lineId,
        through: result.through,
        parallelTo: result.parallelTo,
      };
      let next = withObject(world, parallel);

      if (params.intersectionWith && params.intersectionPoint) {
        const intersection: IntersectionPointObject = {
          kind: "intersection",
          id: params.intersectionPoint,
          of: [result.lineId, params.intersectionWith],
        };
        next = withObject(next, intersection);
      }
      return next;
    },

    buildFlow: (state) => {
      const steps: FlowStep[] = buildMakeParallelFlow(params, state);
      const flow: FlowSpec = {
        steps,
        currentStepId: stepId,
        completionPolicy: "multi-step",
      };
      return flow;
    },
  };

  function buildMakeParallelFlow(
    p: MakeParallelParams,
    st: MakeParallelState,
  ): FlowStep[] {
    const pickPointActions: ActionSpec[] =
      st.stage === "pick-through-point"
        ? [{ type: "select", target: p.through, selectionKind: "single" }]
        : [];
    const pickSegActions: ActionSpec[] =
      st.stage === "pick-parallel-segment"
        ? [{ type: "select", target: p.parallelTo, selectionKind: "single" }]
        : [];

    const pickPointStatus: RuntimeStepStatus =
      st.stage === "pick-through-point" ? "active" : "done";
    const pickSegStatus: RuntimeStepStatus =
      st.stage === "pick-parallel-segment" ? "active" : "locked";

    return [
      {
        id: `${stepId}/pick-through-point`,
        title: "选经过点",
        goal: `选择点 ${p.through}`,
        status: pickPointStatus,
        allowedActions: pickPointActions,
        submitMode: "immediate",
      },
      {
        id: `${stepId}/pick-parallel-segment`,
        title: "选平行线段",
        goal: `选择线段 ${p.parallelTo}`,
        status: pickSegStatus,
        allowedActions: pickSegActions,
        submitMode: "immediate",
      },
    ];
  }
}

// --- draft payload parsing (shared across engines) --------------------------

export interface DraftPayload {
  selections: Record<string, string[]>;
  inputs: Record<string, string>;
}

export function parseDraftPayload(value: string | undefined): DraftPayload {
  if (!value) return { selections: {}, inputs: {} };
  try {
    const parsed = JSON.parse(value) as Partial<DraftPayload>;
    return {
      selections: parsed.selections ?? {},
      inputs: parsed.inputs ?? {},
    };
  } catch {
    return { selections: {}, inputs: {} };
  }
}

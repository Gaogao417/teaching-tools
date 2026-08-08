/**
 * markSegmentValueEngine — the second backend engine.
 *
 * Structurally DIFFERENT from makeParallelEngine: it consumes an input value
 * (not just selections), has a two-stage flow (pick segment → enter value →
 * submit), and judges the entered value against a private answerKey. This
 * proves the engine abstraction handles distinct interaction shapes without the
 * mock backend growing a per-engine switch.
 *
 * No React. No JSXGraph. Pure functions. Fully unit-testable.
 */
import { withObject } from "../domain/geometry.ts";
import type { SegmentValueObject, SegmentId, WorldState } from "../domain/geometry.ts";
import type {
  ActionSpec,
  FlowSpec,
  FlowStep,
  RuntimeActionEvent,
  RuntimeStepStatus,
} from "../shared/runtimeContracts.ts";
import { parseDraftPayload } from "./makeParallelEngine.ts";

export interface MarkSegmentValueParams {
  segment: SegmentId;
}
export interface MarkSegmentValueAnswerKey {
  expected: string;
}

export type MarkSegmentValueState =
  | { stage: "pick-segment" }
  | { stage: "enter-value"; inputValue: string };

export interface MarkSegmentValueResult {
  segment: SegmentId;
  value: string;
}

export function segmentValueId(segment: SegmentId): string {
  return `value:${segment}`;
}

export interface EngineTransition<S> {
  kind: "continue" | "reject" | "complete";
  state: S;
  message?: string;
  result?: MarkSegmentValueResult;
}

export interface MarkSegmentValueEngine {
  readonly stepId: string;
  init(world: WorldState): MarkSegmentValueState;
  reduce(
    state: MarkSegmentValueState,
    action: RuntimeActionEvent,
    world: WorldState,
  ): EngineTransition<MarkSegmentValueState>;
  commit(world: WorldState, result: MarkSegmentValueResult): WorldState;
  buildFlow(state: MarkSegmentValueState): FlowSpec;
}

export function createMarkSegmentValueEngine(
  params: MarkSegmentValueParams,
  answerKey: MarkSegmentValueAnswerKey,
): MarkSegmentValueEngine {
  const stepId = "mark-segment-value";

  return {
    stepId,

    init: () => ({ stage: "pick-segment" }),

    reduce: (state, action, _world): EngineTransition<MarkSegmentValueState> => {
      if (action.type !== "submit") {
        return { kind: "reject", state, message: "请通过提交完成本步骤。" };
      }
      const payload = parseDraftPayload(action.value);

      if (state.stage === "pick-segment") {
        const picked = payload.selections["segment"]?.[0];
        if (picked === params.segment) {
          return {
            kind: "continue",
            state: { stage: "enter-value", inputValue: "" },
            message: `已选择线段 ${picked}，请输入它的值。`,
          };
        }
        return {
          kind: "reject",
          state,
          message: `请选择正确的线段（线段 ${params.segment}）。`,
        };
      }

      // stage === "enter-value"
      const entered = (payload.inputs[segmentValueId(params.segment)] ?? "").trim();
      if (entered === answerKey.expected) {
        return {
          kind: "complete",
          state,
          message: `正确！线段 ${params.segment} 的值为 ${entered}。`,
          result: { segment: params.segment, value: entered },
        };
      }
      return {
        kind: "reject",
        state: { stage: "enter-value", inputValue: entered },
        message: `不正确，请重新输入线段 ${params.segment} 的值。`,
      };
    },

    commit: (world, result): WorldState => {
      const obj: SegmentValueObject = {
        kind: "segment-value",
        id: segmentValueId(result.segment),
        segment: result.segment,
        value: result.value,
      };
      return withObject(world, obj);
    },

    buildFlow: (state): FlowSpec => {
      const pickActions: ActionSpec[] =
        state.stage === "pick-segment"
          ? [{ type: "select", target: params.segment, selectionKind: "single" }]
          : [];
      const inputActions: ActionSpec[] =
        state.stage === "enter-value"
          ? [{ type: "input", target: segmentValueId(params.segment), valueKind: "integer" }]
          : [];

      const pickStatus: RuntimeStepStatus =
        state.stage === "pick-segment" ? "active" : "done";
      const inputStatus: RuntimeStepStatus =
        state.stage === "enter-value" ? "active" : "locked";

      const steps: FlowStep[] = [
        {
          id: `${stepId}/pick-segment`,
          title: "选线段",
          goal: `选择线段 ${params.segment}`,
          status: pickStatus,
          allowedActions: pickActions,
          submitMode: "immediate",
        },
        {
          id: `${stepId}/enter-value`,
          title: "输入值",
          goal: `输入线段 ${params.segment} 的值`,
          status: inputStatus,
          allowedActions: inputActions,
          submitMode: "explicit",
        },
      ];
      return { steps, currentStepId: stepId, completionPolicy: "multi-step" };
    },
  };
}

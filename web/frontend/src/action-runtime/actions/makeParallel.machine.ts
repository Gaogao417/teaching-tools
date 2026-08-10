import { assign, setup, type AnyStateMachine } from "xstate";
import type { ActionEvidence, MakeParallelAction } from "../../../../shared/actionRuntime";
import type { ActionRuntimeEvent } from "../events";
import { createActorFromDefinition, projectBoardSlotValues, projectStandardSnapshot, type ActionMachineDefinition, type StandardActionContext } from "./actionDefinition";

type Context = StandardActionContext<MakeParallelAction>;

function reject(objectId: string) {
  return { wrongObjectId: objectId, wrongMessage: "这个对象不是当前动作需要的对象。" };
}

export const makeParallelDefinition: ActionMachineDefinition<MakeParallelAction> = {
  kind: "make-parallel",
  version: 1,
  createMachine(contract) {
    return setup({
      types: { context: {} as Context, events: {} as ActionRuntimeEvent, output: {} as ActionEvidence | { type: "cancelled" } },
      guards: {
        validPoint: ({ event }) => event.type === "OBJECT.SELECTED" && event.objectKind === "point"
          && contract.input.availablePointIds.includes(event.objectId)
          && (contract.validationPolicy !== "local-teaching" || !contract.input.throughPointId || event.objectId === contract.input.throughPointId),
        validLine: ({ event }) => event.type === "OBJECT.SELECTED" && event.objectKind === "line"
          && contract.input.availableLineIds.includes(event.objectId)
          && (contract.validationPolicy !== "local-teaching" || !contract.input.referenceLineId || event.objectId === contract.input.referenceLineId),
      },
      actions: {
        selectPoint: assign(({ event }) => event.type === "OBJECT.SELECTED" ? { points: [event.objectId], wrongObjectId: undefined, wrongMessage: undefined } : {}),
        selectLine: assign(({ event }) => event.type === "OBJECT.SELECTED" ? { lines: [event.objectId], wrongObjectId: undefined, wrongMessage: undefined } : {}),
        reject: assign(({ event }) => event.type === "OBJECT.SELECTED" ? reject(event.objectId) : {}),
        reset: assign({ points: () => [], lines: () => [], wrongObjectId: () => undefined, wrongMessage: () => undefined }),
      },
    }).createMachine({
      id: "make-parallel@1",
      initial: "select-through-point",
      context: { contract, points: [], lines: [], angles: [], answers: {} },
      states: {
        "select-through-point": {
          on: {
            "OBJECT.SELECTED": [{ guard: "validPoint", target: "select-reference-line", actions: "selectPoint" }, { actions: "reject" }],
            CLEAR: { actions: "reset" },
            CANCEL: "cancelled",
          },
        },
        "select-reference-line": {
          on: {
            "OBJECT.SELECTED": [{ guard: "validLine", target: "completed", actions: "selectLine" }, { actions: "reject" }],
            BACK: { target: "select-through-point", actions: "reset" },
            CLEAR: { target: "select-through-point", actions: "reset" },
            CANCEL: "cancelled",
          },
        },
        completed: { type: "final" },
        cancelled: { type: "final" },
      },
      output: ({ context }) => context.points[0] && context.lines[0]
        ? { actionId: contract.actionId, sourceStepId: contract.sourceStepId, kind: "make-parallel", version: 1, throughPointId: context.points[0], referenceLineId: context.lines[0] }
        : { type: "cancelled" },
    }) as AnyStateMachine;
  },
  project(snapshot) {
    return projectStandardSnapshot(snapshot, () => false, (context) => ({
      enabledByKind: {
        points: context.points.length === 0 ? (context.contract as MakeParallelAction).input.availablePointIds : [],
        lines: context.points.length === 1 && context.lines.length === 0 ? (context.contract as MakeParallelAction).input.availableLineIds : [],
        angles: [],
      },
      answerSlots: (context.contract as MakeParallelAction).answerSlots.map((slot) => {
        const value = slot.id === "through-point" ? context.points[0] || "" : context.lines[0] || "";
        return { ...slot, value, active: false, status: value ? "filled" : "empty" };
      }),
      preview: { type: "parallel", throughPointId: context.points[0], referenceLineId: context.lines[0] },
      boardPreview: projectBoardSlotValues(context.contract, {
        throughPoint: context.points[0],
        helperLine: context.points[0] && context.lines[0] ? (context.contract as MakeParallelAction).input.outputLineLabel || (context.contract as MakeParallelAction).input.outputLineId : undefined,
        referenceLine: context.lines[0],
      }),
    }), (contract, evidence) => evidence.kind === "make-parallel" ? [{
      commandId: `${contract.actionId}/construct-parallel`,
      actionId: contract.actionId,
      type: "construct-parallel",
      throughPointId: evidence.throughPointId,
      referenceLineId: evidence.referenceLineId,
      outputLineId: (contract as MakeParallelAction).input.outputLineId,
    }] : []);
  },
  commands(contract, evidence) {
    return evidence.kind === "make-parallel" ? [{
      commandId: `${contract.actionId}/construct-parallel`, actionId: contract.actionId, type: "construct-parallel",
      throughPointId: evidence.throughPointId, referenceLineId: evidence.referenceLineId, outputLineId: contract.input.outputLineId,
    }] : [];
  },
};

export const createMakeParallelActor = (contract: MakeParallelAction) => createActorFromDefinition(makeParallelDefinition, contract);

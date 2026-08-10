import { assign, setup, type AnyStateMachine } from "xstate";
import type { ActionEvidence, IntersectCarriersAction } from "../../../../shared/actionRuntime";
import type { ActionRuntimeEvent } from "../events";
import { createActorFromDefinition, projectStandardSnapshot, type ActionMachineDefinition, type StandardActionContext } from "./actionDefinition";

type Context = StandardActionContext<IntersectCarriersAction>;

export const intersectCarriersDefinition: ActionMachineDefinition<IntersectCarriersAction> = {
  kind: "intersect-carriers",
  version: 1,
  createMachine(contract) {
    const valid = (index: number, event: ActionRuntimeEvent) => event.type === "OBJECT.SELECTED" && event.objectKind === "point"
      && contract.input.availablePointIds.includes(event.objectId)
      && (contract.validationPolicy !== "local-teaching" || !contract.input.carrierPointIds || event.objectId === contract.input.carrierPointIds[index]);
    return setup({
      types: { context: {} as Context, events: {} as ActionRuntimeEvent, output: {} as ActionEvidence | { type: "cancelled" } },
      guards: { validFirst: ({ event }) => valid(0, event), validSecond: ({ event }) => valid(1, event) },
      actions: {
        append: assign(({ context, event }) => event.type === "OBJECT.SELECTED" ? { points: [...context.points, event.objectId], wrongObjectId: undefined, wrongMessage: undefined } : {}),
        reject: assign(({ event }) => event.type === "OBJECT.SELECTED" ? { wrongObjectId: event.objectId, wrongMessage: "这个点不是当前载体需要的端点。" } : {}),
        reset: assign({ points: () => [], wrongObjectId: () => undefined, wrongMessage: () => undefined }),
        back: assign({ points: ({ context }) => context.points.slice(0, -1), wrongObjectId: () => undefined, wrongMessage: () => undefined }),
      },
    }).createMachine({
      id: "intersect-carriers@1",
      initial: "select-first-carrier",
      context: { contract, points: [], lines: [], angles: [], answers: {} },
      states: {
        "select-first-carrier": { on: { "OBJECT.SELECTED": [{ guard: "validFirst", target: "select-second-carrier", actions: "append" }, { actions: "reject" }], CLEAR: { actions: "reset" }, CANCEL: "cancelled" } },
        "select-second-carrier": { on: { "OBJECT.SELECTED": [{ guard: "validSecond", target: "completed", actions: "append" }, { actions: "reject" }], BACK: { target: "select-first-carrier", actions: "back" }, CLEAR: { target: "select-first-carrier", actions: "reset" }, CANCEL: "cancelled" } },
        completed: { type: "final" },
        cancelled: { type: "final" },
      },
      output: ({ context }) => context.points.length === 2
        ? { actionId: contract.actionId, sourceStepId: contract.sourceStepId, kind: "intersect-carriers", version: 1, carrierPointIds: [context.points[0], context.points[1]] }
        : { type: "cancelled" },
    }) as AnyStateMachine;
  },
  project(snapshot) {
    return projectStandardSnapshot(snapshot, () => false, (context) => ({
      enabledByKind: { points: context.points.length < 2 ? (context.contract as IntersectCarriersAction).input.availablePointIds : [], lines: [], angles: [] },
      answerSlots: (context.contract as IntersectCarriersAction).answerSlots.map((slot, index) => {
        const value = context.points[index] || "";
        return { ...slot, value, active: false, status: value ? "filled" : "empty" };
      }),
      preview: { type: "intersection", parallelLineId: (context.contract as IntersectCarriersAction).input.parallelLineId, carrierPointIds: context.points },
    }), (contract, evidence) => evidence.kind === "intersect-carriers" ? [{
      commandId: `${contract.actionId}/construct-carrier`, actionId: contract.actionId, type: "construct-carrier",
      fromPointId: evidence.carrierPointIds[0], toPointId: evidence.carrierPointIds[1],
      outputLineId: (contract as IntersectCarriersAction).input.outputCarrierLineId,
    }, {
      commandId: `${contract.actionId}/intersect-lines`, actionId: contract.actionId, type: "intersect-lines",
      firstLineId: (contract as IntersectCarriersAction).input.parallelLineId,
      secondLineId: (contract as IntersectCarriersAction).input.outputCarrierLineId,
      outputPointId: (contract as IntersectCarriersAction).input.outputPointId,
    }] : []);
  },
  commands(contract, evidence) {
    return evidence.kind === "intersect-carriers" ? [{
      commandId: `${contract.actionId}/construct-carrier`, actionId: contract.actionId, type: "construct-carrier",
      fromPointId: evidence.carrierPointIds[0], toPointId: evidence.carrierPointIds[1], outputLineId: contract.input.outputCarrierLineId,
    }, {
      commandId: `${contract.actionId}/intersect-lines`, actionId: contract.actionId, type: "intersect-lines",
      firstLineId: contract.input.parallelLineId, secondLineId: contract.input.outputCarrierLineId, outputPointId: contract.input.outputPointId,
    }] : [];
  },
  projectStepRecord(contract, { evidence, current }) {
    const carrierPointIds = evidence?.carrierPointIds || current?.selectedByKind.points || [];
    return {
      values: {
        "carrier-line": carrierPointIds.length === 2 ? carrierPointIds.join("") : "",
        "intersection-point": evidence ? contract.input.outputPointId : "",
      },
    };
  },
};

export const createIntersectCarriersActor = (contract: IntersectCarriersAction) => createActorFromDefinition(intersectCarriersDefinition, contract);

import type { ActionContract, ActionEvidence, ActionKind } from "../../../shared/actionRuntime";
import { createActorFromDefinition, type ActionMachineDefinition, type ActionStepRecordProjection, type EvidenceFor } from "./actions/actionDefinition";
import { makeParallelDefinition } from "./actions/makeParallel.machine";
import { intersectCarriersDefinition } from "./actions/intersectCarriers.machine";
import { markSegmentValuesDefinition } from "./actions/markSegmentValues.machine";
import { pairSegmentsDefinition } from "./actions/pairSegments.machine";
import { ratioScratchDefinition } from "./actions/ratioScratch.machine";
import { convertCollinearDefinition } from "./actions/convertCollinear.machine";
import { enterEquationDefinition } from "./actions/enterEquation.machine";
import { selectOptionDefinition } from "./actions/selectOption.machine";
import { enterTextDefinition } from "./actions/enterText.machine";
import type { ActionActor, ActionSnapshotView } from "./types";

export class UnsupportedActionError extends Error {
  constructor(readonly kind: string, readonly version: number) {
    super(`Unsupported action contract: ${kind}@${version}`);
  }
}

export class InvalidActionInputError extends Error {
  constructor(readonly actionId: string) {
    super(`Invalid action input: ${actionId}`);
  }
}

interface RegistryEntry {
  validate(contract: ActionContract): boolean;
  create(contract: ActionContract): ActionActor;
  projectStepRecord(contract: ActionContract, input: StepRecordProjectionInput): ActionStepRecordProjection;
}

export interface StepRecordProjectionInput {
  evidence?: ActionEvidence;
  current?: ActionSnapshotView;
}

function register<Contract extends ActionContract>(
  definition: ActionMachineDefinition<Contract>,
  validate: (contract: ActionContract) => boolean,
): RegistryEntry {
  return {
    validate,
    create: (contract) => createActorFromDefinition(definition, contract as Contract),
    projectStepRecord(contract, input) {
      return definition.projectStepRecord?.(contract as Contract, {
        evidence: input.evidence as EvidenceFor<Contract> | undefined,
        current: input.current,
      }) || {};
    },
  };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** kind@version is the only dispatch. Each entry owns its input schema + machine. */
const ACTION_REGISTRY: Record<string, RegistryEntry> = {
  "make-parallel@1": register(makeParallelDefinition,
    (contract) => contract.kind === "make-parallel" && strings(contract.input.availablePointIds) && strings(contract.input.availableLineIds)
      && typeof contract.input.outputLineId === "string"
      && (contract.input.outputLineLabel === undefined || typeof contract.input.outputLineLabel === "string"),
  ),
  "intersect-carriers@1": register(intersectCarriersDefinition,
    (contract) => contract.kind === "intersect-carriers" && strings(contract.input.availablePointIds)
      && typeof contract.input.parallelLineId === "string" && typeof contract.input.outputCarrierLineId === "string"
      && typeof contract.input.outputPointId === "string",
  ),
  "mark-segment-values@1": register(markSegmentValuesDefinition,
    (contract) => contract.kind === "mark-segment-values" && strings(contract.input.availableSegmentIds) && Array.isArray(contract.input.labels),
  ),
  "pair-segments@1": register(pairSegmentsDefinition,
    (contract) => contract.kind === "pair-segments" && strings(contract.input.availableSegmentIds) && typeof contract.input.pairCount === "number",
  ),
  "ratio-scratch@1": register(ratioScratchDefinition,
    (contract) => contract.kind === "ratio-scratch" && strings(contract.input.availableSegmentIds)
      && typeof contract.input.firstDisplayName === "string" && typeof contract.input.secondDisplayName === "string",
  ),
  "convert-collinear@1": register(convertCollinearDefinition,
    (contract) => contract.kind === "convert-collinear" && strings(contract.input.availableSegmentIds) && typeof contract.input.relationLatex === "string",
  ),
  "enter-equation@1": register(enterEquationDefinition,
    (contract) => contract.kind === "enter-equation" && strings(contract.input.availableSegmentIds) && strings(contract.input.factorSlots) && contract.input.factorSlots.length === 3,
  ),
  "select-option@1": register(selectOptionDefinition,
    (contract) => contract.kind === "select-option" && Array.isArray(contract.input.options) && contract.input.options.every(record),
  ),
  "enter-text@1": register(enterTextDefinition,
    (contract) => contract.kind === "enter-text" && typeof contract.input.placeholder === "string",
  ),
};

export interface ActionMachineRegistry {
  supports(kind: ActionKind | string, version: number): boolean;
  create(contract: ActionContract): ActionActor;
  projectStepRecord(contract: ActionContract, input: StepRecordProjectionInput): ActionStepRecordProjection;
}

export const actionMachineRegistry: ActionMachineRegistry = {
  supports(kind, version) { return Boolean(ACTION_REGISTRY[`${kind}@${version}`]); },
  create(contract) {
    const entry = ACTION_REGISTRY[`${contract.kind}@${contract.version}`];
    if (!entry) throw new UnsupportedActionError(contract.kind, contract.version);
    if (!entry.validate(contract)) throw new InvalidActionInputError(contract.actionId);
    return entry.create(contract);
  },
  projectStepRecord(contract, input) {
    const entry = ACTION_REGISTRY[`${contract.kind}@${contract.version}`];
    if (!entry) throw new UnsupportedActionError(contract.kind, contract.version);
    if (!entry.validate(contract)) throw new InvalidActionInputError(contract.actionId);
    return entry.projectStepRecord(contract, input);
  },
};

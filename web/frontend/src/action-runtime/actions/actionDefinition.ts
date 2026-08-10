import { createActor, type AnyStateMachine, type SnapshotFrom } from "xstate";
import type { ActionContract, ActionEvidence, ActionKind } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import type { BoardCommand } from "../../../../shared/solutionBoard";
import type { ActionActor, ActionSnapshotView, AnswerSlotView, CanvasSlice } from "../types";

export interface StandardActionContext<Contract extends ActionContract = ActionContract> {
  contract: Contract;
  points: string[];
  lines: string[];
  angles: string[];
  answers: Record<string, string>;
  activeSlotId?: string;
  wrongObjectId?: string;
  wrongMessage?: string;
}

export interface ActionMachineDefinition<Contract extends ActionContract = ActionContract> {
  kind: Contract["kind"];
  version: Contract["version"];
  createMachine(contract: Contract): AnyStateMachine;
  project(snapshot: SnapshotFrom<AnyStateMachine>): ActionSnapshotView;
  commands(contract: Contract, evidence: ActionEvidence): DomainCommand[];
  boardCommands?(contract: Contract, evidence: ActionEvidence): BoardCommand[];
}

export interface ActionPresentationProjection {
  enabledByKind: { points: string[]; lines: string[]; angles: string[] };
  answerSlots: AnswerSlotView[];
  preview?: CanvasSlice["preview"];
  diagramPreviewCommands?: DomainCommand[];
  boardPreview?: BoardCommand[];
}

export function projectBoardSlotValues(contract: ActionContract, values: Record<string, string | undefined>): BoardCommand[] {
  return Object.entries(values).flatMap(([role, latex]) => {
    const slotId = contract.boardTargets?.[role];
    return slotId && latex ? [{ type: "fill-slot" as const, slotId, latex }] : [];
  });
}

export type RegisteredActionDefinition = ActionMachineDefinition & { kind: ActionKind; version: 1 };

export function projectStandardSnapshot<Contract extends ActionContract = ActionContract>(
  snapshot: SnapshotFrom<AnyStateMachine>,
  isReady: (context: StandardActionContext<Contract>) => boolean,
  present: (context: StandardActionContext<Contract>) => ActionPresentationProjection,
  commands: (contract: Contract, evidence: ActionEvidence) => DomainCommand[] = () => [],
): ActionSnapshotView {
  const context = snapshot.context as StandardActionContext<Contract>;
  const done = snapshot.status === "done";
  const output = done ? snapshot.output as ActionEvidence | { type: "cancelled" } | undefined : undefined;
  const evidence = output && !("type" in output && output.type === "cancelled")
    ? output as ActionEvidence
    : undefined;
  const presentation = present(context);
  return {
    state: typeof snapshot.value === "string" ? snapshot.value : JSON.stringify(snapshot.value),
    selectedObjectIds: [...context.points, ...context.lines, ...context.angles],
    selectedByKind: { points: [...context.points], lines: [...context.lines], angles: [...context.angles] },
    answers: { ...context.answers },
    activeSlotId: context.activeSlotId,
    wrongObjectId: context.wrongObjectId,
    wrongMessage: context.wrongMessage,
    ready: !done && isReady(context),
    done,
    evidence,
    commands: evidence ? commands(context.contract, evidence) : [],
    diagramPreviewCommands: presentation.diagramPreviewCommands || [],
    boardPreview: presentation.boardPreview || [],
    enabledByKind: presentation.enabledByKind,
    projectedAnswerSlots: presentation.answerSlots,
    preview: presentation.preview,
  };
}

export function createActorFromDefinition<Contract extends ActionContract>(
  definition: ActionMachineDefinition<Contract>,
  contract: Contract,
): ActionActor {
  const machine = definition.createMachine(contract);
  const actor = createActor(machine);
  const listeners = new Set<() => void>();
  let cached: ActionSnapshotView;
  const project = () => definition.project(actor.getSnapshot() as SnapshotFrom<AnyStateMachine>);
  actor.subscribe(() => {
    cached = project();
    for (const listener of listeners) listener();
  });
  actor.start();
  cached = project();
  return {
    contract,
    send(event) { actor.send(event); },
    getSnapshot() { return cached; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    stop() { listeners.clear(); actor.stop(); },
  };
}

import { assign, setup, type AnyStateMachine, type SnapshotFrom } from "xstate";
import type { ActionContract, ActionEvidence } from "../../../../shared/actionRuntime";
import type { DomainCommand } from "../../../../shared/actionWorld";
import type { BoardCommand } from "../../../../shared/solutionBoard";
import type { ActionRuntimeEvent } from "../events";
import { projectStandardSnapshot, type ActionMachineDefinition, type StandardActionContext } from "./actionDefinition";

interface HistoryFrame {
  lines: string[];
  answers: Record<string, string>;
  activeSlotId?: string;
}

export interface FormMachineContext<Contract extends ActionContract> extends StandardActionContext<Contract> {
  history: HistoryFrame[];
}

export interface FormMachineBehavior<Contract extends ActionContract> {
  availableLineIds(contract: Contract): string[];
  maxLines(contract: Contract): number;
  expectedLineAt?(contract: Contract, index: number): string | undefined;
  activeSlotForLine?(contract: Contract, lineId: string): string | undefined;
  structurallyReady(context: FormMachineContext<Contract>): boolean;
  locallyCorrect(context: FormMachineContext<Contract>): boolean;
  evidence(context: FormMachineContext<Contract>): ActionEvidence;
  answerSlots?(context: FormMachineContext<Contract>): Contract["answerSlots"];
  slotValue?(context: FormMachineContext<Contract>, slotId: string): string;
  commands?(contract: Contract, evidence: ActionEvidence): DomainCommand[];
  previewCommands?(context: FormMachineContext<Contract>): DomainCommand[];
  boardPreview?(context: FormMachineContext<Contract>): BoardCommand[];
  boardCommands?(contract: Contract, evidence: ActionEvidence): BoardCommand[];
}

function frame<Contract extends ActionContract>(context: FormMachineContext<Contract>): HistoryFrame {
  return { lines: [...context.lines], answers: { ...context.answers }, activeSlotId: context.activeSlotId };
}

export function createFormMachineDefinition<Contract extends ActionContract>(
  kind: Contract["kind"],
  behavior: FormMachineBehavior<Contract>,
): ActionMachineDefinition<Contract> {
  const definition: ActionMachineDefinition<Contract> = {
    kind,
    version: 1,
    createMachine(contract) {
      type Context = FormMachineContext<Contract>;
      const validLine = (context: Context, event: ActionRuntimeEvent) => {
        if (event.type !== "OBJECT.SELECTED" || event.objectKind !== "line") return false;
        if (!behavior.availableLineIds(contract).includes(event.objectId)
          || context.lines.includes(event.objectId)
          || context.lines.length >= behavior.maxLines(contract)) return false;
        const expected = behavior.expectedLineAt?.(contract, context.lines.length);
        return contract.validationPolicy !== "local-teaching" || !expected || expected === event.objectId;
      };
      return setup({
        types: { context: {} as Context, events: {} as ActionRuntimeEvent, output: {} as ActionEvidence | { type: "cancelled" } },
        guards: {
          validLine: ({ context, event }) => validLine(context, event),
          canComplete: ({ context }) => behavior.structurallyReady(context)
            && (contract.validationPolicy !== "local-teaching" || behavior.locallyCorrect(context)),
          structurallyReady: ({ context }) => behavior.structurallyReady(context),
        },
        actions: {
          selectLine: assign(({ context, event }) => event.type === "OBJECT.SELECTED" ? {
            lines: [...context.lines, event.objectId],
            activeSlotId: behavior.activeSlotForLine?.(contract, event.objectId),
            history: [...context.history, frame(context)],
            wrongObjectId: undefined,
            wrongMessage: undefined,
          } : {}),
          rejectObject: assign(({ context, event }) => {
            if (event.type !== "OBJECT.SELECTED") return {};
            const expected = behavior.expectedLineAt?.(contract, context.lines.length);
            return {
              wrongObjectId: event.objectId,
              wrongMessage: expected
                ? `你点到了 ${event.objectId}，当前请先选择 ${expected}。`
                : `你点到了 ${event.objectId}，它不符合当前动作的选择要求。`,
            };
          }),
          changeAnswer: assign(({ context, event }) => event.type === "ANSWER.CHANGED" ? {
            answers: { ...context.answers, [event.slotId]: event.value },
            activeSlotId: event.slotId,
            history: [...context.history, frame(context)],
            wrongObjectId: undefined,
            wrongMessage: undefined,
          } : {}),
          back: assign(({ context }) => {
            const previous = context.history[context.history.length - 1];
            return previous ? { ...previous, history: context.history.slice(0, -1), wrongObjectId: undefined, wrongMessage: undefined } : {};
          }),
          clear: assign({ lines: () => [], answers: () => ({}), activeSlotId: () => undefined, history: () => [], wrongObjectId: () => undefined, wrongMessage: () => undefined }),
          diagnose: assign({ wrongMessage: () => "答案还不符合当前关系，请根据提示再检查一次。" }),
        },
      }).createMachine({
        id: `${kind}@1`,
        initial: "editing",
        context: { contract, points: [], lines: [], angles: [], answers: {}, history: [] },
        states: {
          editing: {
            on: {
              "OBJECT.SELECTED": [{ guard: "validLine", actions: "selectLine" }, { actions: "rejectObject" }],
              "ANSWER.CHANGED": { actions: "changeAnswer" },
              BACK: { actions: "back" },
              CLEAR: { actions: "clear" },
              SUBMIT: [{ guard: "canComplete", target: "completed" }, { guard: "structurallyReady", actions: "diagnose" }],
              CANCEL: "cancelled",
            },
          },
          completed: { type: "final" },
          cancelled: { type: "final" },
        },
        output: ({ context }) => behavior.structurallyReady(context) ? behavior.evidence(context) : { type: "cancelled" },
      }) as AnyStateMachine;
    },
    project(snapshot: SnapshotFrom<AnyStateMachine>) {
      return projectStandardSnapshot(
        snapshot,
        (context) => behavior.structurallyReady(context as FormMachineContext<Contract>),
        (standard) => {
          const context = standard as FormMachineContext<Contract>;
          const specs = behavior.answerSlots?.(context) || context.contract.answerSlots;
          return {
            enabledByKind: {
              points: [],
              lines: context.lines.length < behavior.maxLines(context.contract)
                ? behavior.availableLineIds(context.contract).filter((id) => !context.lines.includes(id))
                : [],
              angles: [],
            },
            answerSlots: specs.map((slot) => {
              const value = behavior.slotValue?.(context, slot.id) ?? context.answers[slot.id] ?? "";
              return {
                ...slot,
                value,
                active: context.activeSlotId === slot.id,
                status: value ? "filled" as const : "empty" as const,
              };
            }),
            diagramPreviewCommands: behavior.previewCommands?.(context),
            boardPreview: behavior.boardPreview?.(context),
          };
        },
        behavior.commands,
      );
    },
    commands: behavior.commands || (() => []),
    boardCommands: behavior.boardCommands,
  };
  return definition;
}

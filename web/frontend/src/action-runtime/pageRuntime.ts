import { assign, createActor, setup } from "xstate";
import type {
  ActionCheckpointSnapshot,
  ActionEvaluationResponse,
  ActionEvidence,
  AgentCommand,
  CoachDirective,
  ExercisePlan,
  StudentEvent,
} from "../../../shared/actionRuntime";
import type { DomainCommand } from "../../../shared/actionWorld";
import { applyActionEffectBatch, diagramEffects, replayActionEffectBatches } from "../../../shared/actionEffects";
import type { ActionSolutionBoardContext } from "../../../shared/solutionBoard";
import type { ActionRuntimeEvent } from "./events";
import { projectWorkspaceView } from "./projectWorkspaceView";
import { actionMachineRegistry, type ActionMachineRegistry } from "./registry";
import type { ActionActor, ActionPageRuntime, PageRuntimeSnapshot } from "./types";

type PageEvent =
  | { type: "ACTION_DONE"; evidence: ActionEvidence; commands: DomainCommand[]; submit: boolean; nextActionId?: string }
  | { type: "MARK_SUBMITTING" }
  | { type: "TRANSPORT_FAILURE"; message: string }
  | { type: "UNDO_LAST_ACTION" }
  | { type: "CLEAR_DRAFT_GROUP" }
  | { type: "EVALUATION"; result: ActionEvaluationResponse }
  | { type: "COACH"; directive: CoachDirective }
  | { type: "RESET"; plan: ExercisePlan; checkpoint?: ActionCheckpointSnapshot };

function initialWorld(plan: ExercisePlan) {
  return plan.world;
}

function withSolutionBoardContext(plan: ExercisePlan, boardContext?: ActionSolutionBoardContext): ExercisePlan {
  if (!boardContext) return plan;
  return {
    ...plan,
    solutionBoardContexts: [
      ...(plan.solutionBoardContexts || []).filter((candidate) => candidate.actionId !== boardContext.actionId),
      boardContext,
    ],
  };
}

const pageMachine = setup({
  types: {
    context: {} as PageRuntimeSnapshot,
    input: {} as { plan: ExercisePlan; checkpoint?: ActionCheckpointSnapshot },
    events: {} as PageEvent,
  },
  actions: {
    completeAction: assign(({ context, event }) => {
      if (event.type !== "ACTION_DONE") return {};
      const evidence = context.evidence.filter((item) => item.actionId !== event.evidence.actionId).concat(event.evidence);
      const completedActionIds = context.completedActionIds.includes(event.evidence.actionId)
        ? context.completedActionIds
        : [...context.completedActionIds, event.evidence.actionId];
      let draft = context.world.draft;
      let applicableCommands = [...diagramEffects(event.commands)];
      try {
        draft = applyActionEffectBatch(context.world.draft, {
          actionId: event.evidence.actionId,
          sourceStepId: event.evidence.sourceStepId,
          commands: applicableCommands,
          committed: false,
        });
      } catch {
        // A ServerAuthoritative action may be structurally complete yet
        // mathematically invalid. Keep its typed evidence for backend diagnosis
        // without allowing an optimistic draft command to crash the page actor.
        applicableCommands = [];
      }
      const batch = { actionId: event.evidence.actionId, sourceStepId: event.evidence.sourceStepId, commands: applicableCommands, committed: false };
      const commandBatches = context.world.commandBatches.filter((item) => item.actionId !== batch.actionId).concat(batch);
      const world = { ...context.world, draft, commandBatches };
      if (event.submit) return { evidence, completedActionIds, world, status: "submitting" as const, transportMessage: undefined };
      if (!event.nextActionId) return { evidence, completedActionIds, world, status: "complete" as const };
      return { evidence, completedActionIds, world, currentActionId: event.nextActionId, status: "active" as const };
    }),
    markSubmitting: assign({ status: () => "submitting" as const, transportMessage: () => undefined }),
    markTransportFailure: assign(({ event }) => event.type === "TRANSPORT_FAILURE"
      ? { status: "transport-error" as const, transportMessage: event.message }
      : {}),
    undoLastAction: assign(({ context }) => {
      let index = -1;
      for (let candidate = context.world.commandBatches.length - 1; candidate >= 0; candidate -= 1) {
        if (!context.world.commandBatches[candidate].committed) { index = candidate; break; }
      }
      if (index < 0) return {};
      const removed = context.world.commandBatches[index];
      const commandBatches = context.world.commandBatches.filter((_, batchIndex) => batchIndex !== index);
      return {
        currentActionId: removed.actionId,
        completedActionIds: context.completedActionIds.filter((id) => id !== removed.actionId),
        evidence: context.evidence.filter((item) => item.actionId !== removed.actionId),
        world: { ...context.world, commandBatches, draft: replayActionEffectBatches(context.world.committed, commandBatches) },
        status: "active" as const,
      };
    }),
    clearDraftGroup: assign(({ context }) => {
      const current = context.plan.actions.find((action) => action.actionId === context.currentActionId);
      if (!current) return {};
      const affected = context.world.commandBatches.filter((batch) => !batch.committed && batch.sourceStepId === current.sourceStepId);
      if (!affected.length) return {};
      const affectedIds = new Set(affected.map((batch) => batch.actionId));
      const commandBatches = context.world.commandBatches.filter((batch) => !affectedIds.has(batch.actionId));
      const first = context.plan.actions.find((action) => affectedIds.has(action.actionId));
      return {
        currentActionId: first?.actionId || context.currentActionId,
        completedActionIds: context.completedActionIds.filter((id) => !affectedIds.has(id)),
        evidence: context.evidence.filter((item) => !affectedIds.has(item.actionId)),
        world: { ...context.world, commandBatches, draft: replayActionEffectBatches(context.world.committed, commandBatches) },
        status: "active" as const,
      };
    }),
    applyEvaluation: assign(({ context, event }) => {
      if (event.type !== "EVALUATION") return {};
      const result = event.result;
      if (result.outcome === "conflict") {
        if (result.plan) {
          return {
            plan: result.plan,
            currentActionId: result.plan.currentActionId,
            completedActionIds: result.plan.completedActionIds,
            evidence: [],
            revision: result.revision,
            status: "conflict" as const,
            wrongObjectIds: [],
            wrongMessage: "进度已在其他页面更新，已载入最新状态。",
          };
        }
        return { revision: result.revision, status: "conflict" as const, wrongMessage: "进度版本冲突，请重新载入。" };
      }
      if (result.outcome === "rejected") {
        const wrongActionIds = new Set(result.diagnosis?.wrongActionIds?.length
          ? result.diagnosis.wrongActionIds
          : [context.currentActionId]);
        const commandBatches = context.world.commandBatches.filter((batch) => !wrongActionIds.has(batch.actionId));
        const first = context.plan.actions.find((action) => wrongActionIds.has(action.actionId));
        return {
          currentActionId: first?.actionId || context.currentActionId,
          completedActionIds: context.completedActionIds.filter((id) => !wrongActionIds.has(id)),
          evidence: context.evidence.filter((item) => !wrongActionIds.has(item.actionId)),
          world: { ...context.world, commandBatches, draft: replayActionEffectBatches(context.world.committed, commandBatches) },
          revision: result.revision,
          status: "wrong" as const,
          wrongObjectIds: result.diagnosis?.wrongObjectIds || [],
          wrongMessage: result.diagnosis?.messageLatex || "当前答案与题目关系不一致。",
        };
      }
      if (result.phase === "correct_pause" || result.phase === "group_finished") {
        const committed = result.committedWorld || { ...context.world.draft, revision: result.revision };
        return {
          plan: withSolutionBoardContext({ ...context.plan, world: committed, revision: result.revision }, result.solutionBoardContext),
          revision: result.revision,
          world: { committed, draft: committed, revision: result.revision, commandBatches: [] },
          status: "complete" as const, wrongObjectIds: [], wrongMessage: undefined,
        };
      }
      const nextActionId = result.nextActionId || context.plan.currentActionId;
      return {
        plan: withSolutionBoardContext({ ...context.plan, world: result.committedWorld || context.world.draft, revision: result.revision }, result.solutionBoardContext),
        revision: result.revision,
        currentActionId: nextActionId,
        status: "active" as const,
        evidence: [],
        completedActionIds: context.plan.actions
          .filter((action) => action.actionId !== nextActionId && context.completedActionIds.includes(action.actionId))
          .map((action) => action.actionId),
        wrongObjectIds: [],
        wrongMessage: undefined,
        world: {
          committed: result.committedWorld || { ...context.world.draft, revision: result.revision },
          draft: result.committedWorld || { ...context.world.draft, revision: result.revision },
          revision: result.revision,
          commandBatches: [],
        },
      };
    }),
    applyCoach: assign(({ event }) => event.type === "COACH" ? { coachDirective: event.directive } : {}),
    reset: assign(({ event }) => {
      if (event.type !== "RESET") return {};
      const checkpoint = event.checkpoint?.revision === event.plan.revision ? event.checkpoint : undefined;
      return {
        plan: event.plan,
        currentActionId: checkpoint?.currentActionId || event.plan.currentActionId,
        completedActionIds: checkpoint?.completedActionIds || event.plan.completedActionIds,
        evidence: checkpoint?.evidence || [],
        revision: event.plan.revision,
        status: "active" as const,
        coachDirective: undefined,
        wrongObjectIds: [],
        wrongMessage: undefined,
        transportMessage: undefined,
        world: { committed: initialWorld(event.plan), draft: initialWorld(event.plan), revision: event.plan.revision, commandBatches: [] },
      };
    }),
  },
}).createMachine({
  id: "action-page-runtime",
  initial: "running",
  context: ({ input }) => ({
    plan: input.plan,
    currentActionId: input.checkpoint?.revision === input.plan.revision ? input.checkpoint.currentActionId : input.plan.currentActionId,
    completedActionIds: input.checkpoint?.revision === input.plan.revision ? input.checkpoint.completedActionIds : input.plan.completedActionIds,
    evidence: input.checkpoint?.revision === input.plan.revision ? input.checkpoint.evidence : [],
    revision: input.plan.revision,
    status: "active",
    wrongObjectIds: [],
    world: { committed: initialWorld(input.plan), draft: initialWorld(input.plan), revision: input.plan.revision, commandBatches: [] },
  }),
  states: {
    running: {
      on: {
        ACTION_DONE: { actions: "completeAction" },
        MARK_SUBMITTING: { actions: "markSubmitting" },
        TRANSPORT_FAILURE: { actions: "markTransportFailure" },
        UNDO_LAST_ACTION: { actions: "undoLastAction" },
        CLEAR_DRAFT_GROUP: { actions: "clearDraftGroup" },
        EVALUATION: { actions: "applyEvaluation" },
        COACH: { actions: "applyCoach" },
        RESET: { actions: "reset" },
      },
    },
  },
});

function nowEvent(event: ActionRuntimeEvent): StudentEvent | undefined {
  const at = new Date().toISOString();
  switch (event.type) {
    case "OBJECT.SELECTED": return { type: "object-selected", objectKind: event.objectKind, objectId: event.objectId, at };
    case "ANSWER.CHANGED": return { type: "answer-changed", slotId: event.slotId, value: event.value, at };
    case "BACK": return { type: "back", at };
    case "CLEAR": return { type: "clear", at };
    default: return undefined;
  }
}

export function createActionPageRuntime(
  plan: ExercisePlan,
  checkpoint?: ActionCheckpointSnapshot,
  registry: ActionMachineRegistry = actionMachineRegistry,
): ActionPageRuntime {
  const pageActor = createActor(pageMachine, { input: { plan, checkpoint } });
  const listeners = new Set<() => void>();
  let cachedPageSnapshot: PageRuntimeSnapshot = pageActor.getSnapshot().context;
  const recentEvents: StudentEvent[] = [];
  let wrongAttempts = 0;
  let child: ActionActor;
  let childUnsubscribe: (() => void) | undefined;
  let handledEvidenceActionId: string | undefined;
  let draftToHydrate = checkpoint?.revision === plan.revision ? checkpoint.currentDraft : undefined;

  function notify() {
    // Child snapshots change without changing XState page context. Clone the
    // public snapshot so useSyncExternalStore observes every semantic event.
    cachedPageSnapshot = { ...pageActor.getSnapshot().context };
    for (const listener of listeners) listener();
  }

  function actionFor(snapshot = pageActor.getSnapshot().context) {
    const action = snapshot.plan.actions.find((item) => item.actionId === snapshot.currentActionId);
    if (!action) throw new Error(`Action ${snapshot.currentActionId} is absent from ExercisePlan`);
    return action;
  }

  function nextActionId(actionId: string): string | undefined {
    const snapshot = pageActor.getSnapshot().context;
    const index = snapshot.plan.actions.findIndex((item) => item.actionId === actionId);
    return snapshot.plan.actions[index + 1]?.actionId;
  }

  function mountChild() {
    childUnsubscribe?.();
    child?.stop();
    handledEvidenceActionId = undefined;
    child = registry.create(actionFor());
    childUnsubscribe = child.subscribe(() => {
      const snapshot = child.getSnapshot();
      if (snapshot.done && snapshot.evidence && handledEvidenceActionId !== snapshot.evidence.actionId) {
        handledEvidenceActionId = snapshot.evidence.actionId;
        recentEvents.push({ type: "action-completed", at: new Date().toISOString() });
        const contract = child.contract;
        pageActor.send({
          type: "ACTION_DONE",
          evidence: snapshot.evidence,
          commands: snapshot.commands,
          submit: contract.submitOnComplete && contract.validationPolicy === "server-authoritative",
          nextActionId: nextActionId(contract.actionId),
        });
      }
      notify();
    });
    if (draftToHydrate) {
      const draft = draftToHydrate;
      draftToHydrate = undefined;
      for (const objectId of draft.selectedByKind.points) child.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId });
      for (const objectId of draft.selectedByKind.lines) child.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId });
      for (const objectId of draft.selectedByKind.angles) child.send({ type: "OBJECT.SELECTED", objectKind: "angle", objectId });
      const entries = Object.entries(draft.answers).sort(([left], [right]) => left === draft.activeSlotId ? 1 : right === draft.activeSlotId ? -1 : 0);
      for (const [slotId, value] of entries) child.send({ type: "ANSWER.CHANGED", slotId, value });
    }
  }

  let previousActionId = pageActor.getSnapshot().context.currentActionId;
  pageActor.subscribe((snapshot) => {
    const current = snapshot.context.currentActionId;
    if (current !== previousActionId) {
      previousActionId = current;
      mountChild();
    }
    notify();
  });
  pageActor.start();
  previousActionId = pageActor.getSnapshot().context.currentActionId;
  mountChild();

  return {
    send(event) {
      const page = pageActor.getSnapshot().context;
      if (page.status === "submitting" || page.status === "transport-error") return;
      const traceEvent = nowEvent(event);
      if (traceEvent) {
        recentEvents.push(traceEvent);
        if (recentEvents.length > 30) recentEvents.shift();
      }
      const childSnapshot = child.getSnapshot();
      if (event.type === "BACK" && childSnapshot.selectedObjectIds.length === 0 && Object.keys(childSnapshot.answers).length === 0) {
        pageActor.send({ type: "UNDO_LAST_ACTION" });
        return;
      }
      if (event.type === "CLEAR") {
        pageActor.send({ type: "CLEAR_DRAFT_GROUP" });
        child.send(event);
        return;
      }
      child.send(event);
    },
    getView() {
      return projectWorkspaceView(pageActor.getSnapshot().context, child.getSnapshot());
    },
    getSnapshot() {
      return cachedPageSnapshot;
    },
    getTrace(studentMessage) {
      const page = pageActor.getSnapshot().context;
      const current = child.getSnapshot();
      return {
        exerciseId: page.plan.exerciseId,
        currentActionId: page.currentActionId,
        actionState: current.state,
        selectedObjectIds: current.selectedObjectIds,
        answerDraft: current.answers,
        recentEvents: recentEvents.slice(-20),
        wrongAttempts,
        revision: page.revision,
        ...(studentMessage?.trim() ? { studentMessage: studentMessage.trim() } : {}),
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    applyCoach(directive) {
      pageActor.send({ type: "COACH", directive });
    },
    applyAgentCommand(command: AgentCommand, confirmed = false) {
      const page = pageActor.getSnapshot().context;
      if (command.actionId !== page.currentActionId || page.plan.mode === "assessment") return false;
      if (page.plan.mode === "guided-practice" && !confirmed) return false;
      const contract = actionFor(page);
      if (!contract.capabilities.includes(`agent:${command.type}`)) return false;
      switch (command.type) {
        case "select-object": {
          const entity = projectWorkspaceView(page, child.getSnapshot()).canvas.entities[command.objectId!];
          if (!entity?.enabled) return false;
          child.send({ type: "OBJECT.SELECTED", objectKind: entity.kind, objectId: entity.id });
          return true;
        }
        case "set-answer":
          child.send({ type: "ANSWER.CHANGED", slotId: command.slotId!, value: command.value! });
          return true;
        case "back": child.send({ type: "BACK" }); return true;
        case "clear": child.send({ type: "CLEAR" }); return true;
      }
    },
    markSubmitting() {
      pageActor.send({ type: "MARK_SUBMITTING" });
    },
    markTransportFailure(message = "提交失败，请检查网络后重试。") {
      pageActor.send({ type: "TRANSPORT_FAILURE", message });
    },
    retrySubmission() {
      if (pageActor.getSnapshot().context.status === "transport-error") pageActor.send({ type: "MARK_SUBMITTING" });
    },
    applyEvaluation(result) {
      if (result.outcome === "rejected") wrongAttempts += 1;
      pageActor.send({ type: "EVALUATION", result });
      if (result.outcome === "rejected" || result.outcome === "conflict") mountChild();
    },
    resetFromPlan(nextPlan) {
      draftToHydrate = undefined;
      previousActionId = nextPlan.currentActionId;
      pageActor.send({ type: "RESET", plan: nextPlan });
      mountChild();
    },
    stop() {
      childUnsubscribe?.();
      child.stop();
      listeners.clear();
      pageActor.stop();
    },
  };
}

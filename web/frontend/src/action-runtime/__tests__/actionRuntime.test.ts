import { describe, expect, it } from "vitest";
import type { ActionContract, ExercisePlan } from "../../../../shared/actionRuntime";
import { assertExercisePlan, isActionEvidence, isAgentCommand, isCoachDirective } from "../../../../shared/actionRuntime";
import { createActionActor } from "../actionActor";
import { createActionPageRuntime } from "../pageRuntime";
import { actionMachineRegistry, UnsupportedActionError } from "../registry";

function plan(validationPolicy: "local-demonstration" | "server-authoritative" = "server-authoritative"): ExercisePlan {
  return {
    planVersion: 5,
    exerciseId: "exercise-1",
    revision: 0,
    mode: validationPolicy === "local-demonstration" ? "learn" : "guided-practice",
    metadata: { taskId: "auxiliaryTwoRatios", title: "test", promptLatex: "prompt", skillTags: [] },
    world: {
      revision: 0,
      geometry: {
        viewBox: { width: 10, height: 10 },
        points: [{ id: "T", x: 0, y: 1 }, { id: "C0", x: 0, y: 0 }, { id: "C1", x: 1, y: 0 }, { id: "R0", x: 0, y: 2 }, { id: "R1", x: 1, y: 3 }],
        segments: [{ id: "S", from: "R0", to: "R1" }],
      },
    },
    solutionBoardContexts: ["step/make", "step/intersect"].map((actionId) => ({
      actionId,
      stage: "enter" as const,
      solutionRevision: "fixture-v1",
      board: {
        schemaVersion: 1,
        documentId: "solution",
        headingLatex: "\\text{解：}",
        expressions: [{
          expressionId: "construction",
          sourceStepId: "step",
          latexTemplate: "\\text{过 }{{through}}\\text{ 作 }{{helper}}\\parallel {{reference}}\\text{，交 }{{carrier}}\\text{ 于 }{{intersection}}",
          slotValues: { through: "T", helper: "TP", reference: "S", carrier: "C0C1", intersection: "X" },
          phase: "complete" as const,
        }],
      },
    })),
    coach: { profileId: "coach", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions: [
      {
        actionId: "step/make", sourceStepId: "step", kind: "make-parallel", version: 1,
        title: "作平行线", instruction: "选点和线", input: { throughPointId: "T", referenceLineId: "S", availablePointIds: ["T", "C0", "C1"], availableLineIds: ["S"], outputLineId: "P", outputLineLabel: "TP" },
        ...(validationPolicy === "local-demonstration" ? { localTruth: { throughPointId: "T", referenceLineId: "S" } } : {}),
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy, submitOnComplete: false,
      },
      {
        actionId: "step/intersect", sourceStepId: "step", kind: "intersect-carriers", version: 1,
        title: "求交", instruction: "选两个点", input: { carrierPointIds: ["C0", "C1"], availablePointIds: ["T", "C0", "C1"], parallelLineId: "P", outputCarrierLineId: "C", outputPointId: "X" },
        ...(validationPolicy === "local-demonstration" ? { localTruth: { carrierPointIds: ["C0", "C1"] } } : {}),
        capabilities: ["agent:select-object", "agent:back", "agent:clear"], answerSlots: [], validationPolicy, submitOnComplete: true,
      },
    ],
    currentActionId: "step/make",
    completedActionIds: [],
  };
}

function remainingContracts(validationPolicy: "local-demonstration" | "server-authoritative"): ActionContract[] {
  const base = (actionId: string) => ({ actionId, sourceStepId: actionId, version: 1 as const, title: actionId, instruction: actionId, capabilities: [], validationPolicy, submitOnComplete: true });
  return [
    { ...base("mark"), kind: "mark-segment-values", input: { labels: [{ segmentId: "AB", displayName: "AB", valueLatex: "2" }], availableSegmentIds: ["AB"], autoFocusSequence: true }, answerSlots: [{ id: "AB", label: "AB", kind: "number", required: true }] },
    { ...base("pair"), kind: "pair-segments", input: { expectedOrder: ["AB", "CD"], availableSegmentIds: ["AB", "CD"], pairCount: 1 }, answerSlots: [{ id: "segment-pairs", label: "pair", kind: "object", required: true }] },
    { ...base("ratio"), kind: "ratio-scratch", input: { expectedOrder: ["AB", "CD"], availableSegmentIds: ["AB", "CD"], firstDisplayName: "AB", firstValueLatex: "2", secondDisplayName: "CD", secondValueLatex: "4", simplifiedRatio: ["1", "2"] }, answerSlots: [{ id: "ratio-first", label: "first", kind: "number", required: true }, { id: "ratio-second", label: "second", kind: "number", required: true }] },
    { ...base("convert"), kind: "convert-collinear", input: { expectedOrder: ["AC", "AD", "CD"], availableSegmentIds: ["AC", "AD", "CD"], wholeSegment: "AC", targetSegment: "AD", knownSegment: "CD", relationLatex: "AC=AD+CD" }, answerSlots: [] },
    { ...base("equation"), kind: "enter-equation", input: { expectedOrder: ["AB", "2", "3"], availableSegmentIds: ["AB"], targetLatex: "x", factorSlots: ["known", "numerator", "denominator"], shareValues: ["2", "3"], expectedResult: "4" }, answerSlots: [{ id: "known-factor", label: "known", kind: "object", required: true }, { id: "numerator", label: "num", kind: "number", required: true }, { id: "denominator", label: "den", kind: "number", required: true }, { id: "result", label: "result", kind: "number", required: true }] },
    { ...base("select"), kind: "select-option", input: { options: [{ value: "B", labelLatex: "B" }], expectedValue: "B" }, answerSlots: [{ id: "choice", label: "choice", kind: "text", required: true }] },
    { ...base("text"), kind: "enter-text", input: { placeholder: "answer", expectedValues: ["ok"] }, answerSlots: [{ id: "value", label: "value", kind: "text", required: true }] },
  ];
}

describe("Action Runtime v2", () => {
  it("validates plan/evidence at the transport boundary", () => {
    expect(() => assertExercisePlan(plan("local-demonstration"))).not.toThrow();
    expect(() => assertExercisePlan({ ...plan(), planVersion: 99 })).toThrow(/Unsupported/);
    expect(isActionEvidence({ actionId: "a", sourceStepId: "s", kind: "enter-text", version: 1, value: "ok" })).toBe(true);
    expect(isActionEvidence({ actionId: "a", sourceStepId: "s", kind: "unknown", version: 1 })).toBe(false);
    expect(isAgentCommand({ commandId: "c", actionId: "a", type: "clear" })).toBe(true);
    expect(isAgentCommand({ commandId: "c", actionId: "a", type: "run-script", value: "alert(1)" })).toBe(false);
    expect(isCoachDirective({ directiveId: "d", messageLatex: "hint", tone: "prompt", highlightObjectIds: [], agentCommand: { commandId: "c", actionId: "a", type: "clear" } })).toBe(true);
    expect(isCoachDirective({ directiveId: "d", messageLatex: "hint", tone: "prompt", highlightObjectIds: [], agentCommand: { commandId: "c", actionId: "a", type: "dom-selector", value: "#answer" } })).toBe(false);
    const futurePlan = {
      ...plan("local-demonstration"),
      solutionBoardContexts: undefined,
      actions: [{ ...plan("local-demonstration").actions[0], kind: "future-tool", version: 9, input: { opaque: true } }],
    };
    expect(() => assertExercisePlan(futurePlan)).not.toThrow();
    expect(actionMachineRegistry.supports("future-tool", 9)).toBe(false);
  });

  it("runs exactly the current child and joins split geometry evidence before submit", () => {
    const runtime = createActionPageRuntime(plan());
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/intersect");
    expect(runtime.getSnapshot().evidence.map((item) => item.kind)).toEqual(["make-parallel"]);

    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C1" });
    expect(runtime.getSnapshot().status).toBe("submitting");
    expect(runtime.getSnapshot().evidence.map((item) => item.kind)).toEqual(["make-parallel", "intersect-carriers"]);
    runtime.stop();
  });

  it("ordinary semantic events, answer changes, BACK and CLEAR issue zero network requests", () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => { requests += 1; throw new Error("unexpected network"); }) as typeof fetch;
    try {
      const runtime = createActionPageRuntime(plan("local-demonstration"));
      runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
      runtime.send({ type: "BACK" });
      runtime.send({ type: "ANSWER.CHANGED", slotId: "unused", value: "1" });
      runtime.send({ type: "CLEAR" });
      expect(requests).toBe(0);
      runtime.stop();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("LocalTraining records wrong semantic candidates and completes locally without evaluator submission", () => {
    const trainingPlan: ExercisePlan = {
      ...plan("local-demonstration"),
      mode: "guided-practice",
      actions: plan("local-demonstration").actions.map((action) => ({ ...action, validationPolicy: "local-training" as const })),
      runtimeCapabilities: { practiceValidation: "local-training", trainingSync: "async-records", narrationTransport: "url", coachTurnTransport: "request-response", liveCoach: true },
    };
    const runtime = createActionPageRuntime(trainingPlan);
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/make");
    expect(runtime.getTrace().wrongAttempts).toBe(1);
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C1" });
    expect(runtime.getSnapshot().status).toBe("complete");
    const training = runtime.getTrainingSnapshot();
    expect(training.attempts.map((attempt) => attempt.outcome)).toEqual([
      "wrong", "correct-partial", "correct-complete", "correct-partial", "correct-complete",
    ]);
    expect(training.actionMetrics.every((metric) => metric.completed)).toBe(true);
    runtime.stop();
  });

  it("advances Learn one reviewed teaching beat at a time without learner input", () => {
    const runtime = createActionPageRuntime(plan("local-demonstration"));
    expect(runtime.getSnapshot().currentActionId).toBe("step/make");
    expect(runtime.advanceTeaching()).toBe(true);
    expect(runtime.getSnapshot().currentActionId).toBe("step/intersect");
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines?.map((line) => line.id)).toContain("P");

    expect(runtime.advanceTeaching()).toBe(true);
    expect(runtime.getSnapshot().status).toBe("complete");
    expect(runtime.getSnapshot().world.draft.geometry?.points.some((point) => point.id === "X")).toBe(true);
    runtime.stop();
  });

  it("every registered form action can demonstrate its reviewed teaching targets", () => {
    for (const contract of remainingContracts("local-demonstration")) {
      const actor = actionMachineRegistry.create(contract);
      expect(actor.demonstrate(), contract.kind).toBe(true);
      expect(actor.getSnapshot().done, contract.kind).toBe(true);
      actor.stop();
    }
  });

  it("keeps local wrong input editable and completes only after correction", () => {
    const contract = {
      actionId: "choice", sourceStepId: "choice", kind: "select-option" as const, version: 1 as const,
      title: "选择", instruction: "选择", input: { options: [], expectedValue: "B" }, capabilities: [],
      answerSlots: [{ id: "choice", label: "选择", kind: "text" as const, required: true }],
      validationPolicy: "local-demonstration" as const, submitOnComplete: true,
    };
    const actor = createActionActor(contract);
    actor.send({ type: "ANSWER.CHANGED", slotId: "choice", value: "A" });
    expect(actor.getSnapshot().ready).toBe(true);
    actor.send({ type: "SUBMIT" });
    expect(actor.getSnapshot().done).toBe(false);
    expect(actor.getSnapshot().wrongMessage).toMatch(/不符合/);
    actor.send({ type: "ANSWER.CHANGED", slotId: "choice", value: "B" });
    actor.send({ type: "SUBMIT" });
    expect(actor.getSnapshot().done).toBe(true);
    actor.stop();
  });

  it("rejects unknown action versions explicitly", () => {
    expect(actionMachineRegistry.supports("make-parallel", 1)).toBe(true);
    expect(() => actionMachineRegistry.create({ ...plan().actions[0], version: 2 } as never)).toThrow(UnsupportedActionError);
  });

  it("registry creates distinct action machines instead of one kind-switch machine", () => {
    const make = actionMachineRegistry.create(plan().actions[0]);
    const intersect = actionMachineRegistry.create(plan().actions[1]);
    expect(make.getSnapshot().state).toBe("select-through-point");
    expect(intersect.getSnapshot().state).toBe("select-first-carrier");
    make.stop();
    intersect.stop();
  });

  it("all migrated Topic actions enforce LocalTeaching truth but only structural ServerAuthoritative guards", () => {
    const drive = (actor: ReturnType<typeof actionMachineRegistry.create>, correct: boolean) => {
      const pick = (id: string) => actor.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: id });
      const answer = (slotId: string, value: string) => actor.send({ type: "ANSWER.CHANGED", slotId, value });
      switch (actor.contract.kind) {
        case "mark-segment-values": pick("AB"); answer("AB", correct ? "2" : "9"); break;
        case "pair-segments": (correct ? ["AB", "CD"] : ["CD", "AB"]).forEach(pick); break;
        case "ratio-scratch":
          (correct ? ["AB", "CD"] : ["CD", "AB"]).forEach(pick);
          answer("ratio-first", correct ? "1" : "9"); answer("ratio-second", correct ? "2" : "8"); break;
        case "convert-collinear": (correct ? ["AC", "AD", "CD"] : ["CD", "AD", "AC"]).forEach(pick); break;
        case "enter-equation":
          pick("AB"); answer("numerator", correct ? "2" : "9"); answer("denominator", correct ? "3" : "8"); answer("result", correct ? "4" : "0"); break;
        case "select-option": answer("choice", correct ? "B" : "A"); break;
        case "enter-text": answer("value", correct ? "ok" : "nope"); break;
        default: throw new Error(`Unexpected contract ${actor.contract.kind}`);
      }
      actor.send({ type: "SUBMIT" });
    };

    for (const contract of remainingContracts("local-demonstration")) {
      const actor = actionMachineRegistry.create(contract);
      drive(actor, true);
      expect(actor.getSnapshot().done, contract.kind).toBe(true);
      actor.stop();
    }
    for (const contract of remainingContracts("server-authoritative")) {
      const actor = actionMachineRegistry.create(contract);
      drive(actor, false);
      expect(actor.getSnapshot().done, contract.kind).toBe(true);
      expect(actor.getSnapshot().evidence?.kind).toBe(contract.kind);
      actor.stop();
    }
  });

  it("previews a selected segment value on the diagram and commits the teaching mark", () => {
    const contract = remainingContracts("local-demonstration")[0];
    const markedPlan: ExercisePlan = {
      ...plan("local-demonstration"),
      solutionBoardContexts: undefined,
      world: {
        revision: 0,
        geometry: {
          viewBox: { width: 10, height: 10 },
          points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 4, y: 0 }],
          segments: [{ id: "AB", from: "A", to: "B" }],
        },
      },
      actions: [contract],
      currentActionId: contract.actionId,
    };
    const runtime = createActionPageRuntime(markedPlan);
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "AB" });
    runtime.send({ type: "ANSWER.CHANGED", slotId: "AB", value: "2" });
    expect(runtime.getView().canvas.geometry?.teachingMarks).toEqual([
      expect.objectContaining({ kind: "segment-label", segmentId: "AB", valueLatex: "2" }),
    ]);
    expect(runtime.getSnapshot().world.draft.geometry?.teachingMarks).toBeUndefined();

    runtime.send({ type: "SUBMIT" });
    expect(runtime.getSnapshot().world.draft.geometry?.teachingMarks).toEqual([
      expect.objectContaining({ kind: "segment-label", segmentId: "AB", valueLatex: "2" }),
    ]);
    runtime.stop();
  });

  it("restores a matching checkpoint without replaying network clicks", () => {
    const runtime = createActionPageRuntime(plan(), {
      currentActionId: "step/intersect",
      completedActionIds: ["step/make"],
      evidence: [{ actionId: "step/make", sourceStepId: "step", kind: "make-parallel", version: 1, throughPointId: "T", referenceLineId: "S" }],
      currentDraft: { selectedByKind: { points: ["C0"], lines: [], angles: [] }, answers: {} },
      revision: 0,
      updatedAt: new Date().toISOString(),
    });
    expect(runtime.getSnapshot().currentActionId).toBe("step/intersect");
    expect(runtime.getSnapshot().evidence).toHaveLength(1);
    expect(runtime.getTrace().selectedObjectIds).toEqual(["C0"]);
    runtime.stop();
  });

  it("applies agent commands through the same event port with mode policy", () => {
    const guided = createActionPageRuntime(plan());
    const command = { commandId: "c1", actionId: "step/make", type: "select-object" as const, objectId: "T" };
    expect(guided.applyAgentCommand(command)).toBe(false);
    expect(guided.applyAgentCommand(command, true)).toBe(true);
    expect(guided.getTrace().selectedObjectIds).toEqual(["T"]);
    guided.stop();

    const noCapabilityPlan = { ...plan(), actions: plan().actions.map((action) => ({ ...action, capabilities: [] })) } as ExercisePlan;
    const noCapability = createActionPageRuntime(noCapabilityPlan);
    expect(noCapability.applyAgentCommand(command, true)).toBe(false);
    noCapability.stop();

    const assessmentPlan = { ...plan(), mode: "assessment" as const };
    const assessment = createActionPageRuntime(assessmentPlan);
    expect(assessment.applyAgentCommand(command, true)).toBe(false);
    assessment.stop();
  });

  it("applies make-parallel and intersect commands to draft world and CLEAR removes every orphan", () => {
    const runtime = createActionPageRuntime(plan("local-demonstration"));
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    expect(runtime.getView().canvas.preview).toMatchObject({ type: "parallel", throughPointId: "T" });
    expect(runtime.getView().solutionBoard?.visibleExpressions[0].latex).toContain("T");
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines?.map((line) => line.id)).toContain("P");
    expect(runtime.getView().canvas.entities.P).toBeDefined();

    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    expect(runtime.getView().canvas.preview).toEqual({ type: "intersection", parallelLineId: "P", carrierPointIds: ["C0"] });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C1" });
    expect(runtime.getSnapshot().world.draft.geometry?.segments.find((line) => line.id === "C")).toMatchObject({
      from: "C0",
      to: "C1",
      extensionPoint: "X",
    });
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines?.find((line) => line.id === "P")).toMatchObject({
      through: "T",
      endPoint: "X",
    });
    expect(runtime.getSnapshot().world.draft.geometry?.points.some((point) => point.id === "X" && point.derived)).toBe(true);
    expect(runtime.getView().solutionBoard?.visibleExpressions[0]).toMatchObject({ isComplete: true });

    runtime.send({ type: "CLEAR" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/make");
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines || []).toEqual([]);
    expect(runtime.getSnapshot().world.draft.geometry?.segments.some((line) => line.id === "C")).toBe(false);
    expect(runtime.getSnapshot().world.draft.geometry?.points.some((point) => point.id === "X")).toBe(false);
    expect(runtime.getView().solutionBoard?.visibleExpressions[0]).toMatchObject({ isComplete: true });
    runtime.stop();
  });

  it("BACK at an empty next action rewinds the previous action command batch", () => {
    const runtime = createActionPageRuntime(plan("local-demonstration"));
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/intersect");
    expect(runtime.getView().controls.canBack).toBe(true);
    runtime.send({ type: "BACK" });
    expect(runtime.getSnapshot().currentActionId).toBe("step/make");
    expect(runtime.getSnapshot().evidence).toEqual([]);
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines || []).toEqual([]);
    runtime.stop();
  });

  it("rejected evaluation rolls back only diagnosed action commands and keeps confirmed draft work", () => {
    const runtime = createActionPageRuntime(plan());
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C1" });
    runtime.applyEvaluation({
      outcome: "rejected", evaluation: "wrong", revision: 1, phase: "wrong_feedback", nextIndex: 0,
      diagnosis: { messageLatex: "载体错误", wrongObjectIds: ["C1"], wrongActionIds: ["step/intersect"] },
    });
    expect(runtime.getSnapshot().evidence.map((item) => item.actionId)).toEqual(["step/make"]);
    expect(runtime.getSnapshot().world.draft.geometry?.derivedLines?.some((line) => line.id === "P")).toBe(true);
    expect(runtime.getSnapshot().world.draft.geometry?.segments.some((line) => line.id === "C")).toBe(false);
    expect(runtime.getSnapshot().world.draft.geometry?.points.some((point) => point.id === "X")).toBe(false);
    expect(runtime.getTrace().wrongAttempts).toBe(1);
    runtime.stop();
  });

  it("accepted evaluation commits draft world while transport failure preserves it and is retryable", () => {
    const runtime = createActionPageRuntime(plan());
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C1" });
    const draft = runtime.getSnapshot().world.draft;
    runtime.markTransportFailure("offline");
    expect(runtime.getSnapshot().status).toBe("transport-error");
    expect(runtime.getTrace().wrongAttempts).toBe(0);
    expect(runtime.getSnapshot().world.draft).toEqual(draft);
    runtime.retrySubmission();
    expect(runtime.getSnapshot().status).toBe("submitting");
    runtime.applyEvaluation({ outcome: "accepted", evaluation: "correct", revision: 1, phase: "correct_pause", nextIndex: 0, committedWorld: { ...draft, revision: 1 } });
    expect(runtime.getSnapshot().world.committed.geometry?.points.some((point) => point.id === "X")).toBe(true);
    expect(runtime.getSnapshot().world.commandBatches).toEqual([]);
    runtime.stop();
  });

  it("LocalTeaching checks public targets while ServerAuthoritative accepts structurally valid evidence", () => {
    const local = createActionPageRuntime(plan("local-demonstration"));
    local.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    expect(local.getTrace().selectedObjectIds).toEqual([]);
    expect(local.getView().coach.tone).toBe("wrong");
    local.stop();

    const server = createActionPageRuntime(plan("server-authoritative"));
    server.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "C0" });
    server.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    expect(server.getSnapshot().currentActionId).toBe("step/intersect");
    expect(server.getSnapshot().evidence[0]).toMatchObject({ kind: "make-parallel", throughPointId: "C0" });
    server.stop();
  });

  it("stops the prior child before mounting the next and never pre-creates inactive children", () => {
    let created = 0;
    let stopped = 0;
    const countingRegistry = {
      supports: actionMachineRegistry.supports,
      create(contract: ExercisePlan["actions"][number]) {
        created += 1;
        const actor = actionMachineRegistry.create(contract);
        return { ...actor, stop() { stopped += 1; actor.stop(); } };
      },
    };
    const runtime = createActionPageRuntime(plan(), undefined, countingRegistry);
    expect(created).toBe(1);
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "point", objectId: "T" });
    runtime.send({ type: "OBJECT.SELECTED", objectKind: "line", objectId: "S" });
    expect(created).toBe(2);
    expect(stopped).toBe(1);
    runtime.stop();
    expect(stopped).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import type { ActionContract, ExercisePlan } from "../../../../../shared/actionRuntime";
import { teacherCopyForAction } from "../teacherCopy";

function planWithCoach(actions: ActionContract[]): ExercisePlan {
  return {
    planVersion: 5,
    exerciseId: "e",
    revision: 0,
    mode: "learn",
    metadata: { taskId: "t", title: "t", promptLatex: "p", skillTags: [] },
    world: { revision: 0 },
    coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions,
    currentActionId: actions[0].actionId,
    completedActionIds: [],
  };
}

const base = (actionId: string, sourceStepId: string, kind: ActionContract["kind"]): ActionContract =>
  ({
    actionId, sourceStepId, kind, version: 1, title: actionId, instruction: `指令-${actionId}`,
    input: {}, capabilities: [], answerSlots: [],
    validationPolicy: "local-demonstration", submitOnComplete: false,
  }) as unknown as ActionContract;

describe("teacherCopyForAction", () => {
  it("uses the coach entry copy for the first action of a source step", () => {
    const first = { ...base("a1", "step", "enter-text"), coach: { entryLatex: "入口讲解 $\\frac{1}{2}$" } } as ActionContract;
    const plan = planWithCoach([first]);
    const copy = teacherCopyForAction(plan, first);
    expect(copy.displayLatex).toBe("入口讲解 $\\frac{1}{2}$");
    // Spoken form preserves the Chinese denominator-first fraction semantics.
    expect(copy.spokenText).toBe("入口讲解 2 分之 1");
  });

  it("falls back to the instruction when the first action has no coach entry", () => {
    const first = base("a1", "step", "enter-text");
    const plan = planWithCoach([first]);
    const copy = teacherCopyForAction(plan, first);
    expect(copy.displayLatex).toBe("指令-a1");
    expect(copy.spokenText).toBe("指令-a1");
  });

  it("uses the sub-action's own instruction for later actions of the same source step", () => {
    const first = { ...base("a1", "step", "enter-text"), coach: { entryLatex: "入口讲解" } } as ActionContract;
    const second = { ...base("a2", "step", "enter-text"), coach: { entryLatex: "入口讲解" } } as ActionContract;
    const plan = planWithCoach([first, second]);
    const copy = teacherCopyForAction(plan, second);
    expect(copy.displayLatex).toBe("指令-a2");
    expect(copy.spokenText).toBe("指令-a2");
  });

  it("treats the first action of a different source step as a fresh entry", () => {
    const first = { ...base("a1", "step-one", "enter-text"), coach: { entryLatex: "第一段" } } as ActionContract;
    const second = { ...base("a2", "step-two", "enter-text"), coach: { entryLatex: "第二段" } } as ActionContract;
    const plan = planWithCoach([first, second]);
    expect(teacherCopyForAction(plan, second).displayLatex).toBe("第二段");
  });
});

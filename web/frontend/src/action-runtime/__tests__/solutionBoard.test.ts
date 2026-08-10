import { describe, expect, it } from "vitest";
import type { WorldProjection } from "../../../../shared/actionRuntime";
import { applyActionEffectBatch, replayActionEffectBatches, type ActionEffectBatch } from "../../../../shared/actionEffects";
import {
  applyBoardCommands,
  createSolutionBoardBase,
  isSolutionBoardScript,
  renderBoardExpression,
  type SolutionBoardScript,
} from "../../../../shared/solutionBoard";

const script: SolutionBoardScript = {
  schemaVersion: 1,
  documentId: "solution-1",
  headingLatex: "\\text{解：}",
  expressions: [{
    expressionId: "construction",
    sourceStepId: "step-1",
    ownerActionIds: ["make", "intersect"],
    latexTemplate: "\\text{过 }{{through}}\\text{ 作 }{{helper}}\\parallel {{reference}}",
    modes: ["learn", "guided-practice"],
  }],
};

describe("SolutionBoard domain", () => {
  it("validates scripts and materializes deterministic hidden state", () => {
    expect(isSolutionBoardScript(script)).toBe(true);
    expect(isSolutionBoardScript({
      ...script,
      expressions: [{ ...script.expressions[0], latexTemplate: "{{same}}+{{same}}" }],
    })).toBe(false);
    expect(createSolutionBoardBase(script, "assessment").expressions).toEqual([]);
    expect(createSolutionBoardBase(script, "learn").expressions[0].phase).toBe("hidden");
  });

  it("reveals, fills and completes one continuous expression", () => {
    const board = applyBoardCommands(createSolutionBoardBase(script, "learn"), [
      { type: "reveal-expression", expressionId: "construction" },
      { type: "fill-slot", slotId: "through", latex: "E" },
      { type: "fill-slot", slotId: "helper", latex: "EF" },
      { type: "fill-slot", slotId: "reference", latex: "AC" },
      { type: "complete-expression", expressionId: "construction" },
    ]);
    expect(board.expressions[0].phase).toBe("complete");
    expect(renderBoardExpression(board.expressions[0])).toContain("EF");
    expect(() => applyBoardCommands(board, [{ type: "fill-slot", slotId: "through", latex: "G" }])).toThrow(/complete/);
  });

  it("renders slot placeholders without nesting math delimiters", () => {
    const board = createSolutionBoardBase({
      ...script,
      expressions: [{ ...script.expressions[0], latexTemplate: "过 ${{through}}$ 作 ${{helper}}\\parallel {{reference}}$" }],
    }, "learn");
    const revealed = applyBoardCommands(board, [{ type: "reveal-expression", expressionId: "construction" }]);
    expect(renderBoardExpression(revealed.expressions[0])).toContain("$\\underline{\\qquad}$");
    expect(renderBoardExpression(revealed.expressions[0])).not.toContain("$$");
  });

  it("applies diagram and board commands atomically and replays after removal", () => {
    const world: WorldProjection = {
      revision: 0,
      geometry: {
        viewBox: { width: 10, height: 10 },
        points: [{ id: "E", x: 0, y: 0 }, { id: "A", x: 0, y: 1 }, { id: "C", x: 2, y: 1 }],
        segments: [{ id: "AC", from: "A", to: "C" }],
      },
      solutionBoard: createSolutionBoardBase(script, "learn"),
    };
    const batch: ActionEffectBatch = {
      actionId: "make",
      sourceStepId: "step-1",
      committed: false,
      commands: [
        { target: "diagram", command: { commandId: "make/parallel", actionId: "make", type: "construct-parallel", throughPointId: "E", referenceLineId: "AC", outputLineId: "EF" } },
        { target: "solution-board", command: { type: "reveal-expression", expressionId: "construction" } },
        { target: "solution-board", command: { type: "fill-slot", slotId: "missing", latex: "E" } },
      ],
    };
    expect(() => applyActionEffectBatch(world, batch)).toThrow(/SolutionBoard/);
    expect(world.geometry?.derivedLines).toBeUndefined();
    expect(world.solutionBoard?.expressions[0].phase).toBe("hidden");
    expect(replayActionEffectBatches(world, [])).toBe(world);
  });
});

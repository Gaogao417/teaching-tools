import { describe, expect, it } from "vitest";
import {
  isSolutionBoardScript,
  materializeSolutionBoard,
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
  it("validates reviewed scripts", () => {
    expect(isSolutionBoardScript(script)).toBe(true);
    expect(isSolutionBoardScript({
      ...script,
      expressions: [{ ...script.expressions[0], latexTemplate: "{{same}}+{{same}}" }],
    })).toBe(false);
    expect(materializeSolutionBoard(script, "assessment", {
      through: "E",
      helper: "EF",
      reference: "AC",
    }).expressions).toEqual([]);
  });

  it("materializes a complete immutable server-owned snapshot", () => {
    const board = materializeSolutionBoard(script, "learn", {
      through: "E",
      helper: "EF",
      reference: "AC",
    });
    expect(board.expressions[0]).toMatchObject({
      phase: "complete",
      slotValues: { through: "E", helper: "EF", reference: "AC" },
    });
    expect(renderBoardExpression(board.expressions[0])).toContain("EF");
    expect(() => materializeSolutionBoard(script, "learn", { through: "E" })).toThrow(/Missing canonical/);
  });
});

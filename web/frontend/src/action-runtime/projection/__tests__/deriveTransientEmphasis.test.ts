import { describe, expect, it } from "vitest";
import type { DomainCommand } from "../../../../../shared/actionWorld";
import type { ActionSolutionBoardContext } from "../../../../../shared/solutionBoard";
import { deriveTransientEmphasis } from "../deriveTransientEmphasis";

function cmd(partial: Pick<DomainCommand, "type"> & Record<string, unknown>): DomainCommand {
  return { commandId: `c-${partial.type}`, actionId: "a", ...partial } as DomainCommand;
}

describe("deriveTransientEmphasis", () => {
  it("maps each DomainCommand type to the correct canvas emphasis target", () => {
    const commands: DomainCommand[] = [
      cmd({ type: "construct-parallel", throughPointId: "T", referenceLineId: "S", outputLineId: "P" }),
      cmd({ type: "construct-carrier", fromPointId: "A", toPointId: "B", outputLineId: "C" }),
      cmd({ type: "intersect-lines", firstLineId: "P", secondLineId: "C", outputPointId: "X" }),
      cmd({ type: "set-segment-label", segmentId: "AB", markId: "L1", valueLatex: "2", labelKind: "length" }),
      cmd({ type: "set-correspondence-mark", segmentIds: ["AB", "CD"], markId: "K1", tickCount: 1 }),
      cmd({ type: "set-emphasis", entityIds: ["AB"], markId: "E1" }),
    ];
    expect(deriveTransientEmphasis({ commands })).toEqual([
      { surface: "canvas", kind: "entity", id: "P" },
      { surface: "canvas", kind: "entity", id: "C" },
      { surface: "canvas", kind: "entity", id: "X" },
      { surface: "canvas", kind: "teaching-mark", id: "L1" },
      { surface: "canvas", kind: "teaching-mark", id: "K1" },
      { surface: "canvas", kind: "teaching-mark", id: "E1" },
    ]);
  });

  it("produces no emphasis for empty commands and no board", () => {
    expect(deriveTransientEmphasis({ commands: [] })).toEqual([]);
    expect(deriveTransientEmphasis({})).toEqual([]);
  });

  it("maps an accepted SolutionBoard context to the matching expression id", () => {
    const context: ActionSolutionBoardContext = {
      actionId: "a",
      stage: "accepted",
      solutionRevision: "rev",
      board: {
        schemaVersion: 1,
        documentId: "doc",
        headingLatex: "解：",
        expressions: [
          { expressionId: "expr-step", sourceStepId: "step", latexTemplate: "a", slotValues: {}, phase: "complete" },
          { expressionId: "expr-other", sourceStepId: "other", latexTemplate: "b", slotValues: {}, phase: "complete" },
          { expressionId: "expr-hidden", sourceStepId: "step", latexTemplate: "c", slotValues: {}, phase: "hidden" },
        ],
      },
    };
    const targets = deriveTransientEmphasis({ acceptedBoard: { context, sourceStepId: "step" } });
    expect(targets).toEqual([{ surface: "solution-board", kind: "expression", id: "expr-step" }]);
  });

  it("de-duplicates targets across surfaces", () => {
    const commands: DomainCommand[] = [
      cmd({ type: "construct-parallel", throughPointId: "T", referenceLineId: "S", outputLineId: "P" }),
      cmd({ type: "construct-parallel", throughPointId: "T", referenceLineId: "S", outputLineId: "P" }),
    ];
    expect(deriveTransientEmphasis({ commands })).toEqual([{ surface: "canvas", kind: "entity", id: "P" }]);
  });
});

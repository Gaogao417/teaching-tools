import { describe, expect, it } from "vitest";
import { latexToSpokenChinese } from "../../../../../shared/speechText";
import type { ActionEvidence } from "../../../../../shared/actionRuntime";
import type { CandidateDecision } from "../../../../../shared/trainingRuntime";
import { TrainingFeedbackController } from "../TrainingFeedbackController";

const controller = new TrainingFeedbackController();

const completionEvidence: ActionEvidence = {
  actionId: "a1",
  sourceStepId: "s1",
  kind: "enter-text",
  value: "ok",
  version: 1,
};

describe("TrainingFeedbackController.project", () => {
  describe("wrong decision", () => {
    it("surfaces active wrong feedback with all fields propagated", () => {
      const decision: CandidateDecision = {
        kind: "wrong",
        feedback: {
          messageLatex: "\\angle A = 30^{\\circ}",
          spokenText: "角A等于30度",
          focusTargetId: "angle-A",
          wrongObjectIds: ["ray-ab", "point-c"],
        },
      };

      const view = controller.project(decision);

      expect(view).toEqual({
        active: true,
        messageLatex: "\\angle A = 30^{\\circ}",
        tone: "wrong",
        highlightObjectIds: ["ray-ab", "point-c"],
        focusTargetId: "angle-A",
        spokenText: "角A等于30度",
      });
    });

    it("uses the explicit spokenText verbatim when provided", () => {
      const decision: CandidateDecision = {
        kind: "wrong",
        feedback: { messageLatex: "x = 1", spokenText: "authored spoken copy", wrongObjectIds: [] },
      };
      expect(controller.project(decision).spokenText).toBe("authored spoken copy");
    });

    it("derives a deterministic spoken variant when spokenText is absent", () => {
      const messageLatex = "\\frac{1}{2} + \\frac{1}{3}";
      const decision: CandidateDecision = {
        kind: "wrong",
        feedback: { messageLatex, wrongObjectIds: [] },
      };
      expect(controller.project(decision).spokenText).toBe(latexToSpokenChinese(messageLatex));
    });

    it("defaults focusTargetId to undefined when the feedback omits it", () => {
      const decision: CandidateDecision = {
        kind: "wrong",
        feedback: { messageLatex: "wrong", wrongObjectIds: ["a"] },
      };
      expect(controller.project(decision).focusTargetId).toBeUndefined();
    });

    it("does not share its highlight array reference with the input decision", () => {
      const wrongObjectIds = ["a", "b"];
      const decision: CandidateDecision = {
        kind: "wrong",
        feedback: { messageLatex: "m", wrongObjectIds },
      };
      const view = controller.project(decision);
      expect(view.highlightObjectIds).not.toBe(wrongObjectIds);
      expect(view.highlightObjectIds).toEqual(["a", "b"]);
      // Mutating the view must not bleed back into the guard's decision.
      view.highlightObjectIds.push("ZZZ");
      expect(wrongObjectIds).toEqual(["a", "b"]);
    });
  });

  describe.each<[string, CandidateDecision]>([
    ["ignored-illegal", { kind: "ignored-illegal" }],
    ["correct-partial", { kind: "correct-partial" }],
    ["correct-completion", { kind: "correct-completion", evidence: completionEvidence, commands: [] }],
  ])("non-wrong decision (%s)", (_label, decision) => {
    it("is inactive with no spoken text and no highlights", () => {
      const view = controller.project(decision);
      expect(view.active).toBe(false);
      expect(view.tone).toBe("prompt");
      expect(view.highlightObjectIds).toEqual([]);
      expect(view.spokenText).toBeUndefined();
      expect(view.focusTargetId).toBeUndefined();
    });

    it("falls back to the provided actionInstruction as neutral messageLatex", () => {
      const view = controller.project(decision, { actionInstruction: "点击点 A" });
      expect(view.active).toBe(false);
      expect(view.messageLatex).toBe("点击点 A");
    });

    it("uses an empty messageLatex when no instruction is provided", () => {
      expect(controller.project(decision).messageLatex).toBe("");
    });
  });

  describe("purity", () => {
    const wrongDecision: CandidateDecision = {
      kind: "wrong",
      feedback: { messageLatex: "m = 2", spokenText: "s", focusTargetId: "f", wrongObjectIds: ["x", "y"] },
    };

    it("returns equal results for repeated calls with the same input", () => {
      const a = controller.project(wrongDecision);
      const b = controller.project(wrongDecision);
      expect(a).toEqual(b);
    });

    it("does not mutate the input decision", () => {
      const snapshot = JSON.parse(JSON.stringify(wrongDecision)) as CandidateDecision;
      controller.project(wrongDecision);
      controller.project(wrongDecision, { actionInstruction: "instr" });
      expect(wrongDecision).toEqual(snapshot);
    });

    it("requestSpoken returns the view's spokenText without any side channel", () => {
      const view = controller.project(wrongDecision);
      expect(controller.requestSpoken(view)).toBe("s");
      expect(controller.requestSpoken(controller.project({ kind: "ignored-illegal" }))).toBeUndefined();
    });
  });
});

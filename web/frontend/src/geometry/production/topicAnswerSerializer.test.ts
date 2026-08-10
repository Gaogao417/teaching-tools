import { describe, expect, it } from "vitest";
import type { EntityAffordance, InteractionView } from "../interaction/interaction-view";
import { parallelAnswerFromView } from "./topicAnswerSerializer";

/**
 * The golden partial strings mirror the incremental `topic-answer` drafts the
 * legacy `handlePoint` / `handleSegment` / `undoLast` handlers produced as the
 * learner advanced through `auxiliaryTwoRatios` Q001
 * (throughPoint=C, referenceLine=AD, carriers=[B,E]). Byte-identical to what the
 * backend already grades via `isTopicAnswerAccepted` + `wrongObjectsForSubmission`.
 */

function view(selected: InteractionView["selected"]): InteractionView {
  // A minimal view is enough: parallelAnswerFromView reads only `selected`.
  return {
    prompt: "",
    entities: {} as Record<string, EntityAffordance>,
    selected,
    cursor: "default",
    canCancel: false,
    canGoBack: false,
  };
}

describe("parallelAnswerFromView", () => {
  it("returns null when nothing is selected (fresh start — draft untouched)", () => {
    expect(parallelAnswerFromView(view([]))).toBeNull();
  });

  it("produces the stage-1 partial after the through-point is chosen", () => {
    expect(parallelAnswerFromView(view([{ kind: "point", id: "C" }]))).toBe("point:C");
  });

  it("produces the stage-2 partial after the reference line is chosen", () => {
    expect(
      parallelAnswerFromView(view([{ kind: "point", id: "C" }, { kind: "line", id: "AD" }])),
    ).toBe("point:C|parallel:AD");
  });

  it("produces the stage-3 partial after the first carrier is chosen", () => {
    expect(
      parallelAnswerFromView(
        view([{ kind: "point", id: "C" }, { kind: "line", id: "AD" }, { kind: "point", id: "B" }]),
      ),
    ).toBe("point:C|parallel:AD|carrier:B");
  });

  it("produces the complete string after the second carrier is chosen (Q001 key)", () => {
    expect(
      parallelAnswerFromView(
        view([
          { kind: "point", id: "C" },
          { kind: "line", id: "AD" },
          { kind: "point", id: "B" },
          { kind: "point", id: "E" },
        ]),
      ),
    ).toBe("point:C|parallel:AD|carrier:B,E");
  });

  it("ignores non-point/non-line refs defensively", () => {
    expect(
      parallelAnswerFromView(
        // angle is not part of the construct-parallel answer; the projector never
        // emits one, but the serializer must not throw if it ever sees one.
        view([{ kind: "point", id: "C" }, { kind: "line", id: "AD" }, { kind: "angle", id: "X" }]),
      ),
    ).toBe("point:C|parallel:AD");
  });
});

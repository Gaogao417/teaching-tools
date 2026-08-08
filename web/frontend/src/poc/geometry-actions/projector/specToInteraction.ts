/**
 * specToInteraction — projects a PocRuntimeSpec's flow into an InteractionView.
 *
 * The InteractionView is GENERIC (no action-specific fields). The projector
 * derives clickablePoints/clickableSegments/inputs/canSubmit purely from the
 * active step's allowedActions. This is what keeps GeometryCanvas
 * action-agnostic: it reads InteractionView and nothing else.
 *
 * No React. No JSXGraph.
 */
import { view } from "../domain/interaction.ts";
import type { InteractionView } from "../domain/interaction.ts";
import type { PocRuntimeSpec } from "../shared/runtimeContracts.ts";

export function projectSpecToInteraction(spec: PocRuntimeSpec): InteractionView {
  const activeStep = spec.flow.steps.find((s) => s.status === "active");

  if (!activeStep) {
    return view({ prompt: spec.prompt, feedback: spec.feedback });
  }

  const clickablePoints: string[] = [];
  const clickableSegments: string[] = [];
  const inputs: NonNullable<InteractionView["inputs"]> = [];
  let canSubmit = false;

  // Inspect world to classify each select target as point vs segment.
  for (const a of activeStep.allowedActions) {
    if (a.type === "select" && a.target) {
      const obj = spec.scene.entities.find((e) => e.id === a.target);
      if (obj?.kind === "vertex") clickablePoints.push(a.target);
      else if (obj?.kind === "edge") clickableSegments.push(a.target);
    }
    if (a.type === "input" && a.target) {
      inputs.push({
        objectId: a.target,
        expectedKind: a.valueKind === "integer" || a.valueKind === "length" ? "number" : "text",
        active: true,
        label: `输入值`,
      });
    }
  }

  // Explicit submit steps (e.g. enter-value) require a submit button.
  canSubmit = activeStep.submitMode === "explicit";

  return view({
    clickablePoints,
    clickableSegments,
    inputs: inputs.length > 0 ? inputs : [],
    canSubmit,
    prompt: `${spec.prompt} ｜ ${activeStep.goal}`,
    feedback: spec.feedback,
  });
}

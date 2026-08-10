export type ActionRuntimeEvent =
  | { type: "OBJECT.SELECTED"; objectKind: "point" | "line" | "angle"; objectId: string }
  | { type: "ANSWER.CHANGED"; slotId: string; value: string }
  | { type: "BACK" }
  | { type: "CLEAR" }
  | { type: "SUBMIT" }
  | { type: "CANCEL" };

export type PageRuntimeEvent =
  | { type: "ACTION.COMPLETED"; actionId: string }
  | { type: "EVALUATION.ACCEPTED"; nextActionId?: string; revision: number }
  | { type: "EVALUATION.REJECTED"; messageLatex: string; wrongObjectIds: string[]; revision: number }
  | { type: "EVALUATION.CONFLICT"; revision: number }
  | { type: "COACH.RECEIVED"; messageLatex: string; tone: "prompt" | "correct" | "wrong" | "explain"; highlightObjectIds: string[]; focusTargetId?: string }
  | { type: "COACH.CLEAR" };

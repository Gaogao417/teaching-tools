import type { LearningMode } from "./actionRuntime";

export const SOLUTION_BOARD_SCHEMA_VERSION = 1 as const;

export type BoardExpressionPhase = "hidden" | "writing" | "complete";

export interface BoardExpressionSpec {
  expressionId: string;
  sourceStepId: string;
  ownerActionIds: string[];
  latexTemplate: string;
  modes: LearningMode[];
}

export interface SolutionBoardScript {
  schemaVersion: typeof SOLUTION_BOARD_SCHEMA_VERSION;
  documentId: string;
  headingLatex: string;
  expressions: BoardExpressionSpec[];
}

export interface BoardExpression {
  expressionId: string;
  sourceStepId: string;
  latexTemplate: string;
  slotValues: Record<string, string>;
  phase: BoardExpressionPhase;
}

export interface SolutionBoardProjection {
  schemaVersion: typeof SOLUTION_BOARD_SCHEMA_VERSION;
  documentId: string;
  headingLatex: string;
  expressions: BoardExpression[];
}

export type ActionSolutionBoardStage = "enter" | "accepted";

/**
 * Server-projected, immutable board context for one Action stage.
 * Action machines never inspect or mutate this value.
 */
export interface ActionSolutionBoardContext {
  actionId: string;
  stage: ActionSolutionBoardStage;
  solutionRevision: string;
  board: SolutionBoardProjection;
}

export type SolutionBoardErrorCode =
  | "invalid-script"
  | "missing-canonical-slot";

export class SolutionBoardError extends Error {
  constructor(readonly code: SolutionBoardErrorCode, message: string) {
    super(message);
  }
}

const SLOT_PATTERN = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
const MAX_LATEX_LENGTH = 4_096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validLatex(value: string): boolean {
  return value.length <= MAX_LATEX_LENGTH && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value);
}

export function expressionSlotIds(latexTemplate: string): string[] {
  return [...latexTemplate.matchAll(SLOT_PATTERN)].map((match) => match[1]);
}

export function isSolutionBoardScript(value: unknown): value is SolutionBoardScript {
  if (!isRecord(value) || value.schemaVersion !== SOLUTION_BOARD_SCHEMA_VERSION
    || typeof value.documentId !== "string" || !value.documentId
    || typeof value.headingLatex !== "string" || !validLatex(value.headingLatex)
    || !Array.isArray(value.expressions)) return false;
  const expressionIds = new Set<string>();
  const slotIds = new Set<string>();
  return value.expressions.every((expression) => {
    if (!isRecord(expression) || typeof expression.expressionId !== "string" || !expression.expressionId
      || expressionIds.has(expression.expressionId) || typeof expression.sourceStepId !== "string"
      || !Array.isArray(expression.ownerActionIds) || !expression.ownerActionIds.every((id) => typeof id === "string")
      || typeof expression.latexTemplate !== "string" || !validLatex(expression.latexTemplate)
      || !Array.isArray(expression.modes)
      || !expression.modes.every((mode) => ["learn", "guided-practice", "assessment"].includes(String(mode)))) return false;
    expressionIds.add(expression.expressionId);
    const slots = expressionSlotIds(expression.latexTemplate);
    if (new Set(slots).size !== slots.length || slots.some((slotId) => slotIds.has(slotId))) return false;
    slots.forEach((slotId) => slotIds.add(slotId));
    return true;
  });
}

export function isSolutionBoardProjection(value: unknown): value is SolutionBoardProjection {
  if (!isRecord(value) || value.schemaVersion !== SOLUTION_BOARD_SCHEMA_VERSION
    || typeof value.documentId !== "string" || typeof value.headingLatex !== "string"
    || !Array.isArray(value.expressions)) return false;
  const expressionIds = new Set<string>();
  return value.expressions.every((expression) => {
    if (!isRecord(expression) || typeof expression.expressionId !== "string" || expressionIds.has(expression.expressionId)
      || typeof expression.sourceStepId !== "string" || typeof expression.latexTemplate !== "string"
      || !isRecord(expression.slotValues) || !["hidden", "writing", "complete"].includes(String(expression.phase))) return false;
    expressionIds.add(expression.expressionId);
    const declaredSlots = new Set(expressionSlotIds(expression.latexTemplate));
    return Object.entries(expression.slotValues).every(([slotId, slot]) => declaredSlots.has(slotId)
      && typeof slot === "string" && validLatex(slot));
  });
}

export function isActionSolutionBoardContext(value: unknown): value is ActionSolutionBoardContext {
  return isRecord(value)
    && typeof value.actionId === "string"
    && ["enter", "accepted"].includes(String(value.stage))
    && typeof value.solutionRevision === "string"
    && Boolean(value.solutionRevision)
    && isSolutionBoardProjection(value.board);
}

/**
 * Materializes a complete read-only projection from reviewed question content.
 * This is a content projection boundary, not an Action effect: it does not
 * inspect Action kinds, evidence shapes, semantic roles, or parameter order.
 */
export function materializeSolutionBoard(
  script: SolutionBoardScript,
  mode: LearningMode,
  slotValues: Readonly<Record<string, string>>,
  expressionIds?: ReadonlySet<string>,
): SolutionBoardProjection {
  if (!isSolutionBoardScript(script)) throw new SolutionBoardError("invalid-script", "Invalid SolutionBoard script");
  const expressions = script.expressions
    .filter((expression) => expression.modes.includes(mode) && (!expressionIds || expressionIds.has(expression.expressionId)))
    .map((expression) => {
      const declaredSlots = expressionSlotIds(expression.latexTemplate);
      const resolved = Object.fromEntries(declaredSlots.map((slotId) => {
        const latex = slotValues[slotId];
        if (!latex || !validLatex(latex)) {
          throw new SolutionBoardError("missing-canonical-slot", `Missing canonical SolutionBoard value for ${slotId}`);
        }
        return [slotId, latex];
      }));
      return {
        expressionId: expression.expressionId,
        sourceStepId: expression.sourceStepId,
        latexTemplate: expression.latexTemplate,
        slotValues: resolved,
        phase: "complete" as const,
      };
    });
  return {
    schemaVersion: SOLUTION_BOARD_SCHEMA_VERSION,
    documentId: script.documentId,
    headingLatex: script.headingLatex,
    expressions,
  };
}

export function renderBoardExpression(expression: BoardExpression, placeholder = "$\\underline{\\qquad}$"): string {
  return expression.latexTemplate.replace(SLOT_PATTERN, (_match, slotId: string, offset: number) => {
    const insideMath = (expression.latexTemplate.slice(0, offset).match(/\$/g)?.length || 0) % 2 === 1;
    const value = expression.slotValues[slotId];
    if (!insideMath) return value || placeholder;
    if (!value) return placeholder.startsWith("$") && placeholder.endsWith("$") ? placeholder.slice(1, -1) : placeholder;
    const trimmed = value.trim();
    return trimmed.startsWith("$") && trimmed.endsWith("$") ? trimmed.slice(1, -1) : value;
  });
}

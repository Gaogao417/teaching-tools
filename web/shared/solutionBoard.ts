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

export type BoardCommand =
  | { type: "reveal-expression"; expressionId: string }
  | { type: "fill-slot"; slotId: string; latex: string }
  | { type: "complete-expression"; expressionId: string };

export type BoardCommandErrorCode =
  | "invalid-script"
  | "unknown-expression"
  | "unknown-slot"
  | "invalid-transition"
  | "invalid-latex";

export class BoardCommandError extends Error {
  constructor(readonly code: BoardCommandErrorCode, message: string) {
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

export function isBoardCommand(value: unknown): value is BoardCommand {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "reveal-expression" || value.type === "complete-expression") return typeof value.expressionId === "string";
  return value.type === "fill-slot"
    && typeof value.slotId === "string"
    && typeof value.latex === "string"
    && validLatex(value.latex);
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

export function createSolutionBoardBase(script: SolutionBoardScript, mode: LearningMode): SolutionBoardProjection {
  if (!isSolutionBoardScript(script)) throw new BoardCommandError("invalid-script", "Invalid SolutionBoard script");
  return {
    schemaVersion: SOLUTION_BOARD_SCHEMA_VERSION,
    documentId: script.documentId,
    headingLatex: script.headingLatex,
    expressions: script.expressions.filter((expression) => expression.modes.includes(mode)).map((expression) => ({
      expressionId: expression.expressionId,
      sourceStepId: expression.sourceStepId,
      latexTemplate: expression.latexTemplate,
      slotValues: {},
      phase: "hidden",
    })),
  };
}

function cloneBoard(board: SolutionBoardProjection): SolutionBoardProjection {
  return { ...board, expressions: board.expressions.map((expression) => ({ ...expression, slotValues: { ...expression.slotValues } })) };
}

export function applyBoardCommands(board: SolutionBoardProjection, commands: readonly BoardCommand[]): SolutionBoardProjection {
  const next = cloneBoard(board);
  for (const command of commands) {
    const expression = command.type === "fill-slot"
      ? next.expressions.find((item) => expressionSlotIds(item.latexTemplate).includes(command.slotId))
      : next.expressions.find((item) => item.expressionId === command.expressionId);
    if (!expression) throw new BoardCommandError(command.type === "fill-slot" ? "unknown-slot" : "unknown-expression", `Unknown board target`);
    switch (command.type) {
      case "reveal-expression":
        if (expression.phase === "hidden") expression.phase = "writing";
        break;
      case "fill-slot": {
        if (expression.phase === "hidden") throw new BoardCommandError("invalid-transition", `Expression ${expression.expressionId} is hidden`);
        if (expression.phase === "complete") throw new BoardCommandError("invalid-transition", `Expression ${expression.expressionId} is complete`);
        if (!expressionSlotIds(expression.latexTemplate).includes(command.slotId)) {
          throw new BoardCommandError("unknown-slot", `Unknown board slot ${command.slotId}`);
        }
        if (!validLatex(command.latex)) throw new BoardCommandError("invalid-latex", `Invalid LaTeX for ${command.slotId}`);
        expression.slotValues[command.slotId] = command.latex;
        break;
      }
      case "complete-expression":
        if (expression.phase === "hidden") throw new BoardCommandError("invalid-transition", `Expression ${expression.expressionId} is hidden`);
        if (expressionSlotIds(expression.latexTemplate).some((slotId) => !expression.slotValues[slotId])) {
          throw new BoardCommandError("invalid-transition", `Expression ${command.expressionId} has unfilled slots`);
        }
        expression.phase = "complete";
        break;
    }
  }
  return next;
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

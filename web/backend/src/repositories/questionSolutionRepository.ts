import { createHash } from "node:crypto";
import type { ActionContract, LearningMode } from "../../../shared/actionRuntime";
import {
  isSolutionBoardProjection,
  materializeSolutionBoard,
  type ActionSolutionBoardContext,
  type ActionSolutionBoardStage,
  type SolutionBoardProjection,
} from "../../../shared/solutionBoard";
import type { TopicResolvedScenario } from "../../../shared/topicPractice";
import { db } from "../db/database";

const SNAPSHOT_COMPILER_VERSION = 1;

const insertRevision = db.prepare(`
  INSERT OR IGNORE INTO question_solution_revisions
    (question_id, question_version, solution_revision, document_json, review_status, created_at)
  VALUES (?, ?, ?, ?, 'approved', ?)
`);

const insertSnapshot = db.prepare(`
  INSERT OR IGNORE INTO question_action_solution_boards
    (question_id, question_version, solution_revision, action_id, mode, stage, board_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const getSnapshot = db.prepare(`
  SELECT board_json
  FROM question_action_solution_boards
  WHERE question_id = ? AND question_version = ? AND solution_revision = ?
    AND action_id = ? AND mode = ? AND stage = ?
`);

function solutionRevisionFor(scenario: TopicResolvedScenario): string | undefined {
  if (!scenario.solutionBoard) return undefined;
  const canonical = JSON.stringify({
    compilerVersion: SNAPSHOT_COMPILER_VERSION,
    script: scenario.solutionBoard,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

function completionIndexByExpression(
  scenario: TopicResolvedScenario,
  actions: ActionContract[],
): Map<string, number> {
  const actionIndexes = new Map(actions.map((action, index) => [action.actionId, index]));
  return new Map((scenario.solutionBoard?.expressions || []).map((expression) => {
    const ownerIndexes = expression.ownerActionIds
      .map((actionId) => actionIndexes.get(actionId))
      .filter((index): index is number => index !== undefined);
    const fallback = actions.reduce((last, action, index) => action.sourceStepId === expression.sourceStepId ? index : last, -1);
    return [expression.expressionId, ownerIndexes.length ? Math.max(...ownerIndexes) : fallback];
  }));
}

function snapshotAt(
  scenario: TopicResolvedScenario,
  actions: ActionContract[],
  mode: Exclude<LearningMode, "assessment">,
  cutoff: number,
): SolutionBoardProjection | undefined {
  if (!scenario.solutionBoard) return undefined;
  const completionIndexes = completionIndexByExpression(scenario, actions);
  const visibleIds = new Set(scenario.solutionBoard.expressions
    .filter((expression) => expression.modes.includes(mode)
      && (completionIndexes.get(expression.expressionId) ?? Number.POSITIVE_INFINITY) <= cutoff)
    .map((expression) => expression.expressionId));
  if (!visibleIds.size) return undefined;
  return materializeSolutionBoard(scenario.solutionBoard, mode, {}, visibleIds);
}

function publishScenarioSnapshots(scenario: TopicResolvedScenario, actions: ActionContract[]): string | undefined {
  const solutionRevision = solutionRevisionFor(scenario);
  if (!solutionRevision || !scenario.solutionBoard) return undefined;
  const createdAt = new Date().toISOString();
  const fullBoard = materializeSolutionBoard(scenario.solutionBoard, "learn", {});
  db.transaction(() => {
    insertRevision.run(
      scenario.id,
      scenario.version,
      solutionRevision,
      JSON.stringify(fullBoard),
      createdAt,
    );
    actions.forEach((action, index) => {
      const sameGroupIndexes = actions
        .map((candidate, candidateIndex) => candidate.sourceStepId === action.sourceStepId ? candidateIndex : -1)
        .filter((candidateIndex) => candidateIndex >= 0);
      const groupStart = Math.min(...sameGroupIndexes);
      const groupEnd = Math.max(...sameGroupIndexes);
      const projections: Array<{
        mode: Exclude<LearningMode, "assessment">;
        stage: ActionSolutionBoardStage;
        board: SolutionBoardProjection | undefined;
      }> = [
        { mode: "learn", stage: "enter", board: snapshotAt(scenario, actions, "learn", index) },
        { mode: "learn", stage: "accepted", board: snapshotAt(scenario, actions, "learn", index) },
        { mode: "guided-practice", stage: "enter", board: snapshotAt(scenario, actions, "guided-practice", groupStart - 1) },
        { mode: "guided-practice", stage: "accepted", board: snapshotAt(scenario, actions, "guided-practice", groupEnd) },
      ];
      for (const projection of projections) {
        if (!projection.board) continue;
        insertSnapshot.run(
          scenario.id,
          scenario.version,
          solutionRevision,
          action.actionId,
          projection.mode,
          projection.stage,
          JSON.stringify(projection.board),
          createdAt,
        );
      }
    });
  })();
  return solutionRevision;
}

function readContext(
  scenario: TopicResolvedScenario,
  solutionRevision: string,
  actionId: string,
  mode: Exclude<LearningMode, "assessment">,
  stage: ActionSolutionBoardStage,
): ActionSolutionBoardContext | undefined {
  const row = getSnapshot.get(
    scenario.id,
    scenario.version,
    solutionRevision,
    actionId,
    mode,
    stage,
  ) as { board_json: string } | undefined;
  if (!row) return undefined;
  const board = JSON.parse(row.board_json) as unknown;
  if (!isSolutionBoardProjection(board)) {
    throw new Error(`Invalid stored SolutionBoard snapshot for ${scenario.id}/${actionId}/${mode}/${stage}`);
  }
  return { actionId, stage, solutionRevision, board };
}

export function loadPlanSolutionBoardContexts(
  scenario: TopicResolvedScenario,
  actions: ActionContract[],
  mode: LearningMode,
  currentActionId: string,
): ActionSolutionBoardContext[] {
  if (mode === "assessment") return [];
  const solutionRevision = publishScenarioSnapshots(scenario, actions);
  if (!solutionRevision) return [];
  const current = actions.find((action) => action.actionId === currentActionId);
  const authorizedActions = mode === "learn"
    ? actions
    : actions.filter((action) => current && action.sourceStepId === current.sourceStepId);
  return authorizedActions.flatMap((action) => {
    const context = readContext(scenario, solutionRevision, action.actionId, mode, "enter");
    return context ? [context] : [];
  });
}

export function loadAcceptedSolutionBoardContext(
  scenario: TopicResolvedScenario,
  actions: ActionContract[],
  mode: LearningMode,
  actionId: string,
): ActionSolutionBoardContext | undefined {
  if (mode === "assessment") return undefined;
  const solutionRevision = publishScenarioSnapshots(scenario, actions);
  return solutionRevision ? readContext(scenario, solutionRevision, actionId, mode, "accepted") : undefined;
}

/**
 * 波次 F 任务 1：完成页板书回顾视图。
 *
 * 把服务端内容面（GET /api/learn/:taskId/solution-board）下发的整板
 * `SolutionBoardProjection` 投影成 `SolutionBoardPanel` 消费的
 * `SolutionBoardView`——与 projectWorkspaceView 的逐 Action 投影不同：
 * 这里是 question_completed 后的回顾，全部表达式完整可见、无当前行、
 * 无 accepted 播报。LaTeX 槽位渲染复用 shared 的 renderBoardExpression。
 */
import { renderBoardExpression, type SolutionBoardProjection } from "../../../shared/solutionBoard";
import type { SolutionBoardView } from "./types";

export function solutionBoardReviewView(board: SolutionBoardProjection): SolutionBoardView {
  return {
    headingLatex: board.headingLatex,
    visibleExpressions: board.expressions
      .filter((expression) => expression.phase !== "hidden")
      .map((expression) => ({
        expressionId: expression.expressionId,
        sourceStepId: expression.sourceStepId,
        latex: renderBoardExpression(expression),
        isCurrent: false,
        isComplete: expression.phase === "complete",
      })),
  };
}

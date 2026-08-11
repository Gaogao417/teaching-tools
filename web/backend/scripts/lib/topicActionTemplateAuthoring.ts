import type { AuthoredActionTemplate } from "../../../shared/actionRuntime";
import type { TopicActionProjection, TopicResolvedScenario } from "../../../shared/topicPractice";
import { SOLUTION_BOARD_SCHEMA_VERSION, type SolutionBoardScript } from "../../../shared/solutionBoard";
import { capabilityIdsForTopicStep } from "../../../shared/similarityLearningMap";

function base(
  step: TopicActionProjection,
  actionId: string,
  kind: string,
  capabilities: string[],
  submitOnComplete: boolean,
  input: Record<string, unknown>,
  teachingInput?: Record<string, unknown>,
): AuthoredActionTemplate {
  return {
    actionId,
    sourceStepId: step.id,
    kind,
    version: 1,
    title: step.title,
    instruction: step.promptLatex || step.goal,
    input,
    teachingInput,
    capabilities: [...capabilities, "agent:select-object", "agent:set-answer", "agent:back", "agent:clear"],
    answerSlots: [],
    submitOnComplete,
    presentation: step.presentation,
    coach: step.coach,
  };
}

/**
 * Offline authoring projection. It runs before bundle validation/publication;
 * runtime bootstrap never invokes it. Its output is the versioned action JSON
 * stored in every scenario record.
 */
export function authorTopicActionTemplates(scenario: TopicResolvedScenario): AuthoredActionTemplate[] {
  return scenario.steps.flatMap((step, sourceIndex): AuthoredActionTemplate[] => {
    const capabilities = capabilityIdsForTopicStep(scenario.taskId, step.primitive, sourceIndex);
    const interaction = step.interaction;
    const availableSegments = interaction?.availableSegments || interaction?.geometry?.segments.map((segment) => segment.id) || [];
    const availablePoints = interaction?.geometry?.points.map((point) => point.id) || scenario.promptGeometry?.points.map((point) => point.id) || [];
    switch (step.primitive) {
      case "construct-parallel": {
        const construction = interaction?.construction;
        const outputLineId = `action:${step.id}:parallel`;
        const outputCarrierLineId = `action:${step.id}:carrier`;
        const outputLineLabel = construction?.throughPoint && construction.resultPoint
          ? `${construction.throughPoint}${construction.resultPoint}`
          : undefined;
        return [
          {
            ...base(step, `${step.id}/make-parallel`, "make-parallel", capabilities, false, {
              availablePointIds: availablePoints,
              availableLineIds: availableSegments,
              outputLineId,
              outputLineLabel,
            }, {
              throughPointId: construction?.throughPoint,
              referenceLineId: construction?.parallelSegment,
            }),
            title: "确定平行关系",
            instruction: "先点击辅助线要经过的点，再点击作为平行参照的线段。",
            answerSlots: [
              { id: "through-point", label: "过线点", kind: "object", required: true },
              { id: "reference-line", label: "平行参照线", kind: "object", required: true },
            ],
          },
          {
            ...base(step, `${step.id}/intersect-carriers`, "intersect-carriers", capabilities, true, {
              availablePointIds: availablePoints,
              parallelLineId: outputLineId,
              outputCarrierLineId,
              outputPointId: construction?.resultPoint || `action:${step.id}:intersection`,
            }, {
              carrierPointIds: construction?.carrierPoints,
              resultPointId: construction?.resultPoint,
            }),
            title: "作载体并求交",
            instruction: "再依次点击载体直线上的两个点，系统会延长直线并标出交点。",
            answerSlots: [
              { id: "carrier-0", label: "载体点一", kind: "object", required: true },
              { id: "carrier-1", label: "载体点二", kind: "object", required: true },
            ],
          },
        ];
      }
      case "mark-segments":
        return [{
          ...base(step, step.id, "mark-segment-values", capabilities, true, {
            labels: [],
            availableSegmentIds: availableSegments,
            requiredCount: interaction?.expectedLabels?.length || step.presentation?.requiredInputCount || 1,
            autoFocusSequence: Boolean(step.presentation?.autoFocusSequence),
          }, { labels: interaction?.expectedLabels || [] }),
          instruction: "在图中点击需要标注的线段，再输入对应数值；已完成的标注会保留在图上。",
          answerSlots: [{ id: "segment-values", label: "线段标注", kind: "number", required: true }],
        }];
      case "mark-ratio":
        return [{
          ...base(step, step.id, "pair-segments", capabilities, true, {
            availableSegmentIds: availableSegments,
            pairCount: Math.max(1, Math.ceil((interaction?.expectedOrder?.length || 4) / 2)),
          }, { expectedOrder: interaction?.expectedOrder }),
          instruction: "按顺序点击每组对应边；配成一组后，图上会显示相同的对应刻痕。",
          answerSlots: [{ id: "segment-pairs", label: "对应边", kind: "object", required: true }],
        }];
      case "ratio-scratch": {
        const scratch = interaction?.ratioScratch;
        return [{
          ...base(step, step.id, "ratio-scratch", capabilities, true, {
            availableSegmentIds: availableSegments,
            firstDisplayName: scratch?.firstDisplayName || "第一条边",
            firstValueLatex: scratch?.firstValueLatex || "",
            secondDisplayName: scratch?.secondDisplayName || "第二条边",
            secondValueLatex: scratch?.secondValueLatex || "",
          }, {
            expectedOrder: interaction?.expectedOrder,
            simplifiedRatio: scratch ? [scratch.simplifiedFirstLatex, scratch.simplifiedSecondLatex] : undefined,
          }),
          instruction: "依次点击要比较的两条边，填写化简后的前项和后项；份数会同步标到图上。",
          answerSlots: [
            { id: "ratio-first", label: "最简比前项", kind: "number", required: true },
            { id: "ratio-second", label: "最简比后项", kind: "number", required: true },
          ],
        }];
      }
      case "convert-collinear": {
        const collinear = interaction?.collinear;
        return [{
          ...base(step, step.id, "convert-collinear", capabilities, true, {
            availableSegmentIds: availableSegments,
            relationLatex: collinear?.relationLatex || "",
            wholeSegment: "",
            targetSegment: "",
            knownSegment: "",
          }, {
            expectedOrder: interaction?.expectedOrder,
            wholeSegment: collinear?.wholeSegment || "",
            targetSegment: collinear?.targetSegment || "",
            knownSegment: collinear?.knownSegment || "",
          }),
          instruction: "依次点击整段、目标分段和已知分段，建立三点共线的线段加法关系。",
          answerSlots: [
            { id: "whole-segment", label: "整段", kind: "object", required: true },
            { id: "target-segment", label: "目标分段", kind: "object", required: true },
            { id: "known-segment", label: "已知分段", kind: "object", required: true },
          ],
        }];
      }
      case "equation": {
        const equation = interaction?.equation;
        return [{
          ...base(step, step.id, "enter-equation", capabilities, true, {
            availableSegmentIds: availableSegments,
            targetLatex: equation?.targetLatex || "",
            factorSlots: equation?.factorSlots || ["known", "numerator", "denominator"],
          }, {
            expectedOrder: interaction?.expectedOrder,
            shareValues: equation?.shareValues,
            knownValueLatex: equation?.knownValueLatex,
            expectedResult: step.acceptedAnswers[0]?.split("|")[1],
          }),
          instruction: "点击已知边，填写未知份数、已知份数和计算结果，组成完整比例式。",
          answerSlots: [
            { id: "known-factor", label: "已知边", kind: "object", required: true },
            { id: "numerator", label: "未知份数", kind: "number", required: true },
            { id: "denominator", label: "已知份数", kind: "number", required: true },
            { id: "result", label: "结果", kind: "number", required: true },
          ],
        }];
      }
      case "select":
        return [{
          ...base(step, step.id, "select-option", capabilities, true, { options: step.options || [] }, { expectedValue: step.acceptedAnswers[0] }),
          answerSlots: [{ id: "choice", label: step.title, kind: "text", required: true, options: step.options || [] }],
        }];
      case "input":
        return [{
          ...base(step, step.id, "enter-text", capabilities, true, { placeholder: "写出规范答案" }, { expectedValues: step.acceptedAnswers }),
          instruction: "根据图上的标注写出最终结论；确认后会补全为规范解答。",
          answerSlots: [{ id: "value", label: step.title, kind: "text", required: true, placeholder: "写出规范答案" }],
        }];
    }
  });
}

/** Compiles reviewed question-bank solution steps into one ordered teacher document. */
export interface AuthoredTopicSolutionBoard {
  script: SolutionBoardScript;
}

export interface ReviewedSolutionStep {
  title?: string;
  content?: string;
  content_latex?: string;
}

export function authorTopicSolutionBoard(
  scenario: TopicResolvedScenario,
  actions: AuthoredActionTemplate[],
  reviewedSolutionSteps: ReviewedSolutionStep[] = [],
): AuthoredTopicSolutionBoard {
  if (!actions.length) throw new Error(`Scenario ${scenario.id || scenario.sourceQuestionId} has no ActionTemplates`);
  const sourceRows = reviewedSolutionSteps
    .map((step) => String(step.content_latex || step.content || "").trim())
    .filter(Boolean);
  const rows = sourceRows;
  if (!rows.length) throw new Error(`Scenario ${scenario.id || scenario.sourceQuestionId} has no reviewed solution content`);

  const expressions = rows.map((latexTemplate, index) => {
    // Distribute reviewed proof rows across Action stages without inspecting
    // Action kinds or evidence. A stage may own multiple mathematical rows.
    const ownerIndex = Math.min(
      actions.length - 1,
      Math.max(0, Math.ceil(((index + 1) * actions.length) / rows.length) - 1),
    );
    const owner = actions[ownerIndex];
    return {
      expressionId: `${owner.actionId}/solution-${index + 1}`,
      sourceStepId: owner.sourceStepId,
      ownerActionIds: [owner.actionId],
      latexTemplate,
      modes: ["learn" as const, "guided-practice" as const],
    };
  });
  return {
    script: {
      schemaVersion: SOLUTION_BOARD_SCHEMA_VERSION,
      documentId: `${scenario.id || scenario.sourceQuestionId}/solution`,
      headingLatex: "解：",
      expressions,
    },
  };
}

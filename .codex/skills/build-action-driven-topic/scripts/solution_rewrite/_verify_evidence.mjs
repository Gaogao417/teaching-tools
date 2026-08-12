// Verify every Topic's first, middle, and last record accepts the canonical
// evidence chain and projects diagram commands. This is the typed-evaluation
// proof that each authored ActionTemplate matches its private answer key and
// emits a persistent teaching effect — the engine-level substance of the
// acceptance checklist's "Practice sends typed evidence to backend evaluation".
import bundleJson from "/Users/gaochong/develop/teaching-tools/web/backend/src/content/topicScenarioBundle.json" with { type: "json" };
import { evaluateTopicEvidence } from "/Users/gaochong/develop/teaching-tools/web/backend/src/services/actionRuntime/topicTypedEvaluator.ts";
import { materializeSolutionBoard } from "/Users/gaochong/develop/teaching-tools/web/shared/solutionBoard.ts";

const TOPICS = [
  "reverseASimilarity",
  "parallelLineRatios",
  "nestedSimilarity",
  "butterflySimilarity",
  "auxiliaryTwoRatios",
  "quadraticCompletion",
];

function evidenceFor(template) {
  const ti = template.teachingInput || {};
  const base = { actionId: template.actionId, sourceStepId: template.sourceStepId, version: 1 };
  switch (template.kind) {
    case "make-parallel":
      return { ...base, kind: template.kind, throughPointId: ti.throughPointId, referenceLineId: ti.referenceLineId };
    case "intersect-carriers":
      return { ...base, kind: template.kind, carrierPointIds: ti.carrierPointIds };
    case "mark-segment-values":
      return { ...base, kind: template.kind, values: Object.fromEntries((ti.labels || []).map((l) => [l.segmentId, l.valueLatex])) };
    case "pair-segments":
      return { ...base, kind: template.kind, segmentIds: ti.expectedOrder };
    case "ratio-scratch":
      return { ...base, kind: template.kind, segmentIds: ti.expectedOrder, ratio: ti.simplifiedRatio };
    case "convert-collinear":
      return { ...base, kind: template.kind, segmentIds: ti.expectedOrder };
    case "enter-equation":
      return { ...base, kind: template.kind, factors: ti.shareValues ? [ti.expectedOrder[0], ...ti.shareValues] : ti.expectedOrder, result: ti.expectedResult };
    case "select-option":
      return { ...base, kind: template.kind, value: ti.expectedValue };
    case "enter-text":
      return { ...base, kind: template.kind, value: ti.expectedValues[0] };
    default:
      throw new Error(`unknown kind ${template.kind}`);
  }
}

let failures = 0;
const summary = [];
for (const topicId of TOPICS) {
  const records = bundleJson.scenarios[topicId];
  const picks = [records[0], records[Math.floor(records.length / 2)], records[records.length - 1]];
  for (const record of picks) {
    const templates = record.promptData.actionTemplates;
    const evidence = templates.map(evidenceFor);
    const diagnosis = evaluateTopicEvidence(templates, evidence);
    const board = record.promptData.solutionBoard;
    const fullDoc = materializeSolutionBoard(board, "learn", {});
    const ok = diagnosis.accepted && diagnosis.commands.length >= templates.length
      && fullDoc.expressions.length === board.expressions.length;
    if (!ok) failures++;
    summary.push({
      topic: topicId,
      record: record.id,
      actions: templates.length,
      accepted: diagnosis.accepted,
      commands: diagnosis.commands.length,
      wrongActions: diagnosis.wrongActionIds,
      boardExprs: board.expressions.length,
      docRendered: fullDoc.expressions.length,
      status: ok ? "PASS" : "FAIL",
    });
  }
}
console.log("RECORD | actions | accepted | commands | wrong | board | doc | status");
for (const s of summary) {
  console.log(`${s.topic}/${s.record} | ${s.actions} | ${s.accepted} | ${s.commands} | ${JSON.stringify(s.wrongActions)} | ${s.boardExprs} | ${s.docRendered} | ${s.status}`);
}
console.log(`\n${summary.length} records checked, ${failures} failures`);
process.exit(failures ? 1 : 0);

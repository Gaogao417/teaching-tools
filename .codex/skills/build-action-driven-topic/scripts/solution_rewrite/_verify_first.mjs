// Verify each Topic's first record end-to-end by submitting canonical evidence
// for every action via the practice runtime-action API. Proves the full chain
// (mark -> pair/ratio/convert -> equation/input) accepts and the SolutionBoard
// advances. Run against a live backend at http://127.0.0.1:3001.

const BASE = "http://127.0.0.1:3001";
const TOPICS = [
  "reverseASimilarity",
  "parallelLineRatios",
  "nestedSimilarity",
  "butterflySimilarity",
  "auxiliaryTwoRatios",
  "quadraticCompletion",
];

function evidenceFor(action) {
  const base = { actionId: action.actionId, sourceStepId: action.sourceStepId, version: 1 };
  const input = action.input || {};
  switch (action.kind) {
    case "make-parallel":
      return { ...base, kind: action.kind, throughPointId: input.throughPointId, referenceLineId: input.referenceLineId };
    case "intersect-carriers":
      return { ...base, kind: action.kind, carrierPointIds: input.carrierPointIds };
    case "mark-segment-values":
      return { ...base, kind: action.kind, values: Object.fromEntries((input.labels || []).map((l) => [l.segmentId, l.valueLatex])) };
    case "pair-segments":
      return { ...base, kind: action.kind, segmentIds: input.expectedOrder };
    case "ratio-scratch":
      return { ...base, kind: action.kind, segmentIds: input.expectedOrder, ratio: input.simplifiedRatio };
    case "convert-collinear":
      return { ...base, kind: action.kind, segmentIds: input.expectedOrder };
    case "enter-equation":
      return { ...base, kind: action.kind, factors: input.shareValues ? [input.expectedOrder[0], ...input.shareValues] : input.expectedOrder, result: input.expectedResult };
    case "select-option":
      return { ...base, kind: action.kind, value: input.expectedValue };
    case "enter-text":
      return { ...base, kind: action.kind, value: input.expectedValues[0] };
    default:
      throw new Error(`unknown kind ${action.kind}`);
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}
async function get(path) {
  const res = await fetch(BASE + path);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function verifyTopic(topicId) {
  const start = await post("/api/practice/start", { taskId: topicId, studentName: "verify" });
  const sessionId = start.sessionId;
  const plan0 = await get(`/api/practice/session/${sessionId}/action-plan`);
  const instanceId = plan0.plan.metadata?.instanceId || start.runtime?.instance?.instanceId || start.instance?.instanceId;
  // The plan holds the authored actions with private input (guided-practice).
  const actions = plan0.plan.actions;
  const results = [];
  let stepIndex = 0;
  for (const action of actions) {
    const evidence = evidenceFor(action);
    // Submit via runtime-action with a submit event carrying the evidence.
    const resp = await post("/api/practice/runtime-action", {
      sessionId,
      instanceId,
      action: { type: "submit", stepId: action.sourceStepId, value: JSON.stringify(evidence) },
    }).catch((err) => ({ error: err.message }));
    results.push({ actionId: action.actionId, kind: action.kind, accepted: resp.accepted, evaluation: resp.evaluation, error: resp.error });
    stepIndex++;
  }
  return { topicId, sessionId, instanceId, actionCount: actions.length, results };
}

const report = [];
for (const topicId of TOPICS) {
  try {
    report.push(await verifyTopic(topicId));
  } catch (err) {
    report.push({ topicId, error: err.message });
  }
}
console.log(JSON.stringify(report, null, 2));

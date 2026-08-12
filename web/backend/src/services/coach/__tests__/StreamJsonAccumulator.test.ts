import assert from "node:assert/strict";
import { StreamJsonAccumulator, deltaAfter } from "../adapters/ClaudeCodeTextCoachEngine";

// Recorded-shape stream-json NDJSON lines (no live provider needed). With
// --include-partial-messages, assistant text grows across consecutive assistant
// messages; the terminal `result` only arrives at the very end.
const assistant = (text: string) => JSON.stringify({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const resultLine = (usage: { input_tokens: number; output_tokens: number }) => JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "好的，这很合理。",
  usage,
});

// 1. Real text deltas arrive before the result event (i.e. before completion).
{
  const acc = new StreamJsonAccumulator("glm-5.2");
  const step0 = acc.consume('{"type":"system","subtype":"init"}');
  assert.equal(step0.deltas.length, 0);
  const step1 = acc.consume(assistant("好的"));
  const step2 = acc.consume(assistant("好的，这很"));
  const step3 = acc.consume(assistant("好的，这很合理。"));
  assert.deepEqual(step1.deltas, ["好的"], "first partial yields a real delta");
  assert.deepEqual(step2.deltas, ["，这很"], "growing partial yields the new suffix");
  assert.deepEqual(step3.deltas, ["合理。"], "final partial yields the last suffix");
  assert.equal(acc.isDone, false, "completion has NOT arrived yet — deltas precede completion");
  const stepDone = acc.consume(resultLine({ input_tokens: 10, output_tokens: 8 }));
  assert.equal(stepDone.done, true);
  assert.equal(stepDone.usage?.outputTokens, 8);
  assert.equal(stepDone.usage?.model, "glm-5.2");
}

// 2. deltaAfter does not double-count accumulation- or delta-style streams.
{
  assert.equal(deltaAfter("好的", "好的，这很"), "，这很");
  assert.equal(deltaAfter("abc", "abc"), "");
  assert.equal(deltaAfter("", "abc"), "abc");
}

// 3. A provider error result is surfaced, not swallowed.
{
  const acc = new StreamJsonAccumulator();
  const step = acc.consume(JSON.stringify({ type: "result", is_error: true, result: "API Error: boom" }));
  assert.equal(step.done, true);
  assert.ok(step.error && step.error.includes("boom"));
}

console.log("PASS ClaudeCodeTextCoachEngine emits real text deltas before completion");

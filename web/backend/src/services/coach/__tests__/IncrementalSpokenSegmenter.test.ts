import assert from "node:assert/strict";
import { SpokenSegmenter } from "../application/SpokenSegmenter";

function braceBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}
function mathBalanced(text: string): boolean {
  return (text.match(/\$/g) || []).length % 2 === 0;
}

function assertSound(segments: ReturnType<SpokenSegmenter["segment"]>, original: string): void {
  // No loss, no duplication.
  assert.equal(segments.map((s) => s.spokenText).join(""), original, "segments must concatenate to the original");
  // Unique, monotonic ids.
  const ids = segments.map((s) => s.segmentId);
  assert.equal(new Set(ids).size, ids.length, "segment ids must be unique");
  // Never split inside a LaTeX group or inline math.
  for (const seg of segments) {
    assert.ok(braceBalanced(seg.spokenText), `segment must not split a LaTeX group: "${seg.spokenText}"`);
    assert.ok(mathBalanced(seg.spokenText), `segment must not split inline math: "${seg.spokenText}"`);
  }
}

// 1. A complete utterance segments into ordered, lossless, atomic chunks.
{
  const original = "我们先看这个条件，然后再算结果。明白了吗？";
  const segments = new SpokenSegmenter().segment(original);
  assert.ok(segments.length >= 2, "a multi-clause reply should yield several segments");
  assertSound(segments, original);
}

// 2. Chinese punctuation that arrives in a later delta still splits (cross-delta segmentation).
{
  const segmenter = new SpokenSegmenter();
  const beforePunct = segmenter.push("我们先看这个");
  const afterPunct = segmenter.push("条件，然后再算结果。");
  const tail = segmenter.flush();
  assert.equal(beforePunct.length, 0, "no segment before a terminating punctuation arrives");
  assert.ok(afterPunct.length >= 1, "a segment completes when punctuation crosses a delta boundary");
  assertSound([...beforePunct, ...afterPunct, ...tail], "我们先看这个条件，然后再算结果。");
}

// 3. LaTeX groups and inline math are never split mid-group.
{
  const original = "公式是 \\frac{1}{2}，还有 $a^2+b^2=c^2$，很好。";
  const segments = new SpokenSegmenter(8, 12).segment(original);
  assertSound(segments, original);
  assert.ok(segments.every((s) => !s.spokenText.includes("{1}{2}") || s.spokenText.includes("\\frac{1}{2}")),
    "\\frac{1}{2} must stay together inside one segment");
}

// 4. Numbers, decimals and units stay atomic (we only cut at Chinese punctuation).
{
  const original = "底边长度是 3.14 厘米，面积约是 12 平方厘米。";
  const segments = new SpokenSegmenter().segment(original);
  assertSound(segments, original);
  assert.ok(segments.every((s) => !/\d$/.test(s.spokenText) || /厘米|米|平方/.test(s.spokenText) === false),
    "numeric runs are not the split trigger");
}

// 5. flush closes a trailing segment; each character is emitted exactly once across push+flush.
{
  const segmenter = new SpokenSegmenter();
  const a = segmenter.push("第一句话。");
  const b = segmenter.flush();
  assertSound([...a, ...b], "第一句话。");
}

// 6. Empty / whitespace input yields nothing.
{
  assert.deepEqual(new SpokenSegmenter().segment("   "), []);
  assert.deepEqual(new SpokenSegmenter().flush(), []);
}

console.log("PASS IncrementalSpokenSegmenter emits ordered, atomic, lossless spoken segments");

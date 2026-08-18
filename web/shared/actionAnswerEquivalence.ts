/**
 * Authored answer-equivalence policies for the Action Runtime.
 *
 * Both helpers are data-gated: an action opts in through its authored input
 * (`pairOrderPolicy: "pair-equivalent"` on pair-segments, `answerNormalization:
 * "similarity-statement"` on enter-text). The default behavior stays exact
 * matching, so topics that did not author a policy are unaffected. The same
 * helper must back the frontend local-training guard and the backend typed
 * evaluator so both layers accept identical answer sets.
 */

export type PairOrderPolicy = "pair-equivalent";
export type AnswerNormalization = "similarity-statement";

function pairKey(first: string, second: string): string {
  return first <= second ? `${first}=${second}` : `${second}=${first}`;
}

/**
 * Unordered pair-list equivalence for pair-segments evidence: accepts swapping
 * the two members of any pair and swapping whole pairs (the correspondence
 * relation is the same), and rejects replacing a pair with a different segment
 * pair. Even-length lists only; an odd length never matches.
 */
export function pairOrdersEquivalent(submitted: readonly string[], expected: readonly string[]): boolean {
  if (submitted.length !== expected.length || submitted.length % 2 !== 0) return false;
  const normalize = (ids: readonly string[]) => {
    const keys: string[] = [];
    for (let index = 0; index + 1 < ids.length; index += 2) keys.push(pairKey(ids[index], ids[index + 1]));
    return keys.sort().join("|");
  };
  return normalize(submitted) === normalize(expected);
}

const TRIANGLE_TOKEN = /\\triangle|△|三角形/;
const SIMILARITY_TOKEN = /\\sim|∼|∽|~|相似/;

interface ParsedSimilarityStatement {
  first: string;
  second: string;
  /** Positional vertex correspondence as sorted "left>right" keys. */
  mappingKey: string;
}

/**
 * Parse a triangle-similarity statement in the spellings a learner may type:
 * `\triangle ADE\sim\triangle ACB`, `△ADE∽△ACB`, `三角形ADE相似三角形ACB`.
 * Whitespace, `$`, and terminal punctuation are ignored. Returns undefined for
 * anything that is not exactly two three-letter triangles joined by a
 * similarity token, so unparseable input never accidentally matches.
 */
export function parseSimilarityStatement(raw: string): ParsedSimilarityStatement | undefined {
  const text = String(raw).replace(/[\s\u3000]/g, "").replace(/\$/g, "").replace(/[。，,;；。]+$/g, "");
  const pattern = new RegExp(`^(?:${TRIANGLE_TOKEN.source})([A-Za-z]{3})(?:${SIMILARITY_TOKEN.source})(?:${TRIANGLE_TOKEN.source})([A-Za-z]{3})$`);
  const match = text.match(pattern);
  if (!match) return undefined;
  const first = match[1].toUpperCase();
  const second = match[2].toUpperCase();
  if (new Set(first).size !== 3 || new Set(second).size !== 3) return undefined;
  const mappingKey = [...first].map((letter, index) => `${letter}>${second[index]}`).sort().join(",");
  return { first, second, mappingKey };
}

/**
 * Two similarity statements are equivalent when they declare the same vertex
 * correspondence: applying any single relabeling permutation to both triangles
 * of the expected statement stays accepted (e.g. ADE∼ACB ≡ AED∼ABC), while a
 * positional misalignment such as ADE∼ABC is rejected.
 */
export function similarityStatementsEquivalent(submitted: string, expected: string): boolean {
  const left = parseSimilarityStatement(submitted);
  const right = parseSimilarityStatement(expected);
  if (!left || !right) return false;
  return left.mappingKey === right.mappingKey;
}

/** Shared enter-text acceptance used by both evaluation layers. */
export function normalizedTextAccepted(
  value: string | undefined,
  expectedValues: readonly string[] | undefined,
  normalization: AnswerNormalization | undefined,
): boolean {
  if (!expectedValues?.length) return true;
  if (normalization !== "similarity-statement") {
    return expectedValues.includes(value || "");
  }
  return (value || "") === "" ? false : expectedValues.some((expected) => similarityStatementsEquivalent(value || "", expected));
}

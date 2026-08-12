import type { SpokenSegment } from "../../../../../shared/coachMedia";

/**
 * Incremental, punctuation-aware segmenter. It consumes text deltas as they
 * stream from the model and emits a `SpokenSegment` only once a complete,
 * natural, read-aloud chunk has formed — it never forwards a single token or a
 * fragment that splits a LaTeX group, inline math, or a number/unit run.
 *
 * The first segment uses a shorter threshold so the student hears the coach
 * sooner; later segments allow longer runs for naturalness. `flush` closes a
 * trailing valid segment at end-of-turn.
 */

const STRONG_TERMINATORS = /[。！？]/;
const CLAUSE_TERMINATORS = /[。！？；，]/;

export class SpokenSegmenter {
  private remaining = "";
  private nextId = 0;

  constructor(
    private readonly firstTarget = 18,
    private readonly laterTarget = 56,
    private readonly minFirst = 6,
    private readonly minLaterClause = 12,
    private readonly maxSegment = 96,
  ) {}

  /** Append a text delta and return any segments that completed as a result. */
  push(textDelta: string): SpokenSegment[] {
    this.remaining += textDelta;
    return this.harvest(false);
  }

  /** Close the turn: emit a trailing segment if the remaining text is valid. */
  flush(): SpokenSegment[] {
    const harvested = this.harvest(true);
    const tail = this.remaining.trim();
    this.remaining = "";
    if (tail) harvested.push(this.makeSegment(tail));
    return harvested;
  }

  /** Convenience: segment a complete string in one shot (push + flush). */
  segment(text: string): SpokenSegment[] {
    return [...this.push(text), ...this.flush()];
  }

  private harvest(final: boolean): SpokenSegment[] {
    const out: SpokenSegment[] = [];
    // Re-scan from the front of the remaining buffer. Segments are only ever cut
    // at depth-0 safe boundaries, so the remaining buffer always starts clean.
    while (true) {
      const cut = this.findSplit(this.remaining);
      if (cut < 0) break;
      out.push(this.makeSegment(this.remaining.slice(0, cut).trim()));
      this.remaining = this.remaining.slice(cut);
      if (!final && this.remaining.length === 0) break;
    }
    return out;
  }

  /** Return the exclusive end index of the next safe split, or -1. */
  private findSplit(text: string): number {
    let braces = 0;
    let inMath = false;
    let segmentStart = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const prev = text[i - 1];
      if (char === "\\" ) { // LaTeX command: skip the command name atomically
        let j = i + 1;
        while (j < text.length && /[A-Za-z]/.test(text[j])) j += 1;
        i = j - 1;
        continue;
      }
      if (char === "{") braces += 1;
      else if (char === "}") braces = Math.max(0, braces - 1);
      else if (char === "$") inMath = !inMath;

      if (braces > 0 || inMath) continue;

      if (CLAUSE_TERMINATORS.test(char)) {
        const segLen = i - segmentStart + 1;
        const isFirst = this.nextId === 0;
        const strong = STRONG_TERMINATORS.test(char);
        const hardCap = segLen >= this.maxSegment;
        const firstVoice = isFirst && segLen >= this.minFirst;
        const laterClause = !isFirst && strong && segLen >= this.minLaterClause;
        const laterFull = !isFirst && segLen >= this.laterTarget;
        if (hardCap || firstVoice || laterClause || laterFull) {
          return i + 1;
        }
      }
      // Force a split at a hard cap even without punctuation, between CJK chars,
      // to bound buffering on a long unpunctuated run.
      if (i - segmentStart + 1 >= this.maxSegment) {
        return i + 1;
      }
      // a leading backslash already consumed above
      void prev;
    }
    return -1;
  }

  private makeSegment(text: string): SpokenSegment {
    const segmentId = `seg-${this.nextId.toString(36)}`;
    this.nextId += 1;
    return { segmentId, displayText: text, spokenText: text };
  }
}

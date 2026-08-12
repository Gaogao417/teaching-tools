/** Punctuation-aware segmenter that keeps LaTeX commands/groups and numeric units atomic. */
export class SpokenSegmenter {
  constructor(private readonly firstTarget = 36, private readonly laterTarget = 72) {}

  segment(text: string): string[] {
    const normalized = text.trim();
    if (!normalized) return [];
    const result: string[] = [];
    let start = 0;
    let braces = 0;
    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (char === "{") braces += 1;
      if (char === "}") braces = Math.max(0, braces - 1);
      const target = result.length ? this.laterTarget : this.firstTarget;
      const punctuation = /[。！？；，]/.test(char);
      if (braces === 0 && punctuation && index - start + 1 >= Math.min(12, target)) {
        result.push(normalized.slice(start, index + 1).trim());
        start = index + 1;
      }
    }
    if (start < normalized.length) result.push(normalized.slice(start).trim());
    return result.filter(Boolean);
  }
}

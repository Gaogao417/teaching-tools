/**
 * LaTeX → spoken-Chinese normalization shared by the backend TTS endpoint and
 * the frontend teacher-copy selector.
 *
 * This is a lossy, speech-only transform. It strips math typesetting so a TTS
 * engine never reads back dollar signs, command names or braces. It is NOT a
 * renderer: display LaTeX still travels untouched through the WorkspaceView.
 */

export function latexToSpokenChinese(value: string): string {
  return value
    .replace(/\$+/g, "")
    .replace(/\\text\{([^}]*)\}/g, "$1")
    .replace(/\\(?:frac|sqrt)\{([^}]*)\}(?:\{([^}]*)\})?/g, (_match, first, second) =>
      second ? `${first} 除以 ${second}` : first)
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

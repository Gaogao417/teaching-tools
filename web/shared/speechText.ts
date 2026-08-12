/**
 * LaTeX → spoken-Chinese normalization shared by the backend TTS endpoint and
 * the frontend teacher-copy selector.
 *
 * This is a lossy, speech-only transform. It strips math typesetting so a TTS
 * engine never reads back dollar signs, command names or braces. It is NOT a
 * renderer: display LaTeX still travels untouched through the WorkspaceView.
 */

export const SPEECH_TEXT_VERSION = 2 as const;

function groupAt(source: string, start: number): { value: string; end: number } | undefined {
  if (source[start] !== "{") return undefined;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return { value: source.slice(start + 1, index), end: index + 1 };
  }
  return undefined;
}

function speakLatex(source: string): string {
  let out = "";
  for (let index = 0; index < source.length;) {
    if (source[index] !== "\\") { out += source[index++]; continue; }
    const match = /^\\([a-zA-Z]+)/.exec(source.slice(index));
    if (!match) { index += 1; continue; }
    const command = match[1];
    index += match[0].length;
    if (["frac", "dfrac", "tfrac"].includes(command)) {
      const numerator = groupAt(source, index);
      const denominator = numerator && groupAt(source, numerator.end);
      if (numerator && denominator) {
        out += ` ${speakLatex(denominator.value)} 分之 ${speakLatex(numerator.value)} `;
        index = denominator.end;
        continue;
      }
    }
    if (["sqrt", "text", "mathrm", "operatorname", "overline"].includes(command)) {
      const group = groupAt(source, index);
      if (group) {
        out += command === "sqrt" ? ` 根号 ${speakLatex(group.value)} ` : speakLatex(group.value);
        index = group.end;
        continue;
      }
    }
    const spoken: Record<string, string> = {
      angle: "角 ", parallel: " 平行于 ", perp: " 垂直于 ", times: " 乘以 ", cdot: " 乘以 ",
      le: " 小于等于 ", ge: " 大于等于 ", neq: " 不等于 ", approx: " 约等于 ",
      sim: " 相似于 ", cong: " 全等于 ", pi: "派", degree: "度",
    };
    out += spoken[command] || " ";
  }
  return out;
}

/** Semantic, deterministic math-to-spoken fallback. Authored spoken copy remains preferred. */
export function latexToSpokenChinese(value: string): string {
  return speakLatex(value.replace(/\$+/g, ""))
    .replace(/\^\{?2\}?/g, "的二次方")
    .replace(/\^\{?3\}?/g, "的三次方")
    .replace(/\^\{([^}]*)\}/g, "的$1次方")
    .replace(/_\{([^}]*)\}/g, "下标$1")
    .replace(/[{}]/g, "")
    .replace(/:/g, " 比 ")
    .replace(/=/g, " 等于 ")
    .replace(/\+/g, " 加 ")
    .replace(/−|\s-\s/g, " 减 ")
    .replace(/\s+/g, " ")
    .trim();
}

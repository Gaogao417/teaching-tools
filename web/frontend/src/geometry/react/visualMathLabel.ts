import katex from "katex";
import { VisualRenderError } from "./visualRenderTypes";

/** Use the existing KaTeX parser, then translate its MathML to safe SVG text.
 * Fractions retain grouping; this formats authorized content, never evaluates it.
 * No provider HTML or LaTeX source is inserted into the document. */
export function visualMathLabel(value: string): string {
  if (!/[\\$]/.test(value)) return value;
  let source = value.trim();
  if (source.startsWith("$$") && source.endsWith("$$")) source = source.slice(2, -2);
  else if (source.startsWith("$") && source.endsWith("$")) source = source.slice(1, -1);
  else if ((source.startsWith("\\(") && source.endsWith("\\)")) || (source.startsWith("\\[") && source.endsWith("\\]"))) source = source.slice(2, -2);
  try {
    const markup = katex.renderToString(source, { output: "mathml", throwOnError: true, trust: false, strict: "error" });
    const parsed = new DOMParser().parseFromString(markup, "text/html");
    const math = parsed.querySelector("math");
    if (!math) throw new Error("missing math");
    const grouped = (text: string) => /^[\p{L}\p{N}.]+$/u.test(text) ? text : `(${text})`;
    const read = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      const element = node as Element;
      const children = [...element.childNodes];
      if (element.localName === "annotation") return "";
      const values = children.map(read);
      if (element.localName === "mfrac") return `${grouped(values[0])}/${grouped(values[1])}`;
      if (element.localName === "msup") return `${grouped(values[0])}^${grouped(values[1])}`;
      if (element.localName === "msub") return `${values[0]}_${grouped(values[1])}`;
      if (element.localName === "msqrt") return `√(${values.join("")})`;
      return values.join("");
    };
    const text = read(math);
    if (!text.trim() || /[\\$]/.test(text)) throw new Error("unreadable math");
    return text;
  } catch {
    throw new VisualRenderError("layout", "authorized mathematical label cannot be displayed safely");
  }
}

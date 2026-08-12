import { describe, expect, it } from "vitest";
import {
  isDirectSpeechRequest,
  isDirectSpeechResponse,
} from "../../../shared/actionRuntime";
import { latexToSpokenChinese } from "../../../shared/speechText";

describe("latexToSpokenChinese (shared TTS normalization)", () => {
  it("strips math typesetting and reads fractions aloud", () => {
    expect(latexToSpokenChinese("$\\frac{a}{b}$")).toBe("b 分之 a");
    expect(latexToSpokenChinese("\\text{线段}AB=\\frac{1}{2}")).toBe("线段AB 等于 2 分之 1");
  });

  it("removes command names and braces without pronouncing them", () => {
    expect(latexToSpokenChinese("\\sqrt{x}")).toBe("根号 x");
    expect(latexToSpokenChinese("$\\angle A$")).toBe("角 A");
    expect(latexToSpokenChinese("  a   b  ")).toBe("a b");
  });

  it("preserves nested fraction, power and relation semantics", () => {
    expect(latexToSpokenChinese("\\frac{\\sqrt{x^2}}{a+b}")).toBe("a 加 b 分之 根号 x的二次方");
    expect(latexToSpokenChinese("AB\\parallel CD")).toBe("AB 平行于 CD");
    expect(latexToSpokenChinese("\\triangle ABC\\sim\\triangle DEF")).toContain("相似于");
    expect(latexToSpokenChinese("AB\\perp CD,\\angle A\\neq\\angle B")).toBe("AB 垂直于 CD,角 A 不等于 角 B");
  });

  it("leaves plain Chinese untouched so it stays idempotent for the TTS endpoint", () => {
    expect(latexToSpokenChinese("先过点作平行线")).toBe("先过点作平行线");
  });
});

describe("direct speech request/response guards", () => {
  it("validates a direct speech request", () => {
    expect(isDirectSpeechRequest({ text: "讲解" })).toBe(true);
    expect(isDirectSpeechRequest({ text: "   " })).toBe(false);
    expect(isDirectSpeechRequest({ text: 1 })).toBe(false);
    expect(isDirectSpeechRequest({})).toBe(false);
  });

  it("validates a direct speech response", () => {
    expect(isDirectSpeechResponse({ audioUrl: "https://x/a.mp3" })).toBe(true);
    expect(isDirectSpeechResponse({ audioUrl: "https://x/a.mp3", expiresAt: 9 })).toBe(true);
    expect(isDirectSpeechResponse({ model: "server-only" })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  isDirectSpeechRequest,
  isDirectSpeechResponse,
} from "../../../shared/actionRuntime";
import { latexToSpokenChinese } from "../../../shared/speechText";

describe("latexToSpokenChinese (shared TTS normalization)", () => {
  it("strips math typesetting and reads fractions aloud", () => {
    expect(latexToSpokenChinese("$\\frac{a}{b}$")).toBe("a 除以 b");
    expect(latexToSpokenChinese("\\text{线段}AB=\\frac{1}{2}")).toBe("线段AB=1 除以 2");
  });

  it("removes command names and braces without pronouncing them", () => {
    expect(latexToSpokenChinese("\\sqrt{x}")).toBe("x");
    expect(latexToSpokenChinese("$\\angle A$")).toBe("A");
    expect(latexToSpokenChinese("  a   b  ")).toBe("a b");
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
    expect(isDirectSpeechResponse({ audioUrl: "https://x/a.mp3", model: "qwen", voice: "Cherry" })).toBe(true);
    expect(isDirectSpeechResponse({ audioUrl: "https://x/a.mp3", model: "qwen", voice: "Cherry", expiresAt: 9 })).toBe(true);
    expect(isDirectSpeechResponse({ audioUrl: "https://x/a.mp3", model: "qwen" })).toBe(false);
  });
});

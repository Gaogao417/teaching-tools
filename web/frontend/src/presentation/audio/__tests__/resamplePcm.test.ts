import { describe, expect, it } from "vitest";
import { resamplePcm } from "../resamplePcm";

describe("resamplePcm", () => {
  it.each([44_100, 48_000])("converts %i Hz to an accurate 16 kHz duration", (sourceRate) => {
    const input = Float32Array.from({ length: sourceRate }, (_, index) => Math.sin(2 * Math.PI * 440 * index / sourceRate));
    const output = resamplePcm(input, sourceRate, 16_000);
    expect(output.length).toBeGreaterThanOrEqual(15_999);
    expect(output.length).toBeLessThanOrEqual(16_001);
    let crossings = 0;
    for (let index = 1; index < output.length; index += 1) if (output[index - 1] <= 0 && output[index] > 0) crossings += 1;
    expect(crossings).toBeGreaterThanOrEqual(439);
    expect(crossings).toBeLessThanOrEqual(441);
  });
});

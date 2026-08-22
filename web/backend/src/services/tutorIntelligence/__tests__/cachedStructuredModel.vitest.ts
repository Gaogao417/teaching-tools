/**
 * 结构化模型缓存 decorator + 预算 env 接线测试（失败分析报告 §四.3）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { StructuredModelError } from "../structuredModelPort";
import type { StructuredCompletionRequest, StructuredCompletionResult, StructuredModelPort } from "../structuredModelPort";

function countingModel(): { model: StructuredModelPort; calls: () => number } {
  let calls = 0;
  return {
    model: {
      provider: "test",
      modelId: "test-model",
      async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
        calls += 1;
        return {
          value: { marker: request.userPayload } as unknown as T,
          modelId: "test-model",
          promptVersion: request.promptVersion,
          latencyMs: 1,
        };
      },
    },
    calls: () => calls,
  };
}

function request(payload: unknown): StructuredCompletionRequest {
  return { systemPrompt: "s", promptVersion: "p@v1", userPayload: payload, timeoutMs: 100 };
}

describe("createCachedStructuredModel", () => {
  it("同 promptVersion + userPayload 只穿透一次；不同载荷各自穿透", async () => {
    vi.resetModules();
    const { createCachedStructuredModel } = await import("../adapters/cachedStructuredModel");
    const { model, calls } = countingModel();
    const cached = createCachedStructuredModel(model);

    const first = await cached.complete(request({ a: 1 }));
    await cached.complete(request({ a: 1 }));
    expect(calls()).toBe(1);
    expect((first.value as { marker: { a: number } }).marker).toEqual({ a: 1 });

    await cached.complete(request({ a: 2 }));
    expect(calls()).toBe(2);
    // promptVersion 不同 → 不命中。
    await cached.complete({ ...request({ a: 1 }), promptVersion: "p@v2" });
    expect(calls()).toBe(3);
  });

  it("失败不缓存：同载荷重试再次穿透", async () => {
    vi.resetModules();
    const { createCachedStructuredModel } = await import("../adapters/cachedStructuredModel");
    let calls = 0;
    const flaky: StructuredModelPort = {
      provider: "test",
      modelId: "flaky",
      async complete<T>() {
        calls += 1;
        if (calls === 1) throw new StructuredModelError("timeout", "first fails", true);
        return { value: { ok: true } as unknown as T, modelId: "flaky", promptVersion: "p@v1", latencyMs: 1 };
      },
    };
    const cached = createCachedStructuredModel(flaky);
    await expect(cached.complete(request({ x: 1 }))).rejects.toThrow("first fails");
    const second = await cached.complete(request({ x: 1 }));
    expect(second.value).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it("FIFO 淘汰：maxEntries=1 时旧条目被逐出", async () => {
    vi.resetModules();
    const { createCachedStructuredModel } = await import("../adapters/cachedStructuredModel");
    const { model, calls } = countingModel();
    const cached = createCachedStructuredModel(model, 1);
    await cached.complete(request({ a: 1 }));
    await cached.complete(request({ a: 2 }));
    await cached.complete(request({ a: 1 })); // a1 已被 a2 逐出 → 重新穿透
    expect(calls()).toBe(3);
  });
});

describe("policyGraph 预算 env 接线", () => {
  const originalTotal = process.env.TUTOR_POLICY_TOTAL_BUDGET_MS;
  const originalPerCall = process.env.TUTOR_POLICY_PER_CALL_TIMEOUT_MS;

  afterEach(() => {
    if (originalTotal === undefined) delete process.env.TUTOR_POLICY_TOTAL_BUDGET_MS;
    else process.env.TUTOR_POLICY_TOTAL_BUDGET_MS = originalTotal;
    if (originalPerCall === undefined) delete process.env.TUTOR_POLICY_PER_CALL_TIMEOUT_MS;
    else process.env.TUTOR_POLICY_PER_CALL_TIMEOUT_MS = originalPerCall;
    vi.resetModules();
  });

  it("默认放宽（总 12s / 单次 8s）；env 覆盖生效；非法值回退默认", async () => {
    vi.resetModules();
    const defaults = await import("../policyGraph");
    expect(defaults.POLICY_TOTAL_BUDGET_MS).toBe(12_000);
    expect(defaults.POLICY_PER_CALL_TIMEOUT_MS).toBe(8_000);

    process.env.TUTOR_POLICY_TOTAL_BUDGET_MS = "20000";
    process.env.TUTOR_POLICY_PER_CALL_TIMEOUT_MS = "5000";
    vi.resetModules();
    const overridden = await import("../policyGraph");
    expect(overridden.POLICY_TOTAL_BUDGET_MS).toBe(20_000);
    expect(overridden.POLICY_PER_CALL_TIMEOUT_MS).toBe(5_000);

    process.env.TUTOR_POLICY_TOTAL_BUDGET_MS = "not-a-number";
    process.env.TUTOR_POLICY_PER_CALL_TIMEOUT_MS = "-3";
    vi.resetModules();
    const invalid = await import("../policyGraph");
    expect(invalid.POLICY_TOTAL_BUDGET_MS).toBe(12_000);
    expect(invalid.POLICY_PER_CALL_TIMEOUT_MS).toBe(8_000);
  });
});

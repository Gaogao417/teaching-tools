import assert from "node:assert/strict";
import { DeepSeekTextCoachEngine } from "../adapters/DeepSeekTextCoachEngine";
import type { TextCoachInput, TextGenerationEvent } from "../ports/TextCoachEngine";

const input: TextCoachInput = {
  problemLatex: "三角形内角和",
  mode: "learn",
  action: { actionId: "a1", title: "辅助线", instruction: "过顶点作底边的平行线" },
  visibleSolution: ["利用平行线的内错角"],
  trace: { actionState: "idle" },
  conversation: [],
  studentQuestion: "为什么要作这条辅助线？",
};

function sseResponse(lines: string[], splitAt = 0): Response {
  const encoded = new TextEncoder().encode(lines.join("\n") + "\n");
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitAt > 0) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
      } else {
        controller.enqueue(encoded);
      }
      controller.close();
    },
  }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

async function drain(stream: { next(): Promise<IteratorResult<TextGenerationEvent>> }): Promise<TextGenerationEvent[]> {
  const events: TextGenerationEvent[] = [];
  while (true) {
    const { value, done } = await stream.next();
    if (done) return events;
    events.push(value);
  }
}

async function main(): Promise<void> {
  // 1. The adapter sends the reviewed input directly to DeepSeek, explicitly
  // disables thinking, and yields real SSE content deltas before completion.
  {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"我们先看辅助线，"},"finish_reason":null}]}',
        "",
        'data: {"choices":[{"delta":{"content":"它把三个角搬到同一条直线上。"},"finish_reason":null}]}',
        "",
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        "",
        'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":24}}',
        "",
        "data: [DONE]",
        "",
      ], 37);
    };
    const engine = new DeepSeekTextCoachEngine({ apiKey: "test-key", fetchImpl });
    const result = await engine.streamReply(input, new AbortController().signal);
    assert.ok(result.ok);
    const events = await drain(result.value);
    assert.equal(requestUrl, "https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(requestInit?.body)) as Record<string, any>;
    assert.equal(body.model, "deepseek-v4-flash");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.stream, true);
    assert.equal(body.max_completion_tokens, 256);
    assert.equal(body.messages[0].role, "system");
    assert.deepEqual(JSON.parse(body.messages[1].content), input);
    assert.deepEqual(events.slice(0, 2), [
      { type: "text-delta", text: "我们先看辅助线，" },
      { type: "text-delta", text: "它把三个角搬到同一条直线上。" },
    ]);
    assert.deepEqual(events[2], {
      type: "text-completed",
      usage: { inputTokens: 80, outputTokens: 24, model: "deepseek-v4-flash" },
    });
    assert.deepEqual(engine.telemetryIdentity, { provider: "deepseek-api", model: "deepseek-v4-flash" });
  }

  // 2. Missing auth fails before any network request and is non-retryable.
  {
    let called = false;
    const previous = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const engine = new DeepSeekTextCoachEngine({
      apiKey: "",
      fetchImpl: async () => { called = true; throw new Error("must not call"); },
    });
    const result = await engine.streamReply(input, new AbortController().signal);
    if (previous !== undefined) process.env.DEEPSEEK_API_KEY = previous;
    assert.ok(!result.ok);
    assert.equal(result.error.code, "not-configured");
    assert.equal(result.error.retryable, false);
    assert.equal(called, false);
  }

  // 3. HTTP 429 is surfaced as a retryable rate-limit error.
  {
    const engine = new DeepSeekTextCoachEngine({
      apiKey: "test-key",
      fetchImpl: async () => new Response('{"error":{"message":"slow down"}}', { status: 429 }),
    });
    const result = await engine.streamReply(input, new AbortController().signal);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "rate-limited");
    assert.equal(result.error.retryable, true);
  }

  // 4. Caller cancellation aborts an in-flight HTTP request and maps cleanly.
  {
    const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const controller = new AbortController();
    const engine = new DeepSeekTextCoachEngine({ apiKey: "test-key", fetchImpl, timeoutMs: 1_000 });
    const pending = engine.streamReply(input, controller.signal);
    controller.abort();
    const result = await pending;
    assert.ok(!result.ok);
    assert.equal(result.error.code, "cancelled");
    assert.equal(result.error.retryable, false);
  }

  // 5. Adapter timeout is distinct from caller cancellation and is retryable.
  {
    const fetchImpl: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
    const engine = new DeepSeekTextCoachEngine({ apiKey: "test-key", fetchImpl, timeoutMs: 5 });
    const result = await engine.streamReply(input, new AbortController().signal);
    assert.ok(!result.ok);
    assert.equal(result.error.code, "timeout");
    assert.equal(result.error.retryable, true);
  }

  // 6. Provider-side SSE errors reject the stream; they are never converted to
  // a successful empty completion.
  {
    const engine = new DeepSeekTextCoachEngine({
      apiKey: "test-key",
      fetchImpl: async () => sseResponse([
        'data: {"error":{"message":"upstream unavailable"}}',
        "",
      ]),
    });
    const result = await engine.streamReply(input, new AbortController().signal);
    assert.ok(result.ok);
    await assert.rejects(() => result.value.next(), /upstream unavailable/);
  }

  console.log("PASS DeepSeekTextCoachEngine streams direct API deltas with thinking disabled and bounded failures");
}

void main().catch((error) => { console.error(error); process.exit(1); });

import { spawn } from "node:child_process";
import type {
  EventStream,
  Result,
  TextCoachEngine,
  TextCoachInput,
  TextGenerationEvent,
  UsageSummary,
} from "../ports/TextCoachEngine";
import { TextGenerationError } from "../ports/TextCoachEngine";
import { AsyncQueue } from "../application/asyncQueue";
import { STREAM_COACH_SYSTEM_PROMPT } from "../application/coachTextPrompt";

/**
 * Streaming text coach backed by the Claude Code CLI. Unlike the legacy
 * `--print --output-format json` call (which blocks until the whole structured
 * reply is ready), this uses `--output-format stream-json
 * --include-partial-messages` so assistant text arrives incrementally. Each new
 * run of characters is forwarded as a real `text-delta` — we never hold the
 * complete reply and then fake deltas.
 *
 * The model is asked to emit only the spoken reply as plain Chinese (no LaTeX,
 * no markdown, no JSON envelope). That text is both what the student hears
 * (TTS) and what the answer bubble shows; the application wraps it into a
 * schema-validated CoachDirective afterwards. Provider/model are read from the
 * process environment and stay server-side.
 */

function assistantText(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: unknown } => typeof block === "object" && block !== null && (block as { type?: string }).type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .join("");
}

/** Compute the new suffix to emit given the previously emitted text and the
 *  current accumulated assistant text. Handles both accumulation-style partials
 *  (current starts with emitted) and delta-style chunks (current is the new run)
 *  without double counting. */
export function deltaAfter(emitted: string, current: string): string {
  if (!current) return "";
  return current.startsWith(emitted) ? current.slice(emitted.length) : current;
}

export interface AccumulatorStep {
  deltas: string[];
  done: boolean;
  error?: string;
  usage?: UsageSummary;
}

/**
 * Stateful reducer over Claude Code `stream-json` NDJSON lines. Exported so the
 * "real delta before completion" behaviour is unit-testable without spawning the
 * CLI. Each `consume` returns the new text deltas produced by that line and
 * whether the terminal `result` event has arrived.
 */
export class StreamJsonAccumulator {
  private emitted = "";
  private done = false;
  readonly usage: UsageSummary = {};

  constructor(private readonly model: string = process.env.COACH_CLAUDE_MODEL?.trim() || "glm-5.2") {}

  consume(line: string): AccumulatorStep {
    if (!line.trim()) return { deltas: [], done: false };
    let event: unknown;
    try { event = JSON.parse(line); } catch { return { deltas: [], done: false }; }
    if (!event || typeof event !== "object") return { deltas: [], done: false };
    const obj = event as Record<string, unknown>;
    const type = obj.type;
    if (type === "result") {
      this.done = true;
      const u = obj.usage as Record<string, unknown> | undefined;
      if (u && typeof u === "object") {
        if (typeof u.input_tokens === "number") this.usage.inputTokens = u.input_tokens;
        if (typeof u.output_tokens === "number") this.usage.outputTokens = u.output_tokens;
        this.usage.model = this.model;
      }
      if (obj.is_error === true || obj.subtype === "error_max_turns") {
        const text = typeof obj.result === "string" ? obj.result : "Claude Code coach failed";
        return { deltas: [], done: true, error: text.slice(0, 300) };
      }
      return { deltas: [], done: true, usage: this.usage };
    }
    const current = type === "assistant" || type === "assistant_message_chunk"
      ? assistantText(obj.message) || assistantText(obj)
      : "";
    const delta = deltaAfter(this.emitted, current);
    if (delta) this.emitted += delta;
    return { deltas: delta ? [delta] : [], done: false };
  }

  get isDone(): boolean { return this.done; }
}

export class ClaudeCodeTextCoachEngine implements TextCoachEngine {
  readonly telemetryIdentity = {
    provider: "claude-code",
    model: process.env.COACH_CLAUDE_MODEL?.trim() || "glm-5.2",
  };

  async streamReply(
    input: TextCoachInput,
    signal: AbortSignal,
  ): Promise<Result<EventStream<TextGenerationEvent>, TextGenerationError>> {
    if (!input.studentQuestion.trim()) {
      return { ok: false, error: new TextGenerationError("empty-question", "Student question is empty", false) };
    }
    const command = process.env.CLAUDE_CODE_BIN?.trim() || "claude";
    const model = process.env.COACH_CLAUDE_MODEL?.trim() || "glm-5.2";
    const timeoutMs = Number(process.env.COACH_CLAUDE_TIMEOUT_MS || 45_000);

    const queue = new AsyncQueue<TextGenerationEvent>();
    const accumulator = new StreamJsonAccumulator(model);
    let settled = false;

    const finish = (error?: TextGenerationError) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      if (error) queue.error(error);
      else {
        queue.push({ type: "text-completed", usage: accumulator.usage });
        queue.complete();
      }
    };
    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch { /* already exited */ }
      finish(new TextGenerationError("cancelled", "Coach text generation cancelled", false));
    };
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      finish(new TextGenerationError("timeout", `Claude Code coach timed out after ${timeoutMs}ms`, true));
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000);

    if (signal.aborted) { finish(new TextGenerationError("cancelled", "Coach text generation cancelled", false)); }
    else signal.addEventListener("abort", onAbort, { once: true });

    const args = [
      "--print",
      "--verbose",
      "--model", model,
      "--tools", "",
      "--permission-mode", "dontAsk",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--system-prompt", STREAM_COACH_SYSTEM_PROMPT,
      JSON.stringify(input),
    ];
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdoutBuffer = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (settled) return;
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        const step = accumulator.consume(line);
        for (const delta of step.deltas) {
          if (!settled) queue.push({ type: "text-delta", text: delta });
        }
        if (step.error) { finish(new TextGenerationError("provider-error", step.error, true)); return; }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", () => { /* provider diagnostics; surfaced only via exit code */ });

    child.on("error", (error) => finish(new TextGenerationError("spawn-failed", error.message, true)));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) {
        finish(new TextGenerationError("provider-error", `Claude Code coach exited with ${code}`, true));
        return;
      }
      if (!accumulator.isDone) {
        finish(new TextGenerationError("provider-error", "Claude Code coach produced no result event", true));
        return;
      }
      finish();
    });

    return Promise.resolve({ ok: true, value: queue });
  }
}

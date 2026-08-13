import { ClaudeCodeTextCoachEngine } from "./adapters/ClaudeCodeTextCoachEngine";
import { DeepSeekTextCoachEngine } from "./adapters/DeepSeekTextCoachEngine";
import { TextGenerationError, type TextCoachEngine, type TextCoachInput, type UsageSummary } from "./ports/TextCoachEngine";

/**
 * Composition helper shared by streaming and request-response Coach paths.
 * DeepSeek is the default; Claude Code remains an explicit emergency rollback.
 */
export function createTextCoachEngine(): TextCoachEngine {
  const provider = process.env.COACH_TEXT_PROVIDER?.trim().toLowerCase() || "deepseek";
  if (provider === "claude-code") return new ClaudeCodeTextCoachEngine();
  return new DeepSeekTextCoachEngine();
}

/** Collect the same real streaming provider events for the legacy blocking HTTP
 * contract. This keeps its answer source aligned with /turn-stream without
 * maintaining a second provider-specific implementation. */
export async function generateTextCoachReply(
  input: TextCoachInput,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ text: string; usage?: UsageSummary }> {
  const result = await createTextCoachEngine().streamReply(input, signal);
  if (!result.ok) throw result.error;
  let text = "";
  let usage: UsageSummary | undefined;
  while (true) {
    const { value, done } = await result.value.next();
    if (done) break;
    if (value.type === "text-delta") text += value.text;
    else usage = value.usage;
  }
  text = text.trim();
  if (!text) throw new TextGenerationError("empty-response", "Text coach returned no answer", true);
  return { text: text.slice(0, 1_200), usage };
}

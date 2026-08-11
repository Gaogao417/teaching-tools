import { SYSTEM_PROMPT } from "./claudeCodeCoachService";
import type { ClaudeCoachInput } from "./claudeCodeCoachService";
import { SpeechProviderError } from "./qwenSpeechService";

/**
 * Omni answer provider. A single Qwen3.5-Omni call replaces the
 * ASR → LLM → TTS triplet: the student's audio is understood inline and the
 * model emits both the display text and a spoken reply. Because the omni model
 * speaks directly, the TTS persona is folded into the system prompt here.
 */
const OMNI_VOICE_STYLE = `
语音风格：像耐心的中学数学老师一样讲解——语速稍慢，停顿自然，重点清楚，语气鼓励但不夸张。
输出文本时，涉及数学请在文本里用 $...$ 写内联 LaTeX 以便页面显示，但你朗读时要自然口语化，不要念 LaTeX 命令或美元符号。`;

const OMNI_SYSTEM_PROMPT = `${SYSTEM_PROMPT}${OMNI_VOICE_STYLE}`;

/** DashScope qwen-omni emits raw PCM (24 kHz mono 16-bit) across streamed chunks. */
const OMNI_AUDIO_SAMPLE_RATE = 24_000;

export interface OmniCoachInput extends ClaudeCoachInput {}

export interface OmniCoachOutput {
  /** Display copy for the page (may contain inline $...$ LaTeX). Empty if the model produced nothing. */
  messageLatex: string;
  /** Assembled WAV audio, base64-encoded for an inline data URL. Empty string if no audio was returned. */
  audioWavBase64: string;
  model: string;
  voice: string;
}

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new SpeechProviderError("DASHSCOPE_API_KEY is not configured");
  return key;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * Ensure raw PCM bytes are playable in an <audio> element. If DashScope already
 * framed the stream as a full WAV (RIFF header present) the buffer is returned
 * unchanged; otherwise we prepend a minimal 24 kHz mono 16-bit WAV header.
 */
function toWavBuffer(buffer: Buffer): Buffer {
  if (buffer.length >= 44 && buffer.slice(0, 4).toString("ascii") === "RIFF") return buffer;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.write("WAVE", 8, "ascii");
  header.writeUInt32LE(36 + buffer.length, 4);
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // sub-chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(OMNI_AUDIO_SAMPLE_RATE, 24);
  header.writeUInt32LE(OMNI_AUDIO_SAMPLE_RATE * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(buffer.length, 40);
  return Buffer.concat([header, buffer]);
}

export async function conductOmniCoach(
  input: OmniCoachInput,
  studentAudio?: { dataUrl: string },
): Promise<OmniCoachOutput> {
  const model = process.env.COACH_OMNI_MODEL?.trim() || "qwen3.5-omni-plus";
  // "Cherry" belongs to qwen3-tts and is rejected by qwen-omni audio output; the
  // valid omni voices include Tina / Ethan / Serena (see docs). Tina is a natural
  // female voice that fits the patient-teacher persona.
  const voice = process.env.COACH_OMNI_VOICE?.trim() || "Tina";
  const baseUrl = trimTrailingSlash(
    process.env.DASHSCOPE_COMPATIBLE_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1",
  );
  const timeoutMs = Number(process.env.COACH_OMNI_TIMEOUT_MS || 45_000);

  // The user turn carries the serialized teaching context as text plus, when the
  // student spoke, exactly one audio part — satisfying qwen-omni's "text + one
  // other modality" constraint per turn.
  const userContent: Array<Record<string, unknown>> = [];
  if (studentAudio?.dataUrl) {
    userContent.push({ type: "input_audio", input_audio: { data: studentAudio.dataUrl } });
  }
  userContent.push({ type: "text", text: JSON.stringify(input) });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: OMNI_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        modalities: ["text", "audio"],
        audio: { voice, format: "wav" },
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new SpeechProviderError(error instanceof Error ? error.message : "Qwen Omni request failed");
  }

  if (!response.ok || !response.body) {
    clearTimeout(timer);
    const detail = await response.text().catch(() => "");
    throw new SpeechProviderError(`Qwen Omni request failed (${response.status}) ${detail.slice(0, 500)}`);
  }

  // stream=true is mandatory for qwen-omni: consume SSE, accumulating the text
  // delta and decoding each base64 audio fragment into bytes immediately (base64
  // fragments are not safe to concatenate as strings across chunk boundaries).
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const audioFragments: Buffer[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        let chunk: Record<string, any>;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue; // tolerate partial JSON across reads
        }
        // Surface provider-side errors instead of silently finishing with no text.
        if (chunk.error) {
          const reason = typeof chunk.error.message === "string" ? chunk.error.message : JSON.stringify(chunk.error);
          throw new SpeechProviderError(`Qwen Omni stream error: ${reason}`.slice(0, 500));
        }
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === "string") text += delta.content;
        if (typeof delta.audio?.data === "string" && delta.audio.data.length > 0) {
          audioFragments.push(Buffer.from(delta.audio.data, "base64"));
        }
      }
    }
  } catch (error) {
    clearTimeout(timer);
    throw new SpeechProviderError(error instanceof Error ? error.message : "Qwen Omni stream failed");
  } finally {
    clearTimeout(timer);
  }

  const messageLatex = text.trim().slice(0, 1_200);
  if (!messageLatex) throw new SpeechProviderError("Qwen Omni returned no text");
  const audioWavBase64 = audioFragments.length > 0 ? toWavBuffer(Buffer.concat(audioFragments)).toString("base64") : "";
  return { messageLatex, audioWavBase64, model, voice };
}

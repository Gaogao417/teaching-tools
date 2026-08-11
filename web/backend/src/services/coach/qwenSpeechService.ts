const DEFAULT_DASHSCOPE_API_URL = "https://dashscope.aliyuncs.com/api/v1";
const DEFAULT_DASHSCOPE_COMPATIBLE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_AUDIO_DURATION_MS = 60_000;

export class SpeechProviderError extends Error {}

function apiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new SpeechProviderError("DASHSCOPE_API_KEY is not configured");
  return key;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function validateAudioDataUrl(dataUrl: string, durationMs?: number): void {
  const match = /^data:audio\/[a-z0-9.+-]+(?:;codecs=[^;,]+)?;base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new SpeechProviderError("Unsupported audio data URL");
  const estimatedBytes = Math.floor(match[1].length * 0.75);
  if (estimatedBytes <= 0 || estimatedBytes > MAX_AUDIO_BYTES) {
    throw new SpeechProviderError("Audio must be between 1 byte and 10 MB");
  }
  if (durationMs !== undefined && durationMs > MAX_AUDIO_DURATION_MS) {
    throw new SpeechProviderError("Audio must be no longer than 60 seconds");
  }
}

async function postJson(url: string, payload: unknown, timeoutMs = 45_000): Promise<Record<string, any>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as Record<string, any> | null;
    if (!response.ok || !body) {
      throw new SpeechProviderError(`DashScope request failed (${response.status})`);
    }
    return body;
  } catch (error) {
    if (error instanceof SpeechProviderError) throw error;
    throw new SpeechProviderError(error instanceof Error ? error.message : "DashScope request failed");
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeStudentAudio(input: { dataUrl: string; durationMs?: number }): Promise<{
  transcript: string;
  model: string;
}> {
  validateAudioDataUrl(input.dataUrl, input.durationMs);
  const model = process.env.COACH_ASR_MODEL?.trim() || "qwen3-asr-flash";
  const baseUrl = trimTrailingSlash(process.env.DASHSCOPE_COMPATIBLE_BASE_URL?.trim() || DEFAULT_DASHSCOPE_COMPATIBLE_URL);
  const body = await postJson(`${baseUrl}/chat/completions`, {
    model,
    messages: [{
      role: "user",
      content: [{ type: "input_audio", input_audio: { data: input.dataUrl } }],
    }],
    stream: false,
    asr_options: { language: "zh", enable_itn: true },
  });
  const content = body.choices?.[0]?.message?.content;
  const transcript = typeof content === "string" ? content.trim() : "";
  if (!transcript) throw new SpeechProviderError("Qwen ASR returned an empty transcript");
  return { transcript, model };
}

function secureAudioUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") throw new SpeechProviderError("Qwen TTS returned an invalid audio URL");
  return url.toString();
}

export async function synthesizeCoachSpeech(text: string): Promise<{
  audioUrl: string;
  model: string;
  voice: string;
  expiresAt?: number;
}> {
  const spokenText = text.trim().slice(0, 600);
  if (!spokenText) throw new SpeechProviderError("TTS text is empty");
  const model = process.env.COACH_TTS_MODEL?.trim() || "qwen3-tts-instruct-flash";
  const voice = process.env.COACH_TTS_VOICE?.trim() || "Cherry";
  const baseUrl = trimTrailingSlash(process.env.DASHSCOPE_API_BASE_URL?.trim() || DEFAULT_DASHSCOPE_API_URL);
  const body = await postJson(`${baseUrl}/services/aigc/multimodal-generation/generation`, {
    model,
    input: {
      text: spokenText,
      voice,
      language_type: "Chinese",
      ...(model.includes("instruct") ? {
        instructions: "像耐心的中学数学老师一样讲解：语速稍慢，停顿自然，重点清楚，语气鼓励但不夸张。",
        optimize_instructions: true,
      } : {}),
    },
  });
  const audio = body.output?.audio;
  if (!audio || typeof audio.url !== "string") {
    throw new SpeechProviderError("Qwen TTS returned no audio URL");
  }
  return {
    audioUrl: secureAudioUrl(audio.url),
    model,
    voice,
    ...(typeof audio.expires_at === "number" ? { expiresAt: audio.expires_at } : {}),
  };
}

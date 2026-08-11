import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { SpeechProviderError } from "./qwenSpeechService";

/**
 * CosyVoice-v3-plus speech synthesis over DashScope's duplex WebSocket.
 *
 * Unlike the REST text→URL TTS, CosyVoice streams raw audio as WebSocket
 * binary frames; we assemble them into a single MP3 and return it inline as a
 * data URL (the coach <audio> element accepts data URLs, so no hosting route is
 * needed). Verified: the generic wss://dashscope.aliyuncs.com/api-ws/v1/inference/
 * host accepts a plain DashScope key (no workspace id required), and binary
 * frames concatenate directly into a valid mp3 (22050 Hz mono).
 */

export interface CosyVoiceOutput {
  audioUrl: string;
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

export async function synthesizeCosyVoice(text: string): Promise<CosyVoiceOutput> {
  const spokenText = text.trim().slice(0, 600);
  if (!spokenText) throw new SpeechProviderError("CosyVoice text is empty");
  const model = process.env.COACH_COSY_MODEL?.trim() || "cosyvoice-v3-plus";
  const voice = process.env.COACH_COSY_VOICE?.trim() || "longanyang";
  const baseUrl = trimTrailingSlash(
    process.env.DASHSCOPE_WS_BASE_URL?.trim() || "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
  );
  const timeoutMs = Number(process.env.COACH_COSY_TIMEOUT_MS || 45_000);

  return new Promise<CosyVoiceOutput>((resolve, reject) => {
    const taskId = randomUUID();
    const fragments: Buffer[] = [];
    let settled = false;

    const ws = new WebSocket(baseUrl, {
      headers: {
        Authorization: `bearer ${apiKey()}`,
        "X-DashScope-DataInspection": "enable",
      },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch { /* ignore */ }
      reject(new SpeechProviderError(`CosyVoice timed out after ${timeoutMs}ms`));
    }, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45_000);

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch { /* ignore */ }
      reject(new SpeechProviderError(message));
    };
    const done = (output: CosyVoiceOutput) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      resolve(output);
    };

    ws.on("open", () => {
      ws.send(JSON.stringify({
        header: { action: "run-task", task_id: taskId, streaming: "duplex" },
        payload: {
          task_group: "audio",
          task: "tts",
          function: "SpeechSynthesizer",
          model,
          parameters: { text_type: "PlainText", voice, format: "mp3", sample_rate: 22050 },
          input: {},
        },
      }));
      ws.send(JSON.stringify({
        header: { action: "continue-task", task_id: taskId, streaming: "duplex" },
        payload: { input: { text: spokenText } },
      }));
      ws.send(JSON.stringify({
        header: { action: "finish-task", task_id: taskId, streaming: "duplex" },
        payload: { input: {} },
      }));
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        fragments.push(Buffer.from(data as Uint8Array));
        return;
      }
      let message: Record<string, any>;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return; // tolerate non-JSON text frames
      }
      const event = message?.header?.event;
      if (event === "task-failed") {
        const reason = message?.header?.error_message
          || message?.header?.error
          || JSON.stringify(message).slice(0, 300);
        fail(`CosyVoice task-failed: ${reason}`);
        return;
      }
      if (event === "task-finished") {
        const audio = Buffer.concat(fragments);
        if (audio.length === 0) {
          fail("CosyVoice produced no audio");
          return;
        }
        done({ audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`, model, voice });
      }
    });

    ws.on("error", (error: Error) => fail(error.message || "CosyVoice WebSocket error"));
    ws.on("close", () => {
      // If the socket closes before we explicitly resolve, treat as failure
      // unless we already settled on task-finished.
      fail("CosyVoice socket closed before task-finished");
    });
  });
}

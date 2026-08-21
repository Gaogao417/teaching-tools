/**
 * 回合级 correlation telemetry（Phase 5 remediation / 完整收口计划 §2.6）。
 *
 * 每轮以 correlation ID 关联 ASR、alignment、policy、TTS、token usage、
 * fallback 与 validation failure——口径沿 coach telemetry（结构化 JSON 行，
 * 旁路写出，绝不阻塞教学回合；失败静默吞掉并计数）。
 *
 * 写入面：JSONL 追加（默认 data/tutor-turn-telemetry.jsonl；
 * TUTOR_TELEMETRY_DIR 重定向，TUTOR_TELEMETRY=off 关闭）。事件流本身仍是
 * 唯一状态真源，本模块只是观测旁路。
 */
import { appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";

export type TurnTelemetryStage =
  | "turn"
  | "asr"
  | "alignment"
  | "policy"
  | "tts"
  | "validation"
  | "fallback"
  | "restore";

export interface TurnTelemetryEntry {
  correlation_id: string;
  session_id: string;
  stage: TurnTelemetryStage;
  /** 事件或 telemetry 至少其一的「事件」锚（sequence）。 */
  event_sequence?: number;
  client_turn_id?: string;
  outcome?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  model_calls?: number;
  detail?: Record<string, unknown>;
  recorded_at: string;
}

const memoryBuffer: TurnTelemetryEntry[] = [];
let droppedCount = 0;

function telemetryFilePath(): string | null {
  if (process.env.TUTOR_TELEMETRY === "off") return null;
  const dir = process.env.TUTOR_TELEMETRY_DIR ?? path.resolve(process.cwd(), "data");
  return path.join(dir, "tutor-turn-telemetry.jsonl");
}

/** 追加一条 telemetry（旁路：IO 失败只计数，不影响回合）。 */
export function recordTurnTelemetry(entry: Omit<TurnTelemetryEntry, "recorded_at">): void {
  const full: TurnTelemetryEntry = { ...entry, recorded_at: new Date().toISOString() };
  memoryBuffer.push(full);
  if (memoryBuffer.length > 500) memoryBuffer.shift();
  const file = telemetryFilePath();
  if (!file) return;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(full)}\n`, "utf8");
  } catch {
    droppedCount += 1;
  }
}

/** 测试/观测读取：进程内最近 telemetry（不读文件）。 */
export function recentTurnTelemetry(limit = 50): TurnTelemetryEntry[] {
  return memoryBuffer.slice(-limit);
}

export function droppedTelemetryCount(): number {
  return droppedCount;
}

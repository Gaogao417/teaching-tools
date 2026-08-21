/**
 * tutor 会话 ASR 服务面（Phase 5 remediation 波次 E）。
 *
 * transport 层不得 import provider 客户端（ADR-005 层边界，由
 * coach/layerBoundaries.test 结构性强制）——Qwen ASR 的具体调用收敛在这
 * 个 service 模块内；HTTP 路由只依赖本模块。
 */
import { SpeechProviderError, transcribeStudentAudio } from "../coach/qwenSpeechService";

export { SpeechProviderError };

export function transcribeForTutor(input: {
  dataUrl: string;
  durationMs?: number;
}): Promise<{ transcript: string; model: string }> {
  return transcribeStudentAudio(input);
}

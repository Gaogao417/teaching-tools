import { useCallback, useEffect, useRef, useState } from "react";
import type { CaptureLease, MediaSessionController } from "../audio/MediaSessionController";

const MAX_RECORDING_MS = 45_000;

/** 录音产物（legacy CoachAudioInput 的超集：canonical /asr 请求必带
 *  mime_type——F7 Step 8；legacy 调用方不消费该字段）。 */
export interface RecorderAudioInput {
  dataUrl: string;
  durationMs?: number;
  /** MediaRecorder 实际封装格式（如 audio/webm;codecs=opus；回退 audio/webm）。 */
  mimeType?: string;
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Audio conversion failed"));
    reader.onerror = () => reject(reader.error || new Error("Audio conversion failed"));
    reader.readAsDataURL(blob);
  });
}
function recordingMimeType(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"]
    .find((mimeType) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType));
}

export function useCoachRecorder(options: {
  /** 实例标识（诊断/测试定位双 mic 接线：coach=assistance 通道、answer=mainline 通道）。 */
  owner?: "coach" | "answer";
  disabled: boolean;
  /** Shared media session used to arbitrate exclusive microphone capture
   *  (ADR-005 §Exclusive media session). When provided, a capture lease is
   *  acquired before `getUserMedia` and released on stop/failure. */
  media?: MediaSessionController;
  /** F7 Step 8：录音真正开始（MediaRecorder.start 已生效）时回调——通道锁定
   *  与 {sessionId, revision} 捕获点（录音开始后 revision 变化不得悄悄更新
   *  捕获值）。权限拒绝/设备失败不触发。 */
  onRecordingStart?: () => void;
  /** F7 Step 8：录音与 Voice 播放共享同一媒体 session 的互斥——录音开始即
   *  停止当前 narration 播放（canonical；legacy 缺省不改变行为）。 */
  interruptPlaybackOnStart?: boolean;
  /** capture lease 被占（双 mic 互斥/实时通话占用）时的提示文案。 */
  captureBusyMessage?: string;
  onAudio: (audio: RecorderAudioInput) => void;
  onError: (message: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const lease = useRef<CaptureLease | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const epoch = useRef(0);
  const starting = useRef(false);

  const releaseLease = useCallback(() => {
    lease.current?.release();
    lease.current = null;
  }, []);

  const stop = useCallback(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  const toggle = useCallback(async () => {
    if (recorder.current?.state === "recording") { stop(); return; }
    if (starting.current || recorder.current) return;
    if (options.disabled || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      options.onError("这个浏览器暂不支持录音，请先用文字提问。"); return;
    }
    // ADR-005 §Exclusive media session: acquire the mic before getUserMedia.
    // A live session holding the mic denies this — the recorder MUST NOT call
    // getUserMedia in that case (capture is mutually exclusive, not just UI-disabled).
    const captureLease = options.media?.acquireCapture("coach-turn") ?? null;
    if (options.media && !captureLease) {
      options.onError(options.captureBusyMessage ?? "实时通话正在进行，无法同时录音，请先结束通话。");
      return;
    }
    lease.current = captureLease;
    starting.current = true;
    const attemptEpoch = epoch.current;
    const live = () => attemptEpoch === epoch.current;
    let acquiredStream: MediaStream | undefined;
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = mediaStream;
      if (!live()) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      const mimeType = recordingMimeType();
      const mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder; stream.current = mediaStream;
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      mediaRecorder.ondataavailable = (event) => { if (live() && event.data.size) chunks.push(event.data); };
      mediaRecorder.onstop = () => {
        if (!live()) return;
        const durationMs = Date.now() - startedAt;
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        timer.current = undefined; setRecording(false); mediaStream.getTracks().forEach((track) => track.stop());
        stream.current = null; recorder.current = null;
        releaseLease();
        // Keep this recorder single-flight until its output has been handed off;
        // a second capture must not overwrite the first capture's channel ref.
        starting.current = true;
        const containerType = mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: containerType });
        void blobDataUrl(blob)
          .then((dataUrl) => { if (live()) options.onAudio({ dataUrl, durationMs, mimeType: containerType }); })
          .catch(() => { if (live()) options.onError("录音没有保存成功，请再试一次。"); })
          .finally(() => { if (live()) starting.current = false; });
      };
      mediaRecorder.start(250); setRecording(true);
      // F7 Step 8：录音真正开始——先锁定通道/捕获快照，再按互斥停掉当前
      // narration 播放（共享同一媒体 session；停止引发的 interrupted outcome
      // 由 Step 6 PresentationRuntime 链如实上报）。
      options.onRecordingStart?.();
      if (options.interruptPlaybackOnStart) options.media?.stop("narration");
      timer.current = window.setTimeout(stop, MAX_RECORDING_MS);
    } catch {
      // Permission denied / device error: release the lease so the mic is free
      // and surface a user-facing message without throwing into the training path.
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (!live()) return;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        stop();
      }
      recorder.current = null;
      stream.current = null;
      setRecording(false);
      releaseLease();
      options.onError("没有获得麦克风权限，请允许录音或改用文字提问。");
    } finally {
      if (live()) starting.current = false;
    }
  }, [options, releaseLease, stop]);

  useEffect(() => () => {
    // Invalidate permission and FileReader continuations before releasing hardware.
    epoch.current += 1;
    starting.current = false;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (recorder.current) recorder.current.onstop = null;
    stop(); stream.current?.getTracks().forEach((track) => track.stop());
    recorder.current = null;
    stream.current = null;
    timer.current = undefined;
    releaseLease();
  }, [stop, releaseLease]);
  return { recording, toggle, stop };
}

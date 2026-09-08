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

/**
 * getUserMedia 失败分类（F7 P3 / FM-1-3、FM-1-4）：权限拒绝与设备不可用是
 * 不同的故障（fault matrix F1），同一条「没有权限」文案会误导无设备/设备忙的
 * 用户。按 DOMException name 分类；未知失败保持权限文案（不静默、不伪造空
 * 音频继续）。三类都零录音零上报（catch 路径不产生 onAudio）。
 */
export function recorderStartErrorMessage(failure: unknown): string {
  const name = failure instanceof Error || failure instanceof DOMException ? failure.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") {
    return "未检测到可用的麦克风设备，请检查设备连接或改用文字提问。";
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return "麦克风暂时无法使用（可能被其他应用占用），请稍后再试或改用文字提问。";
  }
  return "没有获得麦克风权限，请允许录音或改用文字提问。";
}

export function useCoachRecorder(options: {
  /** 实例标识（诊断/测试定位双 mic 接线：coach=assistance 通道、answer=mainline 通道）。 */
  owner?: "coach" | "answer";
  disabled: boolean;
  /** Shared media session used to arbitrate exclusive microphone capture
   *  (ADR-005 §Exclusive media session). When provided, a capture lease is
   *  acquired before `getUserMedia` and released on stop/failure. */
  media?: MediaSessionController;
  /** F7 P2（R5 裁定时序）：录音启动前置门——真实录音开始前先完成 barge-in
   *  握手（①中断 adapter ②interrupted outcome+采用新 snapshot ③control.
   *  barge_in）。返回 false（等待失败）则不占麦克风、不开录。异常同样按
   *  false 处理并经 onError 给出可见提示（hardening：不静默吞异常）。 */
  beforeStart?: () => Promise<boolean>;
  /** F7 Step 8：录音真正开始（MediaRecorder.start 已生效）时回调——通道锁定
   *  与 {sessionId, revision} 捕获点（录音开始后 revision 变化不得悄悄更新
   *  捕获值）。权限拒绝/设备失败不触发。 */
  onRecordingStart?: () => void;
  /** F7 Step 8：录音与 Voice 播放共享同一媒体 session 的互斥——录音开始即
   *  停止当前 narration 播放（canonical；legacy 缺省不改变行为）。F7 P2 后
   *  与挂起规则（录音期间到达的 narration 停队首延迟起播）合并为媒体 session
   *  单一互斥；本路径保留为 capture-first 兜底（barge-in 握手竞态/不可中断
   *  narration 在播时生效）。 */
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
  const onError = useRef(options.onError);
  onError.current = options.onError;

  const releaseLease = useCallback(() => {
    lease.current?.release();
    lease.current = null;
  }, []);

  // Invalidate callbacks before stopping hardware: an error can be followed by
  // dataavailable/onstop with a partial recording, and stop itself may throw.
  const discard = useCallback((message?: string) => {
    epoch.current += 1;
    starting.current = false;
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
    const currentRecorder = recorder.current;
    const currentStream = stream.current;
    recorder.current = null;
    stream.current = null;
    if (currentRecorder) {
      currentRecorder.onstop = null;
      currentRecorder.ondataavailable = null;
      currentRecorder.onerror = null;
      try { if (currentRecorder.state === "recording") currentRecorder.stop(); } catch { /* discard still releases hardware/lease */ }
    }
    currentStream?.getTracks().forEach(track => track.stop());
    releaseLease();
    setRecording(false);
    if (message) onError.current(message);
  }, [releaseLease]);

  const stop = useCallback(() => {
    try { if (recorder.current?.state === "recording") recorder.current.stop(); }
    catch { discard("录音没有保存成功，请再试一次或改用文字输入。"); }
  }, [discard]);
  const toggle = useCallback(async () => {
    if (recorder.current?.state === "recording") { stop(); return; }
    if (starting.current || recorder.current) return;
    if (options.disabled || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      options.onError("这个浏览器暂不支持录音，请先用文字提问。"); return;
    }
    starting.current = true;
    const attemptEpoch = ++epoch.current;
    const live = () => attemptEpoch === epoch.current;
    let acquiredStream: MediaStream | undefined;
    try {
      // F7 P2（R5 裁定时序）：先完成 barge-in 握手再占麦克风/开录；等待失败
      // 不录音（此时尚未占用任何资源，直接返回）。
      let gate = true;
      if (options.beforeStart) {
        try {
          gate = await options.beforeStart();
        } catch {
          // hardening（P2-A 返工附带）：门异常不放行（不占麦克风），但不再
          // 静默吞掉——给出可见提示，与 settle.failed 的提示路径一致。
          gate = false;
          options.onError("录音前的打断握手出现问题，请再试一次或改用文字输入。");
        }
      }
      if (!live()) return;
      if (!gate) return;
      // ADR-005 §Exclusive media session: acquire the mic before getUserMedia.
      // A live session holding the mic denies this — the recorder MUST NOT call
      // getUserMedia in that case (capture is mutually exclusive, not just UI-disabled).
      const captureLease = options.media?.acquireCapture("coach-turn") ?? null;
      if (options.media && !captureLease) {
        options.onError(options.captureBusyMessage ?? "实时通话正在进行，无法同时录音，请先结束通话。");
        return;
      }
      lease.current = captureLease;
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquiredStream = mediaStream;
      if (!live()) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = mediaStream;
      const mimeType = recordingMimeType();
      const mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder;
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      let settled = false;
      mediaRecorder.ondataavailable = (event) => { if (live() && !settled && event.data.size) chunks.push(event.data); };
      mediaRecorder.onerror = () => {
        if (!live() || settled) return;
        settled = true;
        discard("录音过程中发生错误，请再试一次或改用文字输入。");
      };
      mediaRecorder.onstop = () => {
        if (!live() || settled) return;
        settled = true;
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
        if (blob.size === 0) {
          discard("没有录到有效音频，请再试一次或改用文字输入。");
          return;
        }
        void blobDataUrl(blob)
          .then((dataUrl) => { if (live()) options.onAudio({ dataUrl, durationMs, mimeType: containerType }); })
          .catch(() => { if (live()) options.onError("录音没有保存成功，请再试一次。"); })
          .finally(() => { if (live()) starting.current = false; });
      };
      mediaRecorder.start(250);
      if (!live()) return;
      setRecording(true);
      // F7 Step 8：录音真正开始——先锁定通道/捕获快照，再按互斥停掉当前
      // narration 播放（共享同一媒体 session；停止引发的 interrupted outcome
      // 由 Step 6 PresentationRuntime 链如实上报）。
      options.onRecordingStart?.();
      if (options.interruptPlaybackOnStart) options.media?.stop("narration");
      timer.current = window.setTimeout(() => { if (live()) stop(); }, MAX_RECORDING_MS);
    } catch (failure) {
      // Permission denied / device error: release the lease so the mic is free
      // and surface a user-facing message without throwing into the training path.
      if (!live()) return;
      discard(acquiredStream
        ? "录音无法启动，请再试一次或改用文字输入。"
        : recorderStartErrorMessage(failure));
    } finally {
      if (live()) starting.current = false;
    }
  }, [options, releaseLease, stop, discard]);

  useEffect(() => () => { discard(); }, [discard]);
  return { recording, toggle, stop };
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { CoachAudioInput } from "../../../../shared/actionRuntime";

const MAX_RECORDING_MS = 45_000;

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

export function useCoachRecorder(options: { disabled: boolean; onAudio: (audio: CoachAudioInput) => void; onError: (message: string) => void }) {
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const stop = useCallback(() => { if (recorder.current?.state === "recording") recorder.current.stop(); }, []);
  const toggle = useCallback(async () => {
    if (recording) { stop(); return; }
    if (options.disabled || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      options.onError("这个浏览器暂不支持录音，请先用文字提问。"); return;
    }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = recordingMimeType();
      const mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder; stream.current = mediaStream; chunks.current = []; startedAt.current = Date.now();
      mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      mediaRecorder.onstop = () => {
        const durationMs = Date.now() - startedAt.current;
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        timer.current = undefined; setRecording(false); mediaStream.getTracks().forEach((track) => track.stop());
        stream.current = null; recorder.current = null;
        const blob = new Blob(chunks.current, { type: mediaRecorder.mimeType || "audio/webm" });
        void blobDataUrl(blob).then((dataUrl) => options.onAudio({ dataUrl, durationMs })).catch(() => options.onError("录音没有保存成功，请再试一次。"));
      };
      mediaRecorder.start(250); setRecording(true);
      timer.current = window.setTimeout(stop, MAX_RECORDING_MS);
    } catch { options.onError("没有获得麦克风权限，请允许录音或改用文字提问。"); }
  }, [options, recording, stop]);

  useEffect(() => () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    if (recorder.current) recorder.current.onstop = null;
    stop(); stream.current?.getTracks().forEach((track) => track.stop());
  }, [stop]);
  return { recording, toggle, stop };
}

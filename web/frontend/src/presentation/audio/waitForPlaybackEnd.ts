/**
 * F7 Step 6 从 useTutorLearning 抽取的播放等待器（legacy 语义原样保留）。
 *
 * 返回值新增 "blocked"（blocked-by-autoplay 不再折算成 done）——canonical
 * PresentationRuntime 不得复用本等待器作为完成证据：它只观察聚合状态
 * （loading/playing → idle），无法区分 `ended` 与 `stopped`，idle 不等价于
 * 播完。canonical 等待器按 MediaPlaybackEvent + generation 绑定（见
 * presentationRuntime/adapters/voicePresentationAdapter）。
 */
import type { MediaSessionController } from "./MediaSessionController";

export type PlaybackWaitResult = "done" | "cancelled" | "error" | "blocked";

export function waitForPlaybackEnd(
  media: MediaSessionController,
  isCancelled: () => boolean,
  timeoutMs = 10 * 60_000,
): Promise<PlaybackWaitResult> {
  const initialStatus = media.getState().status;
  let sawActive = initialStatus === "loading" || initialStatus === "playing";
  return new Promise((resolve) => {
    const finish = (result: PlaybackWaitResult) => {
      window.clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const timer = window.setTimeout(() => finish("done"), timeoutMs);
    const unsubscribe = media.subscribe((state) => {
      if (isCancelled()) finish("cancelled");
      else if (state.status === "loading" || state.status === "playing") sawActive = true;
      else if (sawActive && state.status === "error") finish("error");
      else if (sawActive && state.status === "idle") finish("done");
      else if (state.status === "blocked-by-autoplay" && sawActive) finish("blocked");
    });
  });
}

/** legacy 折算：blocked 视作已交付（音频已就绪，可手动 replay）——与抽取前
 *  行为逐分支等价，仅供 legacy 呈现管线。 */
export function waitForPlaybackEndLegacy(
  media: MediaSessionController,
  isCancelled: () => boolean,
  timeoutMs = 10 * 60_000,
): Promise<"done" | "cancelled" | "error"> {
  return waitForPlaybackEnd(media, isCancelled, timeoutMs).then((result) => (result === "blocked" ? "done" : result));
}

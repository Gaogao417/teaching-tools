import { useEffect, useRef, useState } from "react";
import type { ActionContract, ExercisePlan } from "../../../../shared/actionRuntime";
import { api } from "../../api/client";
import { teacherCopyForAction } from "../projection/teacherCopy";

export interface TeacherSpeech {
  /** URL of the currently loaded teacher voice, if any (enables the replay button). */
  speechUrl: string | undefined;
  /** Whether teacher voice is currently playing (drives peripheral indicators). */
  speaking: boolean;
  /** Replay the current teacher voice. A user gesture, so autoplay is allowed. */
  replay(): void;
  /** Play an externally-produced voice URL (e.g. an AI coach reply). */
  speak(url: string): void;
  /** Stop any in-flight voice. */
  stop(): void;
}

/**
 * Deterministic teacher-voice controller for Action Runtime.
 *
 * - Listens only to REAL action/exercise switches (effect deps on action/exercise
 *   identity), never to arbitrary React renders.
 * - Auto-speaks the deterministic teacher copy once per action entry.
 * - Cancels any in-flight voice when the action changes.
 * - Reuses the backend Qwen TTS provider via the direct `/api/action-speech`
 *   endpoint; it never invokes the AI coach for deterministic text.
 * - Autoplay may be blocked by the browser until the user has interacted with
 *   the page. A blocked play silently degrades to a clickable replay and never
 *   surfaces an error or blocks the runtime.
 *
 * Mode policy: Learn auto-plays; Guided Practice synthesizes for replay but does
 * not force autoplay; Assessment does not auto-read teaching text at all.
 */
export function useTeacherSpeech(plan: ExercisePlan, action: ActionContract): TeacherSpeech {
  const mode = plan.mode;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [speechUrl, setSpeechUrl] = useState<string | undefined>(undefined);
  const [speaking, setSpeaking] = useState(false);
  const lastEnteredActionId = useRef<string | undefined>(undefined);
  // Monotonic request token: bumped on each new action and on each external
  // speak(), so a stale synthesis result can never override a newer voice.
  const requestSeq = useRef(0);

  const ensureAudio = () => {
    if (audioRef.current || typeof Audio === "undefined") return;
    const audio = new Audio();
    audio.preload = "auto";
    audioRef.current = audio;
  };

  const detachHandlers = (audio: HTMLAudioElement) => {
    audio.onplay = null;
    audio.onpause = null;
    audio.onended = null;
    audio.onerror = null;
  };

  const stop = () => {
    const audio = audioRef.current;
    if (audio) {
      detachHandlers(audio);
      audio.pause();
    }
    setSpeaking(false);
  };

  const playInternal = (url: string, autoplay: boolean) => {
    ensureAudio();
    const audio = audioRef.current;
    setSpeechUrl(url);
    if (!audio) return;
    detachHandlers(audio);
    audio.onplay = () => setSpeaking(true);
    audio.onpause = () => setSpeaking(false);
    audio.onended = () => setSpeaking(false);
    audio.onerror = () => setSpeaking(false);
    audio.src = url;
    if (autoplay) {
      // Autoplay can reject before the user has gestured; degrade silently.
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") promise.catch(() => setSpeaking(false));
    }
  };

  useEffect(() => {
    // Stop the previous voice the moment the action actually changes.
    stop();
    if (mode === "assessment") return;
    if (action.actionId === lastEnteredActionId.current) return;
    lastEnteredActionId.current = action.actionId;

    const autoSpeak = mode === "learn"; // Guided Practice: replay-only, no forced autoplay.
    const mine = ++requestSeq.current;
    const copy = teacherCopyForAction(plan, action);
    api.synthesizeActionSpeech({ text: copy.spokenText })
      .then((speech) => {
        if (mine !== requestSeq.current) return; // superseded by a newer action/reply
        playInternal(speech.audioUrl, autoSpeak);
      })
      .catch(() => {
        /* Silent degrade: replay simply stays unavailable for this entry. */
      });
  }, [action.actionId, plan.exerciseId, plan.revision, mode]);

  // Stop audio when the component unmounts.
  useEffect(() => () => stop(), []);

  const replay = () => {
    if (speechUrl) playInternal(speechUrl, true);
  };
  const speak = (url: string) => {
    requestSeq.current += 1; // a coach reply supersedes any pending entry synthesis
    playInternal(url, true);
  };

  return { speechUrl, speaking, replay, speak, stop };
}

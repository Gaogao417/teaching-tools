import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionContract, ExercisePlan } from "../../../../shared/actionRuntime";
import { SPEECH_TEXT_VERSION } from "../../../../shared/speechText";
import { api } from "../../api/client";
import { MediaSessionController, type MediaSessionState } from "../audio/MediaSessionController";
import { NarrationController } from "./NarrationController";
import { teacherCopyForAction } from "../../action-runtime/projection/teacherCopy";
const SPEECH_PROFILE_VERSION = "teacher-zh-v1";

export interface TeacherSpeech {
  speechUrl: string | undefined;
  speaking: boolean;
  autoplayBlocked: boolean;
  replay(): void;
  speak(url: string): void;
  stop(): void;
}

/** Deterministic Action narration with cancellation, bounded prefetch/cache and exclusive playback. */
export function useTeacherSpeech(plan: ExercisePlan, action: ActionContract, sharedMedia?: MediaSessionController): TeacherSpeech {
  const ownedMedia = useMemo(() => new MediaSessionController(), []);
  const media = sharedMedia || ownedMedia;
  const narrationTransport = plan.runtimeCapabilities?.narrationTransport || "url";
  const narration = useMemo(() => new NarrationController({
    synthesize: (text, signal, correlationId) => narrationTransport === "stream"
      ? api.streamActionSpeech({ text, correlationId }, signal)
      : api.synthesizeActionSpeech({ text, correlationId }, signal),
  }, media), [media, narrationTransport]);
  const [speechUrl, setSpeechUrl] = useState<string>();
  const [mediaState, setMediaState] = useState<MediaSessionState>(media.getState());
  const lastEnteredActionId = useRef<string | undefined>(undefined);

  useEffect(() => media.subscribe(setMediaState), [media]);

  useEffect(() => {
    narration.stop();
    setSpeechUrl(undefined);
    if (plan.mode === "assessment" || plan.runtimeCapabilities?.narrationTransport === "off" || action.actionId === lastEnteredActionId.current) return;
    lastEnteredActionId.current = action.actionId;
    const copy = teacherCopyForAction(plan, action);
    const index = plan.actions.findIndex((candidate) => candidate.actionId === action.actionId);
    const nextAction = plan.actions[index + 1];
    const nextCopy = nextAction ? teacherCopyForAction(plan, nextAction) : undefined;
    void narration.enter({
      utteranceId: action.actionId,
      spokenText: copy.spokenText,
      cacheKey: `${SPEECH_PROFILE_VERSION}:speech-v${SPEECH_TEXT_VERSION}:${copy.spokenText}`,
    }, nextAction && nextCopy ? {
      utteranceId: nextAction.actionId,
      spokenText: nextCopy.spokenText,
      cacheKey: `${SPEECH_PROFILE_VERSION}:speech-v${SPEECH_TEXT_VERSION}:${nextCopy.spokenText}`,
    } : undefined, plan.mode === "learn").then((url) => { if (url) setSpeechUrl(url); });
  }, [action.actionId, plan.exerciseId, plan.revision, plan.mode, narration]);

  useEffect(() => () => {
    narration.stop();
    if (!sharedMedia) ownedMedia.dispose();
  }, [narration, ownedMedia, sharedMedia]);

  const replay = () => { void narration.replay(); };
  const speak = (url: string) => {
    narration.stop();
    void media.playUrl("coach-turn", url, { autoplay: true, replayKey: "coach-turn" });
  };
  const stop = () => narration.stop();
  return {
    speechUrl,
    speaking: mediaState.status === "playing",
    autoplayBlocked: mediaState.status === "blocked-by-autoplay" && mediaState.owner === "narration",
    replay,
    speak,
    stop,
  };
}

/**
 * Tutor 会话 React 控制器（Phase 5 remediation 波次 E）。
 *
 * 组装：XState 状态机 + tutorApi + NarrationController（CosyVoice TTS、
 * cache、browser-first-audio telemetry）+ MediaSessionController（barge-in
 * 停播，打断→停止播放目标 <150ms）。只渲染后端返回的已验证 presentation：
 * voice 文本直接送 TTS；workspace 只消费 student_view（ActionContract
 * assessment 形态），前端不解析 action_template、不持有 truth。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";

import { api } from "../../api/client";
import { MediaSessionController } from "../../presentation/audio/MediaSessionController";
import { NarrationController } from "../../presentation/narration/NarrationController";
import { tutorApi, type TutorTurnResponse, type TutorSessionView } from "./tutorApi";
import { tutorSessionMachine } from "./tutorSessionMachine";

export interface TutorTranscriptEntry {
  id: string;
  role: "tutor" | "student";
  text: string;
  at: number;
}

const SPEECH_PROFILE_VERSION = "tutor-zh-v1";

function newTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 等待当前 narration 播放自然结束（loading/playing → idle/error）。
 *  blocked-by-autoplay 视作已交付（音频已就绪，可手动 replay）。
 *  isCancelled 为真（barge-in）立即返回。 */
function waitForPlaybackEnd(
  media: MediaSessionController,
  isCancelled: () => boolean,
  timeoutMs = 10 * 60_000,
): Promise<"done" | "cancelled" | "error"> {
  let sawActive = false;
  let outcome: "done" | "cancelled" | "error" = "done";
  return new Promise((resolve) => {
    const finish = (result: "done" | "cancelled" | "error") => {
      outcome = result;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(outcome);
    };
    const timer = window.setTimeout(() => finish("done"), timeoutMs);
    const unsubscribe = media.subscribe((state) => {
      if (isCancelled()) finish("cancelled");
      else if (state.status === "loading" || state.status === "playing") sawActive = true;
      else if (sawActive && state.status === "error") finish("error");
      else if (sawActive && state.status === "idle") finish("done");
      else if (state.status === "blocked-by-autoplay" && sawActive) finish("done");
    });
  });
}

export function useTutorSession(tpId: string, options?: { restoreSessionId?: string }) {
  const [snapshot, send] = useMachine(tutorSessionMachine);
  const [sessionId, setSessionId] = useState<string | undefined>(options?.restoreSessionId);
  const [revision, setRevision] = useState(0);
  const [transcript, setTranscript] = useState<TutorTranscriptEntry[]>([]);
  const [lastTurn, setLastTurn] = useState<TutorTurnResponse | undefined>();
  const [activeWorkspace, setActiveWorkspace] = useState<TutorTurnResponse["workspace"]>([]);
  const [error, setError] = useState<string | undefined>();
  const revisionRef = useRef(0);
  const playingRef = useRef(false);
  const bargeInAtRef = useRef<number | undefined>(undefined);

  const media = useMemo(() => new MediaSessionController(), []);
  const narration = useMemo(
    () =>
      new NarrationController(
        {
          synthesize: (text, signal, correlationId) =>
            api.streamActionSpeech({ text, correlationId }, signal).then((response) => ({
              audioUrl: response.audioUrl,
            })),
        },
        media,
      ),
    [media],
  );

  useEffect(() => {
    return () => {
      narration.stop();
      media.dispose();
    };
  }, [narration, media]);

  const appendTranscript = useCallback((role: "tutor" | "student", text: string) => {
    setTranscript((entries) => [...entries, { id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role, text, at: Date.now() }]);
  }, []);

  const applyRevision = useCallback((value: number) => {
    revisionRef.current = value;
    setRevision(value);
  }, []);

  /** 回合后同步「进行中的 workspace」：显式签发优先；否则回读学生安全视图
   *  的 pending_workspace（刷新/多回合后仍能看到待操作步——不靠内存重建）。 */
  const syncActiveWorkspace = useCallback(
    async (turnSessionId: string, turn: TutorTurnResponse): Promise<void> => {
      if (turn.workspace.length) {
        setActiveWorkspace(turn.workspace);
        return;
      }
      const view = await tutorApi.view(turnSessionId).catch(() => undefined);
      setActiveWorkspace(view?.pending_workspace ?? []);
    },
    [],
  );
  /** 上报 voice 完成并消费系统续走回合（completed/failed 两类；interrupted
   *  由 bargeIn 单独处理）。TTS 不可用时按 failed 上报，流程不悬挂。 */
  const completeVoiceAndFollow = useCallback(
    async (turnSessionId: string, actionId: string, outcome: "completed" | "failed"): Promise<TutorTurnResponse | undefined> => {
      const followUp = await tutorApi
        .voiceCompletion(turnSessionId, actionId, outcome)
        .catch(() => undefined);
      if (followUp) {
        applyRevision(followUp.revision);
        setLastTurn(followUp);
        void syncActiveWorkspace(turnSessionId, followUp);
      }
      return followUp;
    },
    [applyRevision],
  );

  /** 播放一组 voice 动作（顺序播放；每个完成后上报 voice-completions 并消费
   *  返回的系统续走回合）。打断语义由 bargeIn 控制（stop 立即生效）。 */
  const speakTurn = useCallback(
    async (turn: TutorTurnResponse): Promise<void> => {
      for (const voice of turn.voice) {
        if (!playingRef.current) return;
        appendTranscript("tutor", voice.text);
        const url = await narration
          .enter(
            {
              utteranceId: voice.action_id,
              spokenText: voice.text,
              cacheKey: `${SPEECH_PROFILE_VERSION}:${voice.voice_source ?? "approved-resource"}:${voice.text}`,
            },
            undefined,
            true,
          )
          .catch(() => undefined);
        let outcome: "completed" | "failed" = "completed";
        if (url && playingRef.current) {
          const playback = await waitForPlaybackEnd(media, () => !playingRef.current);
          if (playback === "cancelled" || !playingRef.current) return;
          if (playback === "error") outcome = "failed";
        } else if (!url) {
          // TTS 不可用（CI 无 CosyVoice key）：如实上报 failed，流程继续。
          outcome = "failed";
        }
        if (!playingRef.current) return;
        const followUp = await completeVoiceAndFollow(turn.session_id, voice.action_id, outcome);
        if (followUp) {
          if (followUp.voice.length) {
            await speakTurn(followUp);
            return;
          }
          send({ type: "VOICE_DONE", revision: followUp.revision, hasWorkspace: followUp.workspace.length > 0 } as never);
          return;
        }
      }
      send({ type: "VOICE_DONE", revision: revisionRef.current, hasWorkspace: turn.workspace.length > 0 } as never);
    },
    [appendTranscript, completeVoiceAndFollow, media, narration, send],
  );

  /** 学生回合统一入口（回答/提问/操作证据共用）。 */
  const submitTurn = useCallback(
    async (input: Parameters<typeof tutorApi.turn>[3]) => {
      if (!sessionId) return;
      send({ type: "SUBMIT_INPUT" });
      if (input.text !== undefined) {
        appendTranscript("student", input.input_kind === "question_asked" ? `（问）${input.text}` : input.text);
      }
      try {
        playingRef.current = true;
        const turn = await tutorApi.turn(sessionId, newTurnId(), revisionRef.current, input);
        applyRevision(turn.revision);
        setLastTurn(turn);
        await syncActiveWorkspace(sessionId, turn);
        send({
          type: "TURN_RECEIVED",
          revision: turn.revision,
          turnId: turn.client_turn_id,
          hasVoice: turn.voice.length > 0,
          hasWorkspace: turn.workspace.length > 0,
          completed: false,
        });
        if (turn.voice.length) {
          await speakTurn(turn);
        } else if (turn.workspace.length) {
          playingRef.current = false;
        } else {
          playingRef.current = false;
          send({ type: "VOICE_DONE", revision: turn.revision, hasWorkspace: false } as never);
        }
      } catch (turnError) {
        playingRef.current = false;
        const message = turnError instanceof Error ? turnError.message : String(turnError);
        setError(message);
        send({ type: "FAILED", message });
      }
    },
    [appendTranscript, applyRevision, send, sessionId, speakTurn],
  );

  /** barge-in：立即停播并上报 interrupted（目标 <150ms 停止播放）。 */
  const bargeIn = useCallback(async () => {
    if (!sessionId) return;
    const startedAt = performance.now();
    narration.stop();
    media.stop("narration");
    playingRef.current = false;
    const latencyMs = performance.now() - startedAt;
    const pending = lastTurn?.voice.find((voice) => voice.interruptible) ?? lastTurn?.voice[0];
    send({ type: "BARGE_IN", latencyMs });
    if (pending) {
      await tutorApi.voiceCompletion(sessionId, pending.action_id, "interrupted").catch(() => undefined);
    }
  }, [lastTurn, media, narration, send, sessionId]);

  const start = useCallback(async () => {
    try {
      playingRef.current = true;
      const started = await tutorApi.start(tpId, "browser-student");
      setSessionId(started.session_id);
      applyRevision(started.opening.revision);
      setLastTurn(started.opening);
      send({ type: "SESSION_STARTED", sessionId: started.session_id, revision: started.opening.revision });
      await speakTurn(started.opening);
    } catch (startError) {
      playingRef.current = false;
      const message = startError instanceof Error ? startError.message : String(startError);
      setError(message);
      send({ type: "FAILED", message });
    }
  }, [applyRevision, send, speakTurn, tpId]);

  /** 刷新恢复：GET 学生安全视图，pending voice 重播、pending workspace 重建。 */
  const restore = useCallback(
    async (targetSessionId: string) => {
      try {
        const view: TutorSessionView = await tutorApi.view(targetSessionId);
        setSessionId(view.session_id);
        applyRevision(view.revision);
        playingRef.current = true;
        send({ type: "RESTORED", sessionId: view.session_id, revision: view.revision });
        setActiveWorkspace(view.pending_workspace);
        if (view.pending_workspace.length && !view.pending_voice.length) {
          // 恢复面直接落到操作步（pending actions 来自 backend，不靠内存重建）。
          playingRef.current = false;
          send({
            type: "TURN_RECEIVED",
            revision: view.revision,
            turnId: "restore",
            hasVoice: false,
            hasWorkspace: true,
            completed: false,
          });
        }
        if (view.pending_voice.length) {
          await speakTurn({
            session_id: view.session_id,
            revision: view.revision,
            client_turn_id: "restore",
            idempotent_replay: true,
            mode: view.mode,
            current_checkpoint: view.current_checkpoint,
            decision: null,
            voice: view.pending_voice,
            workspace: view.pending_workspace,
            event_cursor: view.event_cursor,
          });
        }
      } catch (restoreError) {
        playingRef.current = false;
        const message = restoreError instanceof Error ? restoreError.message : String(restoreError);
        setError(message);
        send({ type: "FAILED", message });
      }
    },
    [applyRevision, send, speakTurn],
  );

  const submitWorkspaceEvidence = useCallback(
    async (evidence: Record<string, unknown>) => {
      await submitTurn({ input_kind: "structured_action_evidence", action_evidence: evidence });
    },
    [submitTurn],
  );

  const finish = useCallback(async () => {
    if (!sessionId) return;
    await tutorApi.complete(sessionId).catch(() => undefined);
    send({ type: "COMPLETED" });
  }, [send, sessionId]);

  const resumeFromInterrupt = useCallback(() => send({ type: "RESUME_FROM_INTERRUPT" }), [send]);
  const retry = useCallback(() => send({ type: "RETRY" }), [send]);

  return {
    state: snapshot.value as string,
    sessionId,
    revision,
    transcript,
    lastTurn,
    error,
    currentCheckpoint: lastTurn?.current_checkpoint ?? undefined,
    workspace: activeWorkspace,
    start,
    restore,
    submitTurn,
    submitWorkspaceEvidence,
    bargeIn,
    resumeFromInterrupt,
    retry,
    finish,
    appendTranscript,
  };
}

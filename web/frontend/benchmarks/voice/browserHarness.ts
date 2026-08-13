import type { APIRequestContext, Page } from "@playwright/test";
import type { BrowserBenchmarkEvent, VoiceBenchmarkFlow, VoiceBenchmarkRecord, VoiceServerTimeline } from "./types";

const PLAYBACK_STAGES = new Set(["browser-audio-started", "blocked-by-autoplay", "error"]);

/** Install before navigation. The observer measures production DOM/fetch/media
 * events; it never mocks Audio, fetch, the backend cache, ASR, LLM, TTS, or any
 * provider. The only allowed fixture is a fixed microphone WAV fed via Chromium
 * fake-audio-capture launch flags (see playwright.config.ts). */
export async function installVoiceBrowserObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Event = {
      kind: "action-enter" | "fetch-start" | "fetch-headers" | "telemetry"
        | "microphone" | "capture" | "websocket" | "media" | "stream-delta";
      at: number;
      url?: string;
      correlationId?: string;
      actionId?: string;
      owner?: "narration" | "turn" | "live";
      stage?: string;
      status?: number;
      cacheSource?: string;
      phase?: string;
      role?: string;
      messageType?: string;
    };
    const state = { events: [] as Event[], lastActionId: undefined as string | undefined };
    Object.defineProperty(window, "__VOICE_BENCHMARK__", { value: state, configurable: true });

    const push = (event: Event) => { state.events.push(event); };

    // --- Action enter (workspace data-action-id mutation) ---
    const recordAction = () => {
      const workspace = document.querySelector<HTMLElement>('[data-testid="action-runtime-workspace"]');
      const actionId = workspace?.dataset.actionId;
      if (!actionId || actionId === state.lastActionId) return;
      state.lastActionId = actionId;
      push({ kind: "action-enter", at: Date.now(), actionId });
    };
    const observer = new MutationObserver(recordAction);
    observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-action-id"] });
    window.addEventListener("DOMContentLoaded", recordAction, { once: true });

    // --- fetch: action-speech(-stream) / coach turn-stream / coach telemetry ---
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      let payload: Record<string, unknown> | undefined;
      if (typeof init?.body === "string") {
        try { payload = JSON.parse(init.body) as Record<string, unknown>; } catch { /* non-JSON request */ }
      }
      const at = Date.now();
      const correlationId = typeof payload?.correlationId === "string" ? payload.correlationId : undefined;
    const isSpeech = /\/api\/action-speech(?:-stream)?(?:\?|$)/.test(url);
    const isTurnStream = /\/api\/coach\/turn-stream(?:\?|$)/.test(url);
    const isActionCoach = /\/api\/action-coach(?:\?|$)/.test(url);
    if (isSpeech || isTurnStream || isActionCoach) {
      push({ kind: "fetch-start", at, url, correlationId });
    }
      if (/\/api\/coach\/telemetry(?:\?|$)/.test(url) && payload) {
        push({
          kind: "telemetry",
          at,
          url,
          correlationId,
          owner: payload.owner as Event["owner"],
          stage: typeof payload.stage === "string" ? payload.stage : undefined,
        });
      }
      const response = await originalFetch(input, init);
      if (isSpeech || isTurnStream || isActionCoach) {
        push({
          kind: "fetch-headers",
          at: Date.now(),
          url,
          correlationId,
          status: response.status,
          cacheSource: response.headers.get("x-narration-artifact-source") || response.headers.get("x-cache-source") || undefined,
        });
      }
      // Tee the NDJSON turn stream to attribute ASR-final (first student delta) and
      // LLM-first-text (first coach delta) without touching production code. We read
      // an independent clone; the application consumes the original body untouched.
      if (isTurnStream) {
        try { drainTurnStream(response.clone().body); } catch { /* best-effort attribution */ }
      }
      return response;
    };

    async function drainTurnStream(body: ReadableStream<Uint8Array> | null): Promise<void> {
      if (!body) return;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const seen = new Set<string>();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline = buffer.indexOf("\n");
          while (newline >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf("\n");
            if (!line) continue;
            try {
              const message = JSON.parse(line) as { type?: string; role?: string; correlationId?: string };
              if (message.type === "turn.transcript.delta" && message.role && message.correlationId) {
                const key = `${message.correlationId}:${message.role}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  push({ kind: "stream-delta", at: Date.now(), correlationId: message.correlationId, role: message.role });
                }
              }
            } catch { /* partial line across chunks */ }
          }
        }
      } catch { /* stream attribution never affects the run */ }
    }

    // --- getUserMedia (microphone lease) ---
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);
    if (originalGetUserMedia) {
      mediaDevices.getUserMedia = async (constraints: MediaStreamConstraints) => {
        push({ kind: "microphone", at: Date.now(), phase: "requested" });
        try {
          const stream = await originalGetUserMedia(constraints);
          push({ kind: "microphone", at: Date.now(), phase: "granted" });
          return stream;
        } catch (error) {
          push({ kind: "microphone", at: Date.now(), phase: "denied" });
          throw error;
        }
      };
    }

    // --- MediaRecorder (capture start/stop) ---
    if (typeof MediaRecorder !== "undefined") {
      const originalStart = MediaRecorder.prototype.start;
      MediaRecorder.prototype.start = function patchedStart(...args: unknown[]): void {
        push({ kind: "capture", at: Date.now(), phase: "started" });
        this.addEventListener("stop", () => push({ kind: "capture", at: Date.now(), phase: "stopped" }));
        return (originalStart as (...a: unknown[]) => void).apply(this, args);
      };
    }

    // --- HTMLMediaElement play/ended (browser first audio + playback completed) ---
    const captureMedia = (event: Event) => {
      document.addEventListener(event, (dom) => {
        if (dom.target instanceof HTMLMediaElement) push({ kind: "media", at: Date.now(), phase: event });
      }, true);
    };
    captureMedia("play");
    captureMedia("ended");

    // --- WebSocket (Live Coach full-duplex) ---
    if (typeof WebSocket !== "undefined") {
      const OriginalWebSocket = WebSocket;
      class PatchedWebSocket extends OriginalWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          const href = typeof url === "string" ? url : url.href;
          if (!/\/api\/coach-realtime(?:\?|$)/.test(href)) return;
          let correlationId: string | undefined;
          try { correlationId = new URL(href, location.href).searchParams.get("correlationId") || undefined; } catch { /* ignore */ }
          let seenAudio = false;
          const seenTranscript = new Set<string>();
          push({ kind: "websocket", at: Date.now(), phase: "open", correlationId, url: href });
          this.addEventListener("open", () => push({ kind: "websocket", at: Date.now(), phase: "connected", correlationId }));
          this.addEventListener("message", (dom: MessageEvent) => {
            try {
              const message = JSON.parse(dom.data) as { type?: string; role?: string };
              const type = message.type;
              if (type === "live.ready") push({ kind: "websocket", at: Date.now(), phase: "ready", correlationId, messageType: type });
              else if (type === "live.transcript.delta" && message.role && !seenTranscript.has(message.role)) {
                seenTranscript.add(message.role);
                push({ kind: "websocket", at: Date.now(), phase: "transcript", correlationId, role: message.role, messageType: type });
              } else if (type === "live.audio" && !seenAudio) {
                seenAudio = true;
                push({ kind: "websocket", at: Date.now(), phase: "first-audio", correlationId, messageType: type });
              } else if (type === "live.interrupted") {
                push({ kind: "websocket", at: Date.now(), phase: "interrupted", correlationId, messageType: type });
              }
            } catch { /* non-JSON control frame */ }
          });
          this.addEventListener("close", () => push({ kind: "websocket", at: Date.now(), phase: "close", correlationId }));
          this.addEventListener("error", () => push({ kind: "websocket", at: Date.now(), phase: "error", correlationId }));
        }
      }
      window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;
    }
  });
}

export async function browserEvents(page: Page): Promise<BrowserBenchmarkEvent[]> {
  return page.evaluate(() => {
    const state = (window as unknown as { __VOICE_BENCHMARK__?: { events: BrowserBenchmarkEvent[] } }).__VOICE_BENCHMARK__;
    return state?.events ? [...state.events] : [];
  });
}

export async function waitForBrowserEvent(
  page: Page,
  criteria: Partial<Pick<BrowserBenchmarkEvent, "kind" | "correlationId" | "owner" | "stage" | "phase" | "role">> & { urlIncludes?: string; playbackOutcome?: boolean; minAt?: number },
  timeoutMs: number,
): Promise<BrowserBenchmarkEvent> {
  await page.waitForFunction(({ criteria }) => {
    const state = (window as unknown as { __VOICE_BENCHMARK__?: { events: BrowserBenchmarkEvent[] } }).__VOICE_BENCHMARK__;
    // NB: this callback executes IN the page context, so it cannot close over any
    // Node-side helper — the matcher is inlined verbatim (and mirrored in `matches`
    // below for the Node-side post-wait find).
    return state?.events.some((event) => {
      if (criteria.kind && event.kind !== criteria.kind) return false;
      if (criteria.correlationId && event.correlationId !== criteria.correlationId) return false;
      if (criteria.owner && event.owner !== criteria.owner) return false;
      if (criteria.stage && event.stage !== criteria.stage) return false;
      if (criteria.phase && event.phase !== criteria.phase) return false;
      if (criteria.role && event.role !== criteria.role) return false;
      if (criteria.urlIncludes && !(event.url || "").includes(criteria.urlIncludes)) return false;
      if (criteria.playbackOutcome && !["browser-audio-started", "blocked-by-autoplay", "error"].includes(event.stage || "")) return false;
      if (criteria.minAt && (event.at || 0) < criteria.minAt) return false;
      return true;
    });
  }, { criteria }, { timeout: timeoutMs });
  const events = await browserEvents(page);
  const match = events.find((event) => matches(event, criteria));
  if (!match) throw new Error(`Voice browser event disappeared: ${JSON.stringify(criteria)}`);
  return match;
}

function matches(event: BrowserBenchmarkEvent, criteria: Partial<Pick<BrowserBenchmarkEvent, "kind" | "correlationId" | "owner" | "stage" | "phase" | "role">> & { urlIncludes?: string; playbackOutcome?: boolean; minAt?: number }): boolean {
  if (criteria.kind && event.kind !== criteria.kind) return false;
  if (criteria.correlationId && event.correlationId !== criteria.correlationId) return false;
  if (criteria.owner && event.owner !== criteria.owner) return false;
  if (criteria.stage && event.stage !== criteria.stage) return false;
  if (criteria.phase && event.phase !== criteria.phase) return false;
  if (criteria.role && event.role !== criteria.role) return false;
  if (criteria.urlIncludes && !event.url?.includes(criteria.urlIncludes)) return false;
  if (criteria.playbackOutcome && !PLAYBACK_STAGES.has(event.stage || "")) return false;
  if (criteria.minAt && (event.at || 0) < criteria.minAt) return false;
  return true;
}

export async function probeVoiceEnvironment(api: APIRequestContext, apiBaseUrl: string, taskId: string): Promise<string | undefined> {
  try {
    const response = await api.get(`${apiBaseUrl}/api/learn/${encodeURIComponent(taskId)}/action-plan`, { timeout: 10_000 });
    if (!response.ok()) return `backend action-plan probe returned HTTP ${response.status()}`;
    return undefined;
  } catch (error) {
    return `backend is unavailable: ${(error as Error).message}`;
  }
}

/**
 * Drive a REAL narration that reaches playback. The page must already be loaded
 * with the observer installed and the workspace visible.
 *
 * Background: against the Vite DEV server, `React.StrictMode` double-invokes the
 * narration mount effect — the first synthesis is immediately aborted by the
 * cleanup (`narration.stop()`), so the narration fired on initial page load never
 * reaches `browser-audio-started`. A user-initiated action switch is a dependency
 * change (not a remount), so it enters narration exactly once and plays. This
 * helper clicks "下一个 Action" (or "上一个 Action" when `direction === "prev"`)
 * and resolves the correlationId of the narration that fires as a result. This is
 * a legitimate black-box user interaction — no production code is changed.
 */
export async function advanceToNarration(
  page: Page,
  timeoutMs: number,
  direction: "next" | "prev" = "next",
  settleMs = 3500,
  steps = 1,
): Promise<{ correlationId: string; interactionStartedAt: number }> {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const name = direction === "next" ? "下一个 Action" : "上一个 Action";
  // Advance through (steps - 1) actions without measuring, so the final measured
  // step lands on a FRESH actionId. This matters because the backend telemetry sink
  // merges first-wins on a stable correlationId (narration correlationId === actionId),
  // so only the first entry of each action yields a clean server timeline; re-entering
  // an action would return the first entry's stale source/phase fields.
  for (let step = 1; step < steps; step += 1) {
    const clickAt = Date.now();
    await page.getByRole("button", { name }).click();
    await waitForBrowserEvent(page, { kind: "action-enter", minAt: clickAt }, timeoutMs).catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  const interactionStartedAt = Date.now();
  await page.getByRole("button", { name }).click();
  const speechRequest = await waitForBrowserEvent(page, {
    kind: "fetch-start",
    urlIncludes: "/api/action-speech",
    minAt: interactionStartedAt,
  }, timeoutMs);
  const correlationId = speechRequest.correlationId;
  if (!correlationId) throw new Error("Narration request after action switch did not carry a correlationId");
  return { correlationId, interactionStartedAt };
}

export async function readTimeline(
  api: APIRequestContext,
  apiBaseUrl: string,
  correlationId: string,
  timeoutMs: number,
  requireTerminal = false,
): Promise<VoiceServerTimeline> {
  const deadline = Date.now() + timeoutMs;
  let latest: VoiceServerTimeline | undefined;
  while (Date.now() < deadline) {
    const response = await api.get(`${apiBaseUrl}/api/coach/telemetry/${encodeURIComponent(correlationId)}`);
    if (response.ok()) {
      latest = await response.json() as VoiceServerTimeline;
      if (latest.browserFirstAudioAt && (!requireTerminal || latest.terminal)) return latest;
      if (latest.browserAutoplayBlocked) return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (latest) return latest;
  throw new Error(`No telemetry timeline for correlation ${correlationId}`);
}

/** Poll the server timeline once and return whatever is present (no throw). Useful
 *  for error/cancellation cases where browserFirstAudioAt may never appear. */
export async function peekTimeline(
  api: APIRequestContext,
  apiBaseUrl: string,
  correlationId: string,
): Promise<VoiceServerTimeline | undefined> {
  try {
    const response = await api.get(`${apiBaseUrl}/api/coach/telemetry/${encodeURIComponent(correlationId)}`);
    if (response.ok()) return await response.json() as VoiceServerTimeline;
  } catch { /* best-effort */ }
  return undefined;
}

function delta(end: number | undefined, start: number | undefined): number | undefined {
  return end === undefined || start === undefined ? undefined : Math.round((end - start) * 10) / 10;
}

export function buildRecord(params: {
  runId: string;
  flow: VoiceBenchmarkFlow;
  scenario: string;
  tags: string[];
  iteration: number;
  taskId: string;
  route: string;
  correlationId: string;
  interactionStartedAt?: number;
  events: BrowserBenchmarkEvent[];
  timeline: VoiceServerTimeline;
  /** Allow a spec to force a status (e.g. "cancelled") regardless of playback. */
  status?: VoiceBenchmarkRecord["status"];
}): VoiceBenchmarkRecord {
  const { timeline, correlationId, events } = params;
  const actionEnteredAt = events.find((event) => event.kind === "action-enter" && event.actionId === correlationId)?.at;
  const request = events.find((event) => event.kind === "fetch-start"
    && (event.correlationId === correlationId
      || (params.flow !== "narration" && event.url?.includes("/api/coach/turn-stream"))));
  const headers = events.find((event) => event.kind === "fetch-headers" && event.url === request?.url && event.at >= (request?.at || 0));
  // Prefer the CLIENT-session browser mark over the server-retained timeline: the
  // server InMemoryTelemetrySink merges first-wins on a stable correlationId, so a
  // re-entered narration action (correlationId === actionId) would otherwise return
  // a stale browserFirstAudioAt from an earlier run and yield negative E2E latency.
  const browserStarted = events.find((event) => event.kind === "telemetry" && event.correlationId === correlationId && event.stage === "browser-audio-started")?.at
    ?? events.find((event) => event.kind === "media" && event.phase === "play")?.at
    ?? timeline.browserFirstAudioAt;
  const browserEnded = events.find((event) => event.kind === "media" && event.phase === "ended")?.at ?? timeline.browserCompletedAt;

  const micRequested = events.find((event) => event.kind === "microphone" && event.phase === "requested")?.at;
  const micGranted = events.find((event) => event.kind === "microphone" && event.phase === "granted")?.at;
  const micDenied = events.find((event) => event.kind === "microphone" && event.phase === "denied")?.at;
  const captureStarted = events.find((event) => event.kind === "capture" && event.phase === "started")?.at;
  const captureStopped = events.find((event) => event.kind === "capture" && event.phase === "stopped")?.at;

  const wsOpen = events.find((event) => event.kind === "websocket" && event.phase === "open")?.at;
  const wsReady = events.find((event) => event.kind === "websocket" && event.phase === "ready")?.at;
  const firstAudioPacket = events.find((event) => event.kind === "websocket" && event.phase === "first-audio")?.at;

  const asrProxy = events.find((event) => event.kind === "stream-delta" && event.role === "student")?.at;
  const llmProxy = events.find((event) => event.kind === "stream-delta" && event.role === "coach")?.at;

  const cacheSource = timeline.narrationArtifactSource || headers?.cacheSource;
  const autoplayBlocked = Boolean(timeline.browserAutoplayBlocked);
  const cancelled = params.status === "cancelled" || Boolean(timeline.cancelledAt);
  let status: VoiceBenchmarkRecord["status"];
  if (params.status) status = params.status;
  else if (autoplayBlocked) status = "autoplay-blocked";
  else if (cancelled) status = "cancelled";
  else status = browserStarted !== undefined ? "ok" : "failed";

  const terminalAt = timeline.completedAt ?? timeline.cancelledAt ?? timeline.failedAt;
  const requestObservedAt = request?.at;

  return {
    schemaVersion: 1,
    runId: params.runId,
    recordedAt: new Date().toISOString(),
    flow: params.flow,
    scenario: params.scenario,
    scenarioTags: params.tags,
    iteration: params.iteration,
    taskId: params.taskId,
    route: params.route,
    status,
    correlationId,
    cacheSource,
    client: {
      interactionStartedAt: params.interactionStartedAt,
      actionEnteredAt,
      requestObservedAt,
      responseHeadersAt: headers?.at,
      browserAudioStartedAt: browserStarted,
      browserCompletedAt: browserEnded,
      microphoneRequestedAt: micRequested,
      microphoneGrantedAt: micGranted,
      captureStartedAt: captureStarted,
      captureStoppedAt: captureStopped,
      audioEncodedAt: micDenied !== undefined ? undefined : captureStopped,
      wsConnectAt: wsOpen,
      wsReadyAt: wsReady,
      firstAudioPacketAt: firstAudioPacket,
      asrFinalProxyAt: asrProxy,
      llmFirstTextProxyAt: llmProxy,
    },
    server: timeline,
    latencyMs: {
      interactionToBrowserAudio: delta(browserStarted, params.interactionStartedAt),
      actionEnterToBrowserAudio: delta(browserStarted, actionEnteredAt),
      requestToBrowserAudio: delta(browserStarted, requestObservedAt),
      requestToResponseHeaders: delta(headers?.at, requestObservedAt),
      serverRequestToProviderConnected: delta(timeline.providerConnectedAt, timeline.requestStartedAt),
      serverRequestToLlmFirstText: delta(timeline.llmFirstTextAt, timeline.requestStartedAt),
      serverRequestToFirstSpokenSegment: delta(timeline.firstSpokenSegmentAt, timeline.requestStartedAt),
      serverRequestToTtsFirstAudio: delta(timeline.ttsFirstAudioAt, timeline.requestStartedAt),
      ttsFirstAudioToBrowserAudio: delta(browserStarted, timeline.ttsFirstAudioAt),
      serverRequestToBrowserAudio: delta(browserStarted, timeline.requestStartedAt),
      serverTotal: delta(terminalAt, timeline.requestStartedAt),
      microphoneGrantedToCaptureStarted: delta(captureStarted, micGranted),
      captureStoppedToRequestStarted: delta(requestObservedAt, captureStopped),
      requestStartedToAsrFinalProxy: delta(asrProxy, requestObservedAt),
      asrFinalProxyToLlmFirstText: delta(llmProxy, asrProxy),
      llmFirstTextToFirstSpokenSegment: delta(timeline.firstSpokenSegmentAt, timeline.llmFirstTextAt),
      firstSpokenSegmentToTtsFirstAudio: delta(timeline.ttsFirstAudioAt, timeline.firstSpokenSegmentAt),
      browserFirstAudioToBrowserCompleted: delta(browserEnded, browserStarted),
      interactionTotal: delta(browserEnded ?? terminalAt, params.interactionStartedAt),
      wsConnectToReady: delta(wsReady, wsOpen),
      readyToFirstAudioPacket: delta(firstAudioPacket, wsReady),
      firstAudioPacketToBrowserAudio: delta(browserStarted, firstAudioPacket),
    },
  };
}

export function failedRecord(params: {
  runId: string; flow: VoiceBenchmarkFlow; scenario: string; iteration: number;
  taskId: string; route: string; error: unknown; interactionStartedAt?: number;
}): VoiceBenchmarkRecord {
  return {
    schemaVersion: 1,
    runId: params.runId,
    recordedAt: new Date().toISOString(),
    flow: params.flow,
    scenario: params.scenario,
    scenarioTags: ["real-browser", "real-provider"],
    iteration: params.iteration,
    taskId: params.taskId,
    route: params.route,
    status: "failed",
    error: (params.error as Error).message || String(params.error),
    client: { interactionStartedAt: params.interactionStartedAt },
    latencyMs: {},
  };
}

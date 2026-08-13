/**
 * Voice benchmark record contract (schemaVersion 1).
 *
 * The types are intentionally permissive: the server timeline already carries
 * an index signature, and every new browser-interception phase is an optional
 * field so the existing narration/turn specs keep working unchanged. Phases
 * that cannot be obtained black-box are left undefined and are documented in the
 * coverage matrix as "Not observable" rather than guessed.
 */
export type VoiceBenchmarkFlow = "narration" | "turn" | "recorded" | "live" | "media-arbitration";
export type VoiceBenchmarkStatus = "ok" | "autoplay-blocked" | "cancelled" | "failed";

export interface VoiceServerTimeline {
  correlationId: string;
  flow: VoiceBenchmarkFlow;
  sessionId?: string;
  mode?: string;
  requestStartedAt?: number;
  providerConnectedAt?: number;
  llmFirstTextAt?: number;
  firstSpokenSegmentAt?: number;
  ttsFirstAudioAt?: number;
  browserFirstAudioAt?: number;
  browserAutoplayBlocked?: boolean;
  completedAt?: number;
  cancelledAt?: number;
  failedAt?: number;
  terminal?: "completed" | "cancelled" | "failed";
  narrationArtifactSource?: "memory" | "persistent" | "provider";
  memoryCacheLookupMs?: number;
  persistentCacheLookupMs?: number;
  singleFlightWaitMs?: number;
  providerSynthesisMs?: number;
  artifactBytes?: number;
  updatedAt?: number;
  /** Browser-side terminal marks. Populated only when the production client
   * emits the matching stage; otherwise they stay absent (Not observable). */
  browserCompletedAt?: number;
  browserCancelledAt?: number;
  browserErroredAt?: number;
  [key: string]: unknown;
}

export type BrowserEventKind =
  | "action-enter"
  | "fetch-start"
  | "fetch-headers"
  | "telemetry"
  | "microphone"
  | "capture"
  | "websocket"
  | "media"
  | "stream-delta";

export interface BrowserBenchmarkEvent {
  kind: BrowserEventKind;
  at: number;
  url?: string;
  correlationId?: string;
  actionId?: string;
  owner?: "narration" | "turn" | "live";
  stage?: string;
  status?: number;
  cacheSource?: string;
  /** microphone: requested|granted|denied; capture: started|stopped; media: play|ended;
   *  websocket: open|ready|first-audio|interrupted|transcript|close|error */
  phase?: string;
  /** stream-delta / websocket transcript role: "student" | "coach" */
  role?: string;
  /** websocket live.* message type */
  messageType?: string;
}

export interface VoiceBenchmarkRecord {
  schemaVersion: 1;
  runId: string;
  recordedAt: string;
  flow: VoiceBenchmarkFlow;
  scenario: string;
  scenarioTags: string[];
  iteration: number;
  taskId: string;
  route: string;
  status: VoiceBenchmarkStatus;
  error?: string;
  correlationId?: string;
  cacheSource?: string;
  client: {
    interactionStartedAt?: number;
    actionEnteredAt?: number;
    requestObservedAt?: number;
    responseHeadersAt?: number;
    browserAudioStartedAt?: number;
    /** HTMLMediaElement 'ended' proxy for playback completion (Not observable for Live PCM). */
    browserCompletedAt?: number;
    microphoneRequestedAt?: number;
    microphoneGrantedAt?: number;
    captureStartedAt?: number;
    captureStoppedAt?: number;
    /** Precise encode-ready instant is internal to the app; bounded by captureStoppedAt→requestObservedAt. */
    audioEncodedAt?: number;
    wsConnectAt?: number;
    wsReadyAt?: number;
    firstAudioPacketAt?: number;
    /** Browser-side proxy from the first student transcript delta in the NDJSON stream. */
    asrFinalProxyAt?: number;
    /** Browser-side proxy from the first coach transcript delta in the NDJSON stream. */
    llmFirstTextProxyAt?: number;
  };
  server?: VoiceServerTimeline;
  latencyMs: {
    interactionToBrowserAudio?: number;
    actionEnterToBrowserAudio?: number;
    requestToBrowserAudio?: number;
    requestToResponseHeaders?: number;
    serverRequestToProviderConnected?: number;
    serverRequestToLlmFirstText?: number;
    serverRequestToFirstSpokenSegment?: number;
    serverRequestToTtsFirstAudio?: number;
    ttsFirstAudioToBrowserAudio?: number;
    serverRequestToBrowserAudio?: number;
    serverTotal?: number;
    // Capture / ASR / LLM attribution (Phase 1 additions).
    microphoneGrantedToCaptureStarted?: number;
    captureStoppedToRequestStarted?: number;
    requestStartedToAsrFinalProxy?: number;
    asrFinalProxyToLlmFirstText?: number;
    llmFirstTextToFirstSpokenSegment?: number;
    firstSpokenSegmentToTtsFirstAudio?: number;
    browserFirstAudioToBrowserCompleted?: number;
    interactionTotal?: number;
    // Live Coach (WebSocket full-duplex).
    wsConnectToReady?: number;
    readyToFirstAudioPacket?: number;
    firstAudioPacketToBrowserAudio?: number;
  };
}

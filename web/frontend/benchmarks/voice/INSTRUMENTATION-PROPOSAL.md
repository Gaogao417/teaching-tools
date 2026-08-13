# Optional instrumentation patch — PROPOSAL ONLY (not implemented)

Per the tightened task boundary, Phase 1 measured every voice link **black-box**
from the browser and marked server-internal phases it could not observe as
**Not observable** rather than touching production code. This document proposes
a *minimal, behavior-preserving* instrumentation patch for the few phases that
are genuinely server-internal AND materially affect bottleneck attribution. It is
**a proposal — nothing here is implemented**, and each change is designed to
change no user-visible behavior, add no route, and never affect playback,
recording, or Action Runtime state.

## Proposed changes (provider-neutral, additive telemetry only)

### 1. Authoritative `asrFinalAt` (recorded turn)

**Problem.** The recorded-turn benchmark currently attributes ASR-final via a
browser-side proxy — the first `turn.transcript.delta` with `role:"student"`
observed by teeing the NDJSON turn stream (`client.asrFinalProxyAt`,
`requestStartedToAsrFinalProxy`). This is close but is the moment the transcript
*reaches the browser*, not the moment the ASR provider returned. It also cannot
separate ASR provider latency from upstream buffering.

**Proposal.** In `CoachTurnApplication.start`, after `recognizer.transcribe(...)`
resolves, emit one server telemetry field `asrFinalAt: Date.now()` into the turn
timeline (mirroring how `llmFirstTextAt`/`firstSpokenSegmentAt`/`ttsFirstAudioAt`
are already sunk). This is one `telemetry.record({ asrFinalAt })` call, gated to
the recorded-audio path, provider-neutral (no model/provider in the field).

**Invariant.** Telemetry failure must not affect the turn — it already routes
through the best-effort `TelemetrySink`, so this is automatically safe.

### 2. `correlationId` on the request-response Coach reply (G3)

**Problem.** The request-response turn path (`POST /api/action-coach`) plays its
reply via `media.playUrl("coach-turn", url, { replayKey })` **without a
`correlationId`** (`useTeacherSpeech.speak`). Consequently the production client
never POSTs a `browser-audio-started` mark correlated to the turn, so the
request-response path cannot be measured to "actual browser playback" without
falling back to the `<audio>` `play` event. The benchmark therefore records rr as
**Not observable to browser-audio-started** (it still captures rr via the media
`play` fallback, but the server timeline for the legacy rr path may be absent).

**Proposal.** Thread the turn `correlationId` into `playUrl("coach-turn", url,
{ correlationId, replayKey })` on the rr path (the streaming path already does
this). This is a one-line plumbing change in `CoachController`/`useTeacherSpeech`
that only adds a correlation id to an existing telemetry mark — it changes no
playback, no provider, no capability.

### 3. Last-wins (or per-request) timeline merge for re-entrable narration keys

**Problem (discovered during smoke).** `InMemoryTelemetrySink.mergeServer` merges
**first-wins** on every server field. Narration `correlationId === actionId` is
stable, so re-entering an Action returns the *first* entry's stale
`narrationArtifactSource`, `providerSynthesisMs`, `requestStartedAt`, etc. This
contaminates server cache attribution across re-entries within one backend
process (Phase 1 works around it by measuring each actionId once and relying on
client-side E2E timestamps, which are always clean).

**Proposal.** For re-entrable flows, either (a) reset the server timeline when a
new `requestStartedAt` arrives for the same correlationId, or (b) make
cache-attribution fields (`narrationArtifactSource`, `*LookupMs`,
`providerSynthesisMs`, `artifactBytes`, and the phase timestamps) last-wins while
keeping browser-reported fields first-wins. This is an internal sink change with
no contract/API impact and no user-visible effect; it only makes repeated
measurements of the same key attributable.

## What this proposal does NOT include

- No new routes, providers, or product capabilities.
- No change to playback, recording, autoplay, assessment, or Action Runtime.
- No exposure of provider/model in the browser contract (`sanitizeTimeline`
  still strips them).
- No Redis, object store, SQLite, or CDN.
- No implementation of Omni-recorded, streaming-Omni, client live
  interrupt/commit/stop, or ASR partials — those remain **N/A** (product does
  not implement them).

## Recommendation

Ship Phase 1 as-is (black-box, honest coverage). Adopt items #1–#3 only if/when
the measured baselines show the corresponding attribution gap matters for SLO
decisions. Each is small, additive, and reversible.

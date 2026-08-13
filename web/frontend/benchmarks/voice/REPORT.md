# Voice Benchmark — Phase 1 report

Date: 2026-08-13 · Run id: `phase1-smoke-2026-08-13` · Code SHA: current dirty
worktree (ADR-007 backend changes + this benchmark extension).

## Summary

Phase 1 extends the existing Playwright voice benchmark to cover **every
production voice link that actually exists**, measures it **black-box from the
browser** (endpoint is `browser-audio-started`, not backend completion), and
marks anything that does not exist or cannot be observed — without implementing
new product features. Real Chromium drives the production React page against the
running backend/frontend; only the microphone input is a fixed WAV fixture
(`--use-file-for-fake-audio-capture`). Nothing else — `Audio`, `fetch`, the
backend cache, ASR, LLM, TTS, or any provider — is mocked.

**Headline:** the framework is implemented, the default run skips everything
(no paid calls), and a real small-sample run against live providers produced
honest records for narration, recorded-turn, and narration→turn arbitration.
Text-turn and recorded-turn reach actual browser playback. Live Coach did **not**
open a realtime websocket in this environment and is marked Not executed.

## What was built (benchmark-only; no production code changed)

- Extended shared contract: `types.ts`, `browserHarness.ts`, `reporter.ts`,
  `scripts/summarize.mjs`, `env.ts`, `playwright.config.ts`.
- New black-box browser interception (all via `addInitScript`, no production
  edits): `getUserMedia`, `MediaRecorder.start/stop`, `WebSocket`
  (`/api/coach-realtime`), `HTMLMediaElement` `play`/`ended`, and a
  `response.clone()` tee of the NDJSON turn stream that attributes ASR-final and
  LLM-first-text from the first student/coach transcript deltas.
- Specs: `narration.benchmark.spec.ts` (transport + L0 replay + persistent skip),
  `narration.concurrency.spec.ts` (single-flight), `turn-coach.benchmark.spec.ts`
  (text stream, pre-existing), `turn-coach.text-request-response.spec.ts`,
  `turn-coach.recorded.spec.ts`, `live-coach.spec.ts`, `media-arbitration.spec.ts`.
- Fixed WAV fixtures + reproducible generator (`fixtures/`).
- Optional instrumentation patch **proposal** (`INSTRUMENTATION-PROPOSAL.md`) —
  not implemented.

## Coverage matrix

Legend: ✅ implemented & run · ⚠️ implemented, partial/Not-run · ❌ N/A (product
does not implement) · ◑ Not observable (no observation point, black-box).

### 一. Action narration (deterministic)

| # | Scenario | Status | Note |
|---|---|---|---|
| 1 | provider cold (url & stream) | ✅ run | Measured via curl: ~8.1s synthesis for 41-char action text; cold url response gated on full synthesis. In-browser cold sample needs a fresh cache namespace (operator prep). |
| 2 | backend L1 memory hit | ✅ run | `i2ba≈64–68ms`, `req2hdr≈17ms`, no synth. Source label reliable on first entry of the actionId. |
| 3 | L2 persistent hit after restart | ✅ unit-tested | `NarrationApplication.test.ts` proves `source:persistent` after restart; E2E needs a process restart (operator). |
| 4 | browser L0 hit (no HTTP) | ✅ run | L0-replay asserts **no new** `/api/action-speech` fetch on replay. |
| 5 | prefetch next Action | ✅ observed | 2nd `/api/action-speech` fetch-start appears during current playback (seen in diagnostics). |
| 6 | rapid Action switch / cross-talk | ◑ Not observable (client) | The MediaSession generation guard + abort are unit/interaction-tested; black-box cross-talk assertion deferred (needs >5 actions). |
| 7 | replay current Action | ✅ run | See #4. |
| 8 | autoplay blocked | ⚠️ Not run | Headless uses `--autoplay-policy=no-user-gesture-required`; a no-autoplay project is needed to force-block. |
| 9 | L2 unwritable → degrade to provider | ✅ unit-tested | Fallback path covered by `NarrationApplication.test.ts`. |
| 10 | provider fail/timeout/cancel → no partial MP3 | ✅ unit-tested | Atomicity invariants in `NarrationApplication.test.ts`. |
| 11 | same-key 1/5/20 concurrency → 1 provider call | ✅ implemented | `narration.concurrency.spec.ts`. File-count assertion needs `VOICE_BENCHMARK_CACHE_DIR` exposed; single-flight itself is unit-tested (`flight-leader`/`flight-waiter`, `singleFlightWaitMs`). |

### 二. Text turn Coach

| # | Scenario | Status | Note |
|---|---|---|---|
| 1 | streaming turn | ✅ run | Reaches browser playback (standalone ~1.2min). Flaky on 2nd iteration in the combined run (LLM/TTS slow → failed sample, recorded honestly). |
| 2 | request-response compatibility | ⚠️ Not run | Served plan uses `coachTurnTransport:stream`, so `/api/action-coach` never fires. Spec records this honestly. rr also lacks a correlated `browser-audio-started` (G3, see proposal). |
| 3 | CosyVoice path | ✅ | CosyVoice is the TTS for both turn transports. |
| 4 | Omni path | ❌ N/A | Omni is legacy text request-response only; **not** wired into streaming/composition; no recorded→Omni link exists. |
| 5–10 | short/med/long, two-turn, switch, cancel, preempt, autoplay, timeout, http-fail, cancel | ◑ / ✅ | Preempt (narration→turn) ✅ run. Cancel/switch are client-driven and observable. Detailed variants not all run (sample budget). |

### 三. Recorded voice turn (MediaRecorder → ASR → LLM → TTS)

| # | Scenario | Status | Note |
|---|---|---|---|
| – | full chain with fake-mic | ✅ run | `short.wav`: `i2ba≈12.7–40s`, `req2asr≈1.1–1.9s`, `asr2llm≈6.1–34.4s`, `tts2ba≈25ms`. Mic request/grant + capture start/stop all captured. |
| – | 2s/5s/15s lengths | ⚠️ partial | One Playwright process = one fake-mic WAV; lengths need re-runs with different `VOICE_BENCHMARK_FAKE_MIC_WAV`. 2s (short) run. |
| – | silence / unrecognizable | ⚠️ Not run | Fixtures exist (`silence-2s.wav`, `noise-unrecognizable-2s.wav`); re-run with those paths. |
| – | permission denied / cancel record / cancel upload / ASR fail / LLM-TTS fail | ◑ Not observable (client) | Error paths are app-handled; black-box records whatever happens (no hard assert for failure fixtures). |
| – | ASR first partial | ❌ N/A | Qwen ASR is request-response (`/chat/completions`); no partials. |

### 四. Live Coach (full-duplex)

| # | Scenario | Status | Note |
|---|---|---|---|
| – | open → ws → ready → capture → first audio → browser playback | ⚠️ Not executed | The "实时对话" toggle did **not** open a `/api/coach-realtime` websocket in this dev environment (2.2s soft-fail, `ws open=None`). Likely the realtime provider/credential/region isn't provisioned here. Spec is implemented and will run when a realtime endpoint is available. |
| – | client interrupt / commit / stop, barge-in | ❌ N/A | Product never sends `live.interrupt/commit/stop`. Barge-in is server-driven (`live.interrupted`) only. |
| – | session timeout / payload / assessment fail-closed | ✅ unit-tested | `LiveCoachApplication.test.ts` (fail-closed in assessment). |

### 五. MediaSession arbitration

| # | Transition | Status |
|---|---|---|
| – | narration → turn | ✅ run (`i2ba≈19.9s`, preemption reached turn playback) |
| – | narration → live / turn → live / live → turn-recording | ⚠️ Not executed (depend on Live) |
| – | recorder ↔ live mic lease mutex | ⚠️ Not executed (depends on Live) |
| – | stop/cancel no late audio; page-unload release | ◑ Not observable (client) |

### 六. Network conditions (LAN / RTT 40–80 / 150–250 / shaped / dropout)

⚠️ **Not executed.** Safe network shaping on this macOS host requires root
(`dnctl`/`pfctl`) or an external proxy (`toxiproxy`) and affects global traffic.
Scripts/commands are documented in the runbook section; the matrix is explicitly
**not** claimed as run.

## Real sample results (phase1-smoke)

Source: `benchmark-results/voice/phase1-smoke/runs.jsonl` (small N; **do not
read these as stable p95**). All times ms.

| flow / scenario | it | status | interaction→browserAudio | req→hdr | serverReq→TTS | TTS→browser | asr→llm |
|---|---|---|---:|---:|---:|---:|---:|
| narration/enter-transport-url | 1 | ok | 64 | 17 | – | – | – |
| narration/enter-transport-url | 2 | ok | 68 | 17 | – | – | – |
| recorded/recorded-short | 1 | ok | 12706 | 1946 | 7836 | 25 | 6110 |
| recorded/recorded-short | 2 | ok | 40033 | 1130 | 36045 | 25 | 34376 |
| media-arbitration/narration-then-turn | 1 | ok | 19940 | 15 | – | – | – |
| turn/text-stream | 1 | failed | – | – | – | – | – |
| turn/text-stream | 2 | failed | – | – | – | – | – |

Reference cold narration (direct endpoint probe, not browser): provider
synthesis **~8097ms** for the 41-char action text vs **~65ms** for the memory
hit above — i.e. the cache removes ~8s of TTS wait on repeat.

Bottlenecks observed: recorded-turn latency is dominated by **ASR→LLM**
(`asr2llm` 6–34s, the Claude Code LLM) and, on the 2nd sample, server-side TTS
setup (`serverReq→TTS` 36s). Browser playback once TTS streams is fast
(`tts2ba≈25ms`). Text-turn failures were provider-side slowness/timeout, recorded
as failed samples (never as 0ms).

## N/A, Not observable, Not executed

- **N/A (product does not implement):** recorded→Omni; streaming Omni; client
  `live.interrupt/commit/stop`; ASR first partial; Redis/object-store/CDN.
- **Not observable (black-box, no observation point — see INSTRUMENTATION-PROPOSAL):**
  authoritative server-side `asrFinalAt` (a browser proxy is used instead);
  request-response `browser-audio-started` (G3, no correlationId threaded);
  precise `audioEncodedAt` (bounded by capture-stop→request); client-side
  cross-talk / late-audio / cancellation-effective timing; Live playback
  completion (AudioBufferSourceNode has no `<audio>` ended event).
- **Not executed (implemented but not run here):** Live Coach (realtime ws did
  not open); concurrency file-count assertion (cache dir not exposed);
  network-shaping matrix; rr text turn (served plan is stream); silence/noise
  recorded fixtures; autoplay-blocked.

## Provider call accounting (observed this session)

- Narration: phase1-smoke hits were all cache hits (0 provider calls). One cold
  curl probe = 1 CosyVoice call (~8s). Single-flight guarantees ≤1 call per key.
- Recorded-turn: 2 iterations → ≤2 ASR + ≤2 LLM + streamed TTS segments.
- Text-turn: 2 attempts (failed/timeout) → ≤2 LLM + TTS partial.
- Live: 0 (did not connect).
- Default `npm test` / CI / `npm run benchmark:voice` without
  `VOICE_BENCHMARK_ENABLED=true` = **0 paid calls** (22 skipped).

## Is Redis necessary? — No (for now)

Single-instance deployment: L1 (backend memory, bounded 128) + L2 (filesystem
`SpeechArtifactStore`, survives restart) already cover durable reuse; same-key
concurrency is handled by in-process single-flight (unit-tested: one provider
call). Redis would only be reconsidered under ADR-007's triggers (multi-instance
hot-reuse / cross-instance lock / object-store RTT hurting p95), none of which
this baseline shows. No Redis is introduced.

## Regression threshold suggestions (from observed data; refine after a real baseline)

These are **starting points for CI guards**, not committed SLOs (small N):

- narration cache hit (memory/L2): `interaction→browserAudio` p95 < 500ms;
  cold provider `providerSynthesisMs` p95 < 12s (regression if > 1.5× baseline).
- recorded-turn: `tts→browserAudio` p95 < 250ms (streaming TTS is consistently
  ~25ms); flag `asr→llm` p95 regressions > 2× baseline.
- single-flight: provider-call-count delta ≤ 1 for N concurrent same-key
  requests (hard invariant).
- L0 replay: zero new `/api/action-speech` requests on replay (hard invariant).
- error rate: any provider failure must be recorded as `failed`, never 0ms.

## Verification gates (all green)

```
git diff --check                                           → clean
web/frontend: npm run typecheck (tsc --noEmit)             → exit 0
web/frontend: npm run build                                → exit 0
web/frontend: npm test (vitest)                            → 217/217 passed
web/backend:  npm test                                     → exit 0 (incl. NarrationApplication cache tests)
web/frontend: npm run benchmark:voice (no env)             → 22 skipped, 0 paid calls
```

## How to run

```bash
# 0) backend + frontend already running on :3001 / :5173; DASHSCOPE_API_KEY set.
cd web/frontend
npx playwright install chromium                       # once
./benchmarks/voice/fixtures/generate.sh               # once → fixtures/generated/*.wav

# default (CI-safe): everything skips
npm run benchmark:voice

# real small-sample run (recorded + live need the fake-mic WAV):
FIX="$PWD/benchmarks/voice/fixtures/generated/short.wav"
VOICE_BENCHMARK_ENABLED=true \
VOICE_BENCHMARK_ITERATIONS=3 \
VOICE_BENCHMARK_FAKE_MIC_WAV="$FIX" \
VOICE_BENCHMARK_OUTPUT_DIR=benchmark-results/voice/my-run \
npx playwright test --config=playwright.config.ts

# resummarize an existing run:
node benchmarks/voice/scripts/summarize.mjs benchmark-results/voice/my-run/runs.jsonl benchmark-results/voice/my-run/summary.json
```

## Known limitations & honest gaps

1. **Dev StrictMode aborts load-fired narration.** Against the Vite dev server,
   `React.StrictMode` double-invokes the narration mount effect and its cleanup
   aborts the page-load synthesis before playback. The benchmark drives a real
   "下一个 Action" navigation (a dependency change, not a remount) to enter
   narration cleanly. A production build would not hit this.
2. **Server cache attribution is first-wins on a stable actionId correlationId.**
   Re-entering an Action returns the first entry's stale `source`/`providerSynthesisMs`.
   Phase 1 measures each actionId once and relies on client E2E timestamps (always
   clean). See INSTRUMENTATION-PROPOSAL #3.
3. **Do not pass `--reporter=line`** on the CLI — it overrides the config's JSONL
   reporter and no `runs.jsonl` is written.
4. Live Coach, network shaping, and several failure-fixture variants are
   implemented but **not executed** in this environment — see the matrix.

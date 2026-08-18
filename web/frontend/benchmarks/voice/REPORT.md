# Voice Benchmark — Baseline report (2026-08-14)

Run id: `baseline-20260814T1659` · Date: 2026-08-14 (16:59–20:45 Asia/Shanghai) ·
Code SHA: `3e744e6de184f2876ea2f4b0624b1d7119a90762` (dirty: pre-existing
`web/frontend/src/styles/practice.css` user edit, untouched) · Raw data:
`benchmark-results/voice/baseline-20260814T1659/` (git-ignored).

Providers (real, no mocks): **LLM = DeepSeek direct API** (`deepseek-api`,
model `deepseek-v4-flash`, `COACH_TEXT_PROVIDER=deepseek`,
`DeepSeekTextCoachEngine` over `api.deepseek.com`) · ASR = `qwen3-asr-flash`
(DashScope) · TTS = `cosyvoice-v3-plus` (DashScope) · browser = real Chromium
driving the production React page; only the mic is a fixed WAV fixture.
**Claude Code was not configured, invoked, or tested anywhere in this run** —
verified by telemetry (below), not by assertion.

Sample-scale summary: 752 raw records (650 browser + 102 direct-API),
19 browser groups + 6 direct-API groups. p95 is annotated with N everywhere;
**no p95 claim is made for any N < 20**.

## What this run replaces

The phase1-smoke report (2026-08-13) drew conclusions from ~7 samples. This
baseline replaces those judgments. Two phase1 claims are **obsolete**:

1. *"recorded-turn latency is dominated by ASR→LLM (`asr2llm` 6–34s, the
   Claude Code LLM)"* — **wrong for the current stack**: with the DeepSeek
   direct-API engine, ASR→LLM first text is **p50 ≈ 0.9–1.0s, p95 ≤ 1.35s**
   across all recorded fixtures (N=19–29 each). The Claude-Code text coach was
   replaced by the DeepSeek adapter before this run (commit `3e744e6`
   "stream replies from DeepSeek API"); nothing in this run exercised
   Claude Code.
2. *"text-turn failures were provider-side slowness/timeout"* — text-stream is
   now **30/30 successful**, i2a p50 2.8s / p95 4.2s (N=30).

## Experiment A — direct API coach benchmark (backend script, no browser)

`COACH_TEXT_PROVIDER=deepseek npm run benchmark:coach -- --warm 30 --cold 20
--mode stream|request-response --jsonl …`. Cold = fresh child process per
attempt; warm = same primed process; the 1 priming run per mode is excluded.
All times ms. **0 failures in 100 attempts.**

| group | N | metric | min | mean | p50 | p90 | p95 | max | std |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| stream warm | 30 | llmFirstText | 474 | 952 | 909 | 1411 | 1549 | 1691 | 332 |
| stream warm | 30 | firstSpokenSegment | 659 | 1218 | 1168 | 1716 | 1927 | 2179 | 397 |
| stream warm | 30 | ttsFirstAudio | 1317 | 2377 | 2527 | 3133 | 3503 | 3749 | 728 |
| stream warm | 30 | complete (full drain) | 14212 | 20793 | 21257 | 23972 | 25287 | 26526 | 3079 |
| stream cold | 20 | llmFirstText | 746 | 1042 | 912 | 1383 | 1870 | 1902 | 323 |
| stream cold | 20 | firstSpokenSegment | 931 | 1238 | 1117 | 1648 | 2042 | 2192 | 340 |
| stream cold | 20 | ttsFirstAudio | 2169 | 2721 | 2537 | 3473 | 3610 | 3943 | 522 |
| stream cold | 20 | complete (full drain) | 15570 | 22496 | 21712 | 27717 | 32152 | 34175 | 4735 |
| rr warm | 30 | total (blocking) | 12595 | 17715 | 18275 | 20069 | 20288 | 26298 | 2812 |
| rr cold | 20 | total (blocking) | 14610 | 18095 | 18649 | 20327 | 20465 | 22012 | 2180 |

Warm vs cold: **no meaningful first-token difference** (p50 909 vs 912ms);
cold p95s are slightly higher and cold complete-drain p95 ~3.2s worse — new
processes add variance, not a fixed startup cost. The 15s LLM timeout never
fired; no rate-limit or auth errors occurred (0 failures).

## Experiment B — browser voice-chain benchmark (real Chromium → local backend/frontend)

### B-narration (deterministic Action copy, CosyVoice TTS only — no LLM)

Interaction = click "下一个 Action" → browser audio starts. Grouped by the
authoritative server-reported artifact source.

| cache level | N | min | mean | p50 | p90 | p95 | max | server stage detail |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| provider cold (fresh namespace + fresh process per sample) | 20 | 3618 | 4224 | 4109 | 4627 | 4686 | 5736 | lookup ~0.1ms (miss) → synthesis p50 4059ms, artifact ≈109KB |
| L2 persistent hit (restart, artifact dir preserved) | 30 | 44 | 57 | 58 | 65 | 66 | 71 | fs lookup ≈0.6ms |
| L1 memory hit (same process re-entry) | 202 | 45 | 63 | 62 | 74 | 77 | 85 | in-proc map lookup ≈0.003ms |
| L0 browser blob replay | 102 | – | – | – | – | – | – | **102/102 zero new `/api/action-speech` requests** (hard invariant, 100%) |

Notes: L1 N=202 = 100 planned + 102 re-entries produced by the L0 batches'
setup steps (all measured, none deleted). Cache removes **~4.0s** of TTS wait
on repeat; L2 costs only ~4–5ms over L1. Cache-stage durations other than the
entry's own path (e.g. `providerSynthesisMs` on a hit) are first-wins-stale on
re-entries and are excluded — labels (`narrationArtifactSource`) ARE fresh per
entry (empirically re-verified this run).

### B-turn flows (ASR → DeepSeek → CosyVoice streaming → browser)

All against the dev frontend (:5173); recorded flows feed a fixed WAV via
Chromium fake-audio-capture. `i2a` = first coach interaction → browser audio.

| scenario | attempts | ok | i2a p50 | i2a p90 | i2a p95 (N) | req→ASR-final p50 | ASR→LLM-first-text p50 | srvReq→TTS-first-audio p50 | TTS→browser p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| text-stream | 30 | 30 | 2839 | 4025 | 4158 (30) | n/a (text input) | – | 2574 | 24 |
| recorded-short (2s) | 30 | 29 | 6786 | 7935 | 8135 (29) | 1362 | 917 | 2469 | 24 |
| recorded-medium | 20 | 20 | 7764 | 8539 | 8993 (20) | 1488 | 866 | 2973 | 24 |
| recorded-long | 20 | 19 | 7303 | 8921 | 9288 (19)¹ | 1487 | 1016 | 2845 | 24 |
| recorded-silence-2s² | 10 | 10 | 6608 | 8636 | 9299 (10)² | 1044 | 898 | 2757 | 24 |
| recorded-noise-2s² | 10 | 10 | 7030 | 8808 | 9130 (10)² | 1581 | 871 | 2646 | 24 |
| arbitration narration→turn | 22 | 22 | ~3.1s | ~3.4s | 3.4s (22) | n/a (text turn) | – | – | – |

¹ N=19 < 20 → **not a stable p95**, report as indicative only.
² Silence/noise rows are **failure-behavior statistics only** (kept out of the
normal latency distribution per the sampling plan). Behavior observed: the ASR
returned a transcript (hallucinated filler) for both silence and noise, the
coach replied normally, and playback completed 10/10 — i.e. **no hard failure
occurred for these fixtures**; "unrecognizable input" currently degrades to a
normal reply rather than an error.

Failure distribution across all B-turn flows (112 attempts): 2 genuine
failures — 1 recorded-short "no correlationId (upload fetch never fired)",
1 recorded-long same class; both recorded as failed samples with no zero
latencies. Everything else succeeded.

### B-concurrency (same-key single-flight, cold key per round)

Run against a **production build served by `vite preview` (:4173)**: the Vite
**dev** server's on-demand module loading starves 20 simultaneous page loads
(pages never finished loading in 180–300s), which is a dev-server serving
limitation, not a backend behavior — the preview build removes it. Each round:
fresh empty artifact namespace + fresh backend process → truly cold key.

| clients | attempts | ok | provider-call delta per round | verdict |
|---:|---:|---:|---|---|
| 1 | 10 | 10 | 1 every round | ≤1/key ✓ (10/10) |
| 5 | 10 | 9 | 1 every ok round | ≤1/key ✓ (9/9 measured) |
| 20 | 10 | 0³ | 2 in the 3 measurable rounds | **2 distinct keys × exactly 1 synthesis each**; per-key ≤1 ✓ |

³ In a production build the page-load narration (no StrictMode abort) adds a
second cache key per 20-client round: the measured `delta=2` = load-narration
key + click-narration key, each synthesized exactly once (verified by cache
file inspection). Waiters waited on the single flight (`singleFlightWaitMs`
4333ms ≈ leader synthesis 4349ms; first client i2a 15.7s incl. page burst).
The other 7 rounds stalled **in the browser** (20 tabs' page/audio contention
past the 300s test timeout) and produced no delta; the backend served them
(abort traces show teardown-time disconnects). Honest classification: c20
browser-side E2E is **environment-limited (N=3 measured)**; backend
single-flight itself held in 100% of measurable rounds (c1+c5+c20 → 22/22).

The first 30 concurrency rounds (dev server, before the environment fixes
below) were invalidated by the page-reload defect; they remain in the JSONL as
failed records and are excluded from the table.

### Live Coach — **Not executed**

The "实时对话" toggle again did **not** open a `/api/coach-realtime`
websocket (1 probe attempt: "live toggle did not open a /api/coach-realtime
websocket"). Same as phase1: the realtime provider/credential is evidently not
provisioned in this environment. No data fabricated;
`recorder-live-mutex` (depends on Live) is consequently Not executed too.

### N/A (unchanged from phase1)

recorded→Omni; streaming Omni; client `live.interrupt/commit/stop`; ASR first
partial (Qwen ASR is request-response); Redis/object-store/CDN (see phase1
Redis judgment — unchanged, single-instance L1+L2+single-flight suffices).

## Provider verification (no Claude Code anywhere)

- Backend `coach_turn_timeline` log lines with a provider field:
  **140 × `"provider":"deepseek-api"`, 0 × anything else** — exactly matching
  the 140 completed LLM turns (30 text + 29 short + 20 medium + 19 long +
  10 silence + 10 noise + 22 arbitration).
- Direct-API script JSONL opens with `{"meta":"provider","provider":"deepseek-api","model":"deepseek-v4-flash"}`
  per invocation (4 invocations: 2 modes × warm+cold phases).
- `claude` / `claude-code` grep across every backend log, every runs.jsonl and
  both direct JSONLs: **0 matches**.
- Narration (no LLM) samples carry no provider by design.

## Bottlenecks (from the new data)

1. **Narration cold TTS synthesis ≈ 4.1s p50 / 4.7s p95** dominates the cold
   path; every cache level collapses it to <90ms end-to-end.
2. **Recorded-turn E2E (~6.8–7.8s p50)** decomposes as: upload+ASR ≈ 1.4–1.5s →
   DeepSeek first text ≈ 0.9s → **first spoken audio gate: srvReq→TTS
   ≈ 2.5–3.0s p50** → browser starts in ~23ms. The largest remaining lever is
   TTS first-audio latency (CosyVoice synthesis of the first segment), not the
   LLM.
3. **Full answer drain** (stream complete) is ~21s p50 for a ~130–170-char
   answer — per-segment TTS synthesis serializes behind the segmenter; fine
   for interactivity (first audio ≈2.5s) but bounds total narration length.
4. No long-tail/bimodality: std ≈ p50/4 for most metrics; no degradation trend
   across consecutive requests (success rates stayed 100% through 30-sample
   sequences); zero provider errors/timeouts/rate-limits in 752 records.

## Regression thresholds (proposed CI guards — NOT SLOs)

Baseline-derived starting points (regression = exceed by >1.5× baseline p95,
or violate a hard invariant):

- narration cache hit (L1/L2): interaction→browserAudio p95 < **250ms**
  (baseline 66–77ms, N≥30); L0 replay: **0** new speech requests (hard).
- narration provider cold: synthesis p95 < **7s** (baseline 4.7s, N=20).
- text-stream turn: i2a p95 < **6s** (baseline 4.2s, N=30);
  srvReq→TTS-first-audio p95 < **6s** (baseline 3.9s, N=30).
- recorded-short turn: i2a p95 < **12s** (baseline 8.1s, N=29);
  TTS→browser-audio p95 < **100ms** (baseline 24ms) — hard cap candidate.
- single-flight: new provider artifacts per cold key burst ≤ 1 (hard).
- error accounting: any failure must be recorded `failed` with **no zero
  latencies** (verified: the only 0-valued fields are a stale derived
  `serverTotal` on 2 cancelled concurrency rounds, documented above).
- LLM identity: every turn telemetry line must read `provider=deepseek-api`;
  any `claude-code` occurrence fails the run (hard).

## Benchmark-environment defects found & fixed this run (benchmark-only changes)

1. `web/backend/scripts/benchmark-coach-turn.ts`: added `--jsonl` per-attempt
   raw records + a provider-identity meta line (the script previously printed
   only aggregates, so raw samples weren't traceable).
2. `web/frontend/benchmarks/voice/specs/narration.concurrency.spec.ts`: a
   teardown race in `context.close()` discarded completed measurements
   (several valid rounds lost before the fix).
3. `web/frontend/vite.config.ts`: dev-server watch now ignores
   `benchmark-results/` — Playwright trace writes were reloading every open
   page mid-benchmark (289 stray reloads logged before the fix; this is what
   systematically killed 20-client rounds on the dev server).

Run tooling (backend restart loops, port-ownership verification, env handling
without ever logging keys) lives in the run directory
(`baseline-20260814T1659/tools/`), not the repo.

## Traceability

- Raw JSONL per invocation: `baseline-20260814T1659/{a-direct-api,B0…B12,…}/…/runs.jsonl`
  + per-dir `summary.json` (stock reporter). Cross-run rollup incl. N
  cross-checks vs raw line counts (all match), failure-reason distributions,
  concurrency deltas and the provider audit:
  `baseline-20260814T1659/cross-summary/summary.json`; run metadata:
  `manifest.json`. Backend logs per process in `backend-logs/`.
- All large artifacts stay in the git-ignored run directory; nothing was
  committed. API keys were read from the operator's shell environment only
  and never printed, logged, or written to any file in the repo.

## Not executed / reduced, with reasons

| item | status | reason |
|---|---|---|
| Live Coach (incl. recorder-live-mutex) | Not executed | realtime websocket never opens in this environment (probe recorded) |
| c20 concurrency E2E latency | reduced (N=3 measured) | 20-tab browser page/audio contention stalls past 300s; backend single-flight verified on all measurable rounds |
| Network-shaping matrix | Not executed (unchanged) | requires root/toxiproxy on macOS host |
| autoplay-blocked narration | Not executed (unchanged) | headless runs with autoplay allowed |
| rr text turn via browser | N/A | served plan declares `coachTurnTransport:stream`; rr measured via direct API (experiment A) instead |

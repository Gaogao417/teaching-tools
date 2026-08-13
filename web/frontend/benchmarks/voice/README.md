# Real voice-chain benchmark

This Playwright suite drives the production React page in real Chromium. It
does not replace `Audio`, `fetch`, the backend cache, or either provider. The
browser observer records Action entry, speech/turn request start, response
headers, and the existing `POST /api/coach/telemetry` playback marks. It then
joins them with `GET /api/coach/telemetry/:correlationId`.

The suite is opt-in. A normal test/CI run skips every benchmark and therefore
cannot spend TTS/LLM quota.

## Prerequisites

1. Start the backend with the intended provider credentials and cache directory.
2. Start the frontend with `VITE_API_BASE_URL` pointing at that backend.
3. Install Chromium once with `npx playwright install chromium`.

## Run

From `web/frontend`:

```bash
VOICE_BENCHMARK_ENABLED=true \
VOICE_BENCHMARK_UI_BASE_URL=http://127.0.0.1:5173 \
VOICE_BENCHMARK_API_BASE_URL=http://127.0.0.1:3001 \
VOICE_BENCHMARK_TASK_ID=auxiliaryTwoRatios \
VOICE_BENCHMARK_ITERATIONS=5 \
npx playwright test --config=playwright.config.ts
```

Useful selectors:

- `VOICE_BENCHMARK_NARRATION_SCENARIO=provider-cold|memory-hit|persistent-after-restart|page-load`
- `VOICE_BENCHMARK_TURN_SCENARIO=text-stream`
- `VOICE_BENCHMARK_RECORDED_SCENARIO=recorded-short` (tag; the active fixture drives the length)
- `VOICE_BENCHMARK_LIVE_SCENARIO=live-open`
- `VOICE_BENCHMARK_ARBITRATION_SCENARIO=arbitration-basic`
- `VOICE_BENCHMARK_COACH_QUESTION=...`
- `VOICE_BENCHMARK_TIMEOUT_MS=120000`
- `VOICE_BENCHMARK_OUTPUT_DIR=benchmark-results/voice/my-run`
- `VOICE_BENCHMARK_RUN_ID=cache-v2-baseline`
- `VOICE_BENCHMARK_FAKE_MIC_WAV=/abs/path/to/short.wav` — fixed mic fixture (recorded-turn + Live self-skip without it). Generate with `./fixtures/generate.sh`; see `fixtures/README.md`.
- `VOICE_BENCHMARK_CACHE_DIR=/abs/path` — operator-exposed backend `ACTION_SPEECH_CACHE_DIR`; enables the concurrency single-flight file-count assertion (skipped if unset).
- `VOICE_BENCHMARK_CONCURRENCY_CLIENTS=5` — same-key concurrent narration clients.

> Do not pass `--reporter=line` on the CLI — it overrides this config's JSONL
> reporter and no `runs.jsonl` is written.

Coverage, real sample results, the N/A / Not-observable / Not-executed matrix,
the Redis judgment, regression thresholds, and an optional instrumentation
patch proposal live in **[REPORT.md](./REPORT.md)** and
**[INSTRUMENTATION-PROPOSAL.md](./INSTRUMENTATION-PROPOSAL.md)**.

Scenario names are tags, not cache controls. Prepare the backend before each
run: use a new/empty artifact namespace for `provider-cold`, repeat without a
restart for `memory-hit`, and restart the process while preserving the artifact
directory for `persistent-after-restart`. The recorded
`narrationArtifactSource` is authoritative; an unavailable `cacheSource` remains
`unknown` instead of being guessed by the harness.

To benchmark only one flow:

```bash
npx playwright test benchmarks/voice/specs/narration.benchmark.spec.ts --config=playwright.config.ts
npx playwright test benchmarks/voice/specs/turn-coach.benchmark.spec.ts --config=playwright.config.ts
```

## Results

The reporter writes:

- `runs.jsonl`: one lossless record per iteration, including client marks, the
  sanitized server timeline, cache-stage durations and derived durations.
- `summary.json`: counts plus min/mean/p50/p95/max grouped by
  `flow + scenario + cacheSource`.
- `playwright-artifacts/`: trace/screenshot only when a run fails.

Important derived metrics include interaction/Action-enter/request to actual
browser audio, server request to TTS first audio, and TTS first audio to browser
playback. Browser and server epoch timestamps assume normal clock sync because
both services run on the same benchmark host; the raw timestamps remain in
JSONL so remote-host clock error can be diagnosed.

An existing JSONL file can be summarized again:

```bash
node benchmarks/voice/scripts/summarize.mjs path/to/runs.jsonl path/to/summary.json
```

Use at least 100 cached iterations for a stable p95. For paid cold-provider
runs, 20–30 iterations are a practical starting point; report p50/p90 or raw
samples when the sample count is too small to support a meaningful p95.

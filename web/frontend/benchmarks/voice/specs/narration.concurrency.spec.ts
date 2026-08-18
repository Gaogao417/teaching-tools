import { expect, test } from "@playwright/test";
import { readdirSync } from "node:fs";
import { voiceBenchmarkEnvironment } from "../env";
import {
  advanceToNarration,
  browserEvents,
  buildRecord,
  failedRecord,
  installVoiceBrowserObserver,
  probeVoiceEnvironment,
  readTimeline,
  waitForBrowserEvent,
} from "../browserHarness";
import type { VoiceBenchmarkRecord } from "../types";

const env = voiceBenchmarkEnvironment();

/** Count .mp3 artifacts in the operator-exposed ACTION_SPEECH_CACHE_DIR. Each
 *  successful provider synthesis writes exactly one new .mp3; single-flight
 *  therefore implies at most one new file per concurrent same-key burst. */
function countMp3Files(cacheDir: string): number {
  try {
    return readdirSync(cacheDir).filter((name) => name.endsWith(".mp3")).length;
  } catch {
    return 0;
  }
}

test.describe("deterministic Action narration concurrency benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");

  test(`narration concurrency ${env.concurrencyClients} clients single-flight`, async ({ browser, request }, testInfo) => {
    const route = `/learn/${encodeURIComponent(env.taskId)}`;
    const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
    test.skip(Boolean(unavailable), unavailable);

    const clients = Math.max(1, env.concurrencyClients);
    const canCountFiles = env.cacheDir !== "";
    // If env.cacheDir === "" the file-count assertion is Not executed
    // (VOICE_BENCHMARK_CACHE_DIR not exposed); we still run the concurrency timing
    // so per-client latency data is collected. We intentionally do NOT call
    // test.skip() here, because that would abort the whole run and discard the
    // concurrency timing — only the file-count assertion is skipped.

    const interactionStartedAt = Date.now();
    let record: VoiceBenchmarkRecord;
    let fileCountDelta: number | undefined;
    try {
      // Snapshot the .mp3 count before firing any client.
      const before = canCountFiles ? countMp3Files(env.cacheDir) : undefined;

      const context = await browser.newContext();
      try {
        const pages = await Promise.all(Array.from({ length: clients }, () => context.newPage()));
        await Promise.all(pages.map((p) => installVoiceBrowserObserver(p)));

        // Load every client against the same taskId, wait for the workspace, then
        // (concurrently) advance each to the next action so they all fire the SAME
        // narration cache key near-simultaneously — exercising backend single-flight.
        await Promise.all(pages.map(async (p) => {
          await p.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
          await expect(p.getByTestId("action-runtime-workspace")).toBeVisible({ timeout: env.timeoutMs });
        }));

        const perClient = await Promise.all(pages.map(async (p, idx) => {
          const { correlationId } = await advanceToNarration(p, env.timeoutMs, "next");
          if (!correlationId) throw new Error(`client ${idx}: narration request did not carry a correlationId`);
          await waitForBrowserEvent(p, {
            kind: "telemetry",
            correlationId,
            owner: "narration",
            playbackOutcome: true,
          }, env.timeoutMs);
          return { page: p, correlationId };
        }));

        const firstPage = perClient[0].page;
        const firstCorrelationId = perClient[0].correlationId;

        // After every client reached browser-audio-started, snapshot again.
        const after = canCountFiles ? countMp3Files(env.cacheDir) : undefined;
        fileCountDelta = before !== undefined && after !== undefined ? after - before : undefined;

        const timeline = await readTimeline(request, env.apiBaseUrl, firstCorrelationId, env.timeoutMs);
        record = buildRecord({
          runId: env.runId,
          flow: "narration",
          scenario: `concurrency-${clients}-clients`,
          tags: ["concurrency", "single-flight", "real-browser", "real-provider"],
          iteration: 1,
          taskId: env.taskId,
          route,
          correlationId: firstCorrelationId,
          interactionStartedAt,
          events: await browserEvents(firstPage),
          timeline,
        });

        // Carry the provider-call file-count delta as an extra top-level key. The
        // server timeline has an index signature, but the record's top-level shape
        // is closed; we cast to attach the count without a shared-file change.
        if (fileCountDelta !== undefined) {
          (record as VoiceBenchmarkRecord & { providerCallCountDelta?: number }).providerCallCountDelta = fileCountDelta;
        }
      } finally {
        // A teardown race in context.close() (context already closed) must not
        // discard a completed measurement: swallow it so the record built above
        // still reaches the attachment + assertions below.
        try { await context.close(); } catch { /* teardown race; data is intact */ }
      }
    } catch (error) {
      record = failedRecord({ runId: env.runId, flow: "narration", scenario: `concurrency-${clients}-clients`, iteration: 1, taskId: env.taskId, route, error, interactionStartedAt });
      await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
      throw error;
    }
    // Attach the detailed record BEFORE the structural assertions so a single-flight
    // regression (delta > 1) still yields its data attachment instead of a failedRecord.
    await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
    expect(record.status, "first client narration must reach actual browser playback").toBe("ok");
    if (canCountFiles) {
      expect(fileCountDelta, `single-flight must produce at most 1 new provider file (delta=${fileCountDelta})`).toBeLessThanOrEqual(1);
    }
  });
});

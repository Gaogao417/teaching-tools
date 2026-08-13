import { expect, test } from "@playwright/test";
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

/**
 * Deterministic Action narration benchmark.
 *
 * Driven by a real "下一个 Action" navigation rather than initial page load:
 * against the Vite dev server, React.StrictMode double-invokes the narration
 * mount effect and its cleanup aborts the load-fired synthesis before playback,
 * so load-narration never reaches `browser-audio-started`. A user action switch
 * enters narration exactly once and plays. See `advanceToNarration`.
 *
 * The served transport (url|stream) and the observed cache layer
 * (provider|memory|persistent) are READ from telemetry, not forced. Iteration 1
 * of a fresh namespace is the cold (provider) sample; subsequent re-entries of a
 * warmed action yield memory samples — both are recorded honestly and the
 * reporter groups them by cacheSource.
 */
test.describe("deterministic Action narration benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");

  for (let iteration = 1; iteration <= env.iterations; iteration += 1) {
    test(`narration enter iteration ${iteration}`, async ({ page, request }, testInfo) => {
      const route = `/learn/${encodeURIComponent(env.taskId)}`;
      const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
      test.skip(Boolean(unavailable), unavailable);
      await installVoiceBrowserObserver(page);
      let record: VoiceBenchmarkRecord;
      try {
        await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
        // Single next-action navigation per fresh page → action 2. Client E2E latency
        // is always clean per page session. NOTE: server cache attribution
        // (narrationArtifactSource / *LookupMs / providerSynthesisMs) is reliable only
        // on the FIRST entry of this actionId since backend start — the InMemoryTelemetrySink
        // merges first-wins on the stable actionId correlationId, so re-entries return the
        // first entry's stale source/phase fields. See coverage matrix + patch proposal.
        const { correlationId, interactionStartedAt } = await advanceToNarration(page, env.timeoutMs, "next");
        await waitForBrowserEvent(page, {
          kind: "telemetry",
          correlationId,
          owner: "narration",
          playbackOutcome: true,
        }, env.timeoutMs);
        const timeline = await readTimeline(request, env.apiBaseUrl, correlationId, env.timeoutMs);
        const transport = (await browserEvents(page)).some((event) => event.kind === "fetch-start" && event.url?.includes("/api/action-speech-stream")) ? "stream" : "url";
        record = buildRecord({
          runId: env.runId,
          flow: "narration",
          scenario: `enter-transport-${transport}`,
          tags: ["deterministic-copy", "action-enter", "real-browser", "real-provider"],
          iteration,
          taskId: env.taskId,
          route,
          correlationId,
          interactionStartedAt,
          events: await browserEvents(page),
          timeline,
        });
        expect(record.status, "narration must reach actual browser playback").toBe("ok");
      } catch (error) {
        record = failedRecord({ runId: env.runId, flow: "narration", scenario: "enter", iteration, taskId: env.taskId, route, error });
        await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
        throw error;
      }
      await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
    });
  }

  test.describe("browser L0 replay (no new fetch)", () => {
    for (let iteration = 1; iteration <= Math.max(1, Math.min(env.iterations, 3)); iteration += 1) {
      test(`narration l0-replay iteration ${iteration}`, async ({ page, request }, testInfo) => {
        const route = `/learn/${encodeURIComponent(env.taskId)}`;
        const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
        test.skip(Boolean(unavailable), unavailable);
        await installVoiceBrowserObserver(page);
        let record: VoiceBenchmarkRecord;
        try {
          await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
          await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
          const { correlationId, interactionStartedAt } = await advanceToNarration(page, env.timeoutMs, "next");
          await waitForBrowserEvent(page, { kind: "telemetry", correlationId, owner: "narration", playbackOutcome: true }, env.timeoutMs);
          // Replay plays the cached blob WITHOUT a new /api/action-speech request (L0 hit).
          const replay = page.getByRole("button", { name: /重播当前 Action 讲解|重播老师语音/ });
          await expect(replay).toBeEnabled();
          const beforeReplay = Date.now();
          await replay.click();
          // Assert NO new action-speech fetch-start appears within a short window.
          let staleFetch = false;
          try {
            await waitForBrowserEvent(page, { kind: "fetch-start", urlIncludes: "/api/action-speech", minAt: beforeReplay }, 3000);
            staleFetch = true; // a new fetch DID appear → not an L0 hit
          } catch { /* expected: no new fetch → L0 hit */ }
          record = buildRecord({
            runId: env.runId,
            flow: "narration",
            scenario: "l0-browser-hit-replay",
            tags: ["deterministic-copy", "l0-cache", "replay", "real-browser", "real-provider"],
            iteration,
            taskId: env.taskId,
            route,
            correlationId,
            interactionStartedAt,
            events: await browserEvents(page),
            timeline: await readTimeline(request, env.apiBaseUrl, correlationId, env.timeoutMs),
            status: staleFetch ? "failed" : "ok",
          });
          expect(record.status, "replay must not issue a new action-speech request (L0 hit)").toBe("ok");
        } catch (error) {
          record = failedRecord({ runId: env.runId, flow: "narration", scenario: "l0-browser-hit-replay", iteration, taskId: env.taskId, route, error });
          await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
          throw error;
        }
        await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
      });
    }
  });

  test("narration persistent-after-restart", () => {
    test.skip(true, "requires operator to restart the backend process while preserving ACTION_SPEECH_CACHE_DIR; not automatable from the test process (registered so --list discovers it)");
  });
});

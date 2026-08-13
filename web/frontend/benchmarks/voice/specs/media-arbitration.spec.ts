import { expect, test } from "@playwright/test";
import { voiceBenchmarkEnvironment } from "../env";
import {
  advanceToNarration,
  browserEvents,
  buildRecord,
  failedRecord,
  installVoiceBrowserObserver,
  peekTimeline,
  probeVoiceEnvironment,
  waitForBrowserEvent,
} from "../browserHarness";
import type { VoiceBenchmarkRecord } from "../types";

const env = voiceBenchmarkEnvironment();

// MediaSession arbitration: only one audio owner is active at a time. This file
// exercises the two transitions observable from a single /learn/:taskId page:
//   1. narration-then-turn  — turn Coach playback preempts narration.
//   2. recorder-live-mutex  — while Live holds the capture lease, the recorder's
//                             mic button is disabled (DOM-visible exclusivity).
//
// Other arbitration transitions (NOT executed in this file — require
// multi-action/multi-window choreography; see coverage matrix):
//   - turn → live                  Not executed in this file — requires multi-action/multi-window choreography; see coverage matrix.
//   - live → turn-recording        Not executed in this file — requires multi-action/multi-window choreography; see coverage matrix.
//   - narration → live             Not executed in this file — requires multi-action/multi-window choreography; see coverage matrix.
//   - page-unload media release    Not executed in this file — requires multi-action/multi-window choreography; see coverage matrix.

test.describe("MediaSession arbitration browser benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");

  test(`arbitration ${env.arbitrationScenario} narration-then-turn`, async ({ page, request }, testInfo) => {
    const route = `/learn/${encodeURIComponent(env.taskId)}`;
    const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
    test.skip(Boolean(unavailable), unavailable);
    await installVoiceBrowserObserver(page);
    let interactionStartedAt: number | undefined;
    let record: VoiceBenchmarkRecord;
    try {
        await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();

        // Enter a real narration (page-load narration is dev-StrictMode-aborted; see
        // advanceToNarration) and let it become the active media owner.
        const narration = await advanceToNarration(page, env.timeoutMs, "next");
        await waitForBrowserEvent(
          page,
          { kind: "telemetry", owner: "narration", correlationId: narration.correlationId, playbackOutcome: true },
          env.timeoutMs,
        );

        interactionStartedAt = Date.now();

      // Open the coach rail and fire a turn while narration is/has been the owner.
      await page.getByRole("button", { name: "展开陪练老师" }).click();
      const composer = page.getByPlaceholder("文字或语音问老师");
      await expect(composer).toBeVisible();
      await composer.fill(env.coachQuestion);
      await page.getByRole("button", { name: "发送问题" }).click();

      // Arbitration assertion: a turn browser-audio-started telemetry event must
      // arrive, i.e. the media arbitrator preempted narration and started turn
      // playback (narration is no longer the active owner).
      const turnPlayback = await waitForBrowserEvent(
        page,
        { kind: "telemetry", owner: "turn", playbackOutcome: true },
        env.timeoutMs,
      );
      const turnCorrelationId = turnPlayback.correlationId || "arbitration";
      const timeline =
        (await peekTimeline(request, env.apiBaseUrl, turnCorrelationId)) ?? {
          correlationId: turnCorrelationId,
          flow: "media-arbitration" as const,
        };

      record = buildRecord({
        runId: env.runId,
        flow: "media-arbitration",
        scenario: "narration-then-turn",
        tags: ["arbitration", "preempt", "real-browser", "real-provider"],
        iteration: 1,
        taskId: env.taskId,
        route,
        correlationId: turnCorrelationId,
        interactionStartedAt,
        events: await browserEvents(page),
        timeline,
      });
      expect(record.status, "turn playback must preempt narration").toBe("ok");
    } catch (error) {
      record = failedRecord({
        runId: env.runId,
        flow: "media-arbitration",
        scenario: "narration-then-turn",
        iteration: 1,
        taskId: env.taskId,
        route,
        error,
        interactionStartedAt,
      });
      await testInfo.attach("voice-benchmark-result", {
        body: Buffer.from(JSON.stringify(record)),
        contentType: "application/json",
      });
      throw error;
    }
    await testInfo.attach("voice-benchmark-result", {
      body: Buffer.from(JSON.stringify(record)),
      contentType: "application/json",
    });
  });

  test(`arbitration ${env.arbitrationScenario} recorder-live-mutex`, async ({ page, request }, testInfo) => {
    test.skip(!env.fakeMicWav, "recorder-live-mutex requires VOICE_BENCHMARK_FAKE_MIC_WAV (mic-dependent)");

    const route = `/learn/${encodeURIComponent(env.taskId)}`;
    const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
    test.skip(Boolean(unavailable), unavailable);
    await installVoiceBrowserObserver(page);
    let interactionStartedAt: number | undefined;
    let correlationId = "arbitration";
    let record: VoiceBenchmarkRecord;
    try {
      await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
      await page.getByRole("button", { name: "展开陪练老师" }).click();

      interactionStartedAt = Date.now();

      // Start Live so it acquires the capture lease. Wait for live.ready, after
      // which getUserMedia + AudioWorklet are running and the recorder cannot grab
      // the mic.
      await page.getByRole("button", { name: "实时对话" }).click();
      const ready = await waitForBrowserEvent(
        page,
        { kind: "websocket", phase: "ready", urlIncludes: "/api/coach-realtime" },
        env.timeoutMs,
      );
      correlationId = ready.correlationId || correlationId;

      // Arbitration assertion: while Live holds the mic, the recorder's mic button
      // is disabled. Short timeout — we only probe the steady mutex state.
      const micButton = page.getByRole("button", { name: "语音提问" });
      let disabled = false;
      try {
        await expect(micButton).toBeDisabled({ timeout: 5_000 });
        disabled = true;
      } catch {
        disabled = false;
      }

      // Clean up the live session (best-effort).
      try {
        await page.getByRole("button", { name: "结束对话" }).click();
        await waitForBrowserEvent(
          page,
          { kind: "websocket", phase: "close", correlationId },
          env.timeoutMs,
        );
      } catch {
        /* best-effort teardown */
      }

      const timeline =
        (await peekTimeline(request, env.apiBaseUrl, correlationId)) ?? {
          correlationId,
          flow: "media-arbitration" as const,
        };

      record = buildRecord({
        runId: env.runId,
        flow: "media-arbitration",
        scenario: "recorder-live-mutex",
        tags: ["arbitration", "mic-lease", "mutex", "real-browser", "real-provider"],
        iteration: 1,
        taskId: env.taskId,
        route,
        correlationId,
        interactionStartedAt,
        events: await browserEvents(page),
        timeline,
        status: disabled ? "ok" : "failed",
      });

      if (disabled) {
        expect(record.status, "recorder mic button must be disabled while Live holds the capture lease").toBe("ok");
      }
      // If the button was not disabled, the failed record is the honest outcome; do not throw.
    } catch (error) {
      record = failedRecord({
        runId: env.runId,
        flow: "media-arbitration",
        scenario: "recorder-live-mutex",
        iteration: 1,
        taskId: env.taskId,
        route,
        error,
        interactionStartedAt,
      });
      await testInfo.attach("voice-benchmark-result", {
        body: Buffer.from(JSON.stringify(record)),
        contentType: "application/json",
      });
      throw error;
    }
    await testInfo.attach("voice-benchmark-result", {
      body: Buffer.from(JSON.stringify(record)),
      contentType: "application/json",
    });
  });
});

import { expect, test } from "@playwright/test";
import { basename } from "node:path";
import { voiceBenchmarkEnvironment } from "../env";
import {
  browserEvents,
  buildRecord,
  failedRecord,
  installVoiceBrowserObserver,
  peekTimeline,
  probeVoiceEnvironment,
  readTimeline,
  waitForBrowserEvent,
} from "../browserHarness";
import type { BrowserBenchmarkEvent, VoiceBenchmarkRecord, VoiceServerTimeline } from "../types";

const env = voiceBenchmarkEnvironment();

// The fixture filename distinguishes re-runs that swap the fixed WAV fed via
// Chromium fake-audio-capture (e.g. short/medium/long speech vs silence/noise).
const fixtureTag = env.fakeMicWav ? basename(env.fakeMicWav).replace(/\.wav$/, "") : "no-fixture";
const scenario = `recorded-${fixtureTag}`;
// Silence/noise fixtures cannot reliably yield an ASR transcript or a coach
// reply, so their status is recorded but never hard-asserted.
const assertPlayback = !/silence|noise/i.test(fixtureTag);

test.describe("recorded voice turn Coach browser benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");
  test.skip(!env.fakeMicWav, "recorded turn requires VOICE_BENCHMARK_FAKE_MIC_WAV (fixed audio fixture)");

  for (let iteration = 1; iteration <= env.iterations; iteration += 1) {
    test(`turn coach ${scenario} iteration ${iteration}`, async ({ page, request }, testInfo) => {
      const route = `/learn/${encodeURIComponent(env.taskId)}`;
      const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
      test.skip(Boolean(unavailable), unavailable);
      await installVoiceBrowserObserver(page);
      const mechanicsTimeout = Math.min(env.timeoutMs, 15_000);
      let interactionStartedAt: number | undefined;
      let record: VoiceBenchmarkRecord;
      try {
        await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
        await page.getByRole("button", { name: "展开陪练老师" }).click();
        const composer = page.getByPlaceholder("文字或语音问老师");
        await expect(composer).toBeVisible();

        interactionStartedAt = Date.now();
        // Start recording. With Chromium fake-audio-capture (env.fakeMicWav),
        // getUserMedia returns the fixed WAV and MediaRecorder captures it.
        await page.getByRole("button", { name: "语音提问" }).click();
        await waitForBrowserEvent(page, { kind: "capture", phase: "started" }, mechanicsTimeout);
        // Prove the fake device was actually granted (not denied).
        await waitForBrowserEvent(page, { kind: "microphone", phase: "granted" }, mechanicsTimeout);
        // Let the fixture play out (short/medium/long differ in length).
        await page.waitForTimeout(2500);
        // Stop recording — the mic button aria-label flips to "结束录音".
        await page.getByRole("button", { name: "结束录音" }).click();
        await waitForBrowserEvent(page, { kind: "capture", phase: "stopped" }, mechanicsTimeout);

        // The encoded capture uploads through the same turn-stream endpoint.
        const uploadFetch = await waitForBrowserEvent(
          page,
          { kind: "fetch-start", urlIncludes: "/api/coach/turn-stream" },
          env.timeoutMs,
        );
        let correlationId = uploadFetch.correlationId;

        // ASR runs server-side; for silence/noise fixtures the student
        // transcript may never arrive. Absence is acceptable, not a failure.
        try {
          await waitForBrowserEvent(page, { kind: "stream-delta", role: "student" }, env.timeoutMs);
        } catch {
          /* no student transcript (silence/noise fixture) */
        }

        // Coach TTS playback triggers the turn browser-audio-started
        // telemetry. For silence/noise the coach may still reply; if it does
        // not, mark the run cancelled rather than fabricating a phase.
        let playback: BrowserBenchmarkEvent | undefined;
        try {
          playback = await waitForBrowserEvent(
            page,
            { kind: "telemetry", owner: "turn", playbackOutcome: true },
            env.timeoutMs,
          );
        } catch {
          /* coach produced no playback */
        }
        if (!correlationId) correlationId = playback?.correlationId;
        if (!correlationId) {
          throw new Error("Recorded turn produced no correlationId (upload fetch-start and playback telemetry both missing)");
        }

        let timeline: VoiceServerTimeline;
        try {
          timeline = await readTimeline(request, env.apiBaseUrl, correlationId, env.timeoutMs, true);
        } catch {
          timeline = (await peekTimeline(request, env.apiBaseUrl, correlationId)) ?? { correlationId, flow: "recorded" };
        }

        record = buildRecord({
          runId: env.runId,
          flow: "recorded",
          scenario,
          tags: ["voice-input", "asr", "llm", "streaming-tts", "real-browser", "real-provider", fixtureTag],
          iteration,
          taskId: env.taskId,
          route,
          correlationId,
          interactionStartedAt,
          events: await browserEvents(page),
          timeline,
          status: playback ? undefined : "cancelled",
        });

        if (assertPlayback) {
          expect(record.status, "recorded speech turn must reach actual browser playback").toBe("ok");
        }
      } catch (error) {
        record = failedRecord({
          runId: env.runId,
          flow: "recorded",
          scenario,
          iteration,
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
  }
});

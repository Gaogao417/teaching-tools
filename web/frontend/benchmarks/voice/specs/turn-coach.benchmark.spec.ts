import { expect, test } from "@playwright/test";
import { voiceBenchmarkEnvironment } from "../env";
import {
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

test.describe("streaming turn Coach browser benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");

  for (let iteration = 1; iteration <= env.iterations; iteration += 1) {
    test(`turn coach ${env.turnScenario} iteration ${iteration}`, async ({ page, request }, testInfo) => {
      const route = `/learn/${encodeURIComponent(env.taskId)}`;
      const unavailable = await probeVoiceEnvironment(request, env.apiBaseUrl, env.taskId);
      test.skip(Boolean(unavailable), unavailable);
      await installVoiceBrowserObserver(page);
      let interactionStartedAt: number | undefined;
      let record: VoiceBenchmarkRecord;
      try {
        await page.goto(`${env.uiBaseUrl}${route}`, { waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("action-runtime-workspace")).toBeVisible();
        await page.getByRole("button", { name: "展开陪练老师" }).click();
        const composer = page.getByPlaceholder("文字或语音问老师");
        await expect(composer).toBeVisible();
        await composer.fill(env.coachQuestion);
        interactionStartedAt = Date.now();
        await page.getByRole("button", { name: "发送问题" }).click();
        await waitForBrowserEvent(page, { kind: "fetch-start", urlIncludes: "/api/coach/turn-stream" }, env.timeoutMs);
        const playback = await waitForBrowserEvent(page, { kind: "telemetry", owner: "turn", playbackOutcome: true }, env.timeoutMs);
        if (!playback.correlationId) throw new Error("Turn playback telemetry did not carry a correlationId");
        const timeline = await readTimeline(request, env.apiBaseUrl, playback.correlationId, env.timeoutMs, true);
        record = buildRecord({
          runId: env.runId,
          flow: "turn",
          scenario: env.turnScenario,
          tags: ["text-input", "llm", "streaming-tts", "real-browser", "real-provider"],
          iteration,
          taskId: env.taskId,
          route,
          correlationId: playback.correlationId,
          interactionStartedAt,
          events: await browserEvents(page),
          timeline,
        });
        expect(record.status, "turn Coach must reach actual browser playback").toBe("ok");
      } catch (error) {
        record = failedRecord({ runId: env.runId, flow: "turn", scenario: env.turnScenario, iteration, taskId: env.taskId, route, error, interactionStartedAt });
        await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
        throw error;
      }
      await testInfo.attach("voice-benchmark-result", { body: Buffer.from(JSON.stringify(record)), contentType: "application/json" });
    });
  }
});

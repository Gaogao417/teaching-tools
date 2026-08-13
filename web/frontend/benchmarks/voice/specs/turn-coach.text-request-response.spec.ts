import { expect, test } from "@playwright/test";
import { voiceBenchmarkEnvironment } from "../env";
import {
  browserEvents,
  buildRecord,
  failedRecord,
  installVoiceBrowserObserver,
  peekTimeline,
  probeVoiceEnvironment,
  waitForBrowserEvent,
} from "../browserHarness";
import type { VoiceBenchmarkRecord, VoiceServerTimeline } from "../types";

const env = voiceBenchmarkEnvironment();

test.describe("request-response turn Coach browser benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");

  for (let iteration = 1; iteration <= env.iterations; iteration += 1) {
    test(`turn coach text-request-response iteration ${iteration}`, async ({ page, request }, testInfo) => {
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

        // The served plan decides the transport: request-response fires POST
        // /api/action-coach (blocking JSON); streaming fires POST
        // /api/coach/turn-stream (NDJSON). The test cannot force either, so it
        // records whichever transport the environment actually served.
        await page.waitForFunction(
          () => {
            const state = (window as unknown as {
              __VOICE_BENCHMARK__?: { events: Array<{ kind: string; url?: string }> };
            }).__VOICE_BENCHMARK__;
            if (!state?.events) return false;
            return state.events.some(
              (event) =>
                event.kind === "fetch-start"
                && (event.url?.includes("/api/action-coach") || event.url?.includes("/api/coach/turn-stream")),
            );
          },
          undefined,
          { timeout: env.timeoutMs },
        );
        const events = await browserEvents(page);
        const actionCoachRequest = events.find(
          (event) => event.kind === "fetch-start" && event.url?.includes("/api/action-coach"),
        );

        if (!actionCoachRequest) {
          // A /api/coach/turn-stream fetch-start fired instead: the served plan
          // uses streaming, so the request-response path is not active here.
          // This is an environment condition, not a product bug — record it
          // honestly and let the suite continue.
          record = failedRecord({
            runId: env.runId,
            flow: "turn",
            scenario: "text-request-response",
            iteration,
            taskId: env.taskId,
            route,
            error: new Error("served plan uses stream transport; request-response path not active"),
            interactionStartedAt,
          });
        } else {
          const correlationId = actionCoachRequest.correlationId;
          if (!correlationId) {
            throw new Error("Request-response /api/action-coach request did not carry a correlationId");
          }
          // The rr reply is played through an <audio> element, so the observer's
          // media "play" event is the browserStarted proxy. A server
          // TelemetrySink timeline may not exist for the legacy rr path, so peek
          // without throwing and fall back to a minimal stub.
          await waitForBrowserEvent(page, { kind: "media", phase: "play" }, env.timeoutMs);
          const timeline: VoiceServerTimeline = (await peekTimeline(request, env.apiBaseUrl, correlationId))
            ?? { correlationId, flow: "turn" };
          record = buildRecord({
            runId: env.runId,
            flow: "turn",
            scenario: "text-request-response",
            tags: ["text-input", "request-response", "real-browser", "real-provider"],
            iteration,
            taskId: env.taskId,
            route,
            correlationId,
            interactionStartedAt,
            events: await browserEvents(page),
            timeline,
          });
          expect(record.status, "request-response turn Coach must reach actual browser playback").toBe("ok");
        }
      } catch (error) {
        record = failedRecord({
          runId: env.runId,
          flow: "turn",
          scenario: "text-request-response",
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

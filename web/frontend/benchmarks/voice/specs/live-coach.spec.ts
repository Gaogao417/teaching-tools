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
import type { VoiceBenchmarkRecord } from "../types";

const env = voiceBenchmarkEnvironment();

// Live Coach is full-duplex over WS /api/coach-realtime. The client opens the
// socket, sends live.start, waits for live.ready, then acquires the mic. Coach
// audio arrives as live.audio base64 PCM packets. Barge-in is SERVER-driven:
// the server emits live.interrupted; the client only reacts.
//
// N/A matrix items (do not test here):
//   client-initiated interrupt/commit/stop (live.interrupt/live.commit/live.stop)
//   are NOT sent by the product → those matrix items are N/A; barge-in is
//   server-driven only (live.interrupted), observed opportunistically.

test.describe("Live Coach full-duplex browser benchmark", () => {
  test.skip(!env.enabled, "Real provider benchmark is opt-in; set VOICE_BENCHMARK_ENABLED=true");
  test.skip(!env.fakeMicWav, "Live Coach requires VOICE_BENCHMARK_FAKE_MIC_WAV (fixed audio fixture)");

  for (let iteration = 1; iteration <= env.iterations; iteration += 1) {
    test(`live coach ${env.liveScenario} iteration ${iteration}`, async ({ page, request }, testInfo) => {
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

        interactionStartedAt = Date.now();

        // Start the live session. If the toggle is absent or it never opens a
        // /api/coach-realtime websocket, the served plan likely has the
        // liveCoach capability disabled — record honestly and continue (soft).
        let correlationId: string | undefined;
        let wsOpened = false;
        try {
          await page.getByRole("button", { name: "实时对话" }).click();
          const opened = await waitForBrowserEvent(
            page,
            { kind: "websocket", phase: "open", urlIncludes: "/api/coach-realtime" },
            env.timeoutMs,
          );
          correlationId = opened.correlationId;
          wsOpened = Boolean(correlationId);
        } catch {
          // Toggle missing, or live toggle did not open a websocket.
        }

        if (!wsOpened || !correlationId) {
          record = failedRecord({
            runId: env.runId,
            flow: "live",
            scenario: env.liveScenario,
            iteration,
            taskId: env.taskId,
            route,
            error: new Error(
              "live toggle did not open a /api/coach-realtime websocket (liveCoach capability may be disabled)",
            ),
            interactionStartedAt,
          });
          await testInfo.attach("voice-benchmark-result", {
            body: Buffer.from(JSON.stringify(record)),
            contentType: "application/json",
          });
          return; // honest environment condition — do not crash the run
        }

        // live.ready (server replies with sample rates) — generous, best-effort.
        let readyArrived = false;
        try {
          await waitForBrowserEvent(
            page,
            { kind: "websocket", phase: "ready", correlationId },
            env.timeoutMs,
          );
          readyArrived = true;
        } catch {
          /* realtime provider may not send live.ready */
        }

        // First live.audio packet — only reachable after ready.
        let firstAudioArrived = false;
        if (readyArrived) {
          try {
            await waitForBrowserEvent(
              page,
              { kind: "websocket", phase: "first-audio", correlationId },
              env.timeoutMs,
            );
            firstAudioArrived = true;
          } catch {
            /* realtime provider may not respond with audio */
          }
        }

        // Browser actually started playing coach audio. Live uses an
        // AudioBufferSourceNode (not HTMLMediaElement), so the "media" play event
        // generally does not fire — rely on the owner="live" browser-audio-started
        // telemetry that the production client emits via notifyAudioStarted("live").
        let browserAudioArrived = false;
        if (firstAudioArrived) {
          try {
            await waitForBrowserEvent(
              page,
              { kind: "telemetry", owner: "live", playbackOutcome: true, correlationId },
              env.timeoutMs,
            );
            browserAudioArrived = true;
          } catch {
            /* live owner browser-audio telemetry never arrived */
          }
        }

        // Let the session run a short bounded time to capture at least one round.
        await page.waitForTimeout(8000);

        // Stop the session and wait for the socket to close (best-effort).
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

        // Live timelines may be partial; peek without requiring a terminal state.
        const timeline =
          (await peekTimeline(request, env.apiBaseUrl, correlationId)) ?? {
            correlationId,
            flow: "live" as const,
          };

        record = buildRecord({
          runId: env.runId,
          flow: "live",
          scenario: env.liveScenario,
          tags: ["full-duplex", "realtime", "real-browser", "real-provider"],
          iteration,
          taskId: env.taskId,
          route,
          correlationId,
          interactionStartedAt,
          events: await browserEvents(page),
          timeline,
        });

        // Do NOT assert hard latency. Only assert ok when browser audio actually
        // arrived; otherwise the auto-derived failed/cancelled record is honest.
        if (browserAudioArrived) {
          expect(record.status, "live Coach must reach actual browser playback when audio arrives").toBe("ok");
        }
      } catch (error) {
        record = failedRecord({
          runId: env.runId,
          flow: "live",
          scenario: env.liveScenario,
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

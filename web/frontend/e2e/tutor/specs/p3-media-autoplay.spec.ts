/** FM-3-2: actual Chromium autoplay policy, with a decodable MP3 probe.
 * Run explicitly with TUTOR_E2E_AUTOPLAY_BLOCKED=1. Policy failure is a failing
 * prerequisite in that run; it must never silently count as browser acceptance.
 * TTS is a transport fixture; the HTMLMediaElement and policy are real.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test, type Page, type Route } from "@playwright/test";

// Trace snapshots activate the document in this Playwright version; preserve PNG/JSON instead.
test.use({ trace: "off" });

const TASK_URL = "/learn/goldenMinhangFold2020";
const SILENT_MP3 = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "silent-1.5s.mp3"));

test("FM-3-2 autoplay blocked：暂停+手势恢复入口，恢复后继续；单 audio 元素零重挂；不误报 failure", async ({ baseURL }, testInfo) => {
  test.skip(process.env.TUTOR_E2E_AUTOPLAY_BLOCKED !== "1", "Explicit policy run requires TUTOR_E2E_AUTOPLAY_BLOCKED=1");
  const browser = await chromium.launch({ channel: "chromium", args: ["--autoplay-policy=document-user-activation-required"] });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    // page.evaluate creates a user activation by default. Probe via CDP without one.
    await page.route("**/__autoplay_probe", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Policy probe</title>" }));
    await page.goto("/__autoplay_probe");
    const cdp = await page.context().newCDPSession(page);
    const probe = await cdp.send("Runtime.evaluate", {
      expression: `(async () => { const audio = new Audio(${JSON.stringify(`data:audio/mpeg;base64,${SILENT_MP3.toString("base64")}`)}); try { await audio.play(); audio.pause(); return "played"; } catch (error) { return error.name; } })()`,
      awaitPromise: true, returnByValue: true, userGesture: false,
    });
    expect(probe.result.value, "actual browser policy must reject valid audio").toBe("NotAllowedError");
    await testInfo.attach("actual-autoplay-policy", { body: JSON.stringify({ browser: await browser.version(), policy: "document-user-activation-required", probe: probe.result.value, validAudio: "silent-1.5s.mp3", mockedPlay: false }), contentType: "application/json" });

    await prepareStudent(page);
    // Observe native constructors/events only; play() and browser policy remain untouched.
    await page.addInitScript(() => {
      const telemetry = { constructed: 0, ended: 0 };
      Object.assign(window, { __policyAudio: telemetry });
      window.Audio = new Proxy(window.Audio, { construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        telemetry.constructed++;
        audio.addEventListener("ended", () => telemetry.ended++);
        return audio;
      } });
    });
    const outcomes: string[] = [];
    page.on("request", request => {
      if (request.method() === "POST" && /\/presentation-actions\/[^/]+\/outcomes$/.test(new URL(request.url()).pathname)) outcomes.push(request.postData() ?? "");
    });
    await page.route(/\/api\/action-speech(-stream)?$/, async (route: Route) => {
      if (route.request().url().endsWith("-stream")) { await route.fulfill({ status: 200, contentType: "audio/mpeg", body: SILENT_MP3 }); return; }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ audioUrl: `data:audio/mpeg;base64,${SILENT_MP3.toString("base64")}` }) });
    });
    await page.goto(TASK_URL);
    // Observe before invoking locator assertions: Playwright injected helpers can
    // mark a document activated. CDP observation never carries a user gesture.
    const blocked = await cdp.send("Runtime.evaluate", {
      expression: `new Promise(resolve => { const started=Date.now(); const timer=setInterval(() => { const phase=document.querySelector('[data-testid="tutor-presentation"]')?.getAttribute('data-presentation-phase'); if (phase==='awaiting-gesture' || Date.now()-started>20000) { clearInterval(timer); resolve({phase,activated:navigator.userActivation.hasBeenActive}); } },50); })`,
      awaitPromise: true, returnByValue: true, userGesture: false,
    });
    expect(blocked.result.value).toEqual({ phase: "awaiting-gesture", activated: false });
    await testInfo.attach("blocked-before-gesture", { body: JSON.stringify(blocked.result.value), contentType: "application/json" });
    await expect(page.getByTestId("tutor-presentation-resume")).toBeVisible();
    await expect(page.getByTestId("tutor-presentation-failure")).toHaveCount(0);
    await expect(page.getByTestId("tutor-protocol-error")).toHaveCount(0);
    await expect(page.getByTestId("tutor-error")).toHaveCount(0);
    const audioCount = await page.evaluate(() => (window as unknown as { __policyAudio: { constructed: number } }).__policyAudio.constructed);
    expect(audioCount).toBe(1);
    expect(outcomes).toHaveLength(0);
    await page.getByTestId("tutor-presentation-resume").click();
    await expect(page.locator('[data-testid="tutor-presentation"][data-presentation-phase="presenting"]')
      .or(page.getByTestId("tutor-confirm-input")).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("tutor-confirm-input").or(page.getByTestId("tutor-submit-answer")).first()).toBeVisible({ timeout: 30_000 });
    const telemetry = await page.evaluate(() => (window as unknown as { __policyAudio: { constructed: number; ended: number } }).__policyAudio);
    expect(telemetry).toEqual({ constructed: audioCount, ended: 1 });
    expect(outcomes).toHaveLength(1);
    expect(JSON.parse(outcomes[0]).outcome).toBe("presented");
    await testInfo.attach("native-audio-and-outcome", { body: JSON.stringify({ telemetry, outcomes: outcomes.map(body => JSON.parse(body)) }), contentType: "application/json" });
    await expect(page.getByTestId("tutor-presentation-failure")).toHaveCount(0);
  } finally {
    await testInfo.attach("browser-policy-state", { body: await page.screenshot(), contentType: "image/png" });
    await browser.close();
  }
});

async function prepareStudent(page: Page): Promise<void> {
  await page.addInitScript((name) => {
    window.localStorage.setItem("trig-web-student-name", name);
  }, "p3-autoplay-student");
}

/** Browser fault injection over native MediaRecorder + fake Chromium device.
 * These are system-failure regressions, not human microphone/ASR acceptance.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const audio = readFileSync(new URL('../assets/silent-1.5s.mp3', import.meta.url));
test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] } });
type Fault = 'error-before-data' | 'error-after-data' | 'stop-throws' | 'empty-audio';
async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('trig-web-student-name', 'final-recorder-student');
    const state: { mode?: string; latest?: MediaRecorder; tracks: MediaStreamTrack[]; bytes: number } = { tracks: [], bytes: 0 };
    Object.assign(window, { __recordingFault: state });
    window.MediaRecorder = new Proxy(window.MediaRecorder, { construct(target, args) {
      const recorder = Reflect.construct(target, args) as MediaRecorder;
      state.latest = recorder; state.tracks = recorder.stream.getTracks(); state.bytes = 0;
      recorder.addEventListener('dataavailable', event => {
        state.bytes += event.data.size;
        if (state.mode === 'empty-audio' || state.mode === 'error-before-data') event.stopImmediatePropagation();
      });
      const stop = recorder.stop.bind(recorder);
      recorder.stop = () => {
        if (state.mode === 'stop-throws') { state.mode = undefined; throw new DOMException('injected stop device failure', 'InvalidStateError'); }
        stop();
      };
      return recorder;
    } });
  });
  await page.route(/\/api\/action-speech(-stream)?$/, route => route.fulfill(route.request().url().endsWith('-stream')
    ? { status: 200, contentType: 'audio/mpeg', body: audio }
    : { status: 200, contentType: 'application/json', body: '{}' }));
}
for (const channel of ['mainline', 'assistance'] as const) {
  for (const fault of ['error-before-data', 'error-after-data', 'stop-throws', 'empty-audio'] as Fault[]) {
    test(`JR8 ${channel} ${fault}: zero ASR, released hardware, retry capture succeeds`, async ({ page }, info) => {
      await prepare(page);
      let asr = 0; let inputs = 0;
      page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/student-inputs')) inputs++; });
      await page.route(/\/api\/vnext\/tutor-sessions\/[^/]+\/asr$/, route => {
        asr++;
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'EMPTY_TRANSCRIPT', message: 'retry reached ASR' } }) });
      });
      await page.goto('/learn/goldenMinhangFold2020');
      await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled({ timeout: 60_000 });
      await page.evaluate(mode => { (window as unknown as { __recordingFault: { mode?: string } }).__recordingFault.mode = mode; }, fault);
      const start = page.getByRole('button', { name: channel === 'mainline' ? '语音反馈理解' : '语音提问', exact: true });
      const stop = page.getByRole('button', { name: channel === 'mainline' ? '结束录音回答' : '结束录音', exact: true });
      await start.click(); await expect(stop).toBeVisible();
      if (fault === 'error-after-data') {
        await expect.poll(() => page.evaluate(() => (window as unknown as { __recordingFault: { bytes: number } }).__recordingFault.bytes)).toBeGreaterThan(0);
      }
      if (fault.startsWith('error')) await page.evaluate(() => (window as unknown as { __recordingFault: { latest: MediaRecorder } }).__recordingFault.latest.dispatchEvent(new Event('error')));
      else await stop.click();
      await expect(page.getByText(fault.startsWith('error') ? '录音过程中发生错误，请再试一次或改用文字输入。'
        : fault === 'empty-audio' ? '没有录到有效音频，请再试一次或改用文字输入。' : '录音没有保存成功，请再试一次或改用文字输入。', { exact: true })).toBeVisible();
      await expect(start).toBeVisible();
      const tracks = await page.evaluate(() => (window as unknown as { __recordingFault: { tracks: MediaStreamTrack[] } }).__recordingFault.tracks.map(track => track.readyState));
      expect(tracks.length).toBeGreaterThan(0); expect(tracks.every(state => state === 'ended')).toBe(true);
      expect(asr).toBe(0); expect(inputs).toBe(0);
      await page.evaluate(() => { (window as unknown as { __recordingFault: { mode?: string } }).__recordingFault.mode = undefined; });
      await start.click(); await expect(stop).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __recordingFault: { bytes: number } }).__recordingFault.bytes)).toBeGreaterThan(0);
      await stop.click(); await expect.poll(() => asr).toBe(1);
      await expect(page.getByTestId('tutor-speech-notice')).toContainText('没有听到内容');
      expect(inputs).toBe(0);
      await info.attach('recorder-failure-retry', { body: JSON.stringify({ channel, fault, firstAsr: 0, stoppedTracks: tracks, retryAsr: asr, studentInputs: inputs, nativeRecorder: true, fakeDevice: true }), contentType: 'application/json' });
    });
  }
}

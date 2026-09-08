/** Real HTTP persistence/recovery with fixture TTS; no model or human-mic claim. */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
const audio = readFileSync(new URL('../assets/silent-1.5s.mp3', import.meta.url));
const task = '/learn/goldenMinhangFold2020';
async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem('trig-web-student-name', 'final-recovery-student'));
  await page.route(/\/api\/action-speech(-stream)?$/, route => route.fulfill(route.request().url().endsWith('-stream')
    ? { status: 200, contentType: 'audio/mpeg', body: audio }
    : { status: 200, contentType: 'application/json', body: '{}' }));
}
async function ready(page: Page) {
  await expect(page.getByTestId('tutor-confirm-input')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled();
}
test('JR6 recovery × refresh: offline restore never starts a new session; reconnect restores original identity', async ({ page, context }) => {
  await prepare(page); await page.goto(task); await ready(page);
  const originalUrl = page.url();
  const session = new URL(originalUrl).searchParams.get('session');
  expect(session).toMatch(/^TS-/);
  const progress = await mainlineIdentity(page);
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/tutor-sessions$/.test(new URL(request.url()).pathname)) starts++; });
  // Keep the document shell reachable, but take all canonical HTTP offline.
  await page.route(/\/api\/vnext\//, route => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('heading', { name: '暂时无法确认这道题的学习通道' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Failed to fetch');
  expect(starts).toBe(0);
  expect(new URL(page.url()).searchParams.get('session')).toBe(session);
  await page.unroute(/\/api\/vnext\//);
  await page.reload(); await ready(page);
  expect(new URL(page.url()).searchParams.get('session')).toBe(session);
  expect(await mainlineIdentity(page)).toEqual(progress);
  expect(starts).toBe(0);
  // A new browser page restores the persisted session, not only in-memory state.
  const reopened = await context.newPage(); await prepare(reopened);
  await reopened.goto(originalUrl); await ready(reopened);
  expect(new URL(reopened.url()).searchParams.get('session')).toBe(session);
  expect(await mainlineIdentity(reopened)).toEqual(progress);
  await reopened.close();
});
test('JR6 missing session: explicit restart only, real 404 and new server session', async ({ page }) => {
  await prepare(page);
  let starts = 0;
  page.on('request', request => { if (request.method() === 'POST' && /\/tutor-sessions$/.test(new URL(request.url()).pathname)) starts++; });
  await page.goto(`${task}?session=TS-999999999999`);
  await expect(page.getByTestId('tutor-restart-offered')).toBeVisible();
  expect(starts).toBe(0);
  await page.getByTestId('tutor-restart').click(); await ready(page);
  expect(starts).toBe(1);
  expect(new URL(page.url()).searchParams.get('session')).not.toBe('TS-999999999999');
});

async function mainlineIdentity(page: Page): Promise<unknown> {
  const session = new URL(page.url()).searchParams.get("session");
  expect(session).toMatch(/^TS-/);
  const response = await page.request.get(`http://127.0.0.1:${process.env.TUTOR_E2E_BACKEND_PORT || 3101}/api/vnext/tutor-sessions/${session}`);
  expect(response.ok()).toBe(true);
  const snapshot = await response.json();
  const mainline = snapshot.views?.coach_panel_view?.mainline;
  expect(mainline?.beat_id, "server mainline identity must exist; absent progress text cannot pass").toMatch(/^BT-/);
  return mainline;
}

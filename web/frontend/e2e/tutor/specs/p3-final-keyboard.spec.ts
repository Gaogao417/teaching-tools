/** Actual Tab/Enter interaction, scripted backend; not a human screen-reader audit. */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
const audio = readFileSync(new URL('../assets/silent-1.5s.mp3', import.meta.url));
const task = '/learn/goldenMinhangFold2020';
async function prepare(page: Page) {
  await page.addInitScript(() => localStorage.setItem('trig-web-student-name', 'final-keyboard-student'));
  await page.route(/\/api\/action-speech(-stream)?$/, route => route.fulfill(route.request().url().endsWith('-stream')
    ? { status: 200, contentType: 'audio/mpeg', body: audio }
    : { status: 200, contentType: 'application/json', body: '{}' }));
}
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 60_000 });
  await expect(target).toBeEnabled();
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard cannot reach ${await target.getAttribute('data-testid') ?? await target.textContent()}`);
}
async function activate(page: Page, target: Locator) { await tabTo(page, target); await page.keyboard.press('Enter'); }
async function answer(page: Page, text: string) {
  await tabTo(page, page.getByLabel('回答输入')); await page.keyboard.insertText(text);
  await activate(page, page.getByTestId('tutor-submit-answer'));
}

test('JR7 Draft six beats: only Tab/Enter, refresh takeover and completion focus remain reachable', async ({ page }, info) => {
  test.skip(!process.env.F7_KEYBOARD_DRAFT_URL, 'Needs running scripted Draft service, explicitly named by F7_KEYBOARD_DRAFT_URL');
  test.setTimeout(360_000);
  await prepare(page); await page.goto(`${process.env.F7_KEYBOARD_DRAFT_URL}${task}`);
  const observations: unknown[] = [];
  for (let beat = 1; beat <= 6; beat++) {
    await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled({ timeout: 180_000 });
    if (beat === 3) {
      const session = new URL(page.url()).searchParams.get('session');
      const claimSnapshots: Promise<unknown>[] = [];
      const observeClaim = (response: import('@playwright/test').Response) => {
        if (response.ok() && response.url().includes(`/api/vnext/tutor-sessions/${session}`)) {
          claimSnapshots.push(response.json());
        }
      };
      page.on('response', observeClaim);
      await page.reload();
      await activate(page, page.getByRole('button', { name: '在此页面继续', exact: true }));
      await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled({ timeout: 180_000 });
      expect(new URL(page.url()).searchParams.get('session')).toBe(session);
      page.off('response', observeClaim);
      const snapshots = await Promise.all(claimSnapshots) as Array<{ revision?: number; generation?: { status: string }; pending_presentation?: { action: { workspace_action?: { capability?: string } } } }>;
      expect(snapshots.length).toBeGreaterThan(0);
      for (const snapshot of snapshots) {
        expect(snapshot.generation?.status).not.toBe('pending');
        if (snapshot.pending_presentation) expect(snapshot.pending_presentation.action.workspace_action?.capability).toBe('geometry.visual.reconcile');
      }
      observations.push({ claimSession: session, noNewGenerationDuringClaim: true, onlyCleanupDeliveryDuringClaim: true, revisions: snapshots.map(snapshot => snapshot.revision) });
    }
    await tabTo(page, page.getByTestId('tutor-confirm-input'));
    observations.push(await page.evaluate(() => ({ active: document.activeElement?.getAttribute('data-testid'), connected: document.activeElement?.isConnected })));
    const committed = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/student-inputs'), { timeout: 180_000 });
    await page.keyboard.press('Enter');
    const response = await committed;
    const snapshot = await response.json();
    expect(response.status(), JSON.stringify(snapshot)).toBe(200);
    expect(snapshot.turn).toMatchObject(beat < 6
      ? { status: 'committed', decision_kind: 'transition_beat', to_beat_id: `BT-${String(beat + 1).padStart(2, '0')}` }
      : { status: 'committed', decision_kind: 'complete_beat' });
    observations.push({ beat, revision: snapshot.revision, turn: snapshot.turn });
    await expect(page.getByTestId('tutor-confirm-input')).toBeHidden();
  }
  await expect(page.getByTestId('tutor-completed')).toBeVisible({ timeout: 180_000 });
  await tabTo(page, page.getByTestId('tutor-start-practice'));
  observations.push(await page.evaluate(() => ({ completedFocus: document.activeElement?.getAttribute('data-testid') })));
  await info.attach('keyboard-focus-observations', { body: JSON.stringify(observations), contentType: 'application/json' });
  await info.attach('completed-keyboard-focus', { body: await page.screenshot(), contentType: 'image/png' });
});

test('JR7 Approved fixture Workspace: activate CLEAR, reset local draft without canonical input, re-enter and submit', async ({ page }, info) => {
  await prepare(page); await page.goto(task);
  await activate(page, page.getByTestId('tutor-confirm-input'));
  await answer(page, '识别第一组子母型，△CAD∽△CBA');
  await answer(page, '对应边成比例，AD=CD=8/3、BD=10/3');
  const workspace = page.getByTestId('action-runtime-workspace');
  await expect(workspace).toHaveAttribute('data-action-id', /mark-segment-values/);
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && /\/(student-inputs|action-evidence|workspace-commands)$/.test(new URL(request.url()).pathname)) writes.push(request.url()); });
  const canvas = page.locator('.geometry-canvas');
  const selectAll = async () => {
    await tabTo(page, canvas);
    for (let i = 0; i < 4; i++) { await tabTo(page, canvas); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); }
  };
  await selectAll();
  const first = page.getByLabel('seg-AO', { exact: false });
  await tabTo(page, first); await page.keyboard.insertText('123');
  await activate(page, page.getByRole('button', { name: '清空', exact: true }));
  await expect(workspace).toHaveAttribute('data-selected', '');
  await expect(page.getByRole('button', { name: '确认', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
  await selectAll();
  const values: Record<string,string> = { 'seg-AO':'\\frac{16}{5}', 'seg-DO':'\\frac{32}{15}', 'seg-BO':'\\frac{6}{5}', 'seg-OE':'\\frac{4}{5}' };
  for (const [id, value] of Object.entries(values)) {
    const field = page.getByLabel(id, { exact: false });
    await expect(field).toHaveValue('');
    await tabTo(page, field); await page.keyboard.insertText(value);
  }
  await activate(page, page.getByRole('button', { name: '确认', exact: true }));
  await expect(page.getByTestId('tutor-submit-answer')).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatch(/\/action-evidence$/);
  await info.attach('clear-side-effects', { body: JSON.stringify({ clearCanonicalWrites: 0, selectionCleared: true, valuesCleared: true, confirmDisabledAfterClear: true, finalWrites: writes }), contentType: 'application/json' });
});

/** Real local mechanical classroom only. Does not start services, intercept API
 * responses, manufacture outcomes, inject snapshots, or use external providers.
 * Run ONLY after the owner of 3134/5194 confirms the service is ready. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const CONTRACT = {
  evidenceLevel: 'local-scripted-presenter-real-http-browser-canvas-media',
  scenarios: ['full-refresh-claim-old-page-fenced', 'live-focus-inquiry-cleanup-return-anchor'],
  service: { mode: 'local-mechanical-harness', model: 'scripted', tts: 'recorded-silence' },
  inquiryQuestion: '我没听懂，为什么这两组边是对应边？',
  inquiryFollowup: '这次听懂了',
  requiredHarnessInjection: {
    gate: 'For student_input.text equal to inquiryQuestion, return response_kind=question, verdict=not_applicable, reasoning_location=aligned, grounding_refs=[FN-06] (the current first-similarity conclusion). Do not return pass for the question. Other understanding confirmation keeps the existing legal response.',
    presenter: 'Existing bounded inquiry Presenter must consume actual inquiry context, never mainline-only visual bindings. No new candidate or approval is requested.',
    optionalLedgerEvidence: 'Read-only session event export is needed only for exact lease/event assertions; this script proves HTTP projections, actual UI and renderer cleanup, not hidden SQL events.',
  },
  boundary: '无额外授权，复用仅经权威 anchor∩当前依据；lease owner 仍为 Inquiry。 Normal progressive generation is checked; stress-scene bbox success is not classroom readability.',
};
if (process.argv.includes('--describe')) {
  process.stdout.write(JSON.stringify(CONTRACT, null, 2) + '\n');
  process.exit(0);
}
const [toolsRoot, outputDir, frontend = 'http://127.0.0.1:5194', backend = 'http://127.0.0.1:3134', selected = 'all'] = process.argv.slice(2);
if (!toolsRoot || !outputDir || !['all', 'owner', 'inquiry'].includes(selected)) {
  throw new Error('usage: node visual-classroom-lifecycle.cjs <tools-root> <output-dir> [frontend-url] [backend-url] [all|owner|inquiry]; --describe performs no network/browser work');
}
for (const url of [frontend, backend]) {
  const parsed = new URL(url);
  assert(['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname), 'only loopback services may be used');
  assert.equal(parsed.protocol, 'http:');
}
const { chromium, expect } = require(path.join(path.resolve(toolsRoot), 'web/frontend/node_modules/@playwright/test'));
const TIMEOUT = 60000;
const output = path.resolve(outputDir);
fs.mkdirSync(output, { recursive: true });
const results = [], traces = [], errors = [];
const workspaceVisual = s => s?.views?.student_workspace_view?.canvas?.visual;
const inquiry = s => s?.views?.coach_panel_view?.inquiry;
const ownerOf = s => s?.presentation_execution_owner;
const idle = s => s && !s.pending_presentation && !s.visual_barrier && s.generation?.status !== 'pending';
const key = d => `${d.session_id}:${d.sequence_id}:${d.ordinal}:${d.action_id}`;
function watch(page, label) {
  const state = { label, calls: [], last: undefined, pendingReads: new Set(), pageErrors: [] };
  const requests = new Map();
  page.on('pageerror', e => state.pageErrors.push(e.message));
  page.on('request', request => {
    if (!request.url().includes('/api/vnext/tutor-sessions')) return;
    let body; try { body = request.postDataJSON(); } catch { body = undefined; }
    const call = { index: state.calls.length, started: Date.now(), method: request.method(), url: request.url(), body };
    state.calls.push(call); requests.set(request, call);
  });
  page.on('response', response => {
    const call = requests.get(response.request()); if (!call) return;
    const read = (async () => {
      call.status = response.status(); call.responseAt = Date.now();
      try { call.response = await response.json(); } catch { return; }
      const snapshot = call.response;
      if (snapshot?.views && (!state.last || state.last.session_id !== snapshot.session_id || snapshot.revision >= state.last.revision)) state.last = snapshot;
    })();
    state.pendingReads.add(read); void read.finally(() => state.pendingReads.delete(read));
  });
  traces.push(state); return state;
}
async function checkpoint(page, trace, name) {
  await Promise.all([...trace.pendingReads]);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  const geometry = await page.locator('.geometry-canvas').evaluateAll(nodes => nodes.map(node => ({
    rect: node.getBoundingClientRect().toJSON(),
    points: [...node.querySelectorAll('[data-geometry-id]')].map(p => ({ id: p.getAttribute('data-geometry-id'), rect: p.getBoundingClientRect().toJSON() })),
    labels: [...node.querySelectorAll('text')].map(p => ({ text: p.textContent, rect: p.getBoundingClientRect().toJSON() })),
    visualIds: [...node.querySelectorAll('[data-visual-id]')].map(p => p.getAttribute('data-visual-id')),
  })));
  fs.writeFileSync(path.join(output, `${name}.json`), JSON.stringify({ snapshot: trace.last, geometry }, null, 2));
}
async function waitMainlineReady(page, trace, gate) {
  await expect.poll(() => idle(trace.last) && inquiry(trace.last)?.kind === 'no_inquiry' && (!gate || trace.last.views.participation.gate_id === gate), { timeout: TIMEOUT }).toBe(true);
  await expect(page.getByTestId('tutor-confirm-input')).toBeEnabled({ timeout: TIMEOUT });
  assert.equal(trace.last.views.student_workspace_view.schema, 'ai_teaching_student_workspace_view/v3', 'legacy/v2 cannot count as visual acceptance');
}
function assertCleanup(trace, from, cause) {
  const calls = trace.calls.slice(from);
  const snapshots = calls.map(c => c.response).filter(s => s?.views);
  const active = snapshots.find(s => s.visual_barrier?.status === 'awaiting-cleanup' && (!cause || s.visual_barrier.cause === cause));
  assert(active, `missing authoritative ${cause || ''} cleanup barrier`);
  const barrier = active.visual_barrier, delivery = active.pending_presentation;
  assert.equal(delivery?.action.workspace_action?.capability, 'geometry.visual.reconcile');
  assert.equal(delivery.sequence_id, barrier.cleanup_sequence_id);
  const outcome = calls.find(c => c.url.endsWith('/outcomes') && c.body?.sequence_id === delivery.sequence_id && c.body?.ordinal === delivery.ordinal);
  assert(outcome, 'no actual browser cleanup outcome'); assert.equal(outcome.body.outcome, 'presented');
  assert.equal(outcome.status, 200); assert.equal(outcome.response?.visual_barrier, null);
  assert.deepEqual(outcome.body.execution_owner, barrier.execution_owner);
  assert.equal(workspaceVisual(outcome.response)?.digest, barrier.target_digest);
  return { barrierId: barrier.barrier_id, cleanupKey: key(delivery), targetDigest: barrier.target_digest };
}
async function start(page, trace) {
  await page.goto(`${frontend}/learn/goldenMinhangFold2020`);
  await waitMainlineReady(page, trace, 'GT-01');
  assert(trace.last.session_id, 'session did not start');
}
async function ownerScenario(context) {
  const a = await context.newPage(), ta = watch(a, 'owner-A');
  await start(a, ta); const before = structuredClone(ta.last), oldOwner = ownerOf(before);
  const b = await context.newPage(), tb = watch(b, 'owner-B');
  const sessionUrl = `${frontend}/learn/goldenMinhangFold2020?session=${encodeURIComponent(before.session_id)}`;
  await b.goto(sessionUrl);
  await expect(b.getByTestId('tutor-presentation-owner')).toBeVisible({ timeout: TIMEOUT });
  const beforeReload = tb.calls.length;
  await b.reload(); // Real full document reload, not same-page snapshot injection.
  await expect(b.getByTestId('tutor-presentation-owner')).toBeVisible({ timeout: TIMEOUT });
  assert.equal(tb.calls.slice(beforeReload).filter(c => c.method === 'POST').length, 0, 'GET restore must not auto-claim or fabricate outcome');
  assert.deepEqual(ownerOf(tb.last), oldOwner);
  const fromClaim = tb.calls.length;
  await b.getByRole('button', { name: '在此页面继续', exact: true }).click();
  await waitMainlineReady(b, tb, 'GT-01');
  const newOwner = ownerOf(tb.last);
  assert.notEqual(newOwner.client_instance_id, oldOwner.client_instance_id); assert.equal(newOwner.epoch, oldOwner.epoch + 1);
  const claims = tb.calls.slice(fromClaim).filter(c => c.body?.input?.command === 'claim_presentation');
  assert.equal(claims.length, 1); assert.equal(claims[0].body.execution_owner.client_instance_id, newOwner.client_instance_id);
  const cleanup = assertCleanup(tb, fromClaim, 'claim');
  await checkpoint(b, tb, 'owner-after-refresh-claim');
  // A receives no injected B snapshot. Its real UI submits its old owner.
  const stableRevision = tb.last.revision, fromStale = ta.calls.length;
  await a.getByTestId('tutor-confirm-input').click();
  await expect.poll(() => ta.calls.slice(fromStale).some(c => c.status === 409 && c.response?.error?.code === 'PRESENTATION_OWNER_STALE'), { timeout: TIMEOUT }).toBe(true);
  await expect(a.getByTestId('tutor-presentation-owner')).toBeVisible({ timeout: TIMEOUT });
  assert.equal(ta.calls.slice(fromStale).filter(c => c.method === 'POST').length, 1, 'stale page must not retry/control/outcome loop');
  const restored = await (await b.request.get(`${backend}/api/vnext/tutor-sessions/${before.session_id}`)).json();
  assert.equal(restored.revision, stableRevision, 'old owner input must have zero session mutation');
  assert.deepEqual(ownerOf(restored), newOwner);
  await checkpoint(a, ta, 'owner-old-page-rejected');
  results.push({ scenario: 'owner', status: 'passed', session: before.session_id, oldOwner, newOwner, cleanup, staleWriteRejected: true, getRestoreReadOnly: true });
  await a.close(); await b.close();
}
async function inquiryScenario(context) {
  const page = await context.newPage(), trace = watch(page, 'inquiry'); await start(page, trace);
  const composer = page.getByPlaceholder('文字或语音问老师');
  await composer.fill(CONTRACT.inquiryQuestion);
  await page.getByTestId('tutor-confirm-input').click(); // BT02 introduces three corresponding pairs.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-visual-pulse]')].some(node => node.getAnimations({ subtree: true }).some(a => a.playState === 'running')), null, { timeout: TIMEOUT });
  assert(workspaceVisual(trace.last)?.focus, 'question must interrupt an actually visible focus, not an idle mock');
  const anchor = trace.last.views.coach_panel_view.mainline.beat_id;
  assert.equal(anchor, 'BT-02');
  const fromQuestion = trace.calls.length;
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect.poll(() => inquiry(trace.last)?.kind !== undefined && inquiry(trace.last).kind !== 'no_inquiry', { timeout: TIMEOUT, message: 'harness gate must route the explicit test question to inquiry' }).toBe(true);
  assert.equal(inquiry(trace.last).return_checkpoint_id, anchor);
  await expect(composer).toHaveValue('', { timeout: TIMEOUT });
  const entryCleanup = assertCleanup(trace, fromQuestion, 'barge-in');
  await expect.poll(() => idle(trace.last), { timeout: TIMEOUT }).toBe(true);
  let followups = 0;
  if (inquiry(trace.last).kind !== 'ready_to_return') {
    followups++;
    await composer.fill(CONTRACT.inquiryFollowup);
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
  }
  await expect.poll(() => idle(trace.last) && inquiry(trace.last)?.kind !== 'no_inquiry', { timeout: TIMEOUT }).toBe(true);
  await expect(page.getByTestId('tutor-inquiry-return')).toBeEnabled({timeout: TIMEOUT});
  await checkpoint(page, trace, 'inquiry-user-can-return');
  const fromReturn = trace.calls.length;
  await page.getByTestId('tutor-inquiry-return').click();
  await waitMainlineReady(page, trace, 'GT-02');
  assert.equal(trace.last.views.coach_panel_view.mainline.beat_id, anchor, 'return must not skip or advance the saved anchor');
  const returnCleanup = assertCleanup(trace, fromReturn, 'scope-transition');
  assert.equal(inquiry(trace.last).kind, 'no_inquiry');
  assert.equal(workspaceVisual(trace.last).focus, null, 'inquiry/old pulse focus must not leak into ready mainline');
  const transcript = trace.last.transcript ?? trace.last.views.coach_panel_view.transcript;
  assert.equal(transcript.filter(t => t.role === 'student' && (t.content ?? t.text) === CONTRACT.inquiryQuestion).length, 1, 'question must be recorded exactly once');
  await checkpoint(page, trace, 'inquiry-return-mainline');
  results.push({ scenario: 'inquiry', status: 'passed', session: trace.last.session_id, anchor, followups, entryCleanup, returnCleanup, boundary: CONTRACT.boundary });
  await page.close();
}
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
    await context.addInitScript(() => localStorage.setItem('trig-web-student-name', 'visual-lifecycle-local'));
    const response = await context.request.get(`${backend}/api/author-review`);
    assert(response.ok(), 'local harness metadata unavailable'); const metadata = await response.json();
    for (const [field, value] of Object.entries(CONTRACT.service)) assert.equal(metadata[field], value, 'refuse non-mechanical service');
    assert.equal(metadata.publicationPerformed, false); assert.equal(metadata.status, 'Draft');
    fs.writeFileSync(path.join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
    if (selected === 'all' || selected === 'owner') await ownerScenario(context);
    if (selected === 'all' || selected === 'inquiry') await inquiryScenario(context);
    for (const trace of traces) assert.deepEqual(trace.pageErrors, [], `${trace.label} page errors`);
  } catch (error) { errors.push(error.stack || String(error)); console.error(String(error)); process.exitCode = 1; }
  finally {
    for (const trace of traces) await Promise.all([...trace.pendingReads]);
    fs.writeFileSync(path.join(output, 'lifecycle.json'), JSON.stringify({ ...CONTRACT, status: errors.length ? 'failed' : 'passed', results, errors, traces: traces.map(({ pendingReads, ...trace }) => trace) }, null, 2));
    await browser?.close();
  }
})();

/** Offline Chromium: production projector + Registry, no mocked animation/DOM. */
const { build } = require('esbuild');
const { chromium } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
(async () => {
  const output = process.argv[2] || '/private/tmp/visual-segment-focus-browser';
  fs.mkdirSync(output, { recursive: true });
  const built = await build({ stdin: { contents: `
    import { GeometryModel } from '../domain/model';
    import { projectVisualScene } from '../react/projectVisualScene';
    import { VisualEffectRegistry } from '../react/VisualEffectRegistry';
    window.focusModules = { GeometryModel, projectVisualScene, VisualEffectRegistry };
  `, resolveDir: __dirname, loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="host" style="position:relative;width:400px;height:300px"></div>');
    await page.addScriptTag({ content: built.outputFiles[0].text });
    const result = await page.evaluate(async () => {
      const { GeometryModel, projectVisualScene, VisualEffectRegistry } = window.focusModules;
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const model = new GeometryModel({ points: [{ id: 'A', x: 40, y: 40 }, { id: 'B', x: 220, y: 40 }, { id: 'C', x: 40, y: 180 }], lines: [
        { id: 'CA', kind: 'segment', from: 'C', to: 'A' }, { id: 'CB', kind: 'segment', from: 'C', to: 'B' }
      ] });
      const viewport = { width: 400, height: 300, project: p => p };
      const host = document.querySelector('#host');
      const registry = new VisualEffectRegistry(host, { surfaceGeneration: 1 });
      const view = { visual_revision: 1, digest: 'a'.repeat(64), annotations: [], focus: {
        group_id: 'ratio', binding_ref: 'VB105', mode: 'steady', owner_key: 'teach', resolved_targets: { entity_ids: ['CA', 'CB', 'A', 'B', 'C'] }
      } };
      const identity = (executionKey, operation, pulseIds) => ({ sessionId: 'offline', executionKey, operation, pulseIds, visualRevision: 1,
        targetDigest: view.digest, surfaceGeneration: 1, abort: new AbortController().signal });
      const scene = projectVisualScene(view, model, viewport);
      await registry.install(scene, identity('steady', 'installed'));
      check(host.querySelectorAll('[data-visual-id] path').length === 2, 'steady missing explicit segments');
      check(host.getAnimations({ subtree: true }).length === 0, 'steady unexpectedly animated');
      check(!host.querySelector('text'), 'attention invented labels or correspondence');
      for (const p of host.querySelectorAll('path')) check(p.getBBox().height > 0, 'real path is not visible');
      view.focus.mode = 'pulse';
      const pulseScene = projectVisualScene(view, model, viewport);
      const execution = identity('pulse', 'entrance-complete', ['focus:ratio']);
      let completed = false;
      const start = performance.now();
      const pending = registry.install(pulseScene, execution).then(r => { completed = true; return r; });
      await new Promise(requestAnimationFrame);
      check(!completed, 'pulse receipt preceded real animation completion');
      check(host.getAnimations({ subtree: true }).some(a => a.playState === 'running'), 'no actual animation');
      const receipt = await pending;
      const elapsed = performance.now() - start;
      check(elapsed >= 1500 && receipt.operation === 'entrance-complete', 'incorrect finite completion');
      check(host.querySelectorAll('[data-visual-id]').length === 2, 'pulse removed steady effects');
      const retryStart = performance.now();
      await registry.install(pulseScene, execution);
      check(performance.now() - retryStart < 500 && host.getAnimations({ subtree: true }).length === 0, 'retry replayed pulse');
      const cleared = projectVisualScene({ ...view, focus: null }, model, viewport);
      await registry.reconcile(cleared, identity('cleanup', 'removed'));
      check(host.querySelectorAll('[data-visual-id]').length === 0, 'cleanup left effects');
      registry.dispose();
      return { steady: true, realPulseMs: elapsed, actualCompletion: true, retryNoReplay: true, cleanup: true, evidence: 'offline production projector/Registry; no model or HTTP' };
    });
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

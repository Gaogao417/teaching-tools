/** T-14/BL-N9 D3: independent OS processes share only the SQLite file; the sentinel
 * presenter proves restore consumes the persisted v15 sequence with zero model calls,
 * and a missing companion makes every later process fail closed. */
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { expect, it } from 'vitest';

const script = resolve('src/services/tutorOrchestration/__tests__/support/boundedLoweringCompanionProcess.ts');
type Message = { sessionId?: string; restored?: boolean; error?: string; events?: Array<{ sequence: number; event_type: string; payload_json: string }>; companions?: unknown[]; parity?: { equal: boolean }; presenterCalls?: number };
function child(dbPath: string, args: string[]) {
  const spawned = fork(script, args, { execArgv: ['--import', 'tsx'], env: { ...globalThis.process.env, SQLITE_PATH: dbPath, TUTOR_TELEMETRY: 'off' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages: Message[] = []; let stderr = '';
  spawned.stderr?.on('data', data => stderr += data);
  const done = new Promise<{ code: number | null; messages: Message[] }>((resolveDone, reject) => {
    const timer = setTimeout(() => { spawned.kill('SIGKILL'); reject(new Error('child timeout ' + stderr)); }, 120000);
    spawned.on('message', (message: Message) => messages.push(message));
    spawned.on('error', error => { clearTimeout(timer); reject(error); });
    spawned.on('exit', code => { clearTimeout(timer); resolveDone({ code, messages }); });
  });
  return { process: spawned, done };
}
it('separate process restores committed v15 sequence with zero model calls and fails closed on missing companion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'v15-companion-process-'));
  const spawned: Array<ReturnType<typeof child>> = [];
  const run = (dbPath: string, args: string[]) => { const c = child(dbPath, args); spawned.push(c); return c; };
  try {
    const dbPath = join(dir, 'session.sqlite');
    const commit = await run(dbPath, ['commit']).done;
    expect(commit.code).toBe(0);
    const report = commit.messages.find(m => m.sessionId);
    expect(report).toBeDefined();
    const planned = report!.events!.filter(e => e.event_type === 'presentation_sequence_planned');
    const v15 = planned.filter(e => JSON.parse(e.payload_json)?.generation?.presenter_pin?.prompt_version === 'presenter-interleaved/v15-visual');
    expect(v15.length).toBeGreaterThanOrEqual(1);
    expect(report!.companions!.length).toBeGreaterThanOrEqual(1);

    const restored = await run(dbPath, ['restore', report!.sessionId!]).done;
    expect(restored.code).toBe(0);
    const restoredReport = restored.messages.find(m => m.restored === true);
    expect(restoredReport).toBeDefined();
    expect(restoredReport!.events).toEqual(report!.events);
    expect(restoredReport!.parity?.equal).toBe(true);
    expect(restoredReport!.presenterCalls).toBe(0);

    const raw = new Database(dbPath);
    raw.prepare('DELETE FROM tutor_generation_companions WHERE session_id=?').run(report!.sessionId!);
    raw.close();
    const corrupted = await run(dbPath, ['restore', report!.sessionId!]).done;
    expect(corrupted.code).toBe(5);
    const failure = corrupted.messages.find(m => m.restored === false);
    expect(failure?.error).toContain('GENERATION_COMPANION_CORRUPT');
    expect(failure?.presenterCalls).toBe(0);
  } finally {
    await Promise.all(spawned.map(async c => { if (c.process.exitCode === null) c.process.kill('SIGKILL'); await c.done.catch(() => undefined); }));
    rmSync(dir, { recursive: true, force: true });
  }
}, 300000);

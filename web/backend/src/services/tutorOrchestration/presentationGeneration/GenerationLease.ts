/** Rebuildable scheduling data, not a canonical fact or a second generation state machine.
 * The lease and kernel CAS use the same SQLite transaction; only the kernel epoch
 * permits a result commit. A heartbeat never advances teaching revision.
 */
import { db } from '../../../db/database';
export const GENERATION_LEASE_MS = 45_000;
export const GENERATION_HEARTBEAT_MS = 10_000;
function init(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS tutor_generation_leases (
    session_id TEXT NOT NULL, request_id TEXT NOT NULL, owner TEXT NOT NULL,
    epoch INTEGER NOT NULL, expires_ms INTEGER NOT NULL, lease_ms INTEGER NOT NULL,
    PRIMARY KEY(session_id, request_id))`);
}
export function claimGenerationLease(args: {
  sessionId: string; requestId: string; owner: string; epoch: number;
  now: number; leaseMs: number; commit: () => boolean;
}): boolean {
  init();
  return db.transaction(() => {
    const row = db.prepare('SELECT * FROM tutor_generation_leases WHERE session_id=? AND request_id=?').get(args.sessionId, args.requestId) as {owner:string; expires_ms:number; lease_ms:number} | undefined;
    if (row && row.owner !== args.owner && row.expires_ms > args.now) return false;
    if (!args.commit()) return false;
    const duration = row?.lease_ms ?? args.leaseMs;
    db.prepare(`INSERT INTO tutor_generation_leases VALUES (?,?,?,?,?,?)
      ON CONFLICT(session_id,request_id) DO UPDATE SET owner=excluded.owner,epoch=excluded.epoch,expires_ms=excluded.expires_ms`)
      .run(args.sessionId,args.requestId,args.owner,args.epoch,args.now+duration,duration);
    return true;
  }).immediate();
}
export function renewGenerationLease(sessionId:string, requestId:string, owner:string, now:number): boolean {
  init();
  return db.prepare('UPDATE tutor_generation_leases SET expires_ms=?+lease_ms WHERE session_id=? AND request_id=? AND owner=? AND expires_ms>?')
    .run(now,sessionId,requestId,owner,now).changes === 1;
}
export function releaseGenerationLease(sessionId:string,requestId:string,owner:string):void {
  init();
  db.prepare('UPDATE tutor_generation_leases SET expires_ms=0 WHERE session_id=? AND request_id=? AND owner=?').run(sessionId,requestId,owner);
}

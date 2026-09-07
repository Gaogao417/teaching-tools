/** Restart recovery is a server scheduler, never a side effect of GET/restore.
 * Kernel reconstruction is authoritative; SQL only enumerates candidate sessions.
 */
import { db } from "../../../db/database";
import type { TutorRuntimeApplicationV7 } from "../TutorRuntimeApplicationV7";

const RECOVERY_CONCURRENCY = 4;

/** The scheduler and tests share the real SQL scan and bounded session dispatch. */
export function createGenerationRecoveryScanner(
  factory: () => TutorRuntimeApplicationV7,
  onError: (error: unknown) => void,
): { scanOnce: () => Promise<void>; stop: () => void } {
  let stopped = false;
  let scanning = false;
  const scanOnce = async (): Promise<void> => {
    if (stopped || scanning) return;
    scanning = true;
    try {
      const rows = db.prepare(
        "SELECT session_id FROM tutor_sessions WHERE event_schema='v9' AND completed_at IS NULL",
      ).all() as { session_id: string }[];
      const application = factory();
      for (let i = 0; i < rows.length && !stopped; i += RECOVERY_CONCURRENCY) {
        await Promise.all(rows.slice(i, i + RECOVERY_CONCURRENCY).map(async (row) => {
          try {
            const session = application.restore(row.session_id);
            if (session.hasPendingGeneration()) await application.drivePendingGeneration(session);
          } catch (error) {
            onError(error);
          }
        }));
      }
    } catch (error) {
      onError(error);
    } finally {
      scanning = false;
    }
  };
  return { scanOnce, stop: () => { stopped = true; } };
}

export function startGenerationRecoveryWorker(
  factory: () => TutorRuntimeApplicationV7,
  onError: (error: unknown) => void,
): () => void {
  const scanner = createGenerationRecoveryScanner(factory, onError);
  const timer = setInterval(() => void scanner.scanOnce(), 10_000);
  timer.unref();
  void scanner.scanOnce();
  return () => { scanner.stop(); clearInterval(timer); };
}

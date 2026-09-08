/** Server-private, single-use projection material. Never a runtime state cache. */
import { createHash } from "node:crypto";
import { db } from "../../db/database";
import type { WorkspaceFold } from "../tutorSession/WorkspaceRuntimeReducerV5";
import type { VisualBarrier, VisualExecutionOwner } from "../../../../shared/canonical";
export type ProjectionReadStamp = { changes: number; dataVersion: number };
export function projectionReadStamp(): ProjectionReadStamp {
  return { changes: (db.prepare("SELECT total_changes() AS n").get() as { n: number }).n,
    dataVersion: db.pragma("data_version", { simple: true }) as number };
}
export function sameProjectionReadStamp(a: ProjectionReadStamp, b: ProjectionReadStamp): boolean {
  return a.changes === b.changes && a.dataVersion === b.dataVersion;
}
export type ProjectionWorkspace = { state: Pick<WorkspaceFold["state"], "revision">; context: Pick<WorkspaceFold["context"], "tutorCommands"> };
export type SnapshotProjectionMaterial = {
  runtimeState: Record<string, unknown>; workspace: ProjectionWorkspace; baseGeometry: unknown;
  givenAngleMarks?: readonly import("./KnownGivenAngleProjection").ProblemGivenAngleMark[];
  givenLengthFacts?: readonly import("./KnownGivenLengthProjection").GivenLengthFact[];
  visualLifecycle?: { presentation_execution_owner: VisualExecutionOwner; visual_barrier: VisualBarrier | null };
};
type RecordEntry = { source: object; eventSchema: string; digest: string; identity: string;
  currentIdentity: () => string; stamp: ProjectionReadStamp; material: SnapshotProjectionMaterial };
const entries = new WeakMap<object, RecordEntry>();
const digest = (value: object) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
/** Only snapshot()'s already-computed locals; registration never rebuilds. */
export function registerSnapshotProjection(snapshot: object, source: object, eventSchema: string,
  material: SnapshotProjectionMaterial, before: ProjectionReadStamp, currentIdentity: () => string): void {
  const stamp = projectionReadStamp();
  if (!sameProjectionReadStamp(before, stamp)) return;
  entries.set(snapshot, { source, eventSchema, stamp, currentIdentity, identity: currentIdentity(),
    digest: digest(snapshot), material: freeze(structuredClone(material)) });
}
/** Concrete object identity, not a serializable token or session/revision lookup. */
export function consumeSnapshotProjection(snapshot: object, source: object, eventSchema: string):
  { material: SnapshotProjectionMaterial; stamp: ProjectionReadStamp } | undefined {
  const entry = entries.get(snapshot); entries.delete(snapshot);
  if (!entry || entry.source !== source || entry.eventSchema !== eventSchema
    || entry.digest !== digest(snapshot) || entry.identity !== entry.currentIdentity()
    || !sameProjectionReadStamp(entry.stamp, projectionReadStamp())) return;
  // Await is legal only while local/external SQLite stamps and identity agree.
  return { material: structuredClone(entry.material), stamp: entry.stamp };
}

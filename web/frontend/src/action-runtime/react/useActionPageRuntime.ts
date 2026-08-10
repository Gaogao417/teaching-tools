import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ActionCheckpointSnapshot, ExercisePlan } from "../../../../shared/actionRuntime";
import { createActionPageRuntime } from "../pageRuntime";

export function useActionPageRuntime(plan: ExercisePlan, checkpoint?: ActionCheckpointSnapshot) {
  const runtime = useMemo(
    () => createActionPageRuntime(plan, checkpoint),
    [plan.exerciseId, plan.revision],
  );
  const deferredStop = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (deferredStop.current !== undefined) window.clearTimeout(deferredStop.current);
    return () => {
      // React StrictMode probes effects with setup→cleanup→setup. Deferring the
      // teardown lets the second setup cancel it, while a real unmount still
      // stops both XState actors on the next task.
      deferredStop.current = window.setTimeout(() => runtime.stop(), 0);
    };
  }, [runtime]);
  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  // The page snapshot is referentially stable between notifications. WorkspaceView
  // is a pure projection and is intentionally rebuilt only when React renders.
  const view = runtime.getView();
  return { runtime, snapshot, view };
}

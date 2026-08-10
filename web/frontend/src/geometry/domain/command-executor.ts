/**
 * CommandExecutor — the single entry point that mutates {@link GeometryModel}.
 *
 * Both human interaction (via the tool machine) and automated agents arrive
 * here. The executor validates each {@link GeometryCommand} against the model
 * and then, and only then, writes derived geometry back. This is the final
 * correctness gate; interaction guards may reject early for UX, but they can
 * never be the sole source of truth.
 */
import type { GeometryCommand } from "./commands";
import { type GeoLine, GeometryModel } from "./model";

export interface CommandResultOk {
  ok: true;
  /** Human-readable description of what changed, for UI feedback only. */
  summary: string;
  /** Ids of entities the executor created. */
  createdIds: string[];
}

export interface CommandResultErr {
  ok: false;
  /** Stable machine-readable reason code. */
  reason: "missing-reference" | "degenerate" | "unknown-command";
  message: string;
}

export type CommandResult = CommandResultOk | CommandResultErr;

export interface CommandExecutor {
  execute(command: GeometryCommand): CommandResult;
}

export function createCommandExecutor(model: GeometryModel): CommandExecutor {
  return {
    execute(command) {
      switch (command.type) {
        case "construct-parallel":
          return executeConstructParallel(model, command);
        case "construct-circle":
          return executeConstructCircle(model, command);
        case "mark-angle":
          // POC placeholder: angle marking has no geometry mutation yet.
          return { ok: true, summary: `Marked angle ${command.angleId}`, createdIds: [] };
        default: {
          // Exhaustiveness: a new command variant forces a case here.
          const _exhaustive: never = command;
          void _exhaustive;
          return { ok: false, reason: "unknown-command", message: `Unknown command: ${JSON.stringify(command)}` };
        }
      }
    },
  };
}

function executeConstructParallel(
  model: GeometryModel,
  command: { type: "construct-parallel"; throughPointId: string; referenceLineId: string },
): CommandResult {
  const through = model.getPoint(command.throughPointId);
  const ref = model.getLine(command.referenceLineId);
  if (!through || !ref) {
    return {
      ok: false,
      reason: "missing-reference",
      message: "construct-parallel: referenced point or line does not exist",
    };
  }

  // The reference line must have a non-degenerate direction. Resolved through
  // the model so a parallel-of-a-parallel is still valid as a reference.
  const dir = model.lineDirection(command.referenceLineId);
  if (dir.dx === 0 && dir.dy === 0) {
    return { ok: false, reason: "degenerate", message: "construct-parallel: reference line is degenerate" };
  }

  // Persist the parallel as a *relation* only — a single `parallel-line` that
  // declares `through` + `parallelTo`. No synthetic endpoint, no extra segment:
  // the renderer derives display extent from the relation, so there is one
  // source of truth and nothing to drift out of sync.
  const line: GeoLine = {
    id: `parallel-${through.id}-${ref.id}`,
    kind: "parallel-line",
    through: command.throughPointId,
    parallelTo: command.referenceLineId,
    derived: true,
  };

  model.addLine(line);
  return {
    ok: true,
    summary: `过 ${through.id} 作 ${ref.id} 的平行线`,
    createdIds: [line.id],
  };
}

function executeConstructCircle(
  model: GeometryModel,
  command: { type: "construct-circle"; centerId: string; throughPointId: string },
): CommandResult {
  const center = model.getPoint(command.centerId);
  const through = model.getPoint(command.throughPointId);
  if (!center || !through) {
    return {
      ok: false,
      reason: "missing-reference",
      message: "construct-circle: center or through-point does not exist",
    };
  }
  const radius = Math.hypot(through.x - center.x, through.y - center.y);
  if (radius === 0) {
    return { ok: false, reason: "degenerate", message: "construct-circle: radius is zero" };
  }

  const id = `circle-${center.id}-${through.id}`;
  model.addCircle({ id, centerId: center.id, throughPointId: through.id, derived: true });
  return { ok: true, summary: `以 ${center.id} 为圆心过 ${through.id} 作圆`, createdIds: [id] };
}

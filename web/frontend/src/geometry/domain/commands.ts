/**
 * GeometryCommand — the stable boundary shared by Human / Agent / Replay.
 *
 * A command is a JSON-friendly domain intent. It MUST NOT carry React nodes,
 * class instances, closures, or actor refs. It is what a tool machine emits on
 * completion and what {@link CommandExecutor} consumes to mutate the
 * {@link GeometryModel}.
 *
 * Keeping this shape serializable is what lets the same command path serve UI
 * interaction, automated agents, and future replay/audit — none of them have to
 * simulate clicks.
 */

export type PointId = string;
export type LineId = string;
export type AngleId = string;

/**
 * Construct a line through {@link throughPointId} parallel to the line
 * {@link referenceLineId}.
 */
export interface ConstructParallelCommand {
  type: "construct-parallel";
  throughPointId: PointId;
  referenceLineId: LineId;
}

/**
 * Construct a circle centered at {@link centerId} passing through
 * {@link throughPointId}.
 */
export interface ConstructCircleCommand {
  type: "construct-circle";
  centerId: PointId;
  throughPointId: PointId;
}

/**
 * Mark an angle (domain placeholder). Implemented as a type-only member so the
 * command union keeps its extension surface even though the POC only delivers
 * construct-parallel and construct-circle.
 */
export interface MarkAngleCommand {
  type: "mark-angle";
  angleId: AngleId;
  label?: string;
}

export type GeometryCommand =
  | ConstructParallelCommand
  | ConstructCircleCommand
  | MarkAngleCommand;

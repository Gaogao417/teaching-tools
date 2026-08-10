import type { WorldProjection } from "./actionRuntime";
import type { TopicGeometryModel } from "./topicPractice";

interface CommandBase<Type extends string> {
  commandId: string;
  actionId: string;
  type: Type;
}

export type DomainCommand =
  | (CommandBase<"construct-parallel"> & {
      throughPointId: string;
      referenceLineId: string;
      outputLineId: string;
    })
  | (CommandBase<"construct-carrier"> & {
      fromPointId: string;
      toPointId: string;
      outputLineId: string;
    })
  | (CommandBase<"intersect-lines"> & {
      firstLineId: string;
      secondLineId: string;
      outputPointId: string;
    });

export interface CommandBatch {
  actionId: string;
  sourceStepId: string;
  commands: DomainCommand[];
  committed: boolean;
}

export interface WorkspaceWorld {
  committed: WorldProjection;
  draft: WorldProjection;
  revision: number;
  commandBatches: CommandBatch[];
}

export type WorldCommandErrorCode =
  | "missing-geometry"
  | "missing-reference"
  | "duplicate-output"
  | "degenerate"
  | "unknown-command";

export class WorldCommandError extends Error {
  constructor(readonly code: WorldCommandErrorCode, message: string) {
    super(message);
  }
}

function cloneGeometry(geometry: TopicGeometryModel): TopicGeometryModel {
  return {
    viewBox: { ...geometry.viewBox },
    points: geometry.points.map((point) => ({ ...point })),
    segments: geometry.segments.map((segment) => ({ ...segment })),
    derivedLines: geometry.derivedLines?.map((line) => ({ ...line })) || [],
  };
}

function lineRelation(geometry: TopicGeometryModel, id: string, seen = new Set<string>()): {
  point: { x: number; y: number };
  direction: { x: number; y: number };
} | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  const segment = geometry.segments.find((candidate) => candidate.id === id);
  if (segment) {
    const from = geometry.points.find((point) => point.id === segment.from);
    const to = geometry.points.find((point) => point.id === segment.to);
    if (!from || !to) return undefined;
    return { point: from, direction: { x: to.x - from.x, y: to.y - from.y } };
  }
  const parallel = geometry.derivedLines?.find((candidate) => candidate.id === id);
  if (!parallel) return undefined;
  const through = geometry.points.find((point) => point.id === parallel.through);
  const reference = lineRelation(geometry, parallel.parallelTo, seen);
  return through && reference ? { point: through, direction: reference.direction } : undefined;
}

function applyOne(geometry: TopicGeometryModel, command: DomainCommand): void {
  const hasLine = (id: string) => geometry.segments.some((line) => line.id === id)
    || geometry.derivedLines?.some((line) => line.id === id);
  switch (command.type) {
    case "construct-parallel": {
      if (!geometry.points.some((point) => point.id === command.throughPointId) || !hasLine(command.referenceLineId)) {
        throw new WorldCommandError("missing-reference", `construct-parallel references missing geometry for ${command.commandId}`);
      }
      if (hasLine(command.outputLineId)) throw new WorldCommandError("duplicate-output", `Line ${command.outputLineId} already exists`);
      const reference = lineRelation(geometry, command.referenceLineId);
      if (!reference || Math.hypot(reference.direction.x, reference.direction.y) < 1e-9) {
        throw new WorldCommandError("degenerate", `Reference line ${command.referenceLineId} is degenerate`);
      }
      (geometry.derivedLines ||= []).push({
        id: command.outputLineId,
        kind: "parallel-line",
        through: command.throughPointId,
        parallelTo: command.referenceLineId,
        derived: true,
      });
      return;
    }
    case "construct-carrier": {
      if (!geometry.points.some((point) => point.id === command.fromPointId)
        || !geometry.points.some((point) => point.id === command.toPointId)) {
        throw new WorldCommandError("missing-reference", `construct-carrier references missing points for ${command.commandId}`);
      }
      if (hasLine(command.outputLineId)) throw new WorldCommandError("duplicate-output", `Line ${command.outputLineId} already exists`);
      if (command.fromPointId === command.toPointId) throw new WorldCommandError("degenerate", "Carrier endpoints must differ");
      geometry.segments.push({ id: command.outputLineId, from: command.fromPointId, to: command.toPointId, derived: true });
      return;
    }
    case "intersect-lines": {
      if (geometry.points.some((point) => point.id === command.outputPointId)) {
        throw new WorldCommandError("duplicate-output", `Point ${command.outputPointId} already exists`);
      }
      const first = lineRelation(geometry, command.firstLineId);
      const second = lineRelation(geometry, command.secondLineId);
      if (!first || !second) throw new WorldCommandError("missing-reference", `intersect-lines references missing lines for ${command.commandId}`);
      const denominator = first.direction.x * second.direction.y - first.direction.y * second.direction.x;
      if (Math.abs(denominator) < 1e-9) throw new WorldCommandError("degenerate", "Lines do not have a unique intersection");
      const dx = second.point.x - first.point.x;
      const dy = second.point.y - first.point.y;
      const t = (dx * second.direction.y - dy * second.direction.x) / denominator;
      geometry.points.push({
        id: command.outputPointId,
        x: first.point.x + t * first.direction.x,
        y: first.point.y + t * first.direction.y,
        derived: true,
      });
      const parallel = geometry.derivedLines?.find((line) => line.id === command.firstLineId);
      if (parallel) parallel.endPoint = command.outputPointId;
      const carrier = geometry.segments.find((line) => line.id === command.secondLineId && line.derived);
      if (carrier) carrier.extensionPoint = command.outputPointId;
      return;
    }
  }
}

/** Pure, deterministic command port shared by frontend draft and backend commit. */
export function applyDomainCommands(world: WorldProjection, commands: readonly DomainCommand[]): WorldProjection {
  if (!commands.length) return { ...world, geometry: world.geometry ? cloneGeometry(world.geometry) : undefined };
  if (!world.geometry) throw new WorldCommandError("missing-geometry", "World has no geometry model");
  const geometry = cloneGeometry(world.geometry);
  for (const command of commands) applyOne(geometry, command);
  return { ...world, geometry };
}

export function replayCommandBatches(committed: WorldProjection, batches: readonly CommandBatch[]): WorldProjection {
  return batches.reduce((world, batch) => applyDomainCommands(world, batch.commands), committed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDomainCommand(value: unknown): value is DomainCommand {
  if (!isRecord(value) || typeof value.commandId !== "string" || typeof value.actionId !== "string" || typeof value.type !== "string") return false;
  if (value.type === "construct-parallel") {
    return typeof value.throughPointId === "string" && typeof value.referenceLineId === "string" && typeof value.outputLineId === "string";
  }
  if (value.type === "construct-carrier") {
    return typeof value.fromPointId === "string" && typeof value.toPointId === "string" && typeof value.outputLineId === "string";
  }
  if (value.type === "intersect-lines") {
    return typeof value.firstLineId === "string" && typeof value.secondLineId === "string" && typeof value.outputPointId === "string";
  }
  return false;
}

import type { WorldProjection } from "./actionRuntime";
import type { TopicGeometryModel } from "./topicPractice";
import type { ActionEffectBatch } from "./actionEffects";

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
    })
  | (CommandBase<"set-segment-label"> & {
      segmentId: string;
      markId: string;
      valueLatex: string;
      labelKind: "length" | "share";
    })
  | (CommandBase<"set-correspondence-mark"> & {
      segmentIds: [string, string];
      markId: string;
      tickCount: number;
    })
  | (CommandBase<"set-emphasis"> & {
      entityIds: string[];
      markId: string;
    });

export interface WorkspaceWorld {
  committed: WorldProjection;
  draft: WorldProjection;
  revision: number;
  commandBatches: ActionEffectBatch[];
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
    teachingMarks: geometry.teachingMarks?.map((mark) => mark.kind === "correspondence"
      ? { ...mark, segmentIds: [...mark.segmentIds] as [string, string] }
      : mark.kind === "emphasis" ? { ...mark, entityIds: [...mark.entityIds] } : { ...mark }) || [],
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
    case "set-segment-label": {
      if (!hasLine(command.segmentId)) throw new WorldCommandError("missing-reference", `Unknown segment ${command.segmentId}`);
      if (!command.valueLatex.trim()) throw new WorldCommandError("degenerate", "Segment label cannot be empty");
      const marks = (geometry.teachingMarks ||= []);
      const existing = marks.findIndex((mark) => mark.id === command.markId);
      const mark = { id: command.markId, kind: "segment-label" as const, segmentId: command.segmentId, valueLatex: command.valueLatex, labelKind: command.labelKind };
      if (existing >= 0) marks[existing] = mark;
      else marks.push(mark);
      return;
    }
    case "set-correspondence-mark": {
      if (command.segmentIds.some((id) => !hasLine(id))) throw new WorldCommandError("missing-reference", `Unknown correspondence segment for ${command.markId}`);
      const marks = (geometry.teachingMarks ||= []);
      const existing = marks.findIndex((mark) => mark.id === command.markId);
      const mark = { id: command.markId, kind: "correspondence" as const, segmentIds: [...command.segmentIds] as [string, string], tickCount: command.tickCount };
      if (existing >= 0) marks[existing] = mark;
      else marks.push(mark);
      return;
    }
    case "set-emphasis": {
      if (command.entityIds.some((id) => !hasLine(id) && !geometry.points.some((point) => point.id === id))) {
        throw new WorldCommandError("missing-reference", `Unknown emphasis entity for ${command.markId}`);
      }
      const marks = (geometry.teachingMarks ||= []);
      const existing = marks.findIndex((mark) => mark.id === command.markId);
      const mark = { id: command.markId, kind: "emphasis" as const, entityIds: [...command.entityIds] };
      if (existing >= 0) marks[existing] = mark;
      else marks.push(mark);
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
  if (value.type === "set-segment-label") {
    return typeof value.segmentId === "string" && typeof value.markId === "string" && typeof value.valueLatex === "string"
      && ["length", "share"].includes(String(value.labelKind));
  }
  if (value.type === "set-correspondence-mark") {
    return hasStringTuple(value.segmentIds) && typeof value.markId === "string" && typeof value.tickCount === "number";
  }
  if (value.type === "set-emphasis") {
    return Array.isArray(value.entityIds) && value.entityIds.every((id) => typeof id === "string") && typeof value.markId === "string";
  }
  return false;
}

function hasStringTuple(value: unknown): value is [string, string] {
  return Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === "string");
}

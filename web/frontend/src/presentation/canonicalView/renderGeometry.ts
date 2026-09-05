/**
 * F7 Step 7：`render.geometry`（tutorHttpProfile 宽松 record）→ production
 * Canvas 消费面的运行时结构校验。
 *
 * 服务端 V7HttpSnapshotProjector 由 pinned base + committed 命令合成并在
 * 产出侧过自身门禁；本函数是前端第二道门——零 `as` cast 地把
 * `Record<string, unknown> | null` 判定为可渲染 `TopicGeometryModel`。
 * 非 null 且不可解析 = 快照不可用于 Canvas，adopt 门禁整份拒绝（原子采用
 * 纪律）；null = 无图示任务（渲染明确占位）。
 */
import type { TopicGeometryModel } from "../../../../shared/topicPractice";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: unknown): value is string => typeof value === "string";

function parsePoint(value: unknown): TopicGeometryModel["points"][number] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isString(record["id"]) || !isFiniteNumber(record["x"]) || !isFiniteNumber(record["y"])) return undefined;
  return {
    id: record["id"],
    x: record["x"],
    y: record["y"],
    ...(record["derived"] === true ? { derived: true } : {}),
  };
}

function parseSegment(value: unknown): TopicGeometryModel["segments"][number] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isString(record["id"]) || !isString(record["from"]) || !isString(record["to"])) return undefined;
  return {
    id: record["id"],
    from: record["from"],
    to: record["to"],
    ...(record["derived"] === true ? { derived: true } : {}),
    ...(isString(record["extensionPoint"]) ? { extensionPoint: record["extensionPoint"] } : {}),
  };
}

function parseParallelLine(value: unknown): NonNullable<TopicGeometryModel["derivedLines"]>[number] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isString(record["id"]) || !isString(record["through"]) || !isString(record["parallelTo"])) return undefined;
  return {
    id: record["id"],
    kind: "parallel-line",
    through: record["through"],
    parallelTo: record["parallelTo"],
    derived: true,
    ...(isString(record["endPoint"]) ? { endPoint: record["endPoint"] } : {}),
  };
}

function parseTeachingMark(value: unknown): NonNullable<TopicGeometryModel["teachingMarks"]>[number] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  if (!isString(record["id"]) || !isString(record["kind"])) return undefined;
  switch (record["kind"]) {
    case "segment-label":
      if (!isString(record["segmentId"]) || !isString(record["valueLatex"])) return undefined;
      if (record["labelKind"] !== "length" && record["labelKind"] !== "share") return undefined;
      return { id: record["id"], kind: "segment-label", segmentId: record["segmentId"], valueLatex: record["valueLatex"], labelKind: record["labelKind"] };
    case "correspondence": {
      const segmentIds = record["segmentIds"];
      if (!Array.isArray(segmentIds) || segmentIds.length !== 2 || !segmentIds.every(isString)) return undefined;
      if (!isFiniteNumber(record["tickCount"])) return undefined;
      return { id: record["id"], kind: "correspondence", segmentIds: [segmentIds[0], segmentIds[1]], tickCount: record["tickCount"] };
    }
    case "emphasis": {
      const entityIds = record["entityIds"];
      if (!Array.isArray(entityIds) || !entityIds.every(isString)) return undefined;
      return { id: record["id"], kind: "emphasis", entityIds };
    }
    default:
      return undefined;
  }
}

/**
 * `null` → undefined（无图示任务，调用方渲染明确占位）；结构非法 → undefined
 * （调用方按 adopt 门禁整份拒绝快照，不部分渲染）。已知字段强校验、未知
 * 字段忽略（渲染面只消费已知形状，服务端 additive 字段不破坏前端）。
 */
export function parseRenderGeometryV1(value: Record<string, unknown> | null): TopicGeometryModel | undefined {
  if (value === null) return undefined;
  if (typeof value !== "object") return undefined;
  const viewBox = value["viewBox"];
  if (typeof viewBox !== "object" || viewBox === null) return undefined;
  const box = viewBox as Record<string, unknown>;
  if (!isFiniteNumber(box["width"]) || !isFiniteNumber(box["height"]) || box["width"] <= 0 || box["height"] <= 0) return undefined;
  const points = value["points"];
  const segments = value["segments"];
  if (!Array.isArray(points) || !Array.isArray(segments)) return undefined;
  const parsedPoints = points.map(parsePoint);
  const parsedSegments = segments.map(parseSegment);
  if (parsedPoints.some((point) => point === undefined) || parsedSegments.some((segment) => segment === undefined)) {
    return undefined;
  }
  const derivedLines = value["derivedLines"];
  if (derivedLines !== undefined) {
    if (!Array.isArray(derivedLines)) return undefined;
    const parsed = derivedLines.map(parseParallelLine);
    if (parsed.some((line) => line === undefined)) return undefined;
    return {
      viewBox: { width: box["width"], height: box["height"] },
      points: parsedPoints as TopicGeometryModel["points"],
      segments: parsedSegments as TopicGeometryModel["segments"],
      derivedLines: parsed as NonNullable<TopicGeometryModel["derivedLines"]>,
    };
  }
  const teachingMarks = value["teachingMarks"];
  if (teachingMarks !== undefined) {
    if (!Array.isArray(teachingMarks)) return undefined;
    const parsed = teachingMarks.map(parseTeachingMark);
    if (parsed.some((mark) => mark === undefined)) return undefined;
    return {
      viewBox: { width: box["width"], height: box["height"] },
      points: parsedPoints as TopicGeometryModel["points"],
      segments: parsedSegments as TopicGeometryModel["segments"],
      teachingMarks: parsed as NonNullable<TopicGeometryModel["teachingMarks"]>,
    };
  }
  return {
    viewBox: { width: box["width"], height: box["height"] },
    points: parsedPoints as TopicGeometryModel["points"],
    segments: parsedSegments as TopicGeometryModel["segments"],
  };
}

/**
 * F7 Step 7 返工（独立复验 P1-4）：`render.geometry`（tutorHttpProfile 宽松
 * record）→ production Canvas 消费面的运行时结构校验。
 *
 * 服务端 V7HttpSnapshotProjector 由 pinned base + committed 命令合成并在
 * 产出侧过自身门禁；本函数是前端第二道门——把 `Record<string, unknown> | null`
 * 判定为可渲染 `TopicGeometryModel`。
 *
 * 校验纪律（复验裁定）：
 * - 各字段段（points/segments/derivedLines/teachingMarks）**独立解析**后统一
 *   组装——不因某段存在而提前返回丢失其余段（首轮实现的确定缺陷）；
 * - 已知字段非法即拒绝（如 derivedLines[].kind ≠ "parallel-line"），不静默
 *   修正/伪造；未知字段忽略（additive 不破坏前端）；
 * - 实体引用完整：段端点/平行线 through/parallelTo/endPoint、teachingMark
 *   的 segmentId/segmentIds/entityIds 必须指向已解析实体；重复 id 拒绝；
 * - 零 `as` cast：以 isRecord 收窄（`as Record<string, unknown>` 属 cast）。
 *
 * `null` → undefined（无图示任务，渲染占位）；结构非法 → undefined（adopt
 * 门禁整份拒绝快照，不部分渲染）。
 */
import type { TopicGeometryModel } from "../../../../shared/topicPractice";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: unknown): value is string => typeof value === "string";

/** 整段解析：任一元素失败 → undefined（避免 map+some 的窄化丢失）。 */
function parseAll<T>(raw: readonly unknown[], parser: (value: unknown) => T | undefined): T[] | undefined {
  const parsed: T[] = [];
  for (const item of raw) {
    const value = parser(item);
    if (value === undefined) return undefined;
    parsed.push(value);
  }
  return parsed;
}

/** 已知可选布尔：true → true；false/缺省 → false；其他类型 = 非法（null 哨兵）。 */
function optionalFlag(value: unknown): boolean | null {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return null;
}

function parsePoint(value: unknown): TopicGeometryModel["points"][number] | undefined {
  if (!isRecord(value)) return undefined;
  const derived = optionalFlag(value["derived"]);
  if (!isString(value["id"]) || !isFiniteNumber(value["x"]) || !isFiniteNumber(value["y"]) || derived === null) {
    return undefined;
  }
  return { id: value["id"], x: value["x"], y: value["y"], ...(derived ? { derived: true } : {}) };
}

function parseSegment(value: unknown): TopicGeometryModel["segments"][number] | undefined {
  if (!isRecord(value)) return undefined;
  const derived = optionalFlag(value["derived"]);
  if (!isString(value["id"]) || !isString(value["from"]) || !isString(value["to"]) || derived === null) return undefined;
  const extensionPoint = value["extensionPoint"];
  if (extensionPoint !== undefined && !isString(extensionPoint)) return undefined;
  return {
    id: value["id"],
    from: value["from"],
    to: value["to"],
    ...(derived ? { derived: true } : {}),
    ...(extensionPoint !== undefined ? { extensionPoint } : {}),
  };
}

function parseParallelLine(value: unknown): NonNullable<TopicGeometryModel["derivedLines"]>[number] | undefined {
  if (!isRecord(value)) return undefined;
  // 已知字段非法即拒绝：kind 必须已是 "parallel-line"，不由解析器代填；
  // derived 是模型 literal true——缺失/false 均拒绝，不静默改写为 true
  //（完成度审计 P2：原实现对 false/缺省会静默写出 true，违反「不静默修正」纪律）。
  if (value["kind"] !== "parallel-line") return undefined;
  if (!isString(value["id"]) || !isString(value["through"]) || !isString(value["parallelTo"])) return undefined;
  if (value["derived"] !== true) return undefined;
  const endPoint = value["endPoint"];
  if (endPoint !== undefined && !isString(endPoint)) return undefined;
  return {
    id: value["id"],
    kind: "parallel-line",
    through: value["through"],
    parallelTo: value["parallelTo"],
    derived: true,
    ...(endPoint !== undefined ? { endPoint } : {}),
  };
}

function parseTeachingMark(value: unknown): NonNullable<TopicGeometryModel["teachingMarks"]>[number] | undefined {
  if (!isRecord(value)) return undefined;
  const id = value["id"];
  if (!isString(id) || !isString(value["kind"])) return undefined;
  switch (value["kind"]) {
    case "angle-equality": {
      const rawAngles = value["angles"];
      if(value["source"] !== "problem-given" || !Array.isArray(rawAngles) || rawAngles.length < 2) return undefined;
      const angles: {vertex:string;rayPoints:[string,string];sector:"minor"}[] = [];
      for(const angle of rawAngles) {
        if(!isRecord(angle) || !isString(angle["vertex"]) || angle["sector"] !== "minor") return undefined;
        const rays = angle["rayPoints"];
        if(!Array.isArray(rays) || rays.length !== 2 || !isString(rays[0]) || !isString(rays[1]) || new Set([angle["vertex"],...rays]).size !== 3) return undefined;
        angles.push({vertex:angle["vertex"],rayPoints:[rays[0],rays[1]],sector:"minor"});
      }
      return {id,kind:"angle-equality",source:"problem-given",angles};
    }
    case "segment-label":
      if (!isString(value["segmentId"]) || !isString(value["valueLatex"])) return undefined;
      if (value["labelKind"] !== "length" && value["labelKind"] !== "share") return undefined;
      return { id, kind: "segment-label", segmentId: value["segmentId"], valueLatex: value["valueLatex"], labelKind: value["labelKind"] };
    case "correspondence": {
      const segmentIds = value["segmentIds"];
      if (!Array.isArray(segmentIds) || segmentIds.length !== 2 || !segmentIds.every(isString)) return undefined;
      if (!isFiniteNumber(value["tickCount"])) return undefined;
      return { id, kind: "correspondence", segmentIds: [segmentIds[0], segmentIds[1]], tickCount: value["tickCount"] };
    }
    case "emphasis": {
      const entityIds = value["entityIds"];
      if (!Array.isArray(entityIds) || !entityIds.every(isString)) return undefined;
      return { id, kind: "emphasis", entityIds };
    }
    default:
      return undefined;
  }
}

/**
 * 解析并统一组装；任一段非法/引用缺失/重复 id → undefined。引用宇宙：
 * 点/段 id（emphasis.entityIds 可指向任一）；derivedLines 挂在线宇宙。
 */
export function parseRenderGeometryV1(value: Record<string, unknown> | null): TopicGeometryModel | undefined {
  if (!isRecord(value)) return undefined;
  const viewBox = value["viewBox"];
  if (!isRecord(viewBox) || !isFiniteNumber(viewBox["width"]) || !isFiniteNumber(viewBox["height"])
    || viewBox["width"] <= 0 || viewBox["height"] <= 0) {
    return undefined;
  }
  const rawPoints = value["points"];
  const rawSegments = value["segments"];
  if (!Array.isArray(rawPoints) || !Array.isArray(rawSegments)) return undefined;
  const points = parseAll(rawPoints, parsePoint);
  const segments = parseAll(rawSegments, parseSegment);
  if (points === undefined || segments === undefined) return undefined;

  // 段可选：derivedLines / teachingMarks 各自独立解析（互不遮蔽）。
  const rawDerivedLines = value["derivedLines"];
  const rawTeachingMarks = value["teachingMarks"];
  if (rawDerivedLines !== undefined && !Array.isArray(rawDerivedLines)) return undefined;
  if (rawTeachingMarks !== undefined && !Array.isArray(rawTeachingMarks)) return undefined;
  const derivedLines = rawDerivedLines === undefined ? [] : parseAll(rawDerivedLines, parseParallelLine);
  const teachingMarks = rawTeachingMarks === undefined ? [] : parseAll(rawTeachingMarks, parseTeachingMark);
  if (derivedLines === undefined || teachingMarks === undefined) return undefined;

  // 实体身份唯一性（点/段/派生线同一 id 空间；mark id 独立集合）。
  const entityIds = new Set<string>();
  for (const entity of [...points, ...segments, ...derivedLines]) {
    if (entityIds.has(entity.id)) return undefined;
    entityIds.add(entity.id);
  }
  const markIds = new Set<string>();
  for (const mark of teachingMarks) {
    if (markIds.has(mark.id)) return undefined;
    markIds.add(mark.id);
  }

  // 引用完整性。
  const pointIds = new Set(points.map((point) => point.id));
  const lineIds = new Set(segments.map((segment) => segment.id));
  for (const segment of segments) {
    if (!pointIds.has(segment.from) || !pointIds.has(segment.to)) return undefined;
    if (segment.extensionPoint !== undefined && !pointIds.has(segment.extensionPoint)) return undefined;
  }
  for (const line of derivedLines) {
    if (!pointIds.has(line.through) || !lineIds.has(line.parallelTo)) return undefined;
    if (line.endPoint !== undefined && !pointIds.has(line.endPoint)) return undefined;
  }
  for (const mark of teachingMarks) {
    if (mark.kind === "angle-equality" && mark.angles.some(angle => [angle.vertex,...angle.rayPoints].some(id => !pointIds.has(id)))) return undefined;
    if (mark.kind === "segment-label" && !lineIds.has(mark.segmentId)) return undefined;
    if (mark.kind === "correspondence" && (!lineIds.has(mark.segmentIds[0]) || !lineIds.has(mark.segmentIds[1]))) return undefined;
    if (mark.kind === "emphasis") {
      for (const entityId of mark.entityIds) {
        if (!entityIds.has(entityId)) return undefined;
      }
    }
  }

  return {
    viewBox: { width: viewBox["width"], height: viewBox["height"] },
    points,
    segments,
    ...(derivedLines.length > 0 ? { derivedLines } : {}),
    ...(teachingMarks.length > 0 ? { teachingMarks } : {}),
  };
}

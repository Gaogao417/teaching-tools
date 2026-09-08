/**
 * F4 生产补强（2026-09-08）：生产 driver 发布的 task binding 与 workspace catalog。
 *
 * 生产链（MVP produce_teaching_assets → tools publish-teaching-plan-bundle
 * --task-id）把「题图 pipeline 生成的 baseGeometry + RG facts 板书目录」发布进
 * 独立 canonical build root，并登记 `vnext-task-bindings.yaml`。golden 绑定表
 * 不变（F7 冻结）；本模块只服务**已发布生产 root** 的任务解析：
 *
 * - binding/目录文件缺失或形状非法 → fail closed（UNKNOWN_TASK /
 *   PLAN_IMPORT_FAILED / CATALOG_PIN_MISMATCH），无默认回退；
 * - catalog 经 buildWorkspacePresentationCatalog 全量校验 + baseGeometry
 *   形状校验（有限坐标、viewBox、无悬空端点/重复 id）——生产数据跨边界
 *   同样不豁免 fail closed；
 * - 发布物是本地 build root 的 append-only 布局（同 tutor-policy-profile
 *   先例），不是新的跨仓 canonical 合同。
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  buildWorkspacePresentationCatalog,
  workspaceCatalogPin,
  type WorkspacePresentationCatalogV5,
} from "../tutorSession/WorkspacePresentationCatalogV5";

export interface PublishedTaskBinding {
  readonly tpId: string;
  readonly scenarioId: string;
  /** 相对 canonical root 的 catalog JSON 路径。 */
  readonly catalogPath: string;
}

interface GeometryPointShape { id: string; x: number; y: number; derived?: boolean }
interface GeometrySegmentShape { id: string; from: string; to: string; derived?: boolean }

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const TP_ID_PATTERN = /^TP-[A-Z0-9]+-[0-9]{3,}$/;

export class PublishedBindingError extends Error {
  constructor(readonly code: "UNKNOWN_TASK" | "INVALID_PUBLISHED_BINDING" | "INVALID_PUBLISHED_CATALOG", message: string) {
    super(message);
    this.name = "PublishedBindingError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** 列出 root 下已发布生产绑定的全部 task id（缺文件 → 空列表；损坏 → fail closed）。 */
export function listPublishedTaskIds(canonicalRoot: string): readonly string[] {
  const file = join(canonicalRoot, "vnext-task-bindings.yaml");
  if (!existsSync(file)) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PublishedBindingError("INVALID_PUBLISHED_BINDING", `vnext-task-bindings.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !isRecord(parsed.bindings)) return [];
  return Object.keys(parsed.bindings).filter((id) => TASK_ID_PATTERN.test(id));
}

/** 读取 root 下 `vnext-task-bindings.yaml` 的一条生产绑定；缺文件/缺条目 → undefined。 */
export function loadPublishedTaskBinding(canonicalRoot: string, taskId: string): PublishedTaskBinding | undefined {
  if (!TASK_ID_PATTERN.test(taskId)) return undefined;
  const file = join(canonicalRoot, "vnext-task-bindings.yaml");
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = parseYaml(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PublishedBindingError("INVALID_PUBLISHED_BINDING", `vnext-task-bindings.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed) || !isRecord(parsed.bindings)) return undefined;
  const entry = parsed.bindings[taskId];
  if (entry === undefined || entry === null) return undefined;
  if (!isRecord(entry) || typeof entry.tp_id !== "string" || !TP_ID_PATTERN.test(entry.tp_id)
    || typeof entry.scenario_id !== "string" || !entry.scenario_id.trim()
    || typeof entry.catalog !== "string" || !entry.catalog.trim()) {
    throw new PublishedBindingError("INVALID_PUBLISHED_BINDING", `published binding for task ${taskId} has an invalid shape (fail closed)`);
  }
  if (isAbsolute(entry.catalog) || entry.catalog.includes("..")) {
    throw new PublishedBindingError("INVALID_PUBLISHED_BINDING", `published binding catalog path must stay inside the canonical root: ${entry.catalog}`);
  }
  return { tpId: entry.tp_id, scenarioId: entry.scenario_id, catalogPath: entry.catalog };
}

function validateBaseGeometry(catalog: Record<string, unknown>): void {
  const base = catalog.baseGeometry;
  if (!isRecord(base)) throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published catalog has no baseGeometry");
  const view = base.viewBox;
  if (!isRecord(view) || !isFiniteNumber(view.width) || !isFiniteNumber(view.height) || view.width <= 0 || view.height <= 0) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published catalog viewBox is invalid");
  }
  const points = base.points;
  const segments = base.segments;
  if (!Array.isArray(points) || points.length === 0 || !Array.isArray(segments) || segments.length === 0) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published catalog baseGeometry needs points and segments");
  }
  const ids = new Set<string>();
  const pointIds = new Set<string>();
  for (const point of points as GeometryPointShape[]) {
    if (!isRecord(point) || typeof point.id !== "string" || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published catalog point is malformed");
    }
    if (point.x < 0 || point.x > (view as { width: number }).width || point.y < 0 || point.y > (view as { height: number }).height) {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published catalog point ${point.id} is outside the viewBox`);
    }
    if (ids.has(point.id)) throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `duplicate geometry id ${point.id}`);
    ids.add(point.id);
    pointIds.add(point.id);
  }
  for (const segment of segments as GeometrySegmentShape[]) {
    if (!isRecord(segment) || typeof segment.id !== "string" || typeof segment.from !== "string" || typeof segment.to !== "string") {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published catalog segment is malformed");
    }
    if (!pointIds.has(segment.from) || !pointIds.has(segment.to)) {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published catalog segment ${segment.id} dangles`);
    }
    if (segment.from === segment.to) {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published catalog segment ${segment.id} is a self loop`);
    }
    if (ids.has(segment.id)) throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `duplicate geometry id ${segment.id}`);
    ids.add(segment.id);
    if (segment.derived === true) {
      throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `derived segment ${segment.id} leaked into the published base figure`);
    }
  }
  if (base.derivedLines !== undefined || base.teachingMarks !== undefined) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published base figure must not carry derived lines or teaching marks");
  }
}

/** 加载并全量校验生产发布的 workspace catalog（taskId 必须与目录一致）。 */
export function loadPublishedWorkspaceCatalog(canonicalRoot: string, catalogPath: string, taskId: string): WorkspacePresentationCatalogV5 {
  const file = resolve(canonicalRoot, catalogPath);
  if (!file.startsWith(resolve(canonicalRoot))) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "catalog path escapes the canonical root");
  }
  if (!existsSync(file)) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published workspace catalog missing: ${catalogPath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published workspace catalog is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(raw)) throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", "published workspace catalog must be an object");
  validateBaseGeometry(raw);
  let catalog: WorkspacePresentationCatalogV5;
  try {
    catalog = buildWorkspacePresentationCatalog(raw);
  } catch (error) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published workspace catalog failed assembly: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (catalog.taskId !== taskId) {
    throw new PublishedBindingError("INVALID_PUBLISHED_CATALOG", `published catalog taskId ${catalog.taskId} does not match binding task ${taskId}`);
  }
  return catalog;
}

/** pin 计算（与 session_started.workspace_catalog_pin 同口径）。 */
export function publishedCatalogPin(catalog: WorkspacePresentationCatalogV5): { content_hash: string } {
  return workspaceCatalogPin(catalog);
}

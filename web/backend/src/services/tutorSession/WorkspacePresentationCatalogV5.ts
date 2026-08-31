/**
 * WorkspacePresentationCatalog（F3 — Workspace 状态转换内核）。
 *
 * 任务级 immutable student-safe 呈现目录：View 的 content/kind/分组不在
 * state/v1（设计事实：state 只存 id/枚举/单 revision），由本目录提供——
 * project(state, catalog) 仍是纯函数（ADR-008 §4 Projector 职责不变，
 * catalog=§5「immutable Board context」的统一形态，f3-scope-ledger 偏差 2）。
 *
 * hidden 条目的呈现内容只存在于服务端 catalog（reveal=visibility 翻转的
 * 前提）；state（id+state only）与 View（整条不出现）均不泄漏。
 *
 * gate 绑定（R2 2026-08-31，五级链 resource 腿）：final 类条目必须声明
 * revealGate={gateId/beatId/protocolId}——reveal 授权由
 * WorkspaceRuntimeReducerV5 按 `Plan → Protocol → Beat → Gate → resource`
 * 全链裁决（Plan=catalog.taskId 对 session_started.task_id；Protocol=绑定
 * protocolId ∈ session_started.protocol_refs；Beat=gate_evaluated.beat_id ==
 * 绑定 beatId == 当前 cursor beat；Gate=该 gate committed 且 satisfied；
 * resource=被 reveal 的正是该绑定授权的条目）。
 *
 * catalog pin/hash（R0 §4 冻结口径，R2 2026-08-31 实现）：digest 参与对象
 * = 整个 catalog 对象（schemaVersion/taskId/baseGeometry?/authoredElementKinds?/
 * boardEntries[保序]/canonicalPathEntryIds/initialInteractionMode；seed 不参与），
 * 序列化 = 递归键排序 + 紧凑 JSON + UTF-8 + sha256 小写 hex + `sha256:` 前缀；
 * start 注入 session_started.workspace_catalog_pin，resume 重算对账，不符即
 * HASH_MISMATCH fail closed——不接受未经对账的任意 catalog。
 *
 * legacy 适配路径处置（2026-08-31 R2，协调者采纳 R0 建议「删除/隔离」）：
 * 原 `adaptLegacyWorkspaceIntoCatalogV5` 已删除——它对板书行序反推 kind/
 * revealRequirement/canonicalPath（首行 statement、末行 conclusion/final、全
 * PG-01、BE-01 顺序编号），而 legacy 数据里不存在这些语义，直接违反
 * legacy-contract-adapters.yaml 头部「不得反推/伪造缺失字段」纪律。VS1
 * legacy 链（web/backend/src/services/tutorSession/workspaceRuntimeState.ts）
 * 原样保留服务旧 v2–v4 会话（非双轨）；v5 会话禁止经 legacy 板书行产出
 * catalog——缺 reveal 语义（kind/revealRequirement/revealGate）的输入一律
 * fail closed（buildWorkspacePresentationCatalog 校验拒绝），不得产出可
 * reveal 的完整 catalog。若未来需要保留该路径，必须先由 R0 在
 * contracts/mappings/legacy-contract-adapters.yaml 登记只读 adapter（草稿见
 * r0-contract-wave.md §6，休眠未生效）。
 *
 * BE- 条目分配接口在此冻结；绑定 F4 materializer 真实产物（RG 节点呈现物）
 * 属 F6 Presenter 接线（f3-scope-ledger「明确不做」）。
 */
import { createHash } from "node:crypto";

import type { TopicGeometryModel } from "../../../../shared/topicPractice";
import type { WorkspaceViewElementKind } from "./WorkspaceCapabilityRegistryV5";

export const WORKSPACE_CATALOG_SCHEMA_VERSION = 1 as const;

export type BoardEntryViewKind = "statement" | "derivation" | "conclusion" | "question";

/**
 * final 类条目的 gate 绑定（五级链 `Plan → Protocol → Beat → Gate → resource`
 * 的资源授权声明）：该条目的 final reveal 只能由「属于 protocolId 协议、
 * beatId Beat 的 gateId 门」在满足后授权。
 */
export interface WorkspaceBoardEntryGateBinding {
  /** 授权 gate（GT-；须有 committed gate_evaluated satisfied 于绑定 Beat）。 */
  gateId: string;
  /** gate 所属 Beat（BT-；当前 cursor Beat 必须仍在此——Beat 推进后 gate 失效）。 */
  beatId: string;
  /** gate 所属 Protocol（PR-；必须 ∈ session_started.protocol_refs）。 */
  protocolId: string;
}

export interface WorkspaceBoardEntrySpec {
  /** Board 语义条目 id（BE- 前缀；对应 ReviewedSolutionGraph 节点的呈现物）。 */
  entryId: string;
  kind: BoardEntryViewKind;
  /** student-safe 呈现文本（hidden 期间只存在于服务端 catalog）。 */
  content: string;
  presentationGroup: string;
  /** 内容暴露要求：final=结论真值（gate 满足 + final_result 才可 reveal）。 */
  revealRequirement: "intermediate" | "final";
  /** gate 绑定（revealRequirement=final 必带；intermediate 禁带）。 */
  revealGate?: WorkspaceBoardEntryGateBinding;
}

/** 会话种子覆写（bootstrap 显式覆写输入；legacy 适配产路已删除，见文件头）。 */
export interface WorkspaceSeedOverlay {
  /** 显式给定已提交构图（输出元素直接视为 committed）。 */
  committedElementIds?: string[];
  /** 显式给定初始可见板书条目（须为调用方已持有 reveal 授权的条目）。 */
  boardVisibility?: Record<string, "visible" | "active">;
  interactionMode?: "free" | "construction" | "locked";
}

export interface WorkspacePresentationCatalogV5 {
  schemaVersion: typeof WORKSPACE_CATALOG_SCHEMA_VERSION;
  taskId: string;
  /** authored 学生安全题图（canvas 基座；committed_element_ids 只记运行时产出）。 */
  baseGeometry?: TopicGeometryModel;
  /** authored 元素 id → View kind（缺省按前缀纪律推导）。 */
  authoredElementKinds?: Record<string, WorkspaceViewElementKind>;
  boardEntries: WorkspaceBoardEntrySpec[];
  canonicalPathEntryIds: string[];
  initialInteractionMode: "free" | "construction" | "locked";
}

const BE_PATTERN = /^BE-[0-9]{1,3}$/;
const PG_PATTERN = /^PG-[0-9]{1,3}$/;
const GATE_PATTERN = /^GT-[0-9]{1,3}$/;
const BEAT_PATTERN = /^BT-[0-9]{1,3}$/;
/** canonical v5 policy_decision_made.protocol_id 同款 pattern。 */
const PROTOCOL_PATTERN = /^PR-[A-Z0-9]+-[0-9]{3,}$/;

export class WorkspaceCatalogError extends Error {
  constructor(readonly errors: readonly string[]) {
    super(`invalid workspace presentation catalog: ${errors.join("; ")}`);
    this.name = "WorkspaceCatalogError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGateBinding(entry: Record<string, unknown>, index: number): WorkspaceBoardEntryGateBinding | undefined {
  const raw = entry.revealGate;
  if (raw === undefined) return undefined;
  const errors: string[] = [];
  if (!isRecord(raw)) {
    throw new WorkspaceCatalogError([`boardEntries[${index}].revealGate 必须是对象`]);
  }
  if (typeof raw.gateId !== "string" || !GATE_PATTERN.test(raw.gateId)) {
    errors.push(`boardEntries[${index}].revealGate.gateId 必须匹配 ${GATE_PATTERN}`);
  }
  if (typeof raw.beatId !== "string" || !BEAT_PATTERN.test(raw.beatId)) {
    errors.push(`boardEntries[${index}].revealGate.beatId 必须匹配 ${BEAT_PATTERN}`);
  }
  if (typeof raw.protocolId !== "string" || !PROTOCOL_PATTERN.test(raw.protocolId)) {
    errors.push(`boardEntries[${index}].revealGate.protocolId 必须匹配 ${PROTOCOL_PATTERN}`);
  }
  if (errors.length) throw new WorkspaceCatalogError(errors);
  return { gateId: raw.gateId as string, beatId: raw.beatId as string, protocolId: raw.protocolId as string };
}

/** 目录构建（fail closed：形状/唯一性/引用完整性/gate 绑定逐项校验，不静默降级）。 */
export function buildWorkspacePresentationCatalog(
  input: unknown,
): WorkspacePresentationCatalogV5 {
  const errors: string[] = [];
  if (!isRecord(input)) throw new WorkspaceCatalogError(["catalog 必须是对象"]);
  const taskId = input.taskId;
  if (typeof taskId !== "string" || !taskId.trim()) errors.push("taskId 必须是非空字符串");
  if (input.schemaVersion !== WORKSPACE_CATALOG_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${WORKSPACE_CATALOG_SCHEMA_VERSION}`);
  }
  const entries = input.boardEntries;
  if (!Array.isArray(entries) || entries.length === 0) errors.push("boardEntries 必须是非空数组");
  const entryIds = new Set<string>();
  const boardEntrySpecs: WorkspaceBoardEntrySpec[] = [];
  if (Array.isArray(entries)) {
    entries.forEach((entry, index) => {
      if (!isRecord(entry)) {
        errors.push(`boardEntries[${index}] 必须是对象`);
        return;
      }
      if (typeof entry.entryId !== "string" || !BE_PATTERN.test(entry.entryId)) {
        errors.push(`boardEntries[${index}].entryId 必须匹配 ${BE_PATTERN}`);
      } else if (entryIds.has(entry.entryId)) {
        errors.push(`boardEntries[${index}].entryId ${entry.entryId} 重复`);
      } else {
        entryIds.add(entry.entryId);
      }
      if (!["statement", "derivation", "conclusion", "question"].includes(String(entry.kind))) {
        errors.push(`boardEntries[${index}].kind 非法`);
      }
      if (typeof entry.content !== "string" || !entry.content.trim()) {
        errors.push(`boardEntries[${index}].content 必须是非空 student-safe 文本`);
      }
      if (typeof entry.presentationGroup !== "string" || !PG_PATTERN.test(entry.presentationGroup)) {
        errors.push(`boardEntries[${index}].presentationGroup 必须匹配 ${PG_PATTERN}`);
      }
      if (!["intermediate", "final"].includes(String(entry.revealRequirement))) {
        errors.push(`boardEntries[${index}].revealRequirement 非法`);
      }
      const revealGate = parseGateBinding(entry, index);
      // gate 绑定纪律：final 必带（缺 reveal 语义的输入 fail closed——legacy
      // 板书行等未登记来源不得产出可 reveal 的完整 catalog）；intermediate 禁带。
      if (entry.revealRequirement === "final" && !revealGate) {
        errors.push(`boardEntries[${index}] revealRequirement=final 必须携带 revealGate（五级绑定的资源授权声明）`);
      }
      if (entry.revealRequirement === "intermediate" && revealGate) {
        errors.push(`boardEntries[${index}] revealRequirement=intermediate 不得携带 revealGate`);
      }
      boardEntrySpecs.push({
        entryId: String(entry.entryId),
        kind: entry.kind as BoardEntryViewKind,
        content: String(entry.content),
        presentationGroup: String(entry.presentationGroup),
        revealRequirement: entry.revealRequirement as "intermediate" | "final",
        ...(revealGate ? { revealGate } : {}),
      });
    });
  }
  const canonicalPath = input.canonicalPathEntryIds;
  if (Array.isArray(canonicalPath)) {
    const seen = new Set<string>();
    for (const id of canonicalPath) {
      if (typeof id !== "string" || !entryIds.has(id)) {
        errors.push(`canonicalPathEntryIds 含未知条目 ${String(id)}`);
      } else if (seen.has(id)) {
        errors.push(`canonicalPathEntryIds 条目 ${id} 重复`);
      } else {
        seen.add(id);
      }
    }
  }
  const mode = input.initialInteractionMode ?? "construction";
  if (!["free", "construction", "locked"].includes(String(mode))) {
    errors.push("initialInteractionMode 非法");
  }
  if (errors.length) throw new WorkspaceCatalogError(errors);

  const authoredKinds = isRecord(input.authoredElementKinds)
    ? (Object.fromEntries(
        Object.entries(input.authoredElementKinds).filter(
          ([, kind]) =>
            ["point", "segment", "line", "circle", "polygon", "label", "measure"].includes(String(kind)),
        ),
      ) as Record<string, WorkspaceViewElementKind>)
    : undefined;

  return {
    schemaVersion: WORKSPACE_CATALOG_SCHEMA_VERSION,
    taskId: taskId as string,
    ...(isRecord(input.baseGeometry)
      ? { baseGeometry: input.baseGeometry as unknown as TopicGeometryModel }
      : {}),
    ...(authoredKinds ? { authoredElementKinds: authoredKinds } : {}),
    boardEntries: boardEntrySpecs,
    canonicalPathEntryIds: Array.isArray(canonicalPath) ? (canonicalPath as string[]) : [],
    initialInteractionMode: mode as WorkspacePresentationCatalogV5["initialInteractionMode"],
  };
}

export function boardEntryById(
  catalog: WorkspacePresentationCatalogV5,
  entryId: string,
): WorkspaceBoardEntrySpec | undefined {
  return catalog.boardEntries.find((entry) => entry.entryId === entryId);
}

// --------------------------------------------------------------------------- //
// catalog pin / digest（R0 §4 冻结计算口径；R2 2026-08-31 实现）
// --------------------------------------------------------------------------- //

/** 递归对象键字典序排序（arrays 保序——顺序是语义）；undefined 键剔除。 */
function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => [key, canonicalizeValue(v)]),
    );
  }
  return value;
}

/**
 * catalog 内容 digest（R0 §4）：参与对象 = 整个 catalog 对象（seed overlay
 * 不参与——会话 bootstrap 状态由事件流/revision 链负责）；序列化 = 递归键
 * 排序 + JSON 无空白（紧凑分隔符）+ UTF-8 + sha256 → 小写 hex → `sha256:` 前缀。
 */
export function computeWorkspaceCatalogDigest(catalog: WorkspacePresentationCatalogV5): string {
  const participant = {
    schemaVersion: catalog.schemaVersion,
    taskId: catalog.taskId,
    ...(catalog.baseGeometry !== undefined ? { baseGeometry: catalog.baseGeometry } : {}),
    ...(catalog.authoredElementKinds !== undefined ? { authoredElementKinds: catalog.authoredElementKinds } : {}),
    boardEntries: catalog.boardEntries,
    canonicalPathEntryIds: catalog.canonicalPathEntryIds,
    initialInteractionMode: catalog.initialInteractionMode,
  };
  const canonicalJson = JSON.stringify(canonicalizeValue(participant));
  return `sha256:${createHash("sha256").update(canonicalJson, "utf8").digest("hex")}`;
}

/** session_started.workspace_catalog_pin 形状（canonical 可选字段；F3 新会话必带）。 */
export interface WorkspaceCatalogPin {
  catalog_schema_version: number;
  content_hash: string;
  entry_count: number;
}

/** 由服务端 catalog 计算 pin（start 注入；调用方不得自带——服务端 catalog 是真源）。 */
export function workspaceCatalogPin(catalog: WorkspacePresentationCatalogV5): WorkspaceCatalogPin {
  return {
    catalog_schema_version: catalog.schemaVersion,
    content_hash: computeWorkspaceCatalogDigest(catalog),
    entry_count: catalog.boardEntries.length,
  };
}

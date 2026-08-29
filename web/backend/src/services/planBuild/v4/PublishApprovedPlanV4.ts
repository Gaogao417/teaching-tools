/**
 * F4 复验修复（2026-08-29）：planning/v4 Approved artifact 发布器（P1-2）。
 *
 * 此前发布守卫只存在于 CLI 脚本（scripts/build-approved-plan-v4.ts 内联的
 * publishVersion，existsSync 不可覆盖守卫无任何自动化测试），且 registry.yaml
 * 写入与 loader 对账规则分离。本模块把发布路径收敛为 planBuild 服务内可测试
 * 的唯一实现，CLI 只做薄封装：
 *
 * 1. 不可变守卫（append-only）：目标版本文件已存在即 fail——修改 Approved
 *    内容只能产生新 version（ADR-004；dry-run 也执行该守卫，重发布必须在
 *    写盘前被拒绝）；
 * 2. 写前 fail-closed 门禁：status=Approved、canonical schema（39-schema
 *    dispatch）、content_hash 用同规则重算自洽、artifact_uri 一致；
 * 3. registry.yaml per-version 锚定：每次发布把 content_hash 锚进 current
 *    版本条目（与 skills 仓 canonical_export.promote_canonical 的锚定格式
 *    同构）；既有版本条目保留（合并而非覆盖），previous current 条目标
 *    Superseded（只改 registry 元数据，不改写已发布版本 JSON——TS 侧版本
 *    文件永不动，与 CLI 的 existsSync 守卫一致）。
 *
 * loader 侧（canonicalInputs，anchored=true）对 payload.content_hash ==
 * registry 锚定 hash == 重算 hash 做三方对账，本模块保证写入侧自洽。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { validatePayload } from "../../../../../shared/canonical";
import { canonicalHash } from "../canonicalInputs";

export type PublishV4Namespace = "reviewed-solution-graph" | "teaching-protocol" | "tutor-plan";

export interface PublishableV4Artifact {
  readonly artifact_id?: string;
  readonly graph_id?: string;
  readonly protocol_id?: string;
  readonly version: string;
  readonly status: string;
  readonly schema?: string;
  readonly content_hash: string;
  readonly artifact_uri?: string;
  readonly approval?: { approved_at?: string };
  readonly question_ref?: { artifact_id: string; version: string; content_hash: string };
  [key: string]: unknown;
}

export interface PublishRegistryVersionEntry {
  version: string;
  status: string;
  content_hash?: string;
  approved_at?: string;
  superseded_by?: { artifact_id: string; version: string };
  question_ref?: { artifact_id: string; version: string; content_hash: string };
}

export type PublishApprovedPlanV4Result = { ok: true; wrote: boolean } | { ok: false; errors: string[] };

function artifactIdOf(payload: PublishableV4Artifact): string | null {
  return payload.artifact_id ?? payload.graph_id ?? payload.protocol_id ?? null;
}

/**
 * 发布一个 Approved planning/v4 版本（append-only + registry 锚定）。
 * dryRun=true 时执行全部守卫与校验但不写盘（守卫必须先于 dry-run 返回，
 * 使同版本重发布在 dry-run 下也被拒绝）。
 */
export function publishApprovedPlanV4(
  canonicalRoot: string,
  namespace: PublishV4Namespace,
  payload: PublishableV4Artifact,
  options: { dryRun?: boolean } = {},
): PublishApprovedPlanV4Result {
  const artifactId = artifactIdOf(payload);
  if (!artifactId) return { ok: false, errors: ["publishApprovedPlanV4: 缺 artifact/graph/protocol id"] };
  const dir = path.join(canonicalRoot, namespace, artifactId);
  const versionFile = path.join(dir, `${payload.version}.json`);

  // 1. 不可变守卫：版本文件已存在即拒绝（含 dry-run；修改 Approved 内容只能产生新 version）
  if (existsSync(versionFile)) {
    return {
      ok: false,
      errors: [
        `${artifactId}: ${payload.version}.json 已存在（canonical 版本不可覆盖——修改 Approved 内容只能产生新 version）`,
      ],
    };
  }

  // 2. 写前 fail-closed 校验（status / schema / hash 自洽 / artifact_uri）
  const errors: string[] = [];
  if (payload.status !== "Approved") {
    errors.push(`${artifactId}@${payload.version}: status=${payload.status}，发布只接受 Approved`);
  }
  const schemaCheck = validatePayload(payload as unknown as Record<string, unknown>);
  if (!schemaCheck.ok) {
    errors.push(`${artifactId}@${payload.version}: canonical schema 校验失败: ${schemaCheck.errors.join("; ")}`);
  }
  const hashKind = namespace === "tutor-plan" ? "plan" : "authoring";
  const recomputed = canonicalHash(payload as unknown as Record<string, unknown>, hashKind);
  if (recomputed !== payload.content_hash) {
    errors.push(`${artifactId}@${payload.version}: content_hash 与内容不一致（漂移或被篡改）`);
  }
  const expectedUri = `artifact://${namespace}/${artifactId}@${payload.version}`;
  if (payload.artifact_uri !== undefined && payload.artifact_uri !== expectedUri) {
    errors.push(`${artifactId}@${payload.version}: artifact_uri 与 artifact_id@version 不一致: ${String(payload.artifact_uri)}`);
  }
  if (errors.length) return { ok: false, errors };

  if (options.dryRun) return { ok: true, wrote: false };

  // 3. 写版本文件 + 合并 registry.yaml（per-version 锚定 content_hash）
  mkdirSync(dir, { recursive: true });
  writeFileSync(versionFile, `${JSON.stringify(payload, null, 2)}\n`);

  const registryPath = path.join(dir, "registry.yaml");
  let registry: { artifact_id?: string; current_version?: string; versions?: PublishRegistryVersionEntry[] } = {};
  if (existsSync(registryPath)) {
    try {
      registry = parseYaml(readFileSync(registryPath, "utf8")) as typeof registry;
    } catch {
      registry = {};
    }
  }
  const previousCurrent = registry.current_version ?? null;
  const versions = [...(registry.versions ?? [])].map((entry) => {
    if (previousCurrent && entry.version === previousCurrent && entry.version !== payload.version) {
      return { ...entry, status: "Superseded", superseded_by: { artifact_id: artifactId, version: payload.version } };
    }
    return entry;
  });
  versions.push({
    version: payload.version,
    status: "Approved",
    content_hash: payload.content_hash,
    approved_at: payload.approval?.approved_at ?? "",
    ...(payload.question_ref ? { question_ref: payload.question_ref } : {}),
  });
  const merged: Record<string, unknown> = {
    artifact_id: artifactId,
    current_version: payload.version,
    versions,
  };
  writeFileSync(registryPath, stringifyYaml(merged));
  return { ok: true, wrote: true };
}

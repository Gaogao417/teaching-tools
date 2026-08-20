/**
 * Runtime registry snapshot（Phase 4 / P4-01）。
 *
 * 代码 registry 是 Action vocabulary 的唯一真源：ActionKind 来自
 * web/shared/actionRuntime.ts（RUNTIME_ACTION_KINDS），DomainCommand 来自
 * web/shared/actionWorld.ts 的联合类型，capability 来自
 * web/shared/similarityLearningMap.ts（9 个 similarity.*）加上 Action 模板
 * authoring 固有的 agent:* 元能力。Build Agent 与 materializer 只允许引用
 * snapshot 中存在的词汇；缺 primitive / 未知 capability 一律 fail closed。
 *
 * runtime_registry_version 是内容寻址的（v{planVersion}@{digest12}）：词汇表
 * 任何变化都会改变版本号，从而使旧 TutorPlan 的 runtime_projection 失配，
 * 强制重新 build（ADR-006「相同 Plan + 相同 registry version ⇒ 相同 hash」
 * 的逆否命题）。
 */
import { createHash } from "node:crypto";

import {
  ACTION_RUNTIME_PLAN_VERSION,
  RUNTIME_ACTION_KINDS,
} from "../../../../shared/actionRuntime";
import { SIMILARITY_CAPABILITY_IDS } from "../../../../shared/similarityLearningMap";

/** Action 模板 authoring 固有的 agent 元能力（topicActionTemplateAuthoring.base）。 */
export const AGENT_META_CAPABILITIES: readonly string[] = [
  "agent:select-object",
  "agent:set-answer",
  "agent:back",
  "agent:clear",
];

/** actionWorld.DomainCommand 的 kind 面（6 类几何操作）。 */
export const RUNTIME_DOMAIN_COMMANDS: readonly string[] = [
  "construct-parallel",
  "construct-carrier",
  "intersect-lines",
  "set-segment-label",
  "set-correspondence-mark",
  "set-emphasis",
];

export interface RuntimeRegistrySnapshot {
  readonly runtime_registry_version: string;
  readonly action_kinds: readonly string[];
  readonly domain_commands: readonly string[];
  readonly capabilities: readonly string[];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildRuntimeRegistrySnapshot(): RuntimeRegistrySnapshot {
  const actionKinds = [...RUNTIME_ACTION_KINDS].sort();
  const domainCommands = [...RUNTIME_DOMAIN_COMMANDS].sort();
  const capabilities = [...SIMILARITY_CAPABILITY_IDS, ...AGENT_META_CAPABILITIES].sort();
  const digest = createHash("sha256")
    .update(
      stableStringify({
        action_kinds: actionKinds,
        domain_commands: domainCommands,
        capabilities: capabilities,
      }),
      "utf8",
    )
    .digest("hex")
    .slice(0, 12);
  return {
    runtime_registry_version: `action-runtime-registry/v${ACTION_RUNTIME_PLAN_VERSION}@${digest}`,
    action_kinds: actionKinds,
    domain_commands: domainCommands,
    capabilities,
  };
}

export function isKnownActionKind(snapshot: RuntimeRegistrySnapshot, kind: string): boolean {
  return snapshot.action_kinds.includes(kind);
}

export function isKnownCapability(snapshot: RuntimeRegistrySnapshot, capability: string): boolean {
  return snapshot.capabilities.includes(capability);
}

/** 返回不在 registry 中的 capability（空数组 = 全部合法）。 */
export function unknownCapabilities(
  snapshot: RuntimeRegistrySnapshot,
  requested: readonly string[],
): string[] {
  return [...new Set(requested)].filter((capability) => !isKnownCapability(snapshot, capability));
}

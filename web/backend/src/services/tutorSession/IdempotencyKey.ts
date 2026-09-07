/**
 * IdempotencyKey 组合器（F7 P2 转办 2：canonical 128 字符结构性上限）。
 *
 * canonical tutor-session-event idempotency_key：`^[A-Za-z0-9._:-]{8,128}$`。
 * 服务端组合键的成员含客户端供给身份（client_request_id 本身可达 128 字符），
 * 拼接后超限 ⇒ 回执 4xx（A 轨实测：deterministic outcome 长前缀组合）。
 *
 * 收紧策略（防复发；A 侧已改执行身份稳定摘要，本侧不再依赖客户端自律）：
 * - 组合结果 ≤128 ⇒ 原样使用（既有键逐字节不变——历史流可读性零影响）；
 * - >128 ⇒ 保留稳定前缀（前 3 段）+ 全串 sha256 前 24 hex 摘要（确定性：
 *   同输入恒同键——幂等语义不变；截断只发生在本来就会 4xx 的形状上）。
 */
import { createHash } from "node:crypto";

const IDEMPOTENCY_KEY_MAX = 128;

export function composeIdempotencyKey(parts: readonly string[]): string {
  const joined = parts.join(":");
  if (joined.length <= IDEMPOTENCY_KEY_MAX) return joined;
  const digest = createHash("sha256").update(joined).digest("hex").slice(0, 24);
  const head = parts.slice(0, 3).join(":").slice(0, IDEMPOTENCY_KEY_MAX - digest.length - 1);
  return `${head}:${digest}`;
}

/** canonical 上限自证（防漂移；越界键在 append 边界仍会被 canonical 拒绝）。 */
export function assertIdempotencyKeyShape(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new Error(`composed idempotency key violates the canonical shape (len=${key.length}): ${key.slice(0, 64)}…`);
  }
}

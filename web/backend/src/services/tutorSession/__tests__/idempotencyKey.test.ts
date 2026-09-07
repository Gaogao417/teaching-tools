/**
 * F7 P2 转办 2 回归：服务端组合 idempotency_key 的 128 字符结构性上限。
 *
 * A 轨实测缺陷：deterministic outcome 组合键（sessionId:poutcome:sequence:
 * ordinal:action_id:client_request_id）在长 client_request_id（canonical 上限
 * 128）下超限 ⇒ append 边界 canonical 拒绝 ⇒ 回执 4xx。锁定：
 * - 短成员组合键逐字节不变（历史流可读性零影响）；
 * - 超限组合确定性压缩：同输入恒同键（幂等语义不变）、≤128、过 canonical
 *   形状；异输入不同键（无碰撞回归面——24 hex 摘要）。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { assertIdempotencyKeyShape, composeIdempotencyKey } from "../IdempotencyKey";

const CANONICAL = /^[A-Za-z0-9._:-]{8,128}$/;

test("short composed keys are byte-identical to the plain join (zero drift for existing streams)", () => {
  const sessionId = "TS-1770000000012345";
  const clientRequestId = "cr-ordinary-42";
  assert.equal(
    composeIdempotencyKey([sessionId, "poutcome", "PS-0007", "3", "VA-TS-1770000000012345-0007", clientRequestId]),
    `${sessionId}:poutcome:PS-0007:3:VA-TS-1770000000012345-0007:${clientRequestId}`,
  );
});

test("over-limit compositions compact deterministically within the canonical cap", () => {
  const sessionId = "TS-1770000000009999";
  const longClientRequestId = `cr-${"x".repeat(120)}`; // canonical 上限长度（≥128 总组合必超限）
  const parts = [sessionId, "poutcome", "PS-0007", "3", `VA-${sessionId}-0007-G0`, longClientRequestId];
  assert.ok(parts.join(":").length > 128, "fixture must exceed the canonical cap");
  const key = composeIdempotencyKey(parts);
  assert.ok(key.length <= 128, `compacted key must fit (len=${key.length})`);
  assert.match(key, CANONICAL);
  assert.doesNotThrow(() => assertIdempotencyKeyShape(key));
  // 确定性：同输入恒同键（幂等重投命中同一事件）。
  assert.equal(key, composeIdempotencyKey(parts));
  // 异输入不同键（摘要分辨）。
  const other = composeIdempotencyKey([...parts.slice(0, 5), `cr-${"y".repeat(120)}`]);
  assert.notEqual(key, other);
  assert.ok(other.length <= 128);
});

test("shape guard rejects keys that violate the canonical pattern", () => {
  assert.throws(() => assertIdempotencyKeyShape("short"), /canonical shape/);
  assert.throws(() => assertIdempotencyKeyShape(`k:${" ".repeat(20)}`), /canonical shape/);
});

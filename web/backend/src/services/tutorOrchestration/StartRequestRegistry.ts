/**
 * StartRequestRegistry（F7 Step 4 — start 幂等的应用层原子事务 owner）。
 *
 * spec §2.3 / 复核 P0-4：start 以 client_request_id 幂等——「同键同 payload 返回
 * 同一 session；同键异 payload → 409 REQUEST_PAYLOAD_DRIFT」。幂等登记不进
 * canonical 教学事件（session_started/v7 无 client_request_id 字段——该字段属
 * HTTP application concern）。
 *
 * StartAtomically 在**同一 SQLite 事务**内完成：
 * 1. 查幂等键（命中：hash 同 → Existing；hash 异 → PayloadDrift）；
 * 2. 调用 createSession（内部 kernel start 事务经 better-sqlite3 嵌套降级为
 *    savepoint）；
 * 3. 提交 registry 映射。
 * 「registry reserve 成功但 session 创建失败」不留悬空记录——createSession 抛
 * 错 ⇒ 外层事务整体回滚（含 registry 写入）。
 */
import { createHash } from "node:crypto";
import { db } from "../../db/database";

export type StartReservation =
  | { kind: "created"; sessionId: string }
  | { kind: "existing"; sessionId: string }
  | { kind: "payload-drift"; clientRequestId: string; committedPayloadHash: string };

class StartRequestRegistryError extends Error {
  constructor(readonly kind: "PAYLOAD_DRIFT" | "EXISTING", message: string) {
    super(message);
    this.name = "StartRequestRegistryError";
  }
}

const selectRegistry = db.prepare(
  "SELECT payload_hash, session_id FROM tutor_session_start_registry WHERE client_request_id = ?",
);
const insertRegistry = db.prepare(
  "INSERT INTO tutor_session_start_registry (client_request_id, payload_hash, session_id, created_at) VALUES (?, ?, ?, ?)",
);

/** start 请求的语义载荷指纹（幂等漂移判定面：task/student/assessment；id 族不参与）。 */
export function startPayloadHash(payload: { task_id: string; student_id: string; assessment?: boolean }): string {
  const canonical = JSON.stringify({
    task_id: payload.task_id,
    student_id: payload.student_id,
    assessment: payload.assessment === true,
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * 原子 start：查键 → createSession（事务内）→ 登记。返回 Created/Existing；
 * PayloadDrift 以返回值显式表达（调用方映射 409，不落任何事实）。
 */
export function startAtomically(args: {
  clientRequestId: string;
  payloadHash: string;
  createSession: () => string;
}): StartReservation {
  const transaction = db.transaction((): StartReservation => {
    const existing = selectRegistry.get(args.clientRequestId) as
      | { payload_hash: string; session_id: string }
      | undefined;
    if (existing) {
      if (existing.payload_hash !== args.payloadHash) {
        throw new StartRequestRegistryError(
          "PAYLOAD_DRIFT",
          `client_request_id=${args.clientRequestId} payload drifts from the committed start (committed hash ${existing.payload_hash} vs ${args.payloadHash}); explicit refusal, zero facts`,
        );
      }
      return { kind: "existing", sessionId: existing.session_id };
    }
    const sessionId = args.createSession();
    insertRegistry.run(args.clientRequestId, args.payloadHash, sessionId, new Date().toISOString());
    return { kind: "created", sessionId };
  });
  try {
    return transaction();
  } catch (error) {
    if (error instanceof StartRequestRegistryError && error.kind === "PAYLOAD_DRIFT") {
      const committed = selectRegistry.get(args.clientRequestId) as { payload_hash: string } | undefined;
      return {
        kind: "payload-drift",
        clientRequestId: args.clientRequestId,
        committedPayloadHash: committed?.payload_hash ?? "unknown",
      };
    }
    throw error;
  }
}

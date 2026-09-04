/**
 * F7 Step 4 门禁测试（node 链）：TutorSessionKernelV7 两条输入因果链 + 独立
 * reader 分派。合成 registry（不依赖真实 plan 导入）；SQLITE_PATH 经 ensureSqlite。
 *
 * 1. v7 start/resume 往返（session_started 携 session_mode；event_schema='v7'）；
 * 2. reader 分派三向：v7 行恢复 OK；v6 行 → SESSION_VERSION_UNSUPPORTED；
 *    v5 行（行级 event_schema='v5'）→ SESSION_VERSION_UNSUPPORTED（读侧）；
 * 3. 命令链 causation 门禁：student_workspace_command_recorded + 回执
 *    （causation→命令事实）合法；回执误指 student_input_recorded →
 *    COMMAND_CAUSATION_MISMATCH（复核 P1 负例，append 整批拒绝零事件）；
 *    回执缺 causation → canonical 拒绝（v7 fixture 已锁，此处 kernel 侧行为）；
 * 4. 语言/控制链 intent 门禁（v7 保留）：intent causation→input、同
 *    client_request_id（不符整批拒绝零事件）。
 */
import assert from "node:assert/strict";

import { ensureSqlite } from "./support";
import { SHA, SYNTHETIC_CATALOG_PIN, SYNTHETIC_TASK_ID, syntheticRegistry } from "./v6KernelSupport";

const sqlitePath = ensureSqlite("f7-step4-kernel-v7");

const storeModule = require("../TutorSessionEventStoreV5") as typeof import("../TutorSessionEventStoreV5");
void storeModule;
const { db } = require("../../../db/database") as typeof import("../../../db/database");
const kernelModule = require("../TutorSessionKernelV7") as typeof import("../TutorSessionKernelV7");
const workspaceReducerModule = require("../WorkspaceRuntimeReducerV7") as typeof import("../WorkspaceRuntimeReducerV7");
const eventModule = require("../TutorSessionEventV7") as typeof import("../TutorSessionEventV7");
const { TutorSessionKernelV7 } = kernelModule;
type KernelV7 = import("../TutorSessionKernelV7").TutorSessionKernelV7;
const readEvents = (sessionId: string) => workspaceReducerModule.readTutorSessionEventsV7(sessionId, registryProvider());
const { TutorSessionEventStoreV7Error, TutorSessionIntegrityV7Error, RuntimeStateReducerV7Error } = eventModule;

const at = (): string => new Date().toISOString();

function sessionStartedPayloadV7(mode: "teaching" | "assessment" = "teaching"): Record<string, unknown> {
  return {
    task_id: SYNTHETIC_TASK_ID,
    session_mode: mode,
    scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
    question_ref: { artifact_id: "QT-SMV-002", version: "v2", content_hash: SHA("qt-f7") },
    approach_set_ref: { artifact_id: "AS-SMV-002", version: "v1", content_hash: SHA("as-f7") },
    solution_graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: SHA("rg-f7") },
    protocol_refs: [{ artifact_id: "PR-SMV-002", version: "v1", content_hash: SHA("pr-f7") }],
    tutor_plan_ref: { artifact_id: "TP-SMV-002", version: "v7", content_hash: SHA("tp-f7") },
    policy_profile_snapshot: {
      profile_id: "PP-SMV-001", version: "v1", primary_provider: "deterministic-rules",
      fallback_provider: "safe-fallback", model_id: "none", prompt_version: "pv-1",
    },
    initial_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01" },
    workspace_catalog_pin: { ...SYNTHETIC_CATALOG_PIN },
  };
}

const registryProvider = (): import("../RuntimeStateRebuilderV7").V7RegistryProvider => (payload) => syntheticRegistry();

function startKernel(sessionId: string, mode: "teaching" | "assessment" = "teaching"): KernelV7 {
  return TutorSessionKernelV7.start(
    { sessionId, studentId: "student-f7v7", sessionStarted: sessionStartedPayloadV7(mode) as never, occurred_at: at() },
    registryProvider(),
  );
}

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function eventSchemaOf(sessionId: string): string | undefined {
  const row = db.prepare("SELECT event_schema FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { event_schema?: string } | undefined;
  return row?.event_schema;
}

const studentCommandFact = (clientRequestId: string) => ({
  command_id: `SC-f7v7-${clientRequestId}`,
  surface: "geometry" as const,
  capability: "similarity.mark-known-segments",
  origin: "student" as const,
  target_ids: ["seg-AB"],
  expected_workspace_revision: 0,
  client_request_id: clientRequestId,
  source: "direct" as const,
});

async function main(): Promise<void> {
  const run = (name: string, fn: () => void | Promise<void>) => {
    try {
      fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  };

  await run("v7 start/resume 往返：event_schema='v7' + session_mode 入流 + G2 parity", () => {
    const sessionId = "TS-70010101";
    const kernel = startKernel(sessionId);
    assert.equal(eventSchemaOf(sessionId), "v7");
    const resumed = TutorSessionKernelV7.resume(sessionId, registryProvider());
    assert.equal(resumed.revision, kernel.revision);
    const parity = resumed.assertReplayParity();
    assert.equal(parity.equal, true);
    const started = readEvents(sessionId)[0].payload as { session_mode?: string };
    assert.equal(started.session_mode, "teaching");
  });

  await run("assessment session_mode 入流且可恢复", () => {
    const sessionId = "TS-70010102";
    startKernel(sessionId, "assessment");
    const resumed = TutorSessionKernelV7.resume(sessionId, registryProvider());
    assert.equal((readEvents(sessionId)[0].payload as { session_mode?: string }).session_mode, "assessment");
  });

  await run("reader 分派：v5 行 → SESSION_VERSION_UNSUPPORTED（读侧；v5 继续旧 API 到 F8）", () => {
    const sessionId = "TS-70010109";
    db.prepare(
      "INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, started_at, event_schema) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(sessionId, "s", "TP-X", "v1", "sha256:aaaa", at(), "v5");
    assert.throws(
      () => TutorSessionKernelV7.resume(sessionId, registryProvider()),
      (error: unknown) => error instanceof TutorSessionIntegrityV7Error && error.code === "SESSION_VERSION_UNSUPPORTED",
    );
  });

  await run("reader 分派：v6 行 → SESSION_VERSION_UNSUPPORTED（store 边界）", () => {
    const sessionId = "TS-70010103";
    db.prepare(
      "INSERT INTO tutor_sessions (session_id, student_id, plan_artifact_id, plan_version, plan_content_hash, started_at, event_schema) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(sessionId, "s", "TP-X", "v1", "sha256:aaaa", at(), "v6");
    assert.throws(
      () => TutorSessionKernelV7.resume(sessionId, registryProvider()),
      (error: unknown) => error instanceof TutorSessionIntegrityV7Error && error.code === "SESSION_VERSION_UNSUPPORTED",
    );
  });

  await run("命令链：事实 + 回执（causation→命令事实）合法落库", () => {
    const sessionId = "TS-70010104";
    const kernel = startKernel(sessionId);
    const appended = kernel.append(kernel.revision, [
      { event_type: "student_workspace_command_recorded", payload: studentCommandFact("cc-f7v7-0001"), occurred_at: at(), idempotency_key: "sc-f7v7-77001" },
    ]);
    const commandSequence = appended.appendedSequences[0];
    kernel.append(kernel.revision, [
      {
        event_type: "action_outcome_recorded",
        payload: { action_id: "SC-f7v7-cc-f7v7-0001", action_kind: "student_command", outcome: "completed", resulting_revision: 0 },
        occurred_at: at(),
        causation_sequence: commandSequence,
        idempotency_key: "sc-outcome-f7v7-77001",
      },
    ]);
    assert.equal(countEvents(sessionId), 3);
  });

  await run("命令链负例：回执 causation 误指 student_input_recorded → COMMAND_CAUSATION_MISMATCH 零事件", () => {
    const sessionId = "TS-70010105";
    const kernel = startKernel(sessionId);
    const input = kernel.append(kernel.revision, [
      { event_type: "student_input_recorded", payload: { input: { kind: "control", command: "confirm" }, client_request_id: "cri-f7v7-x" }, occurred_at: at(), idempotency_key: "si-f7v7-77001" },
    ]);
    const command = kernel.append(kernel.revision, [
      { event_type: "student_workspace_command_recorded", payload: studentCommandFact("cc-f7v7-0002"), occurred_at: at(), idempotency_key: "sc-f7v7-77002" },
    ]);
    const before = countEvents(sessionId);
    assert.throws(
      () =>
        kernel.append(kernel.revision, [
          {
            event_type: "action_outcome_recorded",
            payload: { action_id: "SC-f7v7-cc-f7v7-0002", action_kind: "student_command", outcome: "completed", resulting_revision: 0 },
            occurred_at: at(),
            causation_sequence: input.appendedSequences[0],
            idempotency_key: "sc-outcome-f7v7-77002",
          },
        ]),
      (error: unknown) => error instanceof RuntimeStateReducerV7Error && error.code === "COMMAND_CAUSATION_MISMATCH",
    );
    assert.equal(countEvents(sessionId), before);
    void command;
  });

  await run("命令链负例：回执缺 causation → canonical 拒绝零事件", () => {
    const sessionId = "TS-70010106";
    const kernel = startKernel(sessionId);
    kernel.append(kernel.revision, [
      { event_type: "student_workspace_command_recorded", payload: studentCommandFact("cc-f7v7-0003"), occurred_at: at(), idempotency_key: "sc-f7v7-77003" },
    ]);
    const before = countEvents(sessionId);
    assert.throws(
      () =>
        kernel.append(kernel.revision, [
          {
            event_type: "action_outcome_recorded",
            payload: { action_id: "SC-f7v7-cc-f7v7-0003", action_kind: "student_command", outcome: "completed", resulting_revision: 0 },
            occurred_at: at(),
            idempotency_key: "sc-outcome-f7v7-77003",
          },
        ]),
      (error: unknown) => error instanceof TutorSessionEventStoreV7Error && error.code === "VALIDATION_FAILED",
    );
    assert.equal(countEvents(sessionId), before);
  });

  await run("语言/控制链：intent causation→input + 同 client_request_id（不符整批拒绝）", () => {
    const sessionId = "TS-70010107";
    const kernel = startKernel(sessionId);
    const input = kernel.append(kernel.revision, [
      { event_type: "student_input_recorded", payload: { input: { kind: "control", command: "confirm" }, client_request_id: "cri-f7v7-ok" }, occurred_at: at(), idempotency_key: "si-f7v7-77002" },
    ]);
    kernel.append(kernel.revision, [
      { event_type: "student_intent_recorded", payload: { intent_kind: "confirm", client_request_id: "cri-f7v7-ok" }, occurred_at: at(), causation_sequence: input.appendedSequences[0], idempotency_key: "st-f7v7-77001" },
    ]);
    const other = kernel.append(kernel.revision, [
      { event_type: "student_input_recorded", payload: { input: { kind: "control", command: "continue" }, client_request_id: "cri-f7v7-other" }, occurred_at: at(), idempotency_key: "si-f7v7-77003" },
    ]);
    const before = countEvents(sessionId);
    assert.throws(
      () =>
        kernel.append(kernel.revision, [
          { event_type: "student_intent_recorded", payload: { intent_kind: "continue", client_request_id: "cri-f7v7-MISMATCH" }, occurred_at: at(), causation_sequence: other.appendedSequences[0], idempotency_key: "st-f7v7-77002" },
        ]),
      (error: unknown) => error instanceof RuntimeStateReducerV7Error && error.code === "INTENT_CAUSATION_MISMATCH",
    );
    assert.equal(countEvents(sessionId), before);
  });

  await run("session_started 缺 session_mode → canonical 拒绝（v7 必填）", () => {
    const payload = sessionStartedPayloadV7();
    delete payload.session_mode;
    assert.throws(
      () =>
        TutorSessionKernelV7.start(
          { sessionId: "TS-70010108", studentId: "s", sessionStarted: payload as never, occurred_at: at() },
          registryProvider(),
        ),
      (error: unknown) => error instanceof TutorSessionEventStoreV7Error && error.code === "VALIDATION_FAILED",
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE session_id = ?").get("TS-70010108") as { n: number }).n,
      0,
    );
  });

  console.log(`sqlite: ${sqlitePath}`);
}

void main().catch((error) => {
  console.error("FAIL tutorSessionKernelV7", error);
  throw error;
});

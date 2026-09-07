/**
 * GenerationSnapshotProjection 测试（F7 RT4 — S1 冻结字段投影 + A 轨消费正反例）。
 *
 * 覆盖：state/v4 → 冻结字段全状态投影（idle/pending running/waiting_retry/
 * failed 各类）；shared fixtures 正反例逐条过 shared schema（与 A decoder 同一
 * 真源）；隐私边界（epoch/reservation_revision/input_digest/presenter_pin
 * 不出现在投影）；slot 与 record 不一致 = corrupt state fail closed。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import assert from "node:assert/strict";
import test from "node:test";

import { adaptivePresentationSnapshotFieldsSchema } from "../../../../../shared/tutorHttpProfile";
import type { TutorRuntimeStateV9 } from "../../tutorSession/TutorRuntimeStateReducerV9";
import { projectGenerationSnapshotFields } from "../presentationGeneration/GenerationSnapshotProjection";

const PRESENTER_PIN = {
  provider: "deepseek-api",
  model_id: "deepseek-v4-flash",
  prompt_version: "presenter-interleaved/v1",
  context_builder_version: "presentation-context-builder/v1",
  tool_catalog_version: "presentation-tool-catalog/v1",
};

function stateWith(
  slot: TutorRuntimeStateV9["generation_slot"],
  requests: TutorRuntimeStateV9["generation_requests"],
): TutorRuntimeStateV9 {
  return {
    schema: "ai_teaching_tutor_runtime_state/v4",
    session_id: "TS-0042",
    state_revision: 20,
    pinned_plan: {
      tutor_plan_ref: { artifact_id: "TP-SMV-009", version: "v11", content_hash: `sha256:${"a".repeat(64)}` },
      solution_graph_ref: { artifact_id: "RG-SMV-001", version: "v8", content_hash: `sha256:${"b".repeat(64)}` },
      protocol_refs: [{ artifact_id: "PR-SMV-001", version: "v10", content_hash: `sha256:${"c".repeat(64)}` }],
      presenter_generation_pin: PRESENTER_PIN,
    },
    teaching_cursor: { protocol_id: "PR-SMV-001", beat_id: "BT-04", phase: "presenting" },
    inquiry_cursor: null,
    workspace_revision: 3,
    completed: false,
    presentation_cursor: { status: "idle" },
    generation_slot: slot,
    generation_requests: requests,
  } as TutorRuntimeStateV9;
}

function requestRecord(overrides: Partial<TutorRuntimeStateV9["generation_requests"][number]> = {}): TutorRuntimeStateV9["generation_requests"][number] {
  return {
    request_id: "GR-TS0042-0001",
    source_request_id: "src-TS0042-turn-1",
    decision_id: "TD-TS0042-0001",
    scope: { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-04" },
    reservation_revision: 5,
    epoch: 1,
    attempt: 1,
    max_attempts: 3,
    retry_policy_version: "retry-policy/v1-default",
    timeout_ms: 30_000,
    retry_delays_ms: [1_000, 3_000],
    context: {
      plan_ref: { artifact_id: "TP-SMV-009", version: "v11", content_hash: `sha256:${"a".repeat(64)}` },
      graph_ref: { artifact_id: "RG-SMV-001", version: "v8", content_hash: `sha256:${"b".repeat(64)}` },
      selected_fact_ids: ["FN-14"],
      selected_inference_ids: ["IF-12"],
      resource_ids: ["RES3"],
      event_cutoff: 5,
      workspace_revision: 3,
    },
    input_digest: `sha256:${"d".repeat(64)}`,
    presenter_pin: PRESENTER_PIN,
    status: "pending",
    phase: "running",
    ...overrides,
  } as TutorRuntimeStateV9["generation_requests"][number];
}

test("projects all generation states to the frozen S1 field shape", () => {
  // idle。
  assert.deepEqual(projectGenerationSnapshotFields(stateWith({ status: "idle" }, [])), {
    generation: { status: "idle" },
    scope: null,
  });
  // pending/running。
  const running = projectGenerationSnapshotFields(
    stateWith({ status: "pending", request_id: "GR-TS0042-0001" }, [requestRecord()]),
  );
  assert.deepEqual(running.generation, {
    status: "pending", request_id: "GR-TS0042-0001", phase: "running", attempt: 1, max_attempts: 3,
  });
  // pending/waiting_retry（retry_at 必下发）。
  const waiting = projectGenerationSnapshotFields(
    stateWith({ status: "pending", request_id: "GR-TS0042-0001" }, [
      requestRecord({ phase: "waiting_retry", retry_at: "2026-09-07T12:00:01.000Z" }),
    ]),
  );
  assert.equal(waiting.generation.status, "pending");
  assert.equal((waiting.generation as { retry_at?: string }).retry_at, "2026-09-07T12:00:01.000Z");
  // failed/RETRY_EXHAUSTED。
  const failed = projectGenerationSnapshotFields(
    stateWith({ status: "failed", request_id: "GR-TS0042-0001" }, [
      requestRecord({ status: "failed", attempt: 3, epoch: 3, error_class: "RETRY_EXHAUSTED" }),
    ]),
  );
  assert.deepEqual(failed.generation, {
    status: "failed", request_id: "GR-TS0042-0001", attempt: 3, max_attempts: 3, error_class: "RETRY_EXHAUSTED",
  });
  assert.deepEqual(failed.scope, { kind: "approved", protocol_id: "PR-SMV-001", beat_id: "BT-04" });
});

test("projection never leaks internal identity fields (privacy boundary)", () => {
  const projected = projectGenerationSnapshotFields(
    stateWith({ status: "pending", request_id: "GR-TS0042-0001" }, [requestRecord()]),
  );
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["epoch", "reservation_revision", "input_digest", "presenter_pin", "retry_policy_version", "timeout_ms"]) {
    assert.ok(!serialized.includes(forbidden), `projection must not carry ${forbidden}`);
  }
});

test("corrupt slot/record pairing fails closed", () => {
  assert.throws(
    () => projectGenerationSnapshotFields(stateWith({ status: "pending", request_id: "GR-TS0042-9999" }, [requestRecord()])),
    /no matching request record/,
  );
  assert.throws(
    () => projectGenerationSnapshotFields(
      stateWith({ status: "pending", request_id: "GR-TS0042-0001" }, [requestRecord({ status: "cancelled", cancel_reason: "cancelled" })]),
    ),
    /does not match a pending record/,
  );
});

test("shared fixture cases pass/fail the frozen schema exactly (A consumes the same file)", () => {
  const fixturePath = resolve(__dirname, "../../../../../../../shared/fixtures/generation-snapshot-projection-cases.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    positive: Array<{ case: string; fields: unknown }>;
    negative: Array<{ case: string; fields: unknown }>;
  };
  assert.ok(fixture.positive.length >= 5);
  for (const entry of fixture.positive) {
    const parsed = adaptivePresentationSnapshotFieldsSchema.safeParse(entry.fields);
    assert.ok(parsed.success, `positive case ${entry.case} must pass: ${parsed.success ? "" : parsed.error.issues.map((i) => i.message).join(";")}`);
  }
  assert.ok(fixture.negative.length >= 6);
  for (const entry of fixture.negative) {
    const parsed = adaptivePresentationSnapshotFieldsSchema.safeParse(entry.fields);
    assert.ok(!parsed.success, `negative case ${entry.case} must fail the frozen schema`);
  }
});

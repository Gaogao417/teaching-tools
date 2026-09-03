/**
 * F7 Step 2 返工组合接缝门禁（审核修复项 3）：真实 TutorTaskBindingResolver
 * + TutorSessionKernelV6 + SQLite 同链路。
 *
 * 之前 Resolver 测试与 Kernel 测试分离——一个用真实 resolver 但不进数据库，
 * 一个进数据库但用 synthetic provider；真正会出问题的组合接缝没有测试：
 * - start：真实 binding refs（buildSessionStartedPayload + 真实 catalog pin）
 *   经 resolver.v6RegistryProvider 装配的 V6 kernel 启动，事件流可用真 registry
 *   裁决（targets 取自真实 target 宇宙）；
 * - restore：同一 provider 纯重建同一 pending cursor；
 * - start 漂移（TP version 篡改）→ fail closed 且零会话行/零事件；
 * - committed 流漂移（直改 session_started.payload_json 的 scenario_id——绕过
 *   rebuilder 的行 pin 对账腿，命中 provider 的完整 binding 对账腿）→
 *   restore 与 append 两边界均 PIN_MISMATCH，零事件落库。
 */
import { describe, expect, it } from "vitest";

import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../tutorNavigator/__tests__/navigatorSupport";
import { buildSessionStartedPayload } from "../../tutorNavigator/NavigatorPlanV5";
import { TutorTaskBindingResolver } from "../../tutorOrchestration/TutorTaskBindingResolver";
import { workspaceCatalogPin } from "../WorkspacePresentationCatalogV5";
import { TutorSessionKernelV6 } from "../TutorSessionKernelV6";
import { makeV6SessionCodec } from "../RuntimeStateRebuilderV6";
import { appendSessionEvents } from "../kernel/TutorSessionStoreCore";
import type { V5SessionStartedPayload } from "../TutorSessionEventV5";

const GOLDEN_TASK_ID = "goldenMinhangFold2020";
const resolver = new TutorTaskBindingResolver(realCanonicalRoot());

function countEvents(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_session_events WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

function sessionRows(sessionId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { n: number }).n;
}

/** 真实 binding refs + 真实 catalog pin 的 session_started payload。 */
function goldenStartedPayload(sessionId: string): V5SessionStartedPayload {
  const binding = resolver.resolveForStart(GOLDEN_TASK_ID);
  return {
    ...buildSessionStartedPayload(binding.plan, { sessionId, taskId: GOLDEN_TASK_ID, scenarioId: binding.scenarioId }),
    workspace_catalog_pin: { ...workspaceCatalogPin(binding.golden.catalog) },
  };
}

/** 真 registry 下的最小旅程前缀：input → intent/decision → planned → ordinal0 v/a/d。 */
function appendGoldenJourneyPrefix(kernel: import("../TutorSessionKernelV6").TutorSessionKernelV6, sessionId: string, segmentId: string): void {
  const at = (): string => new Date().toISOString();
  const ev = (event_type: import("../TutorSessionEventV6").V6EventType, payload: unknown, causation_sequence?: number): import("../TutorSessionEventV6").PendingV6Event => ({
    event_type,
    payload,
    occurred_at: at(),
    ...(causation_sequence !== undefined ? { causation_sequence } : {}),
  });
  const decisionId = `TD-seam-${sessionId.slice(-4)}1`;
  const planned = {
    sequence_id: "PS-9001",
    decision_id: decisionId,
    protocol_id: resolver.resolveForStart(GOLDEN_TASK_ID).plan.mainline.protocol_id,
    beat_id: "BT-01",
    actions: [
      {
        ordinal: 0,
        kind: "workspace",
        workspace_action: {
          action_id: `WSA-seam-${sessionId.slice(-4)}0`,
          decision_id: decisionId,
          surface: "geometry",
          capability: "geometry.construct",
          origin: "tutor",
          target_ids: [segmentId],
          command_payload: JSON.stringify({ type: "construct-carrier", outputLineId: "line-XY" }),
          reveal_scope: "none",
        },
      },
    ],
  };
  kernel.append(1, [ev("student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "嗯" }, client_request_id: "cr-seam-0001" })]);
  kernel.append(2, [
    ev("semantic_interpretation_recorded", { intent: "ack", reasoning_location: "aligned", confidence: 0.9, interpreter_version: "i/v1" }, 2),
    ev("student_intent_recorded", { intent_kind: "confirm", client_request_id: "cr-seam-0001" }, 2),
    {
      ...ev("policy_decision_made", {
        decision_id: decisionId,
        decision_kind: "execute_beat",
        protocol_id: planned.protocol_id,
        beat_id: "BT-01",
        policy_version: "navigator/v1",
        source_event_sequence: 2,
        source_state_revision: 2,
      }, 4),
    },
  ]);
  kernel.append(3, [ev("presentation_sequence_planned", planned, 5)]);
  kernel.append(4, [
    ev("presentation_action_validated", { sequence_id: "PS-9001", ordinal: 0, action_id: `WSA-seam-${sessionId.slice(-4)}0`, kind: "workspace" }, 6),
    ev("presentation_action_applied", { sequence_id: "PS-9001", ordinal: 0, action_id: `WSA-seam-${sessionId.slice(-4)}0`, kind: "workspace", resulting_workspace_revision: 1 }, 6),
    ev("presentation_action_delivered", { sequence_id: "PS-9001", ordinal: 0, action_id: `WSA-seam-${sessionId.slice(-4)}0`, kind: "workspace" }, 6),
  ]);
}

describe("F7 Step 2 组合接缝：TutorTaskBindingResolver + TutorSessionKernelV6 + SQLite", () => {
  it("真实 binding/pin 全链：start→旅程→restore 同 pending cursor，真 registry 裁决通过", () => {
    const sessionId = "TS-9801";
    const kernel = TutorSessionKernelV6.start(
      { sessionId, studentId: "seam-student", sessionStarted: goldenStartedPayload(sessionId), occurred_at: new Date().toISOString() },
      resolver.v6RegistryProvider,
    );
    const registry = resolver.resolveForStart(GOLDEN_TASK_ID).registry;
    const segmentId = [...registry.targetUniverse].find((id) => id.startsWith("segment-"))!;
    appendGoldenJourneyPrefix(kernel, sessionId, segmentId);

    expect(
      (db.prepare("SELECT event_schema FROM tutor_sessions WHERE session_id = ?").get(sessionId) as { event_schema: string }).event_schema,
    ).toBe("v6");
    expect(kernel.state.presentation_cursor).toEqual({
      status: "awaiting_browser",
      sequence_id: "PS-9001",
      ordinal: 0,
      action_id: `WSA-seam-98010`,
    });
    expect(kernel.state.workspace_revision).toBe(1);
    expect(kernel.assertReplayParity().equal).toBe(true);

    // restore：同一 provider 纯重建，同一 pending snapshot。
    const resumed = TutorSessionKernelV6.resume(sessionId, resolver.v6RegistryProvider);
    expect(resumed.state.presentation_cursor).toEqual(kernel.state.presentation_cursor);
    expect(resumed.revision).toBe(kernel.revision);
    expect(countEvents(sessionId)).toBe(9);
  });

  it("start 漂移（TP version 篡改）：PIN_MISMATCH fail closed，零会话行/零事件", () => {
    const sessionId = "TS-9802";
    const payload = goldenStartedPayload(sessionId);
    const tampered: V5SessionStartedPayload = {
      ...payload,
      tutor_plan_ref: { ...payload.tutor_plan_ref, version: "v-tampered" },
    };
    expect(() =>
      TutorSessionKernelV6.start(
        { sessionId, studentId: "seam-student", sessionStarted: tampered, occurred_at: new Date().toISOString() },
        resolver.v6RegistryProvider,
      ),
    ).toThrowError(/PIN_MISMATCH|tutor_plan_ref/);
    expect(sessionRows(sessionId)).toBe(0);
    expect(countEvents(sessionId)).toBe(0);
  });

  it("committed 流漂移（scenario 篡改）：restore 与 append 两边界 PIN_MISMATCH，零事件落库", () => {
    const sessionId = "TS-9803";
    const kernel = TutorSessionKernelV6.start(
      { sessionId, studentId: "seam-student", sessionStarted: goldenStartedPayload(sessionId), occurred_at: new Date().toISOString() },
      resolver.v6RegistryProvider,
    );
    const registry = resolver.resolveForStart(GOLDEN_TASK_ID).registry;
    const segmentId = [...registry.targetUniverse].find((id) => id.startsWith("segment-"))!;
    appendGoldenJourneyPrefix(kernel, sessionId, segmentId);
    const eventsBefore = countEvents(sessionId);

    // 直改 session_started.payload_json 的 scenario_id（模拟 artifact/绑定漂移；
    // 不触发 rebuilder 的行 pin 腿——命中 provider 的完整 binding 对账腿）。
    const row = db.prepare("SELECT payload_json FROM tutor_session_events WHERE session_id = ? AND sequence = 1").get(sessionId) as { payload_json: string };
    const tamperedPayload = JSON.parse(row.payload_json) as Record<string, unknown>;
    tamperedPayload.scenario_id = "golden-similarity-mvp-001:QT-SMV-999";
    db.prepare("UPDATE tutor_session_events SET payload_json = ? WHERE session_id = ? AND sequence = 1").run(
      JSON.stringify(tamperedPayload),
      sessionId,
    );

    // restore 边界：verified rebuild 折叠前 provider fail closed。
    expect(() => TutorSessionKernelV6.resume(sessionId, resolver.v6RegistryProvider)).toThrowError(/PIN_MISMATCH|scenario_id/);
    // append 边界：事务内重解析 provider，整批拒绝。
    expect(() =>
      appendSessionEvents(makeV6SessionCodec(resolver.v6RegistryProvider), sessionId, kernel.revision, [
        {
          event_type: "student_input_recorded",
          payload: { input: { kind: "control", command: "confirm" }, client_request_id: "cr-seam-x001" },
          occurred_at: new Date().toISOString(),
        },
      ]),
    ).toThrowError(/PIN_MISMATCH|scenario_id/);
    // drifted stream accepts zero new events at both boundaries
    expect(countEvents(sessionId)).toBe(eventsBefore);
  });
});

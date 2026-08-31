/**
 * F3 workspace kernel vitest 套件（G3 辅助证据）：registry/catalog/projector/
 * fold 的单元面 + WorkspaceSessionRuntimeV5 的补充集成面（node 链门禁测试之外）。
 *
 * - SQLITE_PATH 由 vitest.setup.ts 前置（模块图加载前）；
 * - 会话 id 使用独立 TS-97xx 段，避免与其他 vitest 文件共享 db 时的碰撞；
 * - canonical 增补 fixtures（student_intent_recorded 内嵌 workspace_command）
 *   在此消费：positive 经 canonical Zod 通过、negative 被拒；
 * - R2（2026-08-31 修复波次）单元面：legacy 适配路径删除后的 fail-closed、
 *   catalog digest canonical 口径、gate 账本五级绑定授权、mode 约束。
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

import { validatePayload } from "../../../../../shared/canonical";
import {
  checkDomainCommandIdDiscipline,
  checkBoardRevealBoundary,
  elementKindFromId,
  listWorkspaceCapabilities,
  resolveWorkspaceCapability,
  shortElementName,
} from "../WorkspaceCapabilityRegistryV5";
import {
  buildWorkspacePresentationCatalog,
  computeWorkspaceCatalogDigest,
  workspaceCatalogPin,
  WorkspaceCatalogError,
} from "../WorkspacePresentationCatalogV5";
import {
  authorizeBoardRevealBinding,
  emptyWorkspaceGateLedger,
  foldWorkspaceV5Events,
  initialWorkspaceFold,
  seedWorkspaceGateLedger,
} from "../WorkspaceRuntimeReducerV5";
import {
  compareWorkspaceStatesSemantically,
  SEMANTICALLY_IGNORED_WORKSPACE_STATE_FIELDS,
} from "../WorkspaceStateRebuilderV5";
import {
  deriveMainlineParticipation,
  projectStudentWorkspaceViewV5,
} from "../WorkspaceViewProjectorV5";
import { WorkspaceSessionRuntimeV5 } from "../WorkspaceSessionRuntimeV5";
import { TutorSessionKernelV5 } from "../TutorSessionKernelV5";
import { readTutorSessionEventsV5 } from "../TutorSessionEventStoreV5";
import * as catalogModule from "../WorkspacePresentationCatalogV5";
import {
  at,
  constructParallelJson,
  sc,
  setSegmentLabelJson,
  wsStartInput,
  wsTestCatalog,
  wsa,
  assertNoWorkspaceTruthLeak,
} from "./workspaceKernelV5Support";

const fixtureDir = path.resolve(__dirname, "../../../../../shared/canonical/fixtures");
const readFixture = (name: string): unknown => JSON.parse(readFileSync(path.join(fixtureDir, name), "utf8"));

function appendIntentFact(runtime: WorkspaceSessionRuntimeV5, requestId: string): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "student_intent_recorded",
      payload: { intent_kind: "submit_answer", text: "看条件", client_request_id: requestId },
      occurred_at: at(),
    },
  ]);
  return result.appendedSequences[0];
}

function appendDecision(runtime: WorkspaceSessionRuntimeV5, decisionId: string, causationSequence: number): number {
  const result = runtime.kernel.append(runtime.kernel.revision, [
    {
      event_type: "policy_decision_made",
      payload: {
        decision_id: decisionId,
        decision_kind: "execute_beat",
        protocol_id: "PR-SMV-002",
        beat_id: "BT-01",
        policy_version: "presenter/v1",
        source_event_sequence: causationSequence,
        source_state_revision: runtime.kernel.revision,
      },
      occurred_at: at(),
      causation_sequence: causationSequence,
    },
  ]);
  return result.appendedSequences[0];
}

describe("F3 capability registry", () => {
  it("resolves registered capabilities and fails closed on unknown/origin/surface mismatch", () => {
    expect(resolveWorkspaceCapability("board.reveal-entry", "solution_board", "tutor")?.effect).toBe("board_reveal_tutor");
    expect(resolveWorkspaceCapability("board.reveal-entry", "solution_board", "student")).toBeUndefined();
    expect(resolveWorkspaceCapability("board.reveal-entry", "geometry", "tutor")).toBeUndefined();
    expect(resolveWorkspaceCapability("geometry.summon-answer", "geometry", "tutor")).toBeUndefined();
    expect(resolveWorkspaceCapability("similarity.mark-known-segments", "geometry", "student")?.effect).toBe("geometry_mark_known_student");
    expect(listWorkspaceCapabilities().length).toBeGreaterThanOrEqual(11);
  });

  it("enforces output id prefix discipline on domain commands", () => {
    const bad = [{ commandId: "c1", actionId: "a1", type: "intersect-lines", firstLineId: "l1", secondLineId: "l2", outputPointId: "wrong-prefix" }] as never;
    expect(checkDomainCommandIdDiscipline(bad)).toHaveLength(1);
    const good = [{ commandId: "c1", actionId: "a1", type: "intersect-lines", firstLineId: "l1", secondLineId: "l2", outputPointId: "pt-X" }] as never;
    expect(checkDomainCommandIdDiscipline(good)).toHaveLength(0);
  });

  it("derives view kinds by prefix and strips short names (incl. canonical segment- style)", () => {
    expect(elementKindFromId("seg-AD")).toBe("segment");
    expect(elementKindFromId("pt-A")).toBe("point");
    expect(elementKindFromId("line-DE")).toBe("line");
    expect(elementKindFromId("label-AD")).toBe("label");
    expect(elementKindFromId("A", { A: "point" })).toBe("point");
    expect(shortElementName("segment-AD")).toBe("AD");
    expect(shortElementName("seg-AD")).toBe("AD");
  });

  it("checkBoardRevealBoundary rejects none-scope, final-without-gate, and intermediate-with-highlight", () => {
    expect(checkBoardRevealBoundary({ revealScope: "none", requirement: "intermediate", gateSatisfied: false }).allowed).toBe(false);
    expect(checkBoardRevealBoundary({ revealScope: "final_result", requirement: "final", gateSatisfied: false }).allowed).toBe(false);
    expect(checkBoardRevealBoundary({ revealScope: "target_highlight", requirement: "intermediate", gateSatisfied: true }).allowed).toBe(false);
    expect(checkBoardRevealBoundary({ revealScope: "final_result", requirement: "final", gateSatisfied: true }).allowed).toBe(true);
    expect(checkBoardRevealBoundary({ revealScope: "step_narration", requirement: "intermediate", gateSatisfied: false }).allowed).toBe(true);
  });
});

describe("F3 presentation catalog", () => {
  it("fails closed on invalid catalog input (duplicate ids / bad patterns / empty content)", () => {
    expect(() =>
      buildWorkspacePresentationCatalog({
        schemaVersion: 1,
        taskId: "t",
        boardEntries: [
          { entryId: "BE-01", kind: "statement", content: "a", presentationGroup: "PG-01", revealRequirement: "intermediate" },
          { entryId: "BE-01", kind: "derivation", content: "b", presentationGroup: "PG-01", revealRequirement: "intermediate" },
        ],
        canonicalPathEntryIds: ["BE-99"],
      }),
    ).toThrow(WorkspaceCatalogError);
    expect(() =>
      buildWorkspacePresentationCatalog({ schemaVersion: 1, taskId: "t", boardEntries: [], canonicalPathEntryIds: [] }),
    ).toThrow(WorkspaceCatalogError);
  });

  it("R2: legacy adaptation path is deleted; inputs lacking reveal semantics fail closed (no revealable catalog)", () => {
    // 未登记 adapter 不存在（删除即隔离——行序反推违反 adapter 纪律）。
    expect((catalogModule as Record<string, unknown>).adaptLegacyWorkspaceIntoCatalogV5).toBeUndefined();
    // legacy 板书行（无 kind/revealRequirement/revealGate）→ fail closed。
    expect(() =>
      buildWorkspacePresentationCatalog({
        schemaVersion: 1,
        taskId: "legacy-task",
        boardEntries: [
          { entryId: "BE-01", content: "a=b", presentationGroup: "PG-01" },
        ],
        canonicalPathEntryIds: [],
      }),
    ).toThrow(WorkspaceCatalogError);
    // final 缺 gate 绑定 → fail closed；intermediate 带 gate 绑定 → fail closed。
    expect(() =>
      buildWorkspacePresentationCatalog({
        schemaVersion: 1,
        taskId: "t",
        boardEntries: [
          { entryId: "BE-01", kind: "conclusion", content: "DE = 2", presentationGroup: "PG-01", revealRequirement: "final" },
        ],
        canonicalPathEntryIds: ["BE-01"],
      }),
    ).toThrowError(/revealGate/);
    expect(() =>
      buildWorkspacePresentationCatalog({
        schemaVersion: 1,
        taskId: "t",
        boardEntries: [
          {
            entryId: "BE-01",
            kind: "statement",
            content: "a",
            presentationGroup: "PG-01",
            revealRequirement: "intermediate",
            revealGate: { gateId: "GT-01", beatId: "BT-01", protocolId: "PR-SMV-002" },
          },
        ],
        canonicalPathEntryIds: ["BE-01"],
      }),
    ).toThrowError(/revealGate/);
    // 显式 authored 语义（人工声明）是唯一合法产路。
    expect(
      buildWorkspacePresentationCatalog({
        schemaVersion: 1,
        taskId: "t",
        boardEntries: [
          {
            entryId: "BE-01",
            kind: "conclusion",
            content: "DE = 2",
            presentationGroup: "PG-01",
            revealRequirement: "final",
            revealGate: { gateId: "GT-01", beatId: "BT-01", protocolId: "PR-SMV-002" },
          },
        ],
        canonicalPathEntryIds: ["BE-01"],
      }).boardEntries,
    ).toHaveLength(1);
  });

  it("R2: catalog digest follows the frozen canonical serialization (key-order independent, arrays order-sensitive)", () => {
    const catalog = wsTestCatalog();
    const digest = computeWorkspaceCatalogDigest(catalog);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    // pin 与 digest 同源。
    expect(workspaceCatalogPin(catalog)).toEqual({
      catalog_schema_version: 1,
      content_hash: digest,
      entry_count: 5,
    });
    // 递归键排序：同内容、对象键插入序完全打乱 → 同 digest。
    const manualShuffled: Parameters<typeof computeWorkspaceCatalogDigest>[0] = {
      initialInteractionMode: "construction",
      canonicalPathEntryIds: catalog.canonicalPathEntryIds,
      authoredElementKinds: {
        E: "point",
        D: "point",
        C: "point",
        B: "point",
        A: "point",
        "segment-DE": "segment",
        "segment-BC": "segment",
        "segment-AD": "segment",
      },
      boardEntries: catalog.boardEntries.map((entry) => ({
        revealRequirement: entry.revealRequirement,
        presentationGroup: entry.presentationGroup,
        content: entry.content,
        kind: entry.kind,
        entryId: entry.entryId,
        ...(entry.revealGate
          ? { revealGate: { protocolId: entry.revealGate.protocolId, beatId: entry.revealGate.beatId, gateId: entry.revealGate.gateId } }
          : {}),
      })),
      taskId: catalog.taskId,
      ...(catalog.baseGeometry
        ? {
            baseGeometry: {
              segments: catalog.baseGeometry.segments,
              points: catalog.baseGeometry.points,
              viewBox: catalog.baseGeometry.viewBox,
            },
          }
        : {}),
      schemaVersion: 1,
    };
    expect(computeWorkspaceCatalogDigest(manualShuffled)).toBe(digest);
    // boardEntries 保序参与：条目数组反转是内容变化 → digest 必须不同。
    const reversed = { ...manualShuffled, boardEntries: [...manualShuffled.boardEntries].reverse() };
    expect(computeWorkspaceCatalogDigest(reversed)).not.toBe(digest);
    // Board 文本变化（无版本位/revision 不变）→ digest 变化（篡改检出依据）。
    const tampered: Parameters<typeof computeWorkspaceCatalogDigest>[0] = {
      ...manualShuffled,
      boardEntries: manualShuffled.boardEntries.map((entry) =>
        entry.entryId === "BE-03" ? { ...entry, content: "被改文本" } : entry,
      ),
    };
    expect(computeWorkspaceCatalogDigest(tampered)).not.toBe(digest);
  });
});

describe("F3 gate ledger and reveal authorization (R2 five-level binding)", () => {
  const sessionStarted = {
    task_id: "goldenMinhangCross2020",
    protocol_refs: [{ artifact_id: "PR-SMV-002" }],
    initial_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01" },
  };

  it("empty ledger authorizes nothing; seeded ledger tracks cursor/protocol pin", () => {
    const catalog = wsTestCatalog();
    const empty = authorizeBoardRevealBinding({
      catalog,
      ledger: emptyWorkspaceGateLedger(),
      entryId: "BE-04",
    });
    expect(empty.allowed).toBe(false);
    // 链序 Plan → Protocol → Beat → Gate：空账本无 protocol pin，先在 Protocol 腿拒绝。
    expect(empty.reason).toContain("Protocol 未 pin");
    const ledger = seedWorkspaceGateLedger(sessionStarted);
    expect(ledger.cursor).toEqual({ protocolId: "PR-SMV-002", beatId: "BT-01" });
    expect(ledger.pinnedProtocols).toEqual(["PR-SMV-002"]);
  });

  it("authorizeBoardRevealBinding enforces plan/protocol/beat/gate/resource legs", () => {
    const catalog = wsTestCatalog();
    const base = seedWorkspaceGateLedger(sessionStarted);
    const withGate = {
      ...base,
      evaluations: new Map([["GT-01@BT-01", { gateId: "GT-01", beatId: "BT-01", satisfied: true, sequence: 3 }]]),
    };
    // 五级全链满足 → allowed（BE-04 绑定 GT-01@BT-01/PR-SMV-002）。
    expect(authorizeBoardRevealBinding({ catalog, ledger: withGate, entryId: "BE-04" }).allowed).toBe(true);
    // resource：同 ledger 下 BE-05（绑定 GT-02 未满足）→ 拒。
    const wrongResource = authorizeBoardRevealBinding({ catalog, ledger: withGate, entryId: "BE-05" });
    expect(wrongResource.allowed).toBe(false);
    expect(wrongResource.reason).toContain("GT-02@BT-01");
    // gate：绑定 gate 未满足 → 拒。
    const unsatisfied = {
      ...base,
      evaluations: new Map([["GT-01@BT-01", { gateId: "GT-01", beatId: "BT-01", satisfied: false, sequence: 3 }]]),
    };
    const gateLeg = authorizeBoardRevealBinding({ catalog, ledger: unsatisfied, entryId: "BE-04" });
    expect(gateLeg.allowed).toBe(false);
    expect(gateLeg.reason).toContain("gate 未满足");
    // beat：cursor 已推进（stale-gate）→ 拒。
    const advanced = { ...withGate, cursor: { protocolId: "PR-SMV-002", beatId: "BT-02" } };
    const staleGate = authorizeBoardRevealBinding({ catalog, ledger: advanced, entryId: "BE-04" });
    expect(staleGate.allowed).toBe(false);
    expect(staleGate.reason).toContain("stale-gate");
    // protocol：绑定协议未被会话 pin → 拒。
    const unpinned = {
      ...withGate,
      pinnedProtocols: ["PR-OTHER-001"],
    };
    const protocolLeg = authorizeBoardRevealBinding({ catalog, ledger: unpinned, entryId: "BE-04" });
    expect(protocolLeg.allowed).toBe(false);
    expect(protocolLeg.reason).toContain("Protocol 未 pin");
    // plan：catalog.taskId 与 session task 不符 → 拒。
    const planLeg = authorizeBoardRevealBinding({ catalog, ledger: { ...withGate, pinnedTaskId: "otherTask" }, entryId: "BE-04" });
    expect(planLeg.allowed).toBe(false);
    expect(planLeg.reason).toContain("Plan 不符");
    // intermediate 条目不经 gate 授权路径（revealRequirement 非 final → 不裁决 gate）。
    expect(authorizeBoardRevealBinding({ catalog, ledger: base, entryId: "BE-01" }).allowed).toBe(true);
  });

  it("mode constraints: every capability rejects locked; unlocked modes allow execution paths", () => {
    for (const spec of listWorkspaceCapabilities()) {
      expect(spec.allowedInteractionModes).not.toContain("locked");
      expect(spec.allowedInteractionModes).toContain("construction");
    }
  });
});

describe("F3 canonical amendment fixtures (student_intent_recorded workspace_command embed)", () => {
  it("accepts the positive embed fixture and rejects intent-without-command", () => {
    expect(validatePayload(readFixture("tutor-session-event.v5.positive.student-workspace-command.json")).ok).toBe(true);
    const negative = validatePayload(readFixture("tutor-session-event.v5.negative.intent-without-command.json"));
    expect(negative.ok).toBe(false);
    expect(negative.errors.join("; ")).toContain("workspace_command");
  });
});

describe("F3 projector and comparator", () => {
  it("derives participation from teaching phase and projects hidden-free views deterministically", () => {
    const catalog = wsTestCatalog();
    const fold = initialWorkspaceFold("TS-9701", catalog);
    const view1 = projectStudentWorkspaceViewV5(fold.state, catalog, { kind: "listen_only" });
    const view2 = projectStudentWorkspaceViewV5(fold.state, catalog, { kind: "listen_only" });
    expect(view1).toEqual(view2);
    expect(validatePayload(view1).ok).toBe(true);
    expect(view1.revision).toBe(0);
    expect(view1.solution_board.groups).toEqual([]);
    expect(view1.canvas.interaction_enabled).toBe(true);
    // authored 题图元素全部可见且非 student_authored。
    expect(view1.canvas.elements.some((element) => element.element_id === "segment-AD")).toBe(true);
    expect(view1.canvas.elements.every((element) => element.student_authored !== true)).toBe(true);
  });

  it("maps teaching phases to participation kinds", () => {
    const base = {
      schema: "ai_teaching_tutor_runtime_state/v1" as const,
      session_id: "TS-9702",
      state_revision: 1,
      pinned_plan: {
        tutor_plan_ref: { artifact_id: "TP-SMV-002", version: "v6", content_hash: "sha256:" + "a".repeat(64) },
        solution_graph_ref: { artifact_id: "RG-SMV-002", version: "v1", content_hash: "sha256:" + "b".repeat(64) },
        protocol_refs: [{ artifact_id: "PR-SMV-002", version: "v1", content_hash: "sha256:" + "c".repeat(64) }],
      },
      teaching_cursor: { protocol_id: "PR-SMV-002", beat_id: "BT-01", phase: "presenting" as const },
      inquiry_cursor: null,
      workspace_revision: 0,
      completed: false,
    };
    expect(deriveMainlineParticipation(base).kind).toBe("listen_only");
    expect(deriveMainlineParticipation({ ...base, teaching_cursor: { ...base.teaching_cursor, phase: "awaiting_evidence" } }).kind).toBe("workspace_input");
    expect(deriveMainlineParticipation({ ...base, teaching_cursor: { ...base.teaching_cursor, phase: "gate_satisfied" } }).kind).toBe("confirm_input");
    expect(deriveMainlineParticipation({ ...base, completed: true }).kind).toBe("read_only_completed");
    expect(
      deriveMainlineParticipation({
        ...base,
        inquiry_cursor: { inquiry_id: "IQ-9702-0001", state: "clarifying", return_beat_id: "BT-01" },
      }),
    ).toEqual({ kind: "temporarily_paused_for_inquiry", return_checkpoint_id: "BT-01" });
  });

  it("workspace semantic comparator has an explicit empty ignore list and reports any difference", () => {
    expect(SEMANTICALLY_IGNORED_WORKSPACE_STATE_FIELDS).toEqual([]);
    const catalog = wsTestCatalog();
    const a = initialWorkspaceFold("TS-9703", catalog).state;
    const b = initialWorkspaceFold("TS-9703", catalog).state;
    expect(compareWorkspaceStatesSemantically(a, b).equal).toBe(true);
    const c = { ...a, revision: 3 };
    const diff = compareWorkspaceStatesSemantically(a, c);
    expect(diff.equal).toBe(false);
    expect(diff.differences[0]).toContain("revision");
    const otherSession = initialWorkspaceFold("TS-9704", catalog).state;
    expect(compareWorkspaceStatesSemantically(a, otherSession).equal).toBe(false);
  });
});

describe("F3 workspace session runtime (vitest integration)", () => {
  it("full journey parity: online incremental fold equals full replay (contexts included)", () => {
    const sessionId = "TS-9710";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-9710-1");
    let decisionSeq = appendDecision(runtime, "TD-9710-1", intentSeq);
    const reveal = runtime.executePresentation(wsa(sessionId, { action_id: "WSA-9710-1", decision_id: "TD-9710-1", target_ids: ["BE-01"] }), decisionSeq);
    expect(reveal.status).toBe("completed");
    decisionSeq = appendDecision(runtime, "TD-9710-2", intentSeq);
    runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9710-2", decision_id: "TD-9710-2", surface: "geometry", capability: "geometry.construct", target_ids: ["segment-AD"], command_payload: constructParallelJson("C", "segment-AD", "line-9710"), reveal_scope: "none" }),
      decisionSeq,
    );
    const command = runtime.executeStudentCommand(
      sc(sessionId, 2, { command_id: "SC-9710-1", capability: "board.submit-attempt", target_ids: ["BE-01"], client_command_id: "cc-9710-cmd" }),
    );
    expect(command.status).toBe("completed");
    expect(runtime.workspaceState.revision).toBe(3);

    const events = readTutorSessionEventsV5(sessionId);
    const replayed = foldWorkspaceV5Events(events, wsTestCatalog());
    expect(replayed.state).toEqual(runtime.workspaceState);
    expect(replayed.context.tutorCommands).toEqual(runtime.fold.context.tutorCommands);
    expect(replayed.context.draftCommands).toEqual(runtime.fold.context.draftCommands);
    const parity = runtime.assertWorkspaceReplayParity();
    expect(parity.equal).toBe(true);
    expect(parity.differences).toEqual([]);
  });

  it("idempotent retry of a completed command appends zero new events", () => {
    const sessionId = "TS-9711";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const first = runtime.executeStudentCommand(
      sc(sessionId, 0, {
        command_id: "SC-9711-1",
        surface: "geometry",
        capability: "geometry.draft",
        target_ids: ["segment-AD"],
        params: { command: JSON.parse(setSegmentLabelJson("segment-AD", "label-9711", "6")) },
        client_command_id: "cc-9711-1",
      }),
    );
    expect(first.status).toBe("completed");
    const eventsAfterFirst = readTutorSessionEventsV5(sessionId).length;
    const retry = runtime.executeStudentCommand(
      sc(sessionId, 1, {
        command_id: "SC-9711-2",
        surface: "geometry",
        capability: "geometry.draft",
        target_ids: ["segment-BC"],
        params: { command: JSON.parse(setSegmentLabelJson("segment-BC", "label-9711b", "8")) },
        client_command_id: "cc-9711-1",
      }),
    );
    expect(retry.status).toBe("duplicate");
    expect(readTutorSessionEventsV5(sessionId).length).toBe(eventsAfterFirst);
    expect(runtime.workspaceState.geometry.draft_element_ids).toEqual(["label-9711"]);
  });

  it("intent committed without outcome (crash) surfaces incomplete and never auto-continues", () => {
    const sessionId = "TS-9712";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    // 直接经 kernel 写 intent 事实（模拟 intent 批已提交、outcome 批前崩溃）。
    runtime.kernel.append(runtime.kernel.revision, [
      {
        event_type: "student_intent_recorded",
        payload: {
          intent_kind: "submit_workspace_command",
          client_request_id: "cc-9712-crash",
          workspace_command: {
            command_id: "SC-9712-crash",
            surface: "solution_board",
            capability: "board.submit-attempt",
            target_ids: ["BE-01"],
            expected_workspace_revision: 0,
            client_command_id: "cc-9712-crash",
          },
        },
        occurred_at: at(),
      },
    ]);
    const retry = runtime.executeStudentCommand(
      sc(sessionId, 0, { command_id: "SC-9712-retry", target_ids: ["BE-01"], client_command_id: "cc-9712-crash" }),
    );
    expect(retry.status).toBe("incomplete");
    expect(retry.reason).toContain("mid-action crash");
    // resume 语义：issued/intent 无 outcome ⇒ 零完成副作用。
    const resumed = WorkspaceSessionRuntimeV5.resume(sessionId, wsTestCatalog());
    expect(resumed.workspaceState.revision).toBe(0);
    expect(resumed.workspaceState.solution_board.entries[0].attempt_state).toBe("none");
  });

  it("stale and geometry-kernel-rejected commands persist rejection facts with zero state effects", () => {
    const sessionId = "TS-9713";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const stale = runtime.executeStudentCommand(
      sc(sessionId, 7, { command_id: "SC-9713-1", surface: "geometry", capability: "geometry.draft", target_ids: ["segment-AD"], params: { command: JSON.parse(constructParallelJson("C", "segment-AD", "line-9713")) }, client_command_id: "cc-9713-stale" }),
    );
    expect(stale.status).toBe("rejected");
    expect(stale.reason).toContain("stale_revision");
    expect(runtime.workspaceState.geometry.draft_element_ids).toEqual([]);
    // Geometry 内核拒绝（引用不存在的参考线）→ rejected（dry-run fail closed）。
    const badReference = runtime.executeStudentCommand(
      sc(sessionId, 0, { command_id: "SC-9713-2", surface: "geometry", capability: "geometry.draft", target_ids: ["segment-AD"], params: { command: JSON.parse(constructParallelJson("C", "segment-NOPE", "line-9713b")) }, client_command_id: "cc-9713-badref" }),
    );
    expect(badReference.status).toBe("rejected");
    expect(badReference.reason).toContain("Geometry 内核拒绝");
    expect(runtime.workspaceState.geometry.draft_element_ids).toEqual([]);
    // 标注命令带非法 reveal_scope → 拒绝。
    const intentSeq = appendIntentFact(runtime, "cc-9713-t");
    const decisionSeq = appendDecision(runtime, "TD-9713-1", intentSeq);
    const annotate = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9713-1", decision_id: "TD-9713-1", surface: "geometry", capability: "geometry.annotate", target_ids: ["segment-AD"], command_payload: setSegmentLabelJson("segment-AD", "label-9713", "6"), reveal_scope: "final_result" }),
      decisionSeq,
    );
    expect(annotate.status).toBe("rejected");
    expect(annotate.reason).toContain("reveal_scope 必须为 none");
    const parity = runtime.assertWorkspaceReplayParity();
    expect(parity.equal).toBe(true);
  });

  it("duplicate WSA append at store level rolls back (stable idempotency key)", () => {
    const sessionId = "TS-9714";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    const intentSeq = appendIntentFact(runtime, "cc-9714-1");
    const decisionSeq = appendDecision(runtime, "TD-9714-1", intentSeq);
    // 手工预占 wsa-issued idempotency key（模拟前次 issued 已提交）→ 重试走 incomplete。
    runtime.kernel.append(runtime.kernel.revision, [
      {
        event_type: "workspace_surface_action_issued",
        payload: {
          action_id: "WSA-9714-crash",
          decision_id: "TD-9714-1",
          surface: "solution_board",
          capability: "board.reveal-entry",
          target_ids: ["BE-01"],
          reveal_scope: "step_narration",
        },
        occurred_at: at(),
        causation_sequence: decisionSeq,
        idempotency_key: "wsa-issued:WSA-9714-crash",
      },
    ]);
    const retry = runtime.executePresentation(
      wsa(sessionId, { action_id: "WSA-9714-crash", decision_id: "TD-9714-1", target_ids: ["BE-01"] }),
      decisionSeq,
    );
    expect(retry.status).toBe("incomplete");
    expect(retry.workspaceRevision).toBe(0);
    expect(runtime.workspaceState.solution_board.entries[0].visibility).toBe("hidden");
  });

  it("kernel getter exposes the F2 kernel without wrapper state divergence", () => {
    const sessionId = "TS-9715";
    const runtime = WorkspaceSessionRuntimeV5.start(wsStartInput(sessionId), wsTestCatalog());
    expect(runtime.kernel).toBeInstanceOf(TutorSessionKernelV5);
    expect(runtime.kernel.state).toEqual(runtime.tutorState);
    expect(runtime.sessionRevision).toBe(runtime.kernel.revision);
  });
});

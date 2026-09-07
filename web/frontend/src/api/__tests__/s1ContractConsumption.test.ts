import { describe, expect, it } from "vitest";
import { adaptivePresentationSnapshotFieldsSchema, parseSessionSnapshotHttp } from "../../../../shared/tutorHttpProfile";
import { validatePayload } from "../../../../shared/canonical";
import cases from "../../../../shared/fixtures/s1-http-field-cases.json";
import manifest from "../../../../shared/canonical/fixtures/fixtures-manifest.json";
import { runtimeSnapshotRaw, pendingBoardExplainPresentation } from "../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

const fixtures = import.meta.glob("../../../../shared/canonical/fixtures/*.json", { eager: true, import: "default" });
/** P1 候选波 + P2 终态波（增补 33：v3/v6/v8 候选名 → v4/v7/v9 终名 + generation/v2）。 */
const wave = /(?:tutor-plan-bundle\.(?:v6|v7)|tutor-runtime-state\.(?:v3|v4)|tutor-session-event\.(?:v8|v9)|tutor-policy-decision\.v2|presentation-plan\.(?:v3|v4)|presentation-draft\.|presentation-tool-spec\.|workspace-runtime-state\.v2|student-workspace-view\.v2)/;
const casePayload = (name: string): Record<string, unknown> =>
  cases.find((entry) => entry.name === name)!.payload as Record<string, unknown>;

describe("P2 S1 frontend contract consumption (composed decoder wiring)", () => {
  it.each(cases)("HTTP fields: $name", ({ payload, valid }) => {
    expect(adaptivePresentationSnapshotFieldsSchema.safeParse(payload).success).toBe(valid);
  });
  it.each(manifest.fixtures.filter((entry) => wave.test(entry.file)))("canonical: $file", (entry) => {
    const payload = fixtures[`../../../../shared/canonical/fixtures/${entry.file}`];
    expect(payload).toBeDefined();
    expect(validatePayload(payload).ok).toBe(entry.expect_schema === "valid");
  });

  // ---- 组合接线（S1 §1：P2 在同一次接线中组合字段 schema + 一致性门禁 +
  // decoder/view-model；不再保留「在线 parser 拒绝 pending」的迁移期断言）----

  it("composed online parser accepts a legal pending projection (no delivery mounted)", () => {
    expect(parseSessionSnapshotHttp({ ...runtimeSnapshotRaw(), ...casePayload("pending-approved") }).ok).toBe(true);
  });
  it("composed online parser accepts idle/failed/waiting_retry legal projections", () => {
    for (const name of ["idle-no-active-scope", "failed-timeout", "waiting-retry", "retry-budget-exhausted"]) {
      expect(parseSessionSnapshotHttp({ ...runtimeSnapshotRaw(), ...casePayload(name) }).ok).toBe(true);
    }
  });
  it("snapshots without the generation projection keep parsing (server not yet upgraded)", () => {
    expect(parseSessionSnapshotHttp(runtimeSnapshotRaw()).ok).toBe(true);
  });
  it("composed online parser rejects forged/illegal projections (missing fields, leaks, budget violations)", () => {
    for (const entry of cases.filter((entry) => !entry.valid)) {
      const result = parseSessionSnapshotHttp({ ...runtimeSnapshotRaw(), ...entry.payload });
      expect(result.ok).toBe(false);
    }
  });
  it("composed online parser rejects an unpaired projection (generation without scope)", () => {
    const { scope, ...projection } = casePayload("pending-approved");
    expect(scope).toBeDefined();
    expect(parseSessionSnapshotHttp({ ...runtimeSnapshotRaw(), ...projection }).ok).toBe(false);
  });
  it("pending generation must not carry a pending delivery (mirror rule 5 / S1 R1)", () => {
    const raw = runtimeSnapshotRaw({ pendingPresentation: true });
    const result = parseSessionSnapshotHttp({ ...raw, ...casePayload("pending-approved") });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.some((message) => message.includes("generation-pending"))).toBe(true);
  });
  it("pending generation must not mount an active action (S1 R1)", () => {
    const raw = runtimeSnapshotRaw({ participationKind: "workspace_input" });
    expect(parseSessionSnapshotHttp({ ...raw, ...casePayload("pending-approved") }).ok).toBe(false);
  });
  it("active action mounting requires generation idle (failed blocks mounting, S1 R1)", () => {
    const raw = runtimeSnapshotRaw({ participationKind: "workspace_input" });
    const result = parseSessionSnapshotHttp({ ...raw, ...casePayload("failed-timeout") });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.some((message) => message.includes("generation-mount"))).toBe(true);
  });
  it("idle generation does not block an ordinary pending delivery", () => {
    const raw = runtimeSnapshotRaw({ pendingPresentation: true });
    expect(parseSessionSnapshotHttp({ ...raw, ...casePayload("idle-no-active-scope") }).ok).toBe(true);
  });
  it("F7 P2 view/v2：携带 solution_board.fragments 的快照过组合 parser；board.explain 交付合法", () => {
    const raw = runtimeSnapshotRaw({
      pendingPresentation: pendingBoardExplainPresentation(24, 9, "EF-0001"),
      boardEntries: [{ entry_id: "BE-301", kind: "derivation", content: "△DAO∽△DBA" }],
      viewFragments: [{ fragment_id: "EF-0001", kind: "explanation_text", content: "把当前批准步骤拆细，逐项检查依据。", basis_refs: ["RES1"], attach_to_entry: "BE-301" }],
      revision: 24,
      workspaceRevision: 9,
    });
    const result = parseSessionSnapshotHttp(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const view = result.snapshot.views.student_workspace_view;
      expect(view.schema).toBe("ai_teaching_student_workspace_view/v2");
      expect("fragments" in view.solution_board && view.solution_board.fragments?.[0]?.fragment_id).toBe("EF-0001");
      expect(result.snapshot.pending_presentation?.action.workspace_action?.capability).toBe("board.explain");
    }
  });
});

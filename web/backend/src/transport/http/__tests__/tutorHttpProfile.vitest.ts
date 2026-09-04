/**
 * F7 Step 4.1 — tutorHttpProfile 共享 schema 负例（availability / error envelope /
 * parseActionEvidenceResponseHttp）。前后端共用的线格式单真源在此锁定：
 * 未知形态 fail closed，不允许路由/adapter 手拼漂移。
 */
import { describe, expect, it } from "vitest";

import {
  availabilityResponseHttpV1Schema,
  errorEnvelopeHttpV1Schema,
  parseActionEvidenceResponseHttp,
  type SessionSnapshotHttpV1,
} from "../../../../../shared/tutorHttpProfile";

function snapshotFixture(): Record<string, unknown> {
  return {
    profile: "f7-tutor-runtime-http/v1",
    session_id: "TS-99000801",
    task_id: "goldenMinhangFold2020",
    revision: 12,
    completed: false,
    assessment: false,
    question: { artifact_id: "QT-SMV-001", question_type: "fill_blank", stem: "如图。" },
    views: {
      student_workspace_view: {
        schema: "ai_teaching_student_workspace_view/v1",
        session_id: "TS-99000801",
        revision: 3,
        canvas: { elements: [], interaction_enabled: false },
        solution_board: { mode: "building", groups: [] },
        participation: { kind: "listen_only" },
      },
      coach_panel_view: {
        schema: "ai_teaching_coach_panel_view/v1",
        session_id: "TS-99000801",
        revision: 12,
        mainline: { kind: "presenting", beat_id: "BT-01" },
        inquiry: { kind: "no_inquiry" },
        teaching_context: { beat_id: "BT-01" },
        assistance_available: true,
        replay_available: true,
        transcript: [],
      },
      participation: { schema: "ai_teaching_mainline_participation/v1", kind: "listen_only" },
      status: { session_id: "TS-99000801", session_revision: 12, workspace_revision: 3, completed: false },
    },
    render: { workspace_revision: 3, geometry: null },
  };
}

function evaluationFixture() {
  return {
    outcome: "rejected" as const,
    evaluation: "wrong" as const,
    revision: 3,
    diagnosis: { messageLatex: "m", wrongObjectIds: ["seg-AO"] },
    phase: "wrong_feedback" as const,
    nextIndex: 0,
  };
}

describe("availabilityResponseHttpV1Schema", () => {
  it("合法形态通过；缺 enabled / unknown profile / 夹带字段 → fail closed", () => {
    expect(availabilityResponseHttpV1Schema.safeParse({
      task_id: "goldenMinhangFold2020",
      enabled: true,
      profile: "f7-tutor-runtime-http/v1",
    }).success).toBe(true);
    expect(availabilityResponseHttpV1Schema.safeParse({
      task_id: "goldenMinhangFold2020",
      profile: "f7-tutor-runtime-http/v1",
    }).success).toBe(false);
    expect(availabilityResponseHttpV1Schema.safeParse({
      task_id: "goldenMinhangFold2020",
      enabled: true,
      profile: "other-profile/v9",
    }).success).toBe(false);
    expect(availabilityResponseHttpV1Schema.safeParse({
      task_id: "goldenMinhangFold2020",
      enabled: true,
      profile: "f7-tutor-runtime-http/v1",
      extra: 1,
    }).success).toBe(false);
  });
});

describe("errorEnvelopeHttpV1Schema", () => {
  it("稳定 error.code 形态通过；缺 code / error 内夹带 → fail closed", () => {
    expect(errorEnvelopeHttpV1Schema.safeParse({ error: { code: "SESSION_NOT_FOUND", message: "no row" } }).success).toBe(true);
    expect(errorEnvelopeHttpV1Schema.safeParse({ error: { message: "no code" } }).success).toBe(false);
    expect(errorEnvelopeHttpV1Schema.safeParse({ error: { code: "X", message: "m", trace: "leak" } }).success).toBe(false);
  });
});

describe("parseActionEvidenceResponseHttp（组合 parser：snapshot 门禁 + 五判别互斥）", () => {
  it("evidence-rejected 合法组合通过并拆出 snapshot/submission", () => {
    const result = parseActionEvidenceResponseHttp({
      ...snapshotFixture(),
      action_submission: { revision: 12, status: "evidence-rejected", evaluation: evaluationFixture() },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.submission.status).toBe("evidence-rejected");
      expect(result.snapshot.session_id).toBe("TS-99000801");
      expect("action_submission" in result.snapshot).toBe(false);
    }
  });

  it("runtime-failure 携带 evaluation（结构互斥违例）→ fail closed", () => {
    const result = parseActionEvidenceResponseHttp({
      ...snapshotFixture(),
      action_submission: {
        revision: 12,
        status: "runtime-failure",
        failure: { category: "system", failure_class: "MODEL_TIMEOUT", retryable: true },
        evaluation: evaluationFixture(),
      },
    });
    expect(result.ok).toBe(false);
  });

  it("revision-conflict 缺 failure / 缺 action_submission → fail closed", () => {
    const missingFailure = parseActionEvidenceResponseHttp({
      ...snapshotFixture(),
      action_submission: { revision: 12, status: "revision-conflict" },
    });
    expect(missingFailure.ok).toBe(false);
    const missingSubmission = parseActionEvidenceResponseHttp(snapshotFixture());
    expect(missingSubmission.ok).toBe(false);
  });

  it("snapshot 一致性违例（workspace revision 三处不一致）→ fail closed", () => {
    const drifted = snapshotFixture();
    (drifted.views as Record<string, { workspace_revision?: number }>).status.workspace_revision = 99;
    const result = parseActionEvidenceResponseHttp({
      ...drifted,
      action_submission: { revision: 12, status: "evidence-rejected", evaluation: evaluationFixture() },
    });
    expect(result.ok).toBe(false);
  });

  it("类型回放：返回 snapshot 与 SessionSnapshotHttpV1 同型（零手拼 DTO）", () => {
    const result = parseActionEvidenceResponseHttp({
      ...snapshotFixture(),
      action_submission: { revision: 12, status: "evidence-rejected", evaluation: evaluationFixture() },
    });
    if (!result.ok) throw new Error("fixture invalid");
    const _typeCheck: SessionSnapshotHttpV1 = result.snapshot;
    expect(_typeCheck.profile).toBe("f7-tutor-runtime-http/v1");
  });
});

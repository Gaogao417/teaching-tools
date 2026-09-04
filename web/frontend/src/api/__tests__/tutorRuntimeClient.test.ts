/**
 * F7 Step 5 — TutorRuntimeClient HTTP adapter（唯一知道 /api/vnext 的模块）。
 * 覆盖：请求体形状（共享 request schema 客户端自校验）、响应经
 * parseSessionSnapshotHttp fail closed（schema + §1.3 一致性门禁）、错误码保留、
 * ActionSubmission 五判别结构互斥。fetch 全程 stub（零真实网络）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HttpTutorRuntimeClient,
  ProtocolParseError,
  TutorRuntimeHttpError,
  TutorRuntimeRequestError,
} from "../tutorRuntimeClient";
import {
  RUNTIME_SESSION_ID,
  RUNTIME_TASK_ID,
  rejectedEvaluation,
  runtimeSnapshotRaw,
} from "../../action-runtime/tutor/__tests__/runtimeSnapshotFixture";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();

let client: HttpTutorRuntimeClient;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  client = new HttpTutorRuntimeClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function requestBody(call: number): Promise<Record<string, unknown>> {
  const init = fetchMock.mock.calls[call][1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe("TutorRuntimeClient HTTP adapter", () => {
  it("availability：GET /api/vnext/availability/:taskId；enabled/profile 透传", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { task_id: RUNTIME_TASK_ID, enabled: true, profile: "f7-tutor-runtime-http/v1" }));
    const result = await client.availability(RUNTIME_TASK_ID);
    expect(result.enabled).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/vnext/availability/goldenMinhangFold2020");
  });

  it("availability：task_id 回显不符 / enabled 但 unknown profile → ProtocolParseError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { task_id: "other-task", enabled: false, profile: "f7-tutor-runtime-http/v1" }));
    await expect(client.availability(RUNTIME_TASK_ID)).rejects.toBeInstanceOf(ProtocolParseError);
    fetchMock.mockResolvedValue(jsonResponse(200, { task_id: RUNTIME_TASK_ID, enabled: true, profile: "unknown-profile/v9" }));
    await expect(client.availability(RUNTIME_TASK_ID)).rejects.toBeInstanceOf(ProtocolParseError);
  });

  it("start：请求携 task_id/student_id/client_request_id；快照经共享 schema 解析返回", async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, runtimeSnapshotRaw()));
    const snapshot = await client.start({ taskId: RUNTIME_TASK_ID, studentId: "student-1", clientRequestId: "req-start-0001" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/vnext/tutor-sessions");
    const body = await requestBody(0);
    expect(body).toEqual({ task_id: RUNTIME_TASK_ID, student_id: "student-1", client_request_id: "req-start-0001" });
    expect(snapshot.profile).toBe("f7-tutor-runtime-http/v1");
    expect(snapshot.session_id).toBe(RUNTIME_SESSION_ID);
    expect(snapshot.views.participation.kind).toBe("confirm_input");
  });

  it("start：client_request_id 不满足幂等键格式 → 客户端即拒（零网络往返）", async () => {
    await expect(
      client.start({ taskId: RUNTIME_TASK_ID, studentId: "student-1", clientRequestId: "ab" }),
    ).rejects.toBeInstanceOf(TutorRuntimeRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("快照一致性门禁：workspace revision 三处不一致 → ProtocolParseError（不部分采用）", async () => {
    const raw = runtimeSnapshotRaw();
    (raw.views as Record<string, { workspace_revision?: number }>).status.workspace_revision = 99;
    fetchMock.mockResolvedValue(jsonResponse(200, raw));
    await expect(client.restore(RUNTIME_SESSION_ID)).rejects.toBeInstanceOf(ProtocolParseError);
  });

  it("快照 schema：bad profile literal / 缺 render → ProtocolParseError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ...runtimeSnapshotRaw(), profile: "other/v2" }));
    await expect(client.restore(RUNTIME_SESSION_ID)).rejects.toBeInstanceOf(ProtocolParseError);
    const missingRender = runtimeSnapshotRaw() as Record<string, unknown>;
    delete missingRender.render;
    fetchMock.mockResolvedValue(jsonResponse(200, missingRender));
    await expect(client.restore(RUNTIME_SESSION_ID)).rejects.toBeInstanceOf(ProtocolParseError);
  });

  it("restore 404 SESSION_NOT_FOUND / 409 SESSION_VERSION_UNSUPPORTED：TutorRuntimeHttpError 保留服务端错误码", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "SESSION_NOT_FOUND", message: "no row" } }));
    const notFound = await client.restore(RUNTIME_SESSION_ID).catch((error: unknown) => error);
    expect(notFound).toBeInstanceOf(TutorRuntimeHttpError);
    expect((notFound as TutorRuntimeHttpError).code).toBe("SESSION_NOT_FOUND");
    expect((notFound as TutorRuntimeHttpError).status).toBe(404);
    fetchMock.mockResolvedValue(jsonResponse(409, { error: { code: "SESSION_VERSION_UNSUPPORTED", message: "v6 row" } }));
    const version = await client.restore(RUNTIME_SESSION_ID).catch((error: unknown) => error);
    expect((version as TutorRuntimeHttpError).code).toBe("SESSION_VERSION_UNSUPPORTED");
  });

  it("student-inputs：请求体 = input 判别联合（utterance|control）+ client_request_id + expected_revision", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, runtimeSnapshotRaw({ participationKind: "answer_input", revision: 13 })));
    const snapshot = await client.submitStudentInput(
      RUNTIME_SESSION_ID,
      { kind: "utterance", channel: "mainline", text: "识别第一组子母型" },
      12,
      "req-input-0001",
    );
    const body = await requestBody(0);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/vnext/tutor-sessions/${RUNTIME_SESSION_ID}/student-inputs`);
    expect(body).toEqual({
      input: { kind: "utterance", channel: "mainline", text: "识别第一组子母型" },
      client_request_id: "req-input-0001",
      expected_revision: 12,
    });
    expect(snapshot.revision).toBe(13);
  });

  it("student-inputs：workspace_command 输入成员在 HTTP 层即拒（浏览器子集 utterance|control）", async () => {
    await expect(
      client.submitStudentInput(
        RUNTIME_SESSION_ID,
        // 故意构造第三成员——spec §2.5 HTTP 只收 utterance|control。
        { kind: "workspace_command" as never, command_id: "SC-0001" } as never,
        12,
        "req-input-0002",
      ),
    ).rejects.toBeInstanceOf(TutorRuntimeRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("action-evidence：evidence-rejected 响应 → snapshot + action_submission 分别过共享 schema", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      ...runtimeSnapshotRaw({ participationKind: "workspace_input", revision: 31 }),
      action_submission: { revision: 31, status: "evidence-rejected", evaluation: rejectedEvaluation() },
    }));
    const result = await client.submitActionEvidence(RUNTIME_SESSION_ID, {
      evidence: {
        actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04",
        sourceStepId: "BT-04",
        kind: "mark-segment-values",
        version: 1,
        values: { "seg-AO": "9", "seg-DO": "9", "seg-BO": "9", "seg-OE": "9" },
      },
      expectedRevision: 30,
      clientRequestId: "req-evidence-0001",
    });
    expect(result.snapshot.revision).toBe(31);
    expect(result.actionSubmission.status).toBe("evidence-rejected");
    expect(result.actionSubmission.status === "evidence-rejected" && result.actionSubmission.evaluation.evaluation).toBe("wrong");
  });

  it("action-evidence：runtime-failure 携带 evaluation（结构互斥违例）→ ProtocolParseError", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      ...runtimeSnapshotRaw({ participationKind: "workspace_input", revision: 31 }),
      action_submission: {
        revision: 31,
        status: "runtime-failure",
        failure: { category: "turn", failure_class: "STALE_REVISION", retryable: true },
        evaluation: rejectedEvaluation(),
      },
    }));
    await expect(
      client.submitActionEvidence(RUNTIME_SESSION_ID, {
        evidence: { actionId: "a", sourceStepId: "BT-04", kind: "mark-segment-values", version: 1, values: {} },
        expectedRevision: 30,
        clientRequestId: "req-evidence-0002",
      }),
    ).rejects.toBeInstanceOf(ProtocolParseError);
  });

  it("presentation outcome：failed 缺 failure_class → 客户端即拒；合法 presented 请求体成形", async () => {
    await expect(
      client.reportPresentationOutcome(RUNTIME_SESSION_ID, "VA-bt01-narrate", {
        sequenceId: "PS-0001",
        ordinal: 0,
        outcome: "failed",
        clientRequestId: "req-outcome-0001",
        expectedRevision: 12,
      }),
    ).rejects.toBeInstanceOf(TutorRuntimeRequestError);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(jsonResponse(200, runtimeSnapshotRaw({ revision: 13 })));
    await client.reportPresentationOutcome(RUNTIME_SESSION_ID, "VA-bt01-narrate", {
      sequenceId: "PS-0001",
      ordinal: 0,
      outcome: "presented",
      clientRequestId: "req-outcome-0002",
      expectedRevision: 12,
    });
    const body = await requestBody(0);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/vnext/tutor-sessions/${RUNTIME_SESSION_ID}/presentation-actions/VA-bt01-narrate/outcomes`);
    expect(body).toEqual({
      sequence_id: "PS-0001",
      ordinal: 0,
      outcome: "presented",
      client_request_id: "req-outcome-0002",
      expected_revision: 12,
    });
  });

  it("asr：请求 audio snake_case；响应 observe-only 解析；422 EMPTY_TRANSCRIPT 保留错误码", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      session_id: RUNTIME_SESSION_ID,
      observed_revision: 12,
      transcript: "老师什么叫子母型",
      model: "scripted",
    }));
    const result = await client.transcribe(RUNTIME_SESSION_ID, {
      audio: { dataUrl: "data:audio/wav;base64,AAAA", mimeType: "audio/wav", durationMs: 1200 },
      clientRequestId: "req-asr-0001",
    });
    expect(result.transcript).toBe("老师什么叫子母型");
    expect(result.observedRevision).toBe(12);
    const body = await requestBody(0);
    expect(body).toEqual({
      audio: { data_url: "data:audio/wav;base64,AAAA", mime_type: "audio/wav", duration_ms: 1200 },
      client_request_id: "req-asr-0001",
    });
    fetchMock.mockResolvedValue(jsonResponse(422, { error: { code: "EMPTY_TRANSCRIPT", message: "empty" } }));
    const empty = await client.transcribe(RUNTIME_SESSION_ID, {
      audio: { dataUrl: "data:audio/wav;base64,AAAA", mimeType: "audio/wav" },
      clientRequestId: "req-asr-0002",
    }).catch((error: unknown) => error);
    expect((empty as TutorRuntimeHttpError).code).toBe("EMPTY_TRANSCRIPT");
  });

  it("workspace-commands：canonical 命令 session_id 与路径不符 → 客户端即拒", async () => {
    await expect(
      client.submitWorkspaceCommand(RUNTIME_SESSION_ID, { session_id: "TS-99000999", command_id: "SC-0001" }, 12),
    ).rejects.toBeInstanceOf(TutorRuntimeRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

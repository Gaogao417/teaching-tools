/** Production GET route + HTTP serializer over real persisted v9 pending state. */
import express from "express";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "../../../db/database";
import { realCanonicalRoot } from "../../../services/tutorNavigator/__tests__/navigatorSupport";
import { TutorSessionOrchestratorV7 } from "../../../services/tutorOrchestration/TutorSessionOrchestratorV7";
import { TutorRuntimeApplicationV7 } from "../../../services/tutorOrchestration/TutorRuntimeApplicationV7";
import { vNextGateModel } from "../../../services/tutorOrchestration/VNextGateModelFactory";
import type { PresenterGeneratorPort } from "../../../services/tutorOrchestration/presentationGeneration/GeneratorPort";
import { createVNextTutorRoutes } from "../vnextTutorRoutes";
import { tutorRuntimeStateV4Schema } from "../../../../../shared/canonical";
import { parseSessionSnapshotHttp } from "../../../../../shared/tutorHttpProfile";

let server: import("node:http").Server;
let baseUrl: string;
const root = realCanonicalRoot();
beforeAll(async () => {
  vi.stubEnv("TUTOR_VNEXT_ROOT", root);
  vi.stubEnv("TUTOR_VNEXT_SCRIPTED_GATE", "1");
  vi.stubEnv("TUTOR_VNEXT_GENERATION", "0"); // GET can restore v9 without a provider.
  const app = express(); app.use(express.json()); app.use("/api/vnext", createVNextTutorRoutes());
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`; resolve();
    });
  });
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.unstubAllEnvs(); vi.restoreAllMocks();
});
const events = (id: string) => db.prepare("SELECT * FROM tutor_session_events WHERE session_id = ? ORDER BY sequence").all(id);

it("GET returns S1 pending generation/scope and view/v2 without driving, retrying or adding facts", async () => {
  const generate = vi.fn(async (): Promise<never> => { throw new Error("GET must never invoke presenter"); });
  const presenter: PresenterGeneratorPort = {
    provider: "scripted-read-only", modelId: "read-only/v1",
    pin: { provider: "scripted-read-only", model_id: "read-only/v1", prompt_version: "presenter-interleaved/v1",
      context_builder_version: "presentation-context-builder/v1", tool_catalog_version: "presentation-tool-catalog/v1" },
    generatePresentationDraft: generate,
  };
  const session = TutorSessionOrchestratorV7.start({ sessionId: "TS-95001001", studentId: "s1-read-only",
    taskId: "goldenMinhangFold2020", canonicalRoot: root, model: vNextGateModel(), presenter });
  const request = tutorRuntimeStateV4Schema.parse(session.rebuildRuntimeState()).generation_requests[0];
  const before = events(session.sessionId);
  const drive = vi.spyOn(TutorRuntimeApplicationV7.prototype, "drivePendingGeneration");
  let previous: unknown;
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${baseUrl}/api/vnext/tutor-sessions/${session.sessionId}`);
    const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
    const parsed = parseSessionSnapshotHttp(body); expect(parsed.ok).toBe(true);
    expect(body.generation).toEqual({ status: "pending", request_id: request.request_id,
      phase: "running", attempt: request.attempt, max_attempts: request.max_attempts });
    expect(body.scope).toEqual(request.scope);
    expect(body.revision).toBe(session.revision);
    expect(body.views.student_workspace_view.schema).toBe("ai_teaching_student_workspace_view/v2");
    expect(body.active_action).toBeUndefined(); expect(body.pending_presentation).toBeUndefined();
    for (const key of ["epoch", "reservation_revision", "input_digest", "presenter_pin", "generation_requests", "selected_fact_ids"]) {
      expect(JSON.stringify(body)).not.toContain(`"${key}"`);
    }
    if (i > 0) expect(body).toEqual(previous);
    previous = body;
    expect(events(session.sessionId)).toEqual(before);
  }
  expect(drive).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  drive.mockRestore();
});

it("GET preserves the v7 HTTP shape without synthetic generation fields", async () => {
  const session = TutorSessionOrchestratorV7.start({ sessionId: "TS-95001002", studentId: "s1-v7-read-only",
    taskId: "goldenMinhangFold2020", canonicalRoot: root, model: vNextGateModel() });
  const before = events(session.sessionId);
  const response = await fetch(`${baseUrl}/api/vnext/tutor-sessions/${session.sessionId}`);
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200);
  expect(parseSessionSnapshotHttp(body).ok).toBe(true);
  expect(body.generation).toBeUndefined(); expect(body.scope).toBeUndefined();
  expect(body.views.student_workspace_view.schema).toBe("ai_teaching_student_workspace_view/v1");
  expect(events(session.sessionId)).toEqual(before);
});

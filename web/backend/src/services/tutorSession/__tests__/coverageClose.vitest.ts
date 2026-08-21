/**
 * Phase 5 remediation 覆盖补强（六·收口轮）：alternate v3 provenance、
 * 自我修正路径、intelligent routes（voice_source/confidence/route_id）、
 * presenter prompt.action_step workspace 派生、图 usage/目录分支。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";

import { publishSyntheticPlanVt, tempRoot } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { preparePresentation } from "../../tutorPresentation/PreparePresentation";
import { createTutorPolicyGraph } from "../../tutorIntelligence/policyGraph";
import { FakeStructuredModel } from "../../tutorIntelligence/adapters/fake/FakeStructuredModel";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { getTutorSession } from "../TutorSessionEventStore";
import type { TutorDecision } from "../../tutorPolicy/TutorMove";

const root = tempRoot("coverage-close");
const plan = publishSyntheticPlanVt(root, { qtId: "QT-SMV-006", tpId: "TP-SMV-006", parts: 0 });

function revisionOf(sessionId: string): number {
  return (getTutorSession(sessionId) as unknown as { revision: number }).revision;
}

describe("intelligent alternate 与自纠错路径", () => {
  const coordinator = createTutorSessionCoordinator({
    canonicalRoot: root,
    intelligence: createTutorPolicyGraph({ model: new FakeStructuredModel() }),
  });

  it("alternate utterance → v3 route_id/confidence/grounding_refs 落事件 + 路线切换", async () => {
    const sessionId = "TS-8950";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-006", initialMode: "guided_solve" });
    const alternateRoute = plan.recommended_routes.find((route) => route.role === "alternate");
    expect(alternateRoute?.entry_condition).toBeTruthy();
    const response = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-alt-v3", {
      input_kind: "reasoning_utterance",
      text: alternateRoute!.entry_condition!,
    });
    expect(response.alignment).toMatchObject({ alignment: "alternate_valid", route_id: "R2" });
    expect(typeof response.alignment?.confidence).toBe("number");
    const alignmentEvent = coordinator
      .getEvents(sessionId)
      .find((event) => event.event_type === "reasoning_aligned" && (event.payload as { route_id?: string }).route_id);
    expect(alignmentEvent?.payload).toMatchObject({
      route_id: "R2",
      grounding_refs: ["route.R2.entry"],
      aligner_version: expect.stringContaining("PROMPT"),
      workflow_version: "tutor-policy-deepseek-langgraph/v1",
    });
    const part = coordinator.restore(sessionId).curriculum.parts[0];
    expect(part.route_id).toBe("R2");
  });

  it("偏差→自答（无协助介入）→ student_self_corrected + confirm.self_correction", async () => {
    const sessionId = "TS-8951";
    coordinator.start({ sessionId, studentId: "s", tpId: "TP-SMV-006", initialMode: "guided_solve" });
    const deviation = plan.checkpoints.flatMap((entry) => entry.common_deviations ?? [])[0];
    expect(deviation).toBeTruthy();
    const deviationTurn = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-dev", {
      input_kind: "reasoning_utterance",
      text: deviation,
    });
    expect(deviationTurn.alignment?.alignment).toBe("incorrect");
    // 自答（不给 hint 生效时间——ledger 无 hint/explain）。
    const selfFixed = await coordinator.processTurn(sessionId, revisionOf(sessionId), "turn-self", {
      input_kind: "reasoning_utterance",
      text: plan.checkpoints[0].expected_reasoning,
    });
    const events = coordinator.getEvents(sessionId);
    expect(events.some((event) => event.event_type === "student_self_corrected")).toBe(true);
    expect(selfFixed.decision?.move_type).toBe("confirm");
  });
});

describe("presenter prompt.action_step workspace 派生", () => {
  it("显式引用 + 自动补齐路径（referencedActionTemplates）", () => {
    const actionResource = plan.resources.find((resource) => resource.kind === "action_template");
    expect(actionResource).toBeTruthy();
    const state = {
      reasoning: { current_checkpoint_id: actionResource!.checkpoint_id! },
      curriculum: { parts: [{ part_id: "1", checkpoint_ids: [actionResource!.checkpoint_id!], completed_checkpoints: [], current_index: 0, route_id: "R1" }] },
      workspace: {},
    } as never;
    const decision = {
      decision_id: "TD-9",
      move_type: "prompt",
      purpose_code: "prompt.action_step",
      policy_version: "v",
      source_event_sequence: 1,
      source_state_revision: 1,
      checkpoint_id: actionResource!.checkpoint_id,
      resource_ids: [actionResource!.resource_id],
    } as TutorDecision;
    const result = preparePresentation({
      decision,
      plan,
      state,
      sessionId: "TS-9",
      voiceOrdinal: 1,
      workspaceOrdinal: 1,
      answerValues: [],
    });
    expect(result.ok).toBe(true);
    expect(result.presentation!.workspace.length).toBe(1);
    expect(result.presentation!.workspace[0].command_payload).toMatchObject({
      resource_id: actionResource!.resource_id,
      mode: "learn",
    });
  });

  it("probe 资源优先于脚手架（prompt 资源路径）", () => {
    const probe = plan.resources.find((resource) => resource.kind === "diagnostic_probe");
    const state = {
      reasoning: { current_checkpoint_id: probe?.checkpoint_id ?? "CP1" },
      curriculum: { parts: [] },
      workspace: {},
    } as never;
    const result = preparePresentation({
      decision: {
        decision_id: "TD-10",
        move_type: "prompt",
        purpose_code: "prompt.diagnostic_probe",
        policy_version: "v",
        source_event_sequence: 1,
        source_state_revision: 1,
        resource_ids: probe ? [probe.resource_id] : [],
      } as TutorDecision,
      plan,
      state,
      sessionId: "TS-9",
      voiceOrdinal: 1,
      workspaceOrdinal: 1,
      answerValues: [],
    });
    expect(result.ok).toBe(true);
    if (probe) {
      expect(result.presentation!.voice[0].resource_id).toBe(probe.resource_id);
    }
  });
});

describe("intelligent routes 响应（voice_source/confidence/route_id 呈现）", () => {
  let baseUrl = "";
  let server: import("node:http").Server | undefined;

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/tutor-sessions",
      createTutorSessionRoutes({
        coordinator: createTutorSessionCoordinator({
          canonicalRoot: root,
          intelligence: createTutorPolicyGraph({ model: new FakeStructuredModel() }),
        }),
      }),
    );
    app.use(((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error?.message ?? "Invalid request" } });
    }) as express.ErrorRequestHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server!.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  it("expected 回合：model-generated voice_source 进响应；alternate 带 route/confidence", async () => {
    const start = await call("POST", "/api/tutor-sessions", { tpId: "TP-SMV-006", studentId: "s", sessionId: "TS-8960" });
    for (const voice of start.body.opening.voice) {
      await call("POST", "/api/tutor-sessions/TS-8960/voice-completions", { action_id: voice.action_id, outcome: "completed" });
    }
    const view = await call("GET", "/api/tutor-sessions/TS-8960");
    const expected = await call("POST", "/api/tutor-sessions/TS-8960/turns", {
      clientTurnId: "turn-intel-expected",
      expectedRevision: view.body.revision,
      input: { input_kind: "reasoning_utterance", text: plan.checkpoints[0].expected_reasoning },
    });
    expect(expected.status).toBe(200);
    expect(expected.body.voice.some((voice: { voice_source?: string }) => voice.voice_source === "model-generated")).toBe(true);

    const alternateRoute = plan.recommended_routes.find((route) => route.role === "alternate");
    const view2 = await call("GET", "/api/tutor-sessions/TS-8960");
    const alternate = await call("POST", "/api/tutor-sessions/TS-8960/turns", {
      clientTurnId: "turn-intel-alt",
      expectedRevision: view2.body.revision,
      input: { input_kind: "reasoning_utterance", text: alternateRoute!.entry_condition! },
    });
    expect(alternate.body.alignment).toMatchObject({ alignment: "alternate_valid", route_id: "R2" });
    expect(typeof alternate.body.alignment.confidence).toBe("number");
  });

  it("ASR SpeechProviderError → 503（注入抛错转写器）", async () => {
    const { SpeechProviderError } = await import("../../../services/coach/qwenSpeechService");
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/tutor-sessions",
      createTutorSessionRoutes({
        coordinator: createTutorSessionCoordinator({ canonicalRoot: root }),
        transcriber: async () => {
          throw new SpeechProviderError("DASHSCOPE_API_KEY is not configured");
        },
      }),
    );
    const throwingServer = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const address = throwingServer.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tutor-sessions/TS-8961/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA" } }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "ASR_UNAVAILABLE" } });
    await new Promise<void>((resolve) => throwingServer.close(() => resolve()));
  });

  it("complete 未知会话 → 404（complete 端点 coordinatorError 映射）", async () => {
    const missing = await call("POST", "/api/tutor-sessions/TS-8998/complete", { reason: "x" });
    expect(missing.status).toBe(404);
  });

  it("ASR 普通错误 → next(error) 500 路径", async () => {
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(
      "/api/tutor-sessions",
      createTutorSessionRoutes({
        coordinator: createTutorSessionCoordinator({ canonicalRoot: root }),
        transcriber: async () => {
          throw new Error("plain asr failure");
        },
      }),
    );
    app.use(((error: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error?.message ?? "x" } });
      void _next;
    }) as express.ErrorRequestHandler);
    const srv = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const address = srv.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${address.port}/api/tutor-sessions/TS-8962/asr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: { dataUrl: "data:audio/webm;codecs=opus;base64,AAAA" } }),
    });
    expect(response.status).toBe(500);
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  });

});

/**
 * Phase 5 UI 集成波次 C 后端测试：Workspace action_plan 下发 + evidence
 * action_evaluation + 学生安全视图扩展（HTTP 层经 /experience 驱动）。
 *
 * - workspace[0].action_plan 必须通过前端 isExercisePlan guard（assessment
 *   形态：server-authoritative、无 localTruth/teachingInput/expectedValues）；
 * - structured_action_evidence 回合携带 action_evaluation（accepted/rejected
 *   → 前端 Action Runtime 反馈）；
 * - GET /:sessionId 视图携带 task_id/question/alternates_available/
 *   question_completed（刷新恢复面）。
 */
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

import { tempRoot, publishSyntheticV3Experience } from "./vitestSupport";
import { createTutorSessionCoordinator } from "../TutorSession";
import { createLearnExperienceRoutes } from "../../../transport/http/learnExperienceRoutes";
import { createTutorSessionRoutes } from "../../../transport/http/tutorSessionRoutes";
import { isExercisePlan } from "../../../../../shared/actionRuntime";
import type { AuthoredActionTemplate } from "../../../../../shared/actionRuntime";
import { materializeActionTemplate } from "../../actionRuntime/topicPlanProjector";
import { buildTutorWorkspacePlan, studentQuestionGeometry } from "../../tutorPresentation/adapters/legacyActionRuntime/workspacePlanProjector";
import type { TutorPlanV2Payload } from "../../planBuild/canonicalInputs";

const root = tempRoot("workspace-plan");
publishSyntheticV3Experience(root, {
  qtId: "QT-TST-921",
  tpId: "TP-TST-921",
  taskId: "task-workspace-921",
  scenarioId: "SC-TST-921",
});
// 波次 C-2 裁定 1：几何任务（make-parallel 模板 input.geometry 携带画布）。
publishSyntheticV3Experience(root, {
  qtId: "QT-TST-932",
  tpId: "TP-TST-932",
  taskId: "task-geometry-932",
  scenarioId: "SC-TST-932",
  makeParallelAction: true,
});
const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });

let baseUrl = "";
let server: import("node:http").Server | undefined;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/learn", createLearnExperienceRoutes({ canonicalRoot: root, coordinator }));
  app.use("/api/tutor-sessions", createTutorSessionRoutes({ coordinator }));
  app.use(((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.name === "ZodError" || error?.body) {
      res.status(400).json({ error: { code: "BAD_REQUEST", message: error.message ?? "Invalid request" } });
      return;
    }
    next(error);
  }) as express.ErrorRequestHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server!.address() as { port: number };
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

async function call(method: string, url: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** 合成 plan 的期望推理（S1/S2/S3 → CP1/CP2/CP3；与 vitestSupport 同源）。 */
const EXPECTED_BY_INDEX = ["学生能指出目标三角形", "学生能说出内错角相等", "学生能写出 AA 判定结论"];

function planOf(tpId: string): Record<string, any> {
  const dir = path.join(root, "tutor-plan", tpId);
  const versions = readFileSync(path.join(dir, "v2.json"), "utf8");
  return JSON.parse(versions);
}

/** 驱动会话到 workspace 步（期望推理推进 + 播完 pending voice）。 */
async function driveUntilWorkspace(sessionId: string): Promise<any> {
  for (let index = 0; index < 16; index += 1) {
    const view = await call("GET", `/api/tutor-sessions/${sessionId}`);
    if (view.body.pending_workspace?.length) return view.body;
    for (const voice of view.body.pending_voice ?? []) {
      await call("POST", `/api/tutor-sessions/${sessionId}/voice-completions`, {
        action_id: voice.action_id,
        outcome: "completed",
      });
    }
    const after = await call("GET", `/api/tutor-sessions/${sessionId}`);
    if (after.body.pending_workspace?.length) return after.body;
    if (!(after.body.pending_voice ?? []).length) {
      const cpIndex = Number(/CP(\d+)/.exec(after.body.current_checkpoint.checkpoint_id)?.[1] ?? "1") - 1;
      const utterance = EXPECTED_BY_INDEX[Math.min(cpIndex, EXPECTED_BY_INDEX.length - 1)];
      const turn = await call("POST", `/api/tutor-sessions/${sessionId}/turns`, {
        clientTurnId: `drive-${sessionId}-${index}`,
        expectedRevision: after.body.revision,
        input: { input_kind: "reasoning_utterance", text: utterance },
      });
      if (turn.status !== 200) throw new Error(`drive turn failed: ${JSON.stringify(turn.body)}`);
    }
  }
  throw new Error("未在轮数内到达 workspace 步");
}

describe("buildTutorWorkspacePlan（纯投影）", () => {
  it("make-parallel 模板（input.geometry）→ isExercisePlan 通过且 world 携带画布", () => {
    const template = templateOfMakeParallel("TP-X");
    const plan = planOf("TP-TST-921") as unknown as TutorPlanV2Payload;
    const assessment = materializeActionTemplate(template, "assessment");
    const exercisePlan = buildTutorWorkspacePlan(plan, template, assessment, {
      taskId: "task-workspace-921",
      promptLatex: "如图，AB ∥ CD。",
    });
    expect(isExercisePlan(exercisePlan)).toBe(true);
    expect(exercisePlan.world.geometry?.points.map((point) => point.id)).toEqual(["A", "B", "C"]);
    expect(exercisePlan.mode).toBe("assessment");
    expect(exercisePlan.actions[0].validationPolicy).toBe("server-authoritative");
    expect(exercisePlan.actions[0].localTruth).toBeUndefined();
    const serialized = JSON.stringify(exercisePlan);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");
  });

  it("studentQuestionGeometry：同源提取 + 学生安全裁剪（剥运行时投影）", () => {
    const templateWithRuntimeFields: AuthoredActionTemplate = {
      ...templateOfMakeParallel("TP-X"),
      input: {
        ...templateOfMakeParallel("TP-X").input,
        geometry: {
          ...templateOfMakeParallel("TP-X").input.geometry!,
          derivedLines: [{ id: "L9", throughPointId: "C", referenceLineId: "AB", from: "C", to: { x: 1, y: 2 } }],
          teachingMarks: [{ id: "M1", kind: "angle-arc", anchorIds: ["A"] }],
        } as never,
      },
    };
    const geometry = studentQuestionGeometry({
      resources: [
        { resource_id: "R1", kind: "explanation", source: "authored", content: "not json" },
        { resource_id: "R2", kind: "action_template", source: "agent_generated", content: JSON.stringify(templateWithRuntimeFields) },
      ],
    } as never);
    expect(geometry).toBeTruthy();
    expect(geometry?.viewBox).toEqual({ width: 400, height: 300 });
    expect(geometry?.points.map((point) => point.id)).toEqual(["A", "B", "C"]);
    expect(geometry?.segments.map((segment) => segment.id)).toEqual(["AB", "BC"]);
    expect(geometry?.derivedLines).toBeUndefined();
    expect(geometry?.teachingMarks).toBeUndefined();
    // 无几何动作资源 → undefined（非几何题缺省，不猜图）。
    expect(studentQuestionGeometry(planOf("TP-TST-921") as unknown as TutorPlanV2Payload)).toBeUndefined();
  });
});

/** 与 build-tutor-e2e-root.ts 同形的 make-parallel 模板（供纯投影测试）。 */
function templateOfMakeParallel(tpId: string): AuthoredActionTemplate {
  return {
    actionId: `tp:${tpId}:1:make-parallel`,
    sourceStepId: "S3",
    kind: "make-parallel",
    version: 1,
    title: "画平行线",
    instruction: "过点 A 作 AB 的平行线。",
    input: {
      availablePointIds: ["A", "B", "C"],
      availableLineIds: ["AB", "BC"],
      outputLineId: "L1",
      geometry: {
        viewBox: { width: 400, height: 300 },
        points: [
          { id: "A", x: 60, y: 220 },
          { id: "B", x: 300, y: 220 },
          { id: "C", x: 120, y: 60 },
        ],
        segments: [
          { id: "AB", from: "A", to: "B" },
          { id: "BC", from: "B", to: "C" },
        ],
      },
    },
    teachingInput: { throughPointId: "C", referenceLineId: "AB" },
    capabilities: ["action.make-parallel", "agent:select-object", "agent:set-answer", "agent:back", "agent:clear"],
    answerSlots: [{ id: "target", label: "平行线", kind: "object", required: true }],
    submitOnComplete: true,
  };
}

describe("workspace action_plan / action_evaluation（HTTP 经 /experience）", () => {
  it("到达 workspace 步：action_plan 通过 isExercisePlan 且无 truth", async () => {
    const started = await call("POST", "/api/learn/task-workspace-921/experience", { studentId: "student-ws" });
    expect(started.status).toBe(200);
    const sessionId = started.body.session_id;
    const view = await driveUntilWorkspace(sessionId);
    const workspace = view.pending_workspace[0];
    expect(workspace.action_plan).toBeTruthy();
    expect(isExercisePlan(workspace.action_plan)).toBe(true);
    expect(workspace.action_plan.metadata.taskId).toBe("task-workspace-921");
    expect(workspace.action_plan.actions).toHaveLength(1);
    expect(workspace.action_plan.actions[0].kind).toBe("enter-text");
    const serialized = JSON.stringify(workspace);
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");
    // 学生安全视图携带刷新恢复上下文。
    expect(view.task_id).toBe("task-workspace-921");
    expect(view.question.artifact_id).toBe("QT-TST-921");
    expect(view.question.stem).toContain("QT-TST-921");
    expect(view.alternates_available).toBe(false);
    expect(view.question_completed).toBe(false);
    // 非几何题：question.geometry 缺省（不猜图）。
    expect(view.question.geometry).toBeUndefined();
    expect(started.body.question.geometry).toBeUndefined();
  });

  it("波次 C-2 裁定 1：几何任务 /experience 与 GET 视图都下发 question.geometry（开场画布）", async () => {
    const started = await call("POST", "/api/learn/task-geometry-932/experience", { studentId: "student-geo" });
    expect(started.status).toBe(200);
    // /experience 学生安全面：authored 画布（与 workspace world.geometry 同源同形状）。
    expect(started.body.question.geometry).toMatchObject({
      viewBox: { width: 400, height: 300 },
      points: [{ id: "A" }, { id: "B" }, { id: "C" }],
      segments: [{ id: "AB" }, { id: "BC" }],
    });
    const serialized = JSON.stringify(started.body.question);
    expect(serialized).not.toContain("derivedLines");
    expect(serialized).not.toContain("teachingMarks");
    expect(serialized).not.toContain("localTruth");
    expect(serialized).not.toContain("teachingInput");
    expect(serialized).not.toContain("expectedValues");

    // GET :sessionId（刷新恢复面）同一下发。
    const view = await call("GET", `/api/tutor-sessions/${started.body.session_id}`);
    expect(view.body.question.geometry).toEqual(started.body.question.geometry);
  });

  it("错误 evidence → action_evaluation.rejected（wrong 高亮面）；不崩会话", async () => {
    const started = await call("POST", "/api/learn/task-workspace-921/experience", { studentId: "student-ws2" });
    const sessionId = started.body.session_id;
    const view = await driveUntilWorkspace(sessionId);
    const action = view.pending_workspace[0].action_plan.actions[0];
    const wrong = await call("POST", `/api/tutor-sessions/${sessionId}/turns`, {
      clientTurnId: "evidence-wrong-1",
      expectedRevision: view.revision,
      input: {
        input_kind: "structured_action_evidence",
        action_evidence: {
          actionId: action.actionId,
          sourceStepId: action.sourceStepId,
          kind: action.kind,
          version: action.version,
          value: "明显错误的答案",
        },
      },
    });
    expect(wrong.status).toBe(200);
    expect(wrong.body.action_evaluation.outcome).toBe("rejected");
    expect(wrong.body.action_evaluation.evaluation).toBe("wrong");
    expect(wrong.body.action_evaluation.diagnosis).toBeTruthy();
    // 错误不推进：题未完成，workspace 仍待操作。
    expect(wrong.body.question_completed).toBe(false);
    const after = await call("GET", `/api/tutor-sessions/${sessionId}`);
    expect(after.body.pending_workspace.length).toBe(1);
  });

  it("正确 evidence → action_evaluation.accepted + question_completed → 完成信号", async () => {
    const started = await call("POST", "/api/learn/task-workspace-921/experience", { studentId: "student-ws3" });
    const sessionId = started.body.session_id;
    const view = await driveUntilWorkspace(sessionId);
    const action = view.pending_workspace[0].action_plan.actions[0];
    // 期望值由测试侧从 canonical plan 文件派生（页面侧不持有 truth）。
    const plan = planOf("TP-TST-921");
    const resource = plan.resources.find((entry: Record<string, unknown>) => entry.kind === "action_template");
    const template = JSON.parse(resource.content) as { teachingInput?: { expectedValues?: string[] } };
    const expected = template.teachingInput?.expectedValues?.[0] ?? "1";

    const correct = await call("POST", `/api/tutor-sessions/${sessionId}/turns`, {
      clientTurnId: "evidence-correct-1",
      expectedRevision: view.revision,
      input: {
        input_kind: "structured_action_evidence",
        action_evidence: {
          actionId: action.actionId,
          sourceStepId: action.sourceStepId,
          kind: action.kind,
          version: action.version,
          value: expected,
        },
      },
    });
    expect(correct.status).toBe(200);
    expect(correct.body.action_evaluation.outcome).toBe("accepted");
    expect(correct.body.action_evaluation.evaluation).toBe("correct");
    expect(correct.body.action_evaluation.phase).toBe("group_finished");
    expect(correct.body.question_completed).toBe(true);
  });
});

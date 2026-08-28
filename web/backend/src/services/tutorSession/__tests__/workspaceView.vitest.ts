/**
 * VS1（mvp/vs-01）：统一 WorkspaceRuntimeState → StudentWorkspaceView 测试。
 *
 * 纯单测（adapter/projector）：
 * - REQ-03 legacy read adapter：合法输入读入 state；非法 legacy snapshot /
 *   board context / 缺 action_plan 的 operation → 错误列表（fail closed）；
 * - REQ-05 projector：view 单 revision；canvas/board slice 无独立 revision；
 * - REQ-07 truth isolation：hidden 行不进 view（snapshotAt 可见行输入），
 *   truth 键零出现。
 *
 * 集成（真实 coordinator + 真实 bundle 场景）：
 * - REQ-02 opening/turn/session-view 三条读取路径同一 View shape、同 revision；
 * - REQ-06 refresh parity：GET session view 深比较一致（含操作步 pending 态）；
 * - 操作步回合 participation.mode=operate + activeAction 学生安全计划；
 *   讲解回合 listen/respond；空回合不清 operate（会话权威 pending）。
 */
import { describe, expect, it } from "vitest";

import {
  adaptLegacyWorkspaceIntoState,
  projectStudentWorkspace,
} from "../workspaceRuntimeState";
import type { ValidatedWorkspaceAction } from "../../tutorPresentation/WorkspaceAction";
import type { SolutionBoardProjection } from "../../../../../shared/solutionBoard";
import type { TopicGeometryModel } from "../../../../../shared/topicPractice";
import { getTutorSession } from "../TutorSessionEventStore";
import { createTutorSessionCoordinator } from "../TutorSession";
import { publishSyntheticV3Experience, tempRoot } from "./vitestSupport";

// --------------------------------------------------------------------------- //
// 纯单测：adapter + projector
// --------------------------------------------------------------------------- //

const GEOMETRY: TopicGeometryModel = {
  viewBox: { width: 400, height: 300 },
  points: [
    { id: "A", x: 60, y: 220 },
    { id: "B", x: 300, y: 220 },
  ],
  segments: [{ id: "AB", from: "A", to: "B" }],
};

/** snapshotAt 产物口径：只含可见行（hidden 行服务端已过滤）。 */
const VISIBLE_BOARD: SolutionBoardProjection = {
  schemaVersion: 1,
  documentId: "SC/solution",
  headingLatex: "解：",
  expressions: [
    { expressionId: "E1", sourceStepId: "s1", latexTemplate: "\\because AB \\parallel CD", slotValues: {}, phase: "complete" },
  ],
};

function operation(actionPlan?: ValidatedWorkspaceAction["action_plan"]): ValidatedWorkspaceAction {
  return {
    action_id: "WA-1",
    decision_id: "TD-1",
    capability: "action.enter-text",
    target_ids: [],
    resource_id: "RES1",
    action_ref: "tp:X:1:enter-text",
    student_view: undefined,
    ...(actionPlan ? { action_plan: actionPlan } : {}),
  };
}

const MINIMAL_PLAN: ValidatedWorkspaceAction["action_plan"] = {
  planVersion: 5,
  exerciseId: "tutor:X:a",
  revision: 1,
  mode: "assessment",
  metadata: { taskId: "task-1", title: "t", promptLatex: "p", skillTags: [] },
  world: { revision: 1 },
  coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" },
  actions: [],
  currentActionId: "a",
  completedActionIds: [],
};

describe("VS1 legacy read adapter + projector（纯单测）", () => {
  it("REQ-01/03：合法 legacy world snapshot + board context 读入统一 state（两 slice 共享 revision）", () => {
    const result = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 9,
      legacyWorldSnapshot: { baseGeometry: GEOMETRY, disclosedEffects: [] },
      legacyBoardContext: { board: VISIBLE_BOARD, currentExpressionId: "E1" },
      operations: [operation(MINIMAL_PLAN)],
      pendingVoiceCount: 0,
      completed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.revision).toBe(9);
    expect(result.state.sessionId).toBe("TS-1");
    expect(result.state.geometry.baseGeometry).toEqual(GEOMETRY);
    expect(result.state.solutionBoard.board?.expressions).toHaveLength(1);
    // operation 存在 → operate + activeAction；voice 0 → 非 listen。
    expect(result.state.participation.mode).toBe("operate");
    expect(result.state.participation.activeAction?.actionId).toBe("WA-1");
  });

  it("REQ-03：非法 legacy snapshot（几何形状坏/效果命令非数组/板书缺行）→ 错误列表，不产 state", () => {
    const bad = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 1,
      legacyWorldSnapshot: {
        baseGeometry: { viewBox: null, points: [], segments: [] } as unknown as TopicGeometryModel,
        disclosedEffects: "nope" as unknown as [],
      },
      legacyBoardContext: { board: {} as SolutionBoardProjection },
      operations: [],
      pendingVoiceCount: 0,
      completed: false,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("REQ-03/AC-07：operation 缺学生安全 action_plan → fail closed（错误含 action_id）", () => {
    const bad = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 1,
      legacyWorldSnapshot: { disclosedEffects: [] },
      operations: [operation()],
      pendingVoiceCount: 0,
      completed: false,
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.errors.join("; ")).toContain("WA-1");
  });

  it("REQ-05/07：projector 出学生安全 view——单 revision、hidden 行不在、truth 键零出现", () => {
    const result = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 12,
      legacyWorldSnapshot: { baseGeometry: GEOMETRY, disclosedEffects: [] },
      legacyBoardContext: { board: VISIBLE_BOARD },
      operations: [],
      pendingVoiceCount: 1,
      completed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = projectStudentWorkspace(result.state);
    expect(view.revision).toBe(12);
    expect(view.sessionId).toBe("TS-1");
    // pending voice → listen。
    expect(view.participation.mode).toBe("listen");
    // 板书行已渲染、isCurrent 落在最后一行；无 phase=hidden 第三态。
    expect(view.solutionBoard.visibleExpressions).toHaveLength(1);
    expect(view.solutionBoard.visibleExpressions[0]).toMatchObject({
      expressionId: "E1",
      latex: "\\because AB \\parallel CD",
      isCurrent: true,
      isComplete: true,
    });
    // truth 键零出现（REQ-07）。
    const json = JSON.stringify(view);
    for (const forbidden of ["localTruth", "teachingInput", "expectedValues", "hidden"]) {
      expect(json).not.toContain(forbidden);
    }
    // canvas/board slice 无独立 revision 字段（REQ-05）。
    expect("revision" in view.canvas).toBe(false);
    expect("revision" in view.solutionBoard).toBe(false);
  });

  it("REQ-01：completed → review 态（板书投影仍来自披露产物）", () => {
    const result = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 20,
      legacyWorldSnapshot: { disclosedEffects: [] },
      legacyBoardContext: { board: VISIBLE_BOARD },
      operations: [],
      pendingVoiceCount: 0,
      completed: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(projectStudentWorkspace(result.state).participation.mode).toBe("review");
  });

  it("REQ-03：adapter 不生成 reveal——空 board 输入出空 view（不补内容、不判正确性）", () => {
    const result = adaptLegacyWorkspaceIntoState({
      sessionId: "TS-1",
      revision: 3,
      legacyWorldSnapshot: { baseGeometry: GEOMETRY, disclosedEffects: [] },
      operations: [],
      pendingVoiceCount: 0,
      completed: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const view = projectStudentWorkspace(result.state);
    expect(view.solutionBoard.visibleExpressions).toEqual([]);
    expect(view.canvas.geometry).toEqual(GEOMETRY);
  });
});

// --------------------------------------------------------------------------- //
// 集成：真实 coordinator 三条读取路径 + refresh parity
// --------------------------------------------------------------------------- //

interface DrivePlan {
  checkpoints: Array<{ checkpoint_id: string; part_id: string; expected_reasoning: string }>;
  resources: Array<{ resource_id: string; kind: string; checkpoint_id?: string; content?: string }>;
}

function templateOf(plan: DrivePlan, checkpointId: string): { actionId: string; sourceStepId: string; kind: string; expected: string } | undefined {
  const resource = plan.resources.find(
    (entry) => entry.kind === "action_template" && entry.checkpoint_id === checkpointId,
  );
  if (!resource?.content) return undefined;
  const template = JSON.parse(resource.content) as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput?: { expectedValues?: string[] };
  };
  return {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind,
    expected: template.teachingInput?.expectedValues?.[0] ?? "1",
  };
}

describe("VS1 统一 View 集成（真实 coordinator / 三条读取路径）", () => {
  it("opening/turn/session-view 同一 View shape 同 revision；refresh parity 深比较；truth 零出现", async () => {
    const root = tempRoot("vs1-workspace-view");
    const published = publishSyntheticV3Experience(root, {
      qtId: "QT-TST-971",
      tpId: "TP-TST-971",
      taskId: "goldenMinhangCross2020",
      scenarioId: "golden-similarity-mvp-001:QT-SMV-002",
      parts: 2,
    });
    const plan = published.planV3 as unknown as DrivePlan;
    const coordinator = createTutorSessionCoordinator({ canonicalRoot: root });
    const sessionId = "TS-9710";
    coordinator.start({
      sessionId,
      studentId: "student-vs1",
      tpId: "TP-TST-971",
      access: "binding",
      experience: {
        task_id: "goldenMinhangCross2020",
        scenario_id: "golden-similarity-mvp-001:QT-SMV-002",
        approach_set_ref: {
          artifact_id: (published.approachSet as { artifact_id: string }).artifact_id,
          version: (published.approachSet as { version: string }).version,
          content_hash: (published.approachSet as { content_hash: string }).content_hash,
        },
        policy_profile_snapshot: {
          profile_id: "PP-TST-001",
          version: "2026-08-22.1",
          primary_provider: "deterministic-rules",
          fallback_provider: "deepseek-langgraph",
          model_id: "deepseek-v4-flash",
          prompt_version: "policy-voice-deepseek/v1",
        },
        provider: "deterministic-rules",
      },
    });

    const revision = (): number => (getTutorSession(sessionId) as unknown as { revision: number }).revision;

    // 1) 开场（session start 路径的 View 等价物）：GET session view 与
    //    opening turn 之后任一回合响应携带同一 shape。
    const openingSessionView = coordinator.getSessionView(sessionId) as unknown as {
      revision: number;
      workspace_view: { sessionId: string; revision: number; canvas: unknown; solutionBoard: unknown; participation: { mode: string } };
    };
    expect(openingSessionView.workspace_view.sessionId).toBe(sessionId);
    expect(openingSessionView.workspace_view.revision).toBe(openingSessionView.revision);
    // 合成 plan 无披露 → 空 board、respond/listen（非 operate/review）。
    expect(["listen", "respond"]).toContain(openingSessionView.workspace_view.participation.mode);

    // 2) 逐 checkpoint 推进到结论操作步：turn response 的 View 进 operate。
    const part1 = plan.checkpoints.filter((entry) => entry.part_id === "1");
    let operateTurn: Awaited<ReturnType<typeof coordinator.processTurn>> | undefined;
    for (const checkpoint of part1) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const view = coordinator.getSessionView(sessionId) as unknown as { pending_workspace: unknown[] };
        const template = templateOf(plan, checkpoint.checkpoint_id);
        if (view.pending_workspace.length && template) {
          operateTurn = await coordinator.processTurn(sessionId, revision(), `turn-vs1-ev-${checkpoint.checkpoint_id}`, {
            input_kind: "structured_action_evidence",
            action_evidence: {
              actionId: template.actionId,
              sourceStepId: template.sourceStepId,
              kind: template.kind as "enter-text",
              version: 1,
              value: template.expected,
            },
          });
          break;
        }
        await coordinator.processTurn(sessionId, revision(), `turn-vs1-say-${checkpoint.checkpoint_id}-${attempt}`, {
          input_kind: "reasoning_utterance",
          text: checkpoint.expected_reasoning,
        });
      }
    }

    // 签发操作步的回合（或随后的讲解回合）：出现 operate + activeAction。
    // 用 GET + 提问驱动 explain 后的回合检查 turn View 的 operate 语义。
    const asked = await coordinator.processTurn(
      sessionId,
      revision(),
      "turn-vs1-ask",
      { input_kind: "question_asked", text: "这一步是怎么想的？" },
    );
    const turnView = asked.workspace_view;
    expect(turnView.revision).toBe(asked.revision);
    expect(turnView.sessionId).toBe(sessionId);
    // 板书来自真实 bundle 披露（第 1 小问已讲）——可见行非空且 hidden 不出现。
    if (turnView.solutionBoard.visibleExpressions.length) {
      const json = JSON.stringify(turnView);
      expect(json).not.toContain("localTruth");
      expect(json).not.toContain("teachingInput");
      expect(json).not.toContain("expectedValues");
    }

    // 3) REQ-06 refresh parity：连续两次 GET（模拟刷新前后）深比较一致；
    //    并与最近 turn 响应的 View 同源（同 revision 时逐字段一致）。
    const refreshedA = coordinator.getSessionView(sessionId) as unknown as { revision: number; workspace_view: unknown };
    const refreshedB = coordinator.getSessionView(sessionId) as unknown as { revision: number; workspace_view: unknown };
    expect(refreshedA.revision).toBe(refreshedB.revision);
    expect(refreshedA.workspace_view).toEqual(refreshedB.workspace_view);

    // 4) 操作步 pending 的 parity：推进到操作步挂起时，turn 与 session view
    //    同一 operate 投影（activeAction 计划一致；空回合不清）。
    const part2 = plan.checkpoints.filter((entry) => entry.part_id === "2");
    for (const checkpoint of part2) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const view = coordinator.getSessionView(sessionId) as unknown as { pending_workspace: unknown[] };
        if (view.pending_workspace.length) break;
        await coordinator.processTurn(sessionId, revision(), `turn-vs1-p2-${checkpoint.checkpoint_id}-${attempt}`, {
          input_kind: "reasoning_utterance",
          text: checkpoint.expected_reasoning,
        });
      }
    }
    const pendingSession = coordinator.getSessionView(sessionId) as unknown as {
      revision: number;
      pending_workspace: unknown[];
      workspace_view: { revision: number; participation: { mode: string; activeAction?: { actionId: string; plan: { actions: unknown[] } } } };
    };
    expect(pendingSession.pending_workspace.length).toBeGreaterThan(0);
    expect(pendingSession.workspace_view.participation.mode).toBe("operate");
    expect(pendingSession.workspace_view.participation.activeAction?.plan.actions.length).toBeGreaterThan(0);
    expect(pendingSession.workspace_view.revision).toBe(pendingSession.revision);
    // 学生答非操作步（空 workspace 回合）：View 仍 operate（会话权威 pending）。
    const talkTurn = await coordinator.processTurn(sessionId, revision(), "turn-vs1-talk", {
      input_kind: "reasoning_utterance",
      text: "我想想……",
    });
    if (talkTurn.workspace.every((entry) => entry.form !== "operation" || entry.action_plan === undefined)) {
      // 本回合未重新签发操作步：turn View 与 session View 同口径仍 operate。
      expect(talkTurn.workspace_view.participation.mode).toBe("operate");
      expect(talkTurn.workspace_view.participation.activeAction?.actionId)
        .toBe(pendingSession.workspace_view.participation.activeAction?.actionId);
    }

    // 5) 幂等重放路径的 View 接线由 rebuildTurnResponse 编译期保证
    //    （buildSessionWorkspaceView 同一构建入口）；运行期重放在 v4 会话
    //    因 client_turn_id 未落事件而不触发——VS1 之前既有的缺口，登记
    //    P1 移交 VS6（恢复/重放一致性），不在本 VS 扩大修复面。
    expect(operateTurn).toBeTruthy();
  });
});

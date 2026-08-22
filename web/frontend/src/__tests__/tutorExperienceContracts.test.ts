/**
 * Phase 5 UI 集成（波次 C）：shared tutorExperience 合同 guards 测试。
 */
import { describe, expect, it } from "vitest";

import {
  isTutorExperienceResponse,
  isTutorSessionView,
  isTutorTurnResponse,
  type TutorTurnResponse,
} from "../../../shared/tutorExperience";

const BASE_TURN: TutorTurnResponse = {
  session_id: "TS-1001",
  revision: 3,
  client_turn_id: "turn-1",
  idempotent_replay: false,
  mode: "teach",
  current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
  decision: null,
  voice: [{ action_id: "VA-1", text: "我们先看这一问。", interruptible: true }],
  workspace: [],
  event_cursor: 12,
};

describe("tutorExperience guards", () => {
  it("isTutorTurnResponse：合法回合通过；缺关键字段拒绝", () => {
    expect(isTutorTurnResponse(BASE_TURN)).toBe(true);
    expect(isTutorTurnResponse({ ...BASE_TURN, session_id: 123 })).toBe(false);
    expect(isTutorTurnResponse({ ...BASE_TURN, revision: "3" })).toBe(false);
    expect(isTutorTurnResponse({ ...BASE_TURN, voice: [{ action_id: "VA-1" }] })).toBe(false);
  });

  it("isTutorTurnResponse：workspace 携带 action_plan 通过（服务端完整学生安全计划）", () => {
    const turn: TutorTurnResponse = {
      ...BASE_TURN,
      workspace: [{
        action_id: "WA-1",
        decision_id: "TD-1",
        capability: "action.enter-text",
        target_ids: [],
        resource_id: "RES9",
        action_ref: "tp:X:1:enter-text",
        student_view: {
          actionId: "tp:X:1:enter-text", sourceStepId: "S3", kind: "enter-text", version: 1,
          title: "本题结论", instruction: "写出结论", input: { placeholder: "写出结论" },
          capabilities: [], answerSlots: [], validationPolicy: "server-authoritative", submitOnComplete: true,
        },
        action_plan: {
          planVersion: 5, exerciseId: "tutor:X:a", revision: 1, mode: "assessment",
          metadata: { taskId: "task-1", title: "t", promptLatex: "p", skillTags: [] },
          world: { revision: 1 },
          coach: { profileId: "c", displayName: "老师", avatarId: "school", tone: "supportive" },
          actions: [],
          currentActionId: "a", completedActionIds: [],
        },
      }],
      action_evaluation: {
        outcome: "rejected", evaluation: "wrong", revision: 4,
        diagnosis: { messageLatex: "再检查", wrongObjectIds: [] },
        phase: "wrong_feedback", nextIndex: 0,
      },
      question_completed: false,
    };
    expect(isTutorTurnResponse(turn)).toBe(true);
  });

  it("isTutorSessionView：恢复视图（含 question/task_id 扩展字段）", () => {
    expect(isTutorSessionView({
      session_id: "TS-1001", revision: 3, mode: "teach", completed: false,
      question_completed: false,
      current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1" },
      pending_voice: [], pending_workspace: [], event_cursor: 5,
      task_id: "task-1",
      question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
      alternates_available: true,
    })).toBe(true);
    expect(isTutorSessionView({ session_id: "TS-1", revision: 1, completed: false })).toBe(false);
  });

  it("isTutorExperienceResponse：tutor 体验面；legacy 不匹配 tutor guard", () => {
    const experience = {
      kind: "tutor",
      task_id: "task-1",
      scenario_id: "SC-1",
      binding: { artifact_id: "TB-1", default_plan: "TP-1", variants: [], alternates_available: false },
      question: { artifact_id: "QT-1", stem: "题干", subquestions: [] },
      session_id: "TS-1001",
      opening: BASE_TURN,
    };
    expect(isTutorExperienceResponse(experience)).toBe(true);
    expect(isTutorExperienceResponse({ kind: "legacy", task_id: "task-1", reason: "no_approved_binding" })).toBe(false);
    expect(isTutorExperienceResponse({ ...experience, opening: { session_id: "TS-1" } })).toBe(false);
  });
});

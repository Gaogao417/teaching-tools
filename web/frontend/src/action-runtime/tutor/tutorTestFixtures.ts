/**
 * VS1 测试夹具：合法统一 `StudentWorkspaceView` 与携带它的
 * `TutorTurnResponse`（turn/session view 共用形态；供 hook 与页面组件
 * 测试使用——响应合同自 VS1 起 workspace_view 必填）。
 */
import type { StudentWorkspaceView } from "../../../../shared/studentWorkspace";
import type { TutorTurnResponse } from "../../../../shared/tutorExperience";

export function studentWorkspaceViewFixture(overrides: Partial<StudentWorkspaceView> = {}): StudentWorkspaceView {
  return {
    sessionId: "TS-5001",
    revision: 2,
    canvas: {},
    solutionBoard: { headingLatex: "解：", visibleExpressions: [] },
    participation: { mode: "respond" },
    ...overrides,
  };
}

export function tutorTurnFixture(overrides: Partial<TutorTurnResponse> = {}): TutorTurnResponse {
  return {
    session_id: "TS-5001",
    revision: 2,
    client_turn_id: "system.open",
    idempotent_replay: false,
    mode: "teach",
    current_checkpoint: { checkpoint_id: "CP1", part_id: "1", route_id: "R1", index: 1, total: 3 },
    decision: null,
    voice: [],
    workspace: [],
    workspace_view: studentWorkspaceViewFixture(),
    event_cursor: 3,
    ...overrides,
  };
}

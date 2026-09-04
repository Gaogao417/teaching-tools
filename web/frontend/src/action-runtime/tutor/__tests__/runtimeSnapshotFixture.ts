/**
 * F7 Step 5 测试夹具：构造经 `parseSessionSnapshotHttp`（schema parse + §1.3
 * 一致性门禁）原子校验的 ValidatedSessionSnapshot——夹具一旦漂移（不再满足
 * 共享线格式）即在构造处抛错、测试随之失败，不信任手写 `as Snapshot`。
 */
import { parseSessionSnapshotHttp } from "../../../../../shared/tutorHttpProfile";
import type { SessionSnapshotHttpV1 } from "../../../../../shared/tutorHttpProfile";
import type { ExercisePlan } from "../../../../../shared/actionRuntime";

export const RUNTIME_TASK_ID = "goldenMinhangFold2020";
export const RUNTIME_SESSION_ID = "TS-99000801";

const GATE_BY_KIND: Record<string, string> = {
  confirm_input: "GT-01",
  answer_input: "GT-02",
  workspace_input: "GT-04",
  continue_input: "GT-05",
};

/** golden BT-04 mark-segment-values@1 同构的学生安全 plan（planVersion=5，
 *  assessment 形态、server-authoritative、零真值——过 isExercisePlan）。 */
export function runtimeActionPlan(): ExercisePlan {
  return {
    planVersion: 5,
    exerciseId: "tutor:TP-SMV-009:1:bt04",
    revision: 3,
    mode: "assessment",
    metadata: { taskId: RUNTIME_TASK_ID, title: "标注第二组子母型的四段长度", promptLatex: "如图，将 △ACD 沿 AD 翻折，求 BE。", skillTags: [] },
    world: { revision: 3, geometry: runtimeGeometry() },
    coach: { profileId: "tutor-zh-v1", displayName: "老师", avatarId: "school", tone: "supportive" },
    actions: [{
      actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04",
      sourceStepId: "BT-04",
      kind: "mark-segment-values",
      version: 1,
      title: "标注第二组子母型的四段长度",
      instruction: "在画布上依次选中 AO、DO、BO、OE，并填入由 △DAO∽△DBA 求得的长。",
      input: { labels: [], availableSegmentIds: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"], requiredCount: 4, autoFocusSequence: true },
      capabilities: ["similarity.mark-known-segments"],
      answerSlots: [{ id: "values", label: "四段长度", kind: "text", required: true, placeholder: "选中线段并填入长度" }],
      validationPolicy: "server-authoritative",
      submitOnComplete: true,
    }],
    currentActionId: "tp:TP-SMV-009:1:mark-segment-values-bt04",
    completedActionIds: [],
    runtimeCapabilities: {
      practiceValidation: "server-authoritative",
      trainingSync: "local-only",
      narrationTransport: "off",
      coachTurnTransport: "request-response",
      liveCoach: false,
    },
  };
}

/** student-safe composed render geometry（authored 基座 + committed 构造段）。 */
export function runtimeGeometry() {
  return {
    viewBox: { width: 420, height: 420 },
    points: [
      { id: "A", x: 200, y: 220, derived: false },
      { id: "B", x: 20, y: 280, derived: false },
      { id: "C", x: 380, y: 280, derived: false },
      { id: "D", x: 220, y: 280, derived: false },
      { id: "E", x: 140, y: 160, derived: false },
      { id: "O", x: 160, y: 280, derived: true },
    ],
    segments: [
      { id: "seg-AO", from: "A", to: "O", derived: true },
      { id: "seg-DO", from: "D", to: "O", derived: true },
      { id: "seg-BO", from: "B", to: "O", derived: true },
      { id: "seg-OE", from: "O", to: "E", derived: true },
    ],
  };
}

export interface RuntimeSnapshotOptions {
  participationKind?: string;
  revision?: number;
  workspaceRevision?: number;
  /** workspace_input 时默认挂载合法 active_action；置 false 构造「呈现中未挂载」
   *  负例（必须同时携带 pending_presentation 才能过 §1.3 #8/#11 门禁）。 */
  activeAction?: boolean;
  /** 携带 pending_presentation（voice 交付；Step 6 PresentationRuntime 消费）。 */
  pendingPresentation?: boolean;
  /** 覆写 active_action 的 action_plan（构造 ExercisePlan 校验负例）。 */
  actionPlanOverride?: unknown;
  /** 覆写 active_action 的 target_ids（构造 render geometry 对账负例）。 */
  targetIdsOverride?: string[];
  inquiryReadyToReturn?: boolean;
  /** 显式 turn（committed / revision-conflict 等）。 */
  turn?: Record<string, unknown>;
  /** 顶层字段覆写（question/transcript 等微调）。 */
  overrides?: Record<string, unknown>;
}

/** 队首 voice 交付（presentation_delivery/v1；approved 资源、无 workspace 回执）。 */
export function pendingVoicePresentation(revision: number): Record<string, unknown> {
  return {
    schema: "ai_teaching_presentation_delivery/v1",
    session_id: RUNTIME_SESSION_ID,
    sequence_id: "PS-0001",
    ordinal: 0,
    action_id: "VA-bt01-narrate",
    action: {
      kind: "voice",
      voice_action: {
        action_id: "VA-bt01-narrate",
        decision_id: "TD-seed-0001",
        text: "我们先回顾翻折的基本性质。",
        source: "approved-resource",
        resource_ref: "RES1",
        interruptible: true,
        intent: "narrate",
      },
    },
    session_revision: revision,
  };
}

function mainlineFor(kind: string): Record<string, unknown> {
  if (kind === "read_only_completed") return { kind: "completed" };
  if (kind === "temporarily_paused_for_inquiry") return { kind: "presenting", beat_id: "BT-02" };
  if (kind === "workspace_input") {
    return { kind: "awaiting_workspace", beat_id: "BT-04", gate_id: GATE_BY_KIND[kind], action_id: "tp:TP-SMV-009:1:mark-segment-values-bt04" };
  }
  if (kind === "confirm_input") return { kind: "awaiting_confirmation", beat_id: "BT-01", gate_id: GATE_BY_KIND[kind] };
  if (kind === "answer_input") return { kind: "awaiting_answer", beat_id: "BT-02", gate_id: GATE_BY_KIND[kind] };
  if (kind === "continue_input") return { kind: "ready_to_continue", beat_id: "BT-02", gate_id: GATE_BY_KIND[kind] };
  return { kind: "presenting", beat_id: "BT-01" };
}

/** 完整 SessionSnapshot 线 JSON（f7-tutor-runtime-http/v1）。 */
export function runtimeSnapshotRaw(options: RuntimeSnapshotOptions = {}): Record<string, unknown> {
  const kind = options.participationKind ?? "confirm_input";
  const revision = options.revision ?? 12;
  const workspaceRevision = options.workspaceRevision ?? 3;
  const completed = kind === "read_only_completed";
  const attachActive = kind === "workspace_input" && options.activeAction !== false;
  const attachPending = options.pendingPresentation === true;
  /** view 内嵌 participation（student_workspace_view.participation——无 schema 字段）。 */
  const participationView = {
    kind,
    ...(GATE_BY_KIND[kind] ? { gate_id: GATE_BY_KIND[kind] } : {}),
    ...(kind === "temporarily_paused_for_inquiry" ? { return_checkpoint_id: "BT-02" } : {}),
  };
  /** 独立 views.participation envelope（canonical mainline-participation/v1）。 */
  const participationEnvelope = { schema: "ai_teaching_mainline_participation/v1", ...participationView };
  return {
    profile: "f7-tutor-runtime-http/v1",
    session_id: RUNTIME_SESSION_ID,
    task_id: RUNTIME_TASK_ID,
    revision,
    completed,
    assessment: false,
    question: { artifact_id: "QT-SMV-001", question_type: "fill_blank", stem: "如图，将 △ACD 沿 AD 翻折，求 BE。" },
    views: {
      student_workspace_view: {
        schema: "ai_teaching_student_workspace_view/v1",
        session_id: RUNTIME_SESSION_ID,
        revision: workspaceRevision,
        canvas: { elements: [], interaction_enabled: kind === "workspace_input" },
        solution_board: { mode: "building", groups: [] },
        participation: participationView,
      },
      coach_panel_view: {
        schema: "ai_teaching_coach_panel_view/v1",
        session_id: RUNTIME_SESSION_ID,
        revision,
        mainline: mainlineFor(kind),
        inquiry: options.inquiryReadyToReturn
          ? { kind: "ready_to_return", inquiry_id: `IQ-${RUNTIME_SESSION_ID}-01`, return_checkpoint_id: "BT-02" }
          : { kind: "no_inquiry" },
        teaching_context: { beat_id: "BT-01", waiting_for: "学生确认" },
        assistance_available: true,
        replay_available: true,
        transcript: [{ turn_id: `DT-${RUNTIME_SESSION_ID}-0002`, role: "tutor", content: "识别第一组子母型" }],
      },
      participation: participationEnvelope,
      status: { session_id: RUNTIME_SESSION_ID, session_revision: revision, workspace_revision: workspaceRevision, completed },
    },
    render: { workspace_revision: workspaceRevision, geometry: attachActive ? runtimeGeometry() : null },
    ...(attachPending ? { pending_presentation: pendingVoicePresentation(revision) } : {}),
    ...(attachActive ? {
      active_action: {
        action_id: "tp:TP-SMV-009:1:mark-segment-values-bt04",
        resource_id: "RES8",
        action_ref: "tp:TP-SMV-009:1:mark-segment-values-bt04",
        capability: "similarity.mark-known-segments",
        target_ids: options.targetIdsOverride ?? ["seg-AO", "seg-DO", "seg-BO", "seg-OE"],
        student_view: {
          actionId: "tp:TP-SMV-009:1:mark-segment-values-bt04",
          kind: "mark-segment-values",
          version: 1,
          input: { labels: [], availableSegmentIds: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"], requiredCount: 4, autoFocusSequence: true },
        },
        action_plan: options.actionPlanOverride ?? runtimeActionPlan(),
        form: "operation",
      },
    } : {}),
    ...(options.turn ? { turn: options.turn } : {}),
    ...(completed ? {} : {}),
    ...options.overrides,
  };
}

/** 夹具构造单入口：schema + 一致性门禁 fail closed（非法夹具在此抛错）。 */
export function validRuntimeSnapshot(options: RuntimeSnapshotOptions = {}): SessionSnapshotHttpV1 {
  const result = parseSessionSnapshotHttp(runtimeSnapshotRaw(options));
  if (!result.ok) {
    throw new Error(`runtime snapshot fixture invalid: ${result.errors.join("; ")}`);
  }
  return result.snapshot;
}

/** evidence rejected 评价（pinned typed evaluator 真实结果形态）。 */
export function rejectedEvaluation() {
  return {
    outcome: "rejected" as const,
    evaluation: "wrong" as const,
    revision: 0,
    diagnosis: { messageLatex: "m", wrongObjectIds: ["seg-AO", "seg-DO", "seg-BO", "seg-OE"] },
    phase: "wrong_feedback" as const,
    nextIndex: 0,
  };
}

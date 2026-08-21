/**
 * TutorRuntimeState 投影（Phase 5 / P5-02，PRD 04 §2.2 / ADR-006 §3）。
 *
 * State = f(Approved Plan, append-only SessionEvents) 的纯函数：
 * - 五类子状态：curriculum / dialogue / reasoning（含 assistance 台账）/
 *   workspace / working diagnosis，外加 repair 上下文与失败三分计数；
 * - 不落库、不可跨域写（P5-12：working diagnosis 仅 session-local）；
 * - replay 重建：projectRuntimeState(plan, events)；按 revision 取历史快照用
 *   stateAtRevision（事件 state_revision ≤ 目标值的部分流）；
 * - 台账（P5-11）：assistance 记录每 checkpoint 的 hint 档位、失败尝试、
 *   prompt 次数与 explain 交付，Policy 据此决定下一档帮助且不机械升级。
 */
import type { StoredV2Event, SessionMode, Alignment } from "./TutorSessionEvent";
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";

export interface AssistanceLedger {
  hintLevelsIssued: number[];
  lastHintSequence?: number;
  incorrectSequences: number[];
  failedActionSequences: number[];
  promptsIssued: number;
  /** 每次 prompt 决策的事件 sequence（用于「偏差之后的自查 prompt」判定）。 */
  promptSequences: number[];
  explainedSequences: number[];
}

export interface WorkingDiagnosisEntry {
  summary_code: string;
  candidate_skill_ids?: string[];
  evidence_sequences: number[];
  sequence: number;
}

export interface CurriculumPartState {
  part_id: string;
  route_id: string;
  checkpoint_ids: string[];
  current_index: number;
  completed_checkpoints: string[];
}

export interface DialogueState {
  open_question?: { sequence: number; text: string };
  answered_questions: number[];
  last_voice?: { action_id: string; outcome: string; sequence: number };
}

export interface ReasoningState {
  current_checkpoint_id: string;
  last_alignment?: { alignment: Alignment; checkpoint_id?: string; sequence: number; confidence?: number };
  alternate_path?: { description: string; route_id?: string; sequence: number };
  self_corrections: Array<{ checkpoint_id: string; sequence: number; deviation_sequence: number }>;
  interruptions: number[];
  consecutive_no_progress: number;
}

export interface WorkspaceState {
  action_history: Array<{
    action_id: string;
    decision_id: string;
    capability: string;
    resource_id?: string;
    outcome?: string;
    issued_sequence: number;
  }>;
  active_action_id?: string;
}

export interface RepairContext {
  active: boolean;
  source_checkpoint_id?: string;
  delivered_sequence?: number;
  triggered_by_sequence?: number;
}

export interface FailureLedger {
  policy_failures: number[];
  runtime_failures: number[];
}

export interface TutorRuntimeState {
  session_id: string;
  plan_ref: { artifact_id: string; version: string; content_hash: string };
  initial_mode: SessionMode;
  mode: SessionMode;
  mode_before_repair?: SessionMode;
  revision: number;
  last_sequence: number;
  curriculum: {
    parts: CurriculumPartState[];
    current_part_index: number;
    completed: boolean;
  };
  dialogue: DialogueState;
  reasoning: ReasoningState;
  workspace: WorkspaceState;
  assistance: Record<string, AssistanceLedger>;
  working_diagnosis: WorkingDiagnosisEntry[];
  repair: RepairContext;
  failures: FailureLedger;
  completed: boolean;
}

function emptyLedger(): AssistanceLedger {
  return {
    hintLevelsIssued: [],
    incorrectSequences: [],
    failedActionSequences: [],
    promptsIssued: 0,
    promptSequences: [],
    explainedSequences: [],
  };
}

/** plan 的 primary 路线按 part 建立课程序（与 materializer 的 part 结构一致）。 */
function initialCurriculum(plan: TutorPlanV2Payload): CurriculumPartState[] {
  const partIds = Array.from(new Set(plan.checkpoints.map((checkpoint) => checkpoint.part_id)));
  return partIds.map((partId) => {
    const primary = plan.recommended_routes.find(
      (route) => route.role === "primary" && (route.part_id ?? "1") === partId,
    );
    const checkpointIds = primary
      ? primary.checkpoint_ids
      : plan.checkpoints.filter((c) => c.part_id === partId).map((c) => c.checkpoint_id);
    return {
      part_id: partId,
      route_id: primary?.route_id ?? "R1",
      checkpoint_ids: checkpointIds,
      current_index: 0,
      completed_checkpoints: [],
    };
  });
}

function firstCheckpointOf(state: TutorRuntimeState): string {
  const part = state.curriculum.parts[state.curriculum.current_part_index];
  if (!part) return "CP1";
  return part.checkpoint_ids[Math.min(part.current_index, part.checkpoint_ids.length - 1)] ?? "CP1";
}

function applyEvent(plan: TutorPlanV2Payload, state: TutorRuntimeState, event: StoredV2Event): void {
  state.revision = event.state_revision;
  state.last_sequence = event.sequence;
  const payload = event.payload as unknown as Record<string, unknown>;

  switch (event.event_type) {
    case "session_started": {
      state.mode = (payload.initial_mode as SessionMode) ?? "teach";
      state.initial_mode = state.mode;
      break;
    }
    case "mode_changed": {
      const toMode = payload.to_mode as SessionMode;
      if (state.mode === "repair" && toMode !== "repair") {
        // 修复完成退出：清空 repair 上下文（P5-03 完成后回原 checkpoint）。
        state.repair = { active: false };
        state.mode_before_repair = undefined;
      } else if (toMode === "repair" && state.mode !== "repair") {
        state.mode_before_repair = state.mode;
        state.repair = { active: true, source_checkpoint_id: state.reasoning.current_checkpoint_id };
      }
      state.mode = toMode;
      break;
    }
    case "student_input_recorded": {
      state.reasoning.consecutive_no_progress =
        payload.input_kind === "silence_observed" ? state.reasoning.consecutive_no_progress + 1 : 0;
      if (payload.input_kind === "question_asked" && typeof payload.text === "string") {
        state.dialogue.open_question = { sequence: event.sequence, text: payload.text };
      }
      break;
    }
    case "reasoning_aligned": {
      const alignment = payload.alignment as Alignment;
      const checkpointId = (payload.checkpoint_id as string | undefined) ?? state.reasoning.current_checkpoint_id;
      const confidence = payload.confidence as number | undefined;
      state.reasoning.last_alignment = {
        alignment,
        checkpoint_id: checkpointId,
        sequence: event.sequence,
        ...(typeof confidence === "number" ? { confidence } : {}),
      };
      if (alignment === "alternate_valid") {
        // 缺陷修复（Phase 5 remediation）：alternate route 真正落状态的前半——
        // 先在 alternate_path 上挂路线 id：v3 事件显式携带；v2 事件从 plan 推导
        // （entry 命中 = 该 part 备选路线的首节点）。student_progressed 据此切换。
        const explicitRouteId = typeof payload.route_id === "string" ? payload.route_id : undefined;
        const checkpointPartId = plan.checkpoints.find(
          (entry) => entry.checkpoint_id === checkpointId,
        )?.part_id;
        const derivedRouteId = explicitRouteId
          ? undefined
          : plan.recommended_routes.find(
              (route) =>
                route.role === "alternate" &&
                (route.part_id ?? "1") === (checkpointPartId ?? "1") &&
                route.checkpoint_ids[0] === checkpointId,
            )?.route_id;
        state.reasoning.alternate_path = {
          description: (payload.alternate_description as string | undefined) ?? "",
          sequence: event.sequence,
          ...({ route_id: explicitRouteId ?? derivedRouteId } as { route_id?: string }),
        };
        if (!state.reasoning.alternate_path.route_id) delete state.reasoning.alternate_path.route_id;
      }
      if (alignment === "incorrect") {
        const ledger = (state.assistance[checkpointId] ??= emptyLedger());
        if (payload.checkpoint_id === undefined || payload.checkpoint_id === state.reasoning.current_checkpoint_id) {
          ledger.incorrectSequences.push(event.sequence);
        } else {
          ledger.incorrectSequences.push(event.sequence);
        }
      }
      if (alignment === "no_progress") {
        state.reasoning.consecutive_no_progress = Math.max(state.reasoning.consecutive_no_progress, 1);
      }
      break;
    }
    case "tutor_move_decided": {
      const moveType = payload.move_type as string;
      const checkpointId = (payload.checkpoint_id as string | undefined) ?? state.reasoning.current_checkpoint_id;
      const ledger = (state.assistance[checkpointId] ??= emptyLedger());
      if (moveType === "prompt") {
        ledger.promptsIssued += 1;
        ledger.promptSequences.push(event.sequence);
      }
      if (moveType === "explain") ledger.explainedSequences.push(event.sequence);
      // 缺陷修复（Phase 5 remediation）：教师答问交付即关闭 open question——
      // 学生提问是 dialogue 事实，回答 move 落地后不得残留为未处理。
      if (payload.purpose_code === "explain.answer_question" && state.dialogue.open_question) {
        state.dialogue.answered_questions.push(state.dialogue.open_question.sequence);
        state.dialogue.open_question = undefined;
      }
      break;
    }
    case "hint_issued": {
      const checkpointId = payload.checkpoint_id as string;
      const ledger = (state.assistance[checkpointId] ??= emptyLedger());
      const level = payload.level as number;
      if (!ledger.hintLevelsIssued.includes(level)) ledger.hintLevelsIssued.push(level);
      ledger.lastHintSequence = event.sequence;
      break;
    }
    case "student_progressed": {
      const checkpointId = payload.checkpoint_id as string;
      const partIndex = state.curriculum.parts.findIndex((part) => part.checkpoint_ids.includes(checkpointId));
      if (partIndex >= 0) {
        const part = state.curriculum.parts[partIndex];
        // 缺陷修复（Phase 5 remediation）：alternate route 真正落状态——学生沿
        // 备选路线推进时，把该 part 的课程序切换到 Plan 批准的备选路线
        // （checkpoint 顺序与完成判定都按新路线算，不只是推进 primary 节点）。
        const alternateRouteId =
          payload.via_alternate === true ? state.reasoning.alternate_path?.route_id : undefined;
        const alternateRoute = alternateRouteId
          ? plan.recommended_routes.find(
              (route) => route.route_id === alternateRouteId && (route.part_id ?? "1") === part.part_id,
            )
          : undefined;
        if (alternateRoute) {
          part.route_id = alternateRoute.route_id;
          part.checkpoint_ids = [...alternateRoute.checkpoint_ids];
        }
        if (!part.completed_checkpoints.includes(checkpointId)) {
          part.completed_checkpoints.push(checkpointId);
        }
        const advancedIndex = part.checkpoint_ids.indexOf(checkpointId) + 1;
        part.current_index = Math.max(part.current_index, advancedIndex);
        state.curriculum.current_part_index = partIndex;
        if (part.current_index >= part.checkpoint_ids.length) {
          const next = state.curriculum.parts.findIndex(
            (candidate) => candidate.current_index < candidate.checkpoint_ids.length,
          );
          state.curriculum.current_part_index = next >= 0 ? next : partIndex;
          state.curriculum.completed = next < 0;
        }
        state.reasoning.current_checkpoint_id = firstCheckpointOf(state);
        state.reasoning.consecutive_no_progress = 0;
      }
      state.reasoning.alternate_path = undefined;
      state.dialogue.open_question = undefined;
      break;
    }
    case "student_self_corrected": {
      const checkpointId = payload.checkpoint_id as string;
      state.reasoning.self_corrections.push({
        checkpoint_id: checkpointId,
        sequence: event.sequence,
        deviation_sequence: payload.deviation_sequence as number,
      });
      break;
    }
    case "voice_action_issued": {
      // 呈现issued：等待完成结果（dialogue.last_voice 由 completed 落定）。
      break;
    }
    case "voice_action_completed": {
      state.dialogue.last_voice = {
        action_id: payload.action_id as string,
        outcome: payload.outcome as string,
        sequence: event.sequence,
      };
      if (payload.outcome === "interrupted") {
        state.reasoning.interruptions.push(event.sequence);
      }
      break;
    }
    case "workspace_action_issued": {
      // canonical 合同：command_payload 是 JSON 字符串（读取侧统一反序列化）。
      const rawCommand = payload.command_payload;
      const command = (
        typeof rawCommand === "string" ? (JSON.parse(rawCommand) as Record<string, unknown>) : ((rawCommand ?? {}) as Record<string, unknown>)
      );
      state.workspace.action_history.push({
        action_id: payload.action_id as string,
        decision_id: payload.decision_id as string,
        capability: payload.capability as string,
        resource_id: command.resource_id as string | undefined,
        issued_sequence: event.sequence,
      });
      state.workspace.active_action_id = payload.action_id as string;
      break;
    }
    case "workspace_action_completed": {
      const entry = state.workspace.action_history.find(
        (item) => item.action_id === payload.action_id && item.outcome === undefined,
      );
      if (entry) entry.outcome = payload.outcome as string;
      if (state.workspace.active_action_id === payload.action_id && payload.outcome !== "rejected") {
        state.workspace.active_action_id = undefined;
      }
      break;
    }
    case "working_diagnosis_updated": {
      state.working_diagnosis.push({
        summary_code: payload.summary_code as string,
        ...(Array.isArray(payload.candidate_skill_ids)
          ? { candidate_skill_ids: payload.candidate_skill_ids as string[] }
          : {}),
        evidence_sequences: payload.evidence_sequences as number[],
        sequence: event.sequence,
      });
      break;
    }
    case "repair_delivered": {
      state.repair = {
        active: true,
        source_checkpoint_id: payload.source_checkpoint_id as string,
        delivered_sequence: event.sequence,
        triggered_by_sequence: state.assistance[payload.source_checkpoint_id as string]?.incorrectSequences.at(-1),
      };
      break;
    }
    case "policy_failed": {
      state.failures.policy_failures.push(event.sequence);
      break;
    }
    case "runtime_failure": {
      state.failures.runtime_failures.push(event.sequence);
      break;
    }
    case "session_completed": {
      state.completed = true;
      break;
    }
    default:
      break;
  }
}

/** 全量 replay：从 plan + events 重建 TutorRuntimeState（无快照，纯投影）。 */
export function projectRuntimeState(
  plan: TutorPlanV2Payload,
  events: readonly StoredV2Event[],
): TutorRuntimeState {
  const started = events.find((event) => event.event_type === "session_started");
  if (!started) {
    throw new Error("cannot project state: session_started event missing");
  }
  const startPayload = started.payload as { plan: TutorRuntimeState["plan_ref"]; initial_mode: SessionMode };
  const state: TutorRuntimeState = {
    session_id: started.session_id,
    plan_ref: startPayload.plan,
    initial_mode: startPayload.initial_mode,
    mode: startPayload.initial_mode,
    revision: 0,
    last_sequence: 0,
    curriculum: { parts: initialCurriculum(plan), current_part_index: 0, completed: false },
    dialogue: { answered_questions: [] },
    reasoning: {
      current_checkpoint_id: "",
      self_corrections: [],
      interruptions: [],
      consecutive_no_progress: 0,
    },
    workspace: { action_history: [] },
    assistance: {},
    working_diagnosis: [],
    repair: { active: false },
    failures: { policy_failures: [], runtime_failures: [] },
    completed: false,
  };
  state.reasoning.current_checkpoint_id = firstCheckpointOf(state);
  for (const event of events) {
    applyEvent(plan, state, event);
  }
  return state;
}

/** 历史 revision 的状态快照（gate：event replay 可重建任意时点五类 state）。 */
export function stateAtRevision(
  plan: TutorPlanV2Payload,
  events: readonly StoredV2Event[],
  revision: number,
): TutorRuntimeState {
  return projectRuntimeState(plan, events.filter((event) => event.state_revision <= revision));
}

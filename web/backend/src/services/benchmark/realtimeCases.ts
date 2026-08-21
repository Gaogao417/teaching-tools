/**
 * C-RT deterministic realtime cases（Phase 5 评测接入，evaluation-scope realtime 阶段）。
 *
 * 5 个 case（evaluation-scope.yaml 冻结定义），输入是 Phase 4 真实产物
 * （canonical Approved TutorPlan v2）+ Phase 5 scripted closed-loop runner：
 *
 * - C-RT-01（QT-SMV-003）Teach 提问打断 → Policy 修复并回原 checkpoint；
 * - C-RT-02（QT-SMV-004）正确口述 → Confirm → Workspace action 来源一致；
 * - C-RT-03（QT-SMV-001）错误 → L1 → 未推进 → L2 → 推进（state revision/因果断言）；
 * - C-RT-04（QT-SMV-005）学生自我修正（StudentSelfCorrected，非 Tutor 纠正）；
 * - C-RT-05（QT-SMV-002）alternate valid 接受 / action 失败进安全 Repair 后回 checkpoint。
 *
 * 判定全部确定性（scripted runner + 事件序列断言），不调模型、不依赖 live voice
 * （scope 冻结口径：scripted 先行，live 不阻塞 MVP）。
 */
import { createHash } from "node:crypto";

import { benchmarkRunSchema, validatePayload } from "../../../../shared/canonical";
import { loadCurrentPlan, type TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorSessionCoordinator } from "../tutorSession/TutorSession";
import type { StoredV2Event } from "../tutorSession/TutorSessionEvent";

export const REALTIME_RUNNER_VERSION = "benchmark-runner-realtime-0.1.0";

export const GOLDEN_TP_BY_QT: Record<string, string> = {
  "QT-SMV-001": "TP-SMV-001",
  "QT-SMV-002": "TP-SMV-002",
  "QT-SMV-003": "TP-SMV-003",
  "QT-SMV-004": "TP-SMV-004",
  "QT-SMV-005": "TP-SMV-005",
  "QT-SMV-006": "TP-SMV-006",
};

export interface RealtimeCaseResult {
  case_id: string;
  stage: "realtime";
  status: "pass" | "fail";
  failure_class?: string;
  metrics?: { detail?: string };
}

export interface RealtimeInputs {
  canonicalRoot: string;
}

const FAILURE = {
  missingInput: "input_missing",
  trajectory: "trajectory_assertion_failed",
  causality: "causality_assertion_failed",
} as const;

function fail(caseId: string, failureClass: string, detail: string): RealtimeCaseResult {
  return { case_id: caseId, stage: "realtime", status: "fail", failure_class: failureClass, metrics: { detail } };
}

function pass(caseId: string, detail?: string): RealtimeCaseResult {
  return { case_id: caseId, stage: "realtime", status: "pass", ...(detail ? { metrics: { detail } } : {}) };
}

// --------------------------------------------------------------------------- //
// scripted 场景工具（与 acceptanceScripts 同源逻辑，输入全部由 plan 数据派生）
// --------------------------------------------------------------------------- //

async function turn(
  c: TutorSessionCoordinator,
  sid: string,
  options?: { completeVoice?: boolean },
): Promise<{ move?: string; purpose?: string }> {
  const result = await c.driveTutorTurn(sid);
  if (options?.completeVoice !== false) {
    for (const voice of result.presentation.voice) {
      c.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }
  }
  return { move: result.decision?.move_type, purpose: result.decision?.purpose_code };
}

async function teachOpening(c: TutorSessionCoordinator, sid: string): Promise<void> {
  await turn(c, sid);
  await turn(c, sid);
}

function expectedText(plan: TutorPlanV2Payload, checkpointId: string): string {
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  if (!checkpoint) throw new Error(`checkpoint ${checkpointId} 缺失`);
  return checkpoint.expected_reasoning;
}

function deviationText(plan: TutorPlanV2Payload, partId: string): string {
  void partId;
  // 题目级陷阱清单：全题取材（golden plan 的错因集中在后段 part）。
  const checkpoint = plan.checkpoints.find((entry) => (entry.common_deviations ?? []).length > 0);
  const deviation = checkpoint?.common_deviations?.[0];
  if (!deviation) throw new Error("plan 无 common_deviations");
  return deviation;
}

function actionTemplateOf(plan: TutorPlanV2Payload, partId: string) {
  const checkpointIds = plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id);
  const resource = plan.resources.find(
    (entry) => entry.kind === "action_template" && entry.checkpoint_id && checkpointIds.includes(entry.checkpoint_id),
  );
  if (!resource) throw new Error(`part ${partId} 无 action_template`);
  return resource;
}

function decisionsOf(c: TutorSessionCoordinator, sid: string) {
  return c
    .getEvents(sid)
    .filter((event) => event.event_type === "tutor_move_decided")
    .map((event) => event.payload as {
      decision_id: string;
      move_type: string;
      purpose_code: string;
      checkpoint_id?: string;
      source_event_sequence: number;
      source_state_revision: number;
    });
}

/** gate 3 因果合同：决策必须关联存在的 source event 与 state revision。 */
function assertDecisionCausality(events: readonly StoredV2Event[]): void {
  const decisions = events.filter((event) => event.event_type === "tutor_move_decided");
  if (!decisions.length) throw new Error("无决策事件");
  for (const decision of decisions) {
    const payload = decision.payload as { source_event_sequence: number; source_state_revision: number };
    if (!events.some((event) => event.sequence === payload.source_event_sequence)) {
      throw new Error(`决策 ${payload.source_event_sequence} 引用不存在的 source event`);
    }
    if (!(payload.source_state_revision >= 0)) throw new Error("source_state_revision 非法");
  }
}

// --------------------------------------------------------------------------- //
// 5 个 case
// --------------------------------------------------------------------------- //

async function runInterruptionRepairCase(c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string): Promise<string> {
  c.start({ sessionId: sid, studentId: "c-rt-01", tpId: plan.artifact_id });
  await turn(c, sid, { completeVoice: false }); // explain.open 播放中
  c.recordStudentInput(sid, { input_kind: "student_interrupted" });
  const partId = plan.checkpoints[0].part_id;
  c.recordStudentInput(sid, { input_kind: "question_asked", text: `老师，${deviationText(plan, partId)}这样行吗？` });
  const interrupted = c.getEvents(sid).some(
    (event) =>
      event.event_type === "voice_action_completed" && (event.payload as { outcome: string }).outcome === "interrupted",
  );
  if (!interrupted) throw new Error("打断未记 interrupted");
  const answer = await turn(c, sid);
  if (answer.purpose !== "explain.answer_question") throw new Error(`问题未用 Explain 回答（${answer.purpose}）`);
  const follow = await turn(c, sid);
  if (!["prompt.verify_after_question", "prompt.hand_over"].includes(follow.purpose ?? "")) {
    throw new Error(`回答后分支非法（${follow.purpose}）`);
  }
  // verify/hand_over 后继续挣扎到修复
  await turn(c, sid);
  let guard = 0;
  let recovered = false;
  while (guard < 8 && !recovered) {
    guard += 1;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: deviationText(plan, partId) });
    const step = await turn(c, sid);
    if (step.move === "repair") {
      const repairDelivered = c.getEvents(sid).find((event) => event.event_type === "repair_delivered");
      const sourceCheckpoint = (repairDelivered!.payload as { source_checkpoint_id: string }).source_checkpoint_id;
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedText(plan, sourceCheckpoint) });
      const recovery = await turn(c, sid);
      if (recovery.purpose !== "confirm.repair_complete") throw new Error(`修复完成确认非法（${recovery.purpose}）`);
      const modeBack = c
        .getEvents(sid)
        .some(
          (event) =>
            event.sequence > repairDelivered!.sequence &&
            event.event_type === "mode_changed" &&
            (event.payload as { to_mode: string }).to_mode !== "repair",
        );
      if (!modeBack) throw new Error("修复完成未退出 repair mode");
      recovered = true;
    }
  }
  if (!recovered) throw new Error("8 轮内未走到 Repair");
  assertDecisionCausality(c.getEvents(sid));
  return "打断→interrupted→Explain 回答→阶梯→Repair→恢复";
}

async function runCorrectPathCase(c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string): Promise<string> {
  c.start({ sessionId: sid, studentId: "c-rt-02", tpId: plan.artifact_id });
  await teachOpening(c, sid);
  const partId = plan.checkpoints[0].part_id;
  const partCheckpointIds = plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id);
  const actionCheckpoint = actionTemplateOf(plan, partId).checkpoint_id ?? partCheckpointIds.at(-1)!;
  for (const checkpointId of partCheckpointIds) {
    if (checkpointId === actionCheckpoint) break;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedText(plan, checkpointId) });
    await turn(c, sid);
    await turn(c, sid);
  }
  const state = c.restore(sid);
  if (!state.workspace.active_action_id) throw new Error("action 节点未派发 workspace action");
  const issued = c
    .getEvents(sid)
    .find((event) => event.event_type === "workspace_action_issued")!;
  const payload = issued.payload as { capability: string; decision_id: string; command_payload?: string };
  const command = JSON.parse(payload.command_payload ?? "{}") as { resource_id?: string };
  if (payload.capability !== plan.policy_constraints.allowed_capabilities[0]) {
    throw new Error("workspace capability 与 plan allowlist 不一致");
  }
  if (command.resource_id !== actionTemplateOf(plan, partId).resource_id) {
    throw new Error("workspace action 来源资源不一致");
  }
  const decisionOf = decisionsOf(c, sid).find((decision) => decision.decision_id === payload.decision_id);
  if (!decisionOf) throw new Error("workspace action 未关联 TutorDecision");
  const template = JSON.parse(actionTemplateOf(plan, partId).content ?? "{}") as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput: { expectedValues: string[] };
  };
  const submitted = c.submitActionEvidence(sid, {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind as never,
    version: 1,
    value: template.teachingInput.expectedValues[0],
  });
  if (!submitted.accepted) throw new Error("正确操作证据被拒");
  assertDecisionCausality(c.getEvents(sid));
  return "口述正确→Confirm→action_step→typed evaluator 接受";
}

async function runHintLadderCase(c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string): Promise<string> {
  c.start({ sessionId: sid, studentId: "c-rt-03", tpId: plan.artifact_id });
  await teachOpening(c, sid);
  const partId = plan.checkpoints[0].part_id;
  const deviation = deviationText(plan, partId);
  const purposes: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: deviation });
    purposes.push((await turn(c, sid)).purpose ?? "");
  }
  if (purposes[0] !== "prompt.self_check") throw new Error(`首错应 Prompt 自查（${purposes[0]}）`);
  if (purposes[1] !== "hint.escalate" || purposes[2] !== "hint.escalate") {
    throw new Error(`阶梯应为 L1→L2（${purposes.slice(1).join(",")}）`);
  }
  const hints = c
    .getEvents(sid)
    .filter((event) => event.event_type === "hint_issued")
    .map((event) => event.payload as { level: number; checkpoint_id: string });
  if (hints.map((hint) => hint.level).join(",") !== "1,2") throw new Error("hint 档位非 1→2");
  const hintCheckpoint = hints[0].checkpoint_id;
  c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedText(plan, hintCheckpoint) });
  const confirm = await turn(c, sid);
  if (confirm.move !== "confirm") throw new Error("推进后应 Confirm");
  const events = c.getEvents(sid);
  const progressed = events.find(
    (event) => event.event_type === "student_progressed" && (event.payload as { checkpoint_id: string }).checkpoint_id === hintCheckpoint,
  );
  if (!progressed) throw new Error("未在 hint 同一 checkpoint 推进");
  // 修复（Phase 5 remediation）：原为空断言——现在真实核对 decision 的因果源。
  const decision = decisionsOf(c, sid).at(-1)!;
  const alignment = events.find(
    (event) => event.sequence === (progressed.causation_sequence ?? -1),
  );
  if (!alignment || alignment.event_type !== "reasoning_aligned") {
    throw new Error("progressed 的 causation 必须指向对齐事件");
  }
  if (decision.source_event_sequence !== alignment.sequence) {
    throw new Error(
      `决策 source_event_sequence=${decision.source_event_sequence} 必须等于对齐事件 ${alignment.sequence}`,
    );
  }
  if (decision.source_state_revision !== alignment.state_revision) {
    throw new Error(
      `决策 source_state_revision=${decision.source_state_revision} 必须等于对齐事件所在 revision ${alignment.state_revision}`,
    );
  }
  assertDecisionCausality(events);
  return "错误→prompt→L1→L2→推进（档位/同 checkpoint/因果链）";
}

async function runSelfCorrectionCase(c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string): Promise<string> {
  c.start({ sessionId: sid, studentId: "c-rt-04", tpId: plan.artifact_id });
  await teachOpening(c, sid);
  const partId = plan.checkpoints[0].part_id;
  const partCheckpointIds = plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id);
  const actionCheckpoint = actionTemplateOf(plan, partId).checkpoint_id ?? partCheckpointIds.at(-1)!;
  // QT-SMV-005 无 authored common_deviations：自我修正走操作证据路径
  // （错误操作 → Prompt 自查 → 学生改对），与 utterance 路径同一事实合同。
  for (const checkpointId of partCheckpointIds) {
    if (checkpointId === actionCheckpoint) break;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedText(plan, checkpointId) });
    await turn(c, sid);
    await turn(c, sid);
  }
  const state = c.restore(sid);
  if (!state.workspace.active_action_id) await turn(c, sid);
  if (!c.restore(sid).workspace.active_action_id) throw new Error("action 节点未派发");
  const template = JSON.parse(actionTemplateOf(plan, partId).content ?? "{}") as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput: { expectedValues: string[] };
  };
  const evidence = {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind as "enter-text",
    version: 1 as const,
    value: template.teachingInput.expectedValues[0],
  };
  const wrong = c.submitActionEvidence(sid, { ...evidence, value: "显然无关的错误操作" });
  if (wrong.accepted) throw new Error("错误操作不应被接受");
  const nudge = await turn(c, sid);
  if (nudge.move !== "prompt") throw new Error(`错误操作后应 Prompt 自查（${nudge.move}）`);
  const corrected = c.submitActionEvidence(sid, evidence);
  if (!corrected.accepted) throw new Error("学生改对后操作未被接受");
  const confirm = await turn(c, sid);
  const events = c.getEvents(sid);
  const selfCorrected = events.find((event) => event.event_type === "student_self_corrected");
  if (!selfCorrected) throw new Error("自我修正事实缺失");
  const between = events.filter(
    (event) =>
      event.event_type === "tutor_move_decided" &&
      event.sequence > (selfCorrected.payload as { deviation_sequence: number }).deviation_sequence &&
      event.sequence < selfCorrected.sequence,
  );
  if (!between.every((event) => (event.payload as { move_type: string }).move_type === "prompt")) {
    throw new Error("偏差与修正之间出现了非 Prompt 教学（记为 Tutor 纠正）");
  }
  if (confirm.purpose !== "confirm.self_correction") throw new Error(`确认目的应区分自我修正（${confirm.purpose}）`);
  assertDecisionCausality(events);
  return "StudentSelfCorrected（操作证据路径）+ 非 Tutor 纠正";
}

async function runAlternateAndActionRepairCase(c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string): Promise<string> {
  c.start({ sessionId: sid, studentId: "c-rt-05", tpId: plan.artifact_id });
  await teachOpening(c, sid);
  const partId = plan.checkpoints[0].part_id;
  const partCheckpointIds = plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id);
  const actionCheckpoint = actionTemplateOf(plan, partId).checkpoint_id ?? partCheckpointIds.at(-1)!;
  const actionIndex = partCheckpointIds.indexOf(actionCheckpoint);
  const staging = actionIndex > 0 ? partCheckpointIds[actionIndex - 1] : actionCheckpoint;

  let guard = 0;
  while (c.restore(sid).reasoning.current_checkpoint_id !== staging && guard < 10) {
    guard += 1;
    const cp = c.restore(sid).reasoning.current_checkpoint_id;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedText(plan, cp) });
    await turn(c, sid);
    await turn(c, sid);
  }
  const alternateRoute = plan.recommended_routes.find(
    (route) => route.role === "alternate" && (route.part_id ?? "1") === partId && route.entry_condition,
  );
  if (!alternateRoute) throw new Error("无备选路线可演练");
  c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: alternateRoute.entry_condition! });
  const alternateConfirm = await turn(c, sid);
  if (alternateConfirm.purpose !== "confirm.alternate_path") throw new Error(`alternate 未被接受（${alternateConfirm.purpose}）`);
  const alternateAligned = c
    .getEvents(sid)
    .find(
      (event) => event.event_type === "reasoning_aligned" && (event.payload as { alignment: string }).alignment === "alternate_valid",
    );
  if (!alternateAligned) throw new Error("alternate 输入被判错");

  // 到 action 节点，操作失败进安全 Repair，再恢复
  await turn(c, sid);
  const state = c.restore(sid);
  if (!state.workspace.active_action_id) throw new Error("action 节点未派发");
  const template = JSON.parse(actionTemplateOf(plan, partId).content ?? "{}") as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput: { expectedValues: string[] };
  };
  const evidence = {
    actionId: template.actionId,
    sourceStepId: template.sourceStepId,
    kind: template.kind as "enter-text",
    version: 1 as const,
    value: template.teachingInput.expectedValues[0],
  };
  let repaired = false;
  guard = 0;
  while (guard < 6 && !repaired) {
    guard += 1;
    const wrong = c.submitActionEvidence(sid, { ...evidence, value: "毫不相关的错误操作" });
    if (wrong.accepted) throw new Error("错误操作不应被接受");
    const step = await turn(c, sid);
    if (step.move === "repair") {
      const repairDelivered = c.getEvents(sid).find((event) => event.event_type === "repair_delivered")!;
      const sourceCheckpoint = (repairDelivered.payload as { source_checkpoint_id: string }).source_checkpoint_id;
      const recoveryEvidence = c.submitActionEvidence(sid, evidence);
      if (!recoveryEvidence.accepted) throw new Error("修复后正确操作未被接受");
      const recovery = await turn(c, sid);
      if (recovery.purpose !== "confirm.repair_complete") throw new Error(`修复完成确认非法（${recovery.purpose}）`);
      void sourceCheckpoint;
      repaired = true;
    }
  }
  if (!repaired) throw new Error("操作失败未进入安全 Repair");
  // 学生错误操作不得产生 workspace rejected（工具拒绝≠学生错误）
  const rejected = c
    .getEvents(sid)
    .filter(
      (event) => event.event_type === "workspace_action_completed" && (event.payload as { outcome: string }).outcome === "rejected",
    );
  if (rejected.length > 0) throw new Error("学生操作失败被误记为工具 rejected");
  assertDecisionCausality(c.getEvents(sid));
  return "alternate 接受→操作失败→Repair→正确操作恢复";
}

// --------------------------------------------------------------------------- //
// runner
// --------------------------------------------------------------------------- //

export interface RealtimeRunInput {
  runId: string;
  sutId: string;
  datasetId: string;
  datasetVersion: string;
  inputs: RealtimeInputs & { coordinator: TutorSessionCoordinator; nextSessionId: () => string };
  startedAt?: string;
}

export type RealtimeRunResult =
  | { ok: true; record: Record<string, unknown> }
  | { ok: false; errors: readonly string[] };

export async function buildRealtimeRun(input: RealtimeRunInput): Promise<RealtimeRunResult> {
  const { coordinator, nextSessionId, canonicalRoot } = input.inputs;
  const results: RealtimeCaseResult[] = [];
  const load = (qtId: string): TutorPlanV2Payload | null => {
    const tpId = GOLDEN_TP_BY_QT[qtId];
    const result = loadCurrentPlan({ canonicalRoot }, tpId);
    return result.ok ? result.payload : null;
  };
  const scenarios: Array<[string, string, (c: TutorSessionCoordinator, plan: TutorPlanV2Payload, sid: string) => Promise<string>]> = [
    ["C-RT-01", "QT-SMV-003", runInterruptionRepairCase],
    ["C-RT-02", "QT-SMV-004", runCorrectPathCase],
    ["C-RT-03", "QT-SMV-001", runHintLadderCase],
    ["C-RT-04", "QT-SMV-005", runSelfCorrectionCase],
    ["C-RT-05", "QT-SMV-002", runAlternateAndActionRepairCase],
  ];
  for (const [caseId, qtId, scenario] of scenarios) {
    const plan = load(qtId);
    if (!plan) {
      results.push(fail(caseId, FAILURE.missingInput, `${qtId} 的 Approved TutorPlan 缺失`));
      continue;
    }
    try {
      const detail = await scenario(coordinator, plan, nextSessionId());
      results.push(pass(caseId, detail));
    } catch (error) {
      results.push(fail(caseId, FAILURE.trajectory, error instanceof Error ? error.message : String(error)));
    }
  }

  const passed = results.filter((result) => result.status === "pass").length;
  const failed = results.filter((result) => result.status === "fail").length;
  const configHash = createHash("sha256")
    .update(JSON.stringify({ runner: REALTIME_RUNNER_VERSION, dataset: input.datasetId }))
    .digest("hex");
  const record = {
    schema: "ai_teaching_benchmark_run/v1",
    run_id: input.runId,
    dataset_id: input.datasetId,
    dataset_version: input.datasetVersion,
    sut: {
      sut_id: input.sutId,
      config_hash: `sha256:${configHash}`,
      config_artifact_uri: `artifact://sut-config/${input.sutId.replace(/^sut-/, "")}@v1`,
    },
    status: "completed",
    case_results: results,
    runner_version: REALTIME_RUNNER_VERSION,
    environment: `node ${process.version}`,
    started_at: input.startedAt ?? new Date().toISOString(),
    completed_at: new Date().toISOString(),
    summary: { passed, failed, errored: 0, not_executed: 0 },
  };
  const validation = validatePayload(record);
  if (!validation.ok) return { ok: false, errors: validation.errors };
  benchmarkRunSchema.parse(record);
  return { ok: true, record };
}

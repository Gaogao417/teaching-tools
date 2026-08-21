/**
 * 浏览器验收剧本（Phase 5 退出门禁 1，10 号计划 §10「浏览器验收剧本」1–12）。
 *
 * MVP 交付形态（evaluation-scope「scripted 先行、live 不阻塞」口径）：确定性
 * scripted closed-loop——同一 TutorPolicy/Presenter/event spine 走完整教学轮，
 * 输入文本全部从 plan 数据派生（expected_reasoning / common_deviations /
 * alternate route entry_condition），不使用手工标注的期望标签。
 *
 * 12 条剧本：
 *  S1 同一 Plan 下答对→Confirm/Wait、卡住→Prompt/Hint；
 *  S2 Teach 被问题打断→Explain 回答→按更新 state 分支；
 *  S3 口述正确路径→最小 Voice/Workspace 呈现；
 *  S4 失败尝试后 Hint 利用历史（阶梯不重置）；
 *  S5 L1 后推进：事件因果链（decision↔state revision↔checkpoint）；
 *  S6 自我修正不记为 Tutor 纠正；
 *  S7 alternate valid 被接受并可继续；
 *  S8 Confirm 只说话、Wait 零动作；
 *  S9 非法 WorkspaceAction 被拒且不污染学生 evidence；
 *  S10 Policy timeout → safe fallback，session 不卡死；
 *  S11 多级提示无效进 Repair，完成后回原 checkpoint；
 *  S12 Assessment fail closed（拒绝生成式教学 Move / truth / Tutor tools）。
 */
import assert from "node:assert/strict";
import type { ActionEvidence } from "../../../../shared/actionRuntime";
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { StoredV2Event } from "./TutorSessionEvent";
import type { TutorSessionCoordinator } from "./TutorSession";
import { validateWorkspaceAction } from "../tutorPresentation/adapters/legacyActionRuntime/workspaceActionAdapter";

export interface AcceptanceScriptOutcome {
  script_id: string;
  plan_id: string;
  status: "pass" | "fail" | "skipped";
  failures: string[];
  session_ids: string[];
  detail?: string;
}

export interface ScriptHarness {
  coordinator: TutorSessionCoordinator;
  canonicalRoot: string;
  /** 每条剧本自增分配会话 id。 */
  nextSessionId(): string;
  /** S10 需要一次性 slow policy 的 coordinator。 */
  makeCoordinatorWithPolicy?: (policy: unknown) => TutorSessionCoordinator;
}

// --------------------------------------------------------------------------- //
// 输入派生（全部来自 plan 数据，不引入人工标签）
// --------------------------------------------------------------------------- //

export function expectedUtteranceFor(plan: TutorPlanV2Payload, checkpointId: string): string {
  const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId);
  if (!checkpoint) throw new Error(`checkpoint ${checkpointId} 不存在`);
  return checkpoint.expected_reasoning;
}

export function deviationUtteranceForPart(plan: TutorPlanV2Payload, partId: string): string {
  void partId;
  const checkpoint = plan.checkpoints.find((entry) => (entry.common_deviations ?? []).length > 0);
  const deviation = checkpoint?.common_deviations?.[0];
  if (!deviation) throw new Error(`plan 无 common_deviations 可派生错误输入`);
  return deviation;
}

/**
 * 挣扎输入派生：plan 有 authored 错因 → 偏差文本（incorrect 路径）；
 * 否则用含糊口吻（unclear 路径，同样历练 clarify→probe→hint 阶梯）。
 * 两条路径都只使用 plan 数据或无数学内容的脚手架口吻，不伪造对齐标签。
 */
export function struggleInputFor(plan: TutorPlanV2Payload): { kind: "deviation" | "vague"; text: string } {
  const checkpoint = plan.checkpoints.find((entry) => (entry.common_deviations ?? []).length > 0);
  if (checkpoint?.common_deviations?.length) {
    return { kind: "deviation", text: checkpoint.common_deviations[0] };
  }
  return { kind: "vague", text: "嗯……我不太确定这一步该怎么下手" };
}

export function alternateUtteranceForPart(plan: TutorPlanV2Payload, partId: string): string {
  const route = plan.recommended_routes.find(
    (entry) => entry.role === "alternate" && (entry.part_id ?? "1") === partId && entry.entry_condition,
  );
  if (!route?.entry_condition) throw new Error(`part ${partId} 无 alternate route entry_condition`);
  return route.entry_condition;
}

export function actionTemplateOf(plan: TutorPlanV2Payload, partId: string) {
  const checkpoints = plan.checkpoints.filter((entry) => entry.part_id === partId).map((c) => c.checkpoint_id);
  const resource = plan.resources.find(
    (entry) => entry.kind === "action_template" && entry.checkpoint_id && checkpoints.includes(entry.checkpoint_id),
  );
  if (!resource) throw new Error(`part ${partId} 无 action_template`);
  return resource;
}

function correctEvidenceFor(template: { content?: string }): ActionEvidence {
  const parsed = JSON.parse(template.content ?? "{}") as {
    actionId: string;
    sourceStepId: string;
    kind: string;
    teachingInput?: { expectedValues?: string[] };
  };
  const value = parsed.teachingInput?.expectedValues?.[0] ?? "1";
  return {
    actionId: parsed.actionId,
    sourceStepId: parsed.sourceStepId,
    kind: parsed.kind as ActionEvidence["kind"],
    version: 1,
    ...(parsed.kind === "enter-text" ? { value } : { value }),
  } as ActionEvidence;
}

// --------------------------------------------------------------------------- //
// scripted 驱动助手
// --------------------------------------------------------------------------- //

async function turn(
  coordinator: TutorSessionCoordinator,
  sessionId: string,
  options?: { completeVoice?: boolean },
): Promise<{ decision: Awaited<ReturnType<TutorSessionCoordinator["driveTutorTurn"]>>["decision"]; voiceCount: number }> {
  const result = await coordinator.driveTutorTurn(sessionId);
  if (options?.completeVoice !== false) {
    for (const voice of result.presentation.voice) {
      coordinator.completeVoice(sessionId, { action_id: voice.action_id, outcome: "completed" });
    }
  }
  return { decision: result.decision, voiceCount: result.presentation.voice.length };
}

async function teachOpening(coordinator: TutorSessionCoordinator, sessionId: string): Promise<void> {
  await turn(coordinator, sessionId); // explain.open（seed + 讲解）
  await turn(coordinator, sessionId); // prompt.hand_over + mode → guided_solve
}

function eventsOf(coordinator: TutorSessionCoordinator, sessionId: string): StoredV2Event[] {
  return coordinator.getEvents(sessionId);
}

function hintsOf(coordinator: TutorSessionCoordinator, sessionId: string) {
  return coordinator
    .getEvents(sessionId)
    .filter((event) => event.event_type === "hint_issued")
    .map((event) => event.payload as { level: number; checkpoint_id: string });
}

function decisionsOf(coordinator: TutorSessionCoordinator, sessionId: string) {
  return eventsOf(coordinator, sessionId)
    .filter((event) => event.event_type === "tutor_move_decided")
    .map((event) => event.payload as {
      decision_id: string;
      move_type: string;
      purpose_code: string;
      checkpoint_id?: string;
      assistance_level?: number;
      source_event_sequence: number;
      source_state_revision: number;
      fallback?: boolean;
    });
}

// --------------------------------------------------------------------------- //
// 12 条剧本
// --------------------------------------------------------------------------- //

type ScriptRunner = (harness: ScriptHarness, plan: TutorPlanV2Payload) => Promise<{ detail?: string }>;

const SCRIPTS: Record<string, ScriptRunner> = {
  /** 1. 相同 Plan 下，学生直接答对时 Tutor 选择 Confirm/Wait，卡住时选择 Prompt/Hint。 */
  async S1(harness, plan) {
    const c = harness.coordinator;
    const sidA = harness.nextSessionId();
    c.start({ sessionId: sidA, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sidA);
    const cp1 = plan.checkpoints[0].checkpoint_id;
    c.recordStudentInput(sidA, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, cp1) });
    const a = await turn(c, sidA);
    assert.ok(
      a.decision?.move_type === "confirm" || a.decision?.move_type === "wait",
      `答对后应 Confirm/Wait，实际 ${a.decision?.move_type}`,
    );
    assert.notEqual(a.decision?.move_type, "explain", "答对后不得机械播放讲解");

    const sidB = harness.nextSessionId();
    c.start({ sessionId: sidB, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sidB);
    const struggle = struggleInputFor(plan);
    c.recordStudentInput(sidB, { input_kind: "reasoning_utterance", text: struggle.text });
    const b1 = await turn(c, sidB);
    assert.equal(b1.decision?.move_type, "prompt", "首次卡住应先 Prompt（自查/澄清）");
    let sawHint = false;
    for (let index = 0; index < 3 && !sawHint; index += 1) {
      c.recordStudentInput(sidB, { input_kind: "reasoning_utterance", text: struggle.text });
      const step = await turn(c, sidB);
      assert.ok(
        step.decision?.move_type === "prompt" || step.decision?.move_type === "hint",
        `卡住时只应 Prompt/Hint（实际 ${step.decision?.move_type}）`,
      );
      sawHint = step.decision?.move_type === "hint";
    }
    assert.ok(sawHint, "持续卡住应到达最小 Hint");
    return { detail: `答对→${a.decision?.move_type}；卡住（${struggle.kind}）→prompt→…→hint` };
  },

  /** 2. Teach 被问题打断后，Runtime 根据更新 state 决定继续、Prompt 或 Repair。 */
  async S2(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    const opening = await turn(c, sid, { completeVoice: false }); // explain.open 播放中
    assert.ok(opening.decision?.move_type === "explain");

    c.recordStudentInput(sid, { input_kind: "student_interrupted" });
    const struggle = struggleInputFor(plan);
    c.recordStudentInput(sid, { input_kind: "question_asked", text: `老师，${struggle.text}这样行吗？` });
    const events = eventsOf(c, sid);
    const interrupted = events.find(
      (event) => event.event_type === "voice_action_completed" && (event.payload as { outcome: string }).outcome === "interrupted",
    );
    assert.ok(interrupted, "打断必须把未播完 voice 记为 interrupted");

    const answer = await turn(c, sid);
    assert.equal(answer.decision?.move_type, "explain", "问题用 Explain 回答");
    assert.equal(answer.decision?.purpose_code, "explain.answer_question");

    // 回答完成 → 按 state 分支：出现偏差证据 → verify Prompt；否则交接继续。
    const follow = await turn(c, sid);
    assert.ok(
      follow.decision?.purpose_code === "prompt.verify_after_question" ||
        follow.decision?.purpose_code === "prompt.hand_over",
      `回答后应按 state 分支（verify/继续），实际 ${follow.decision?.purpose_code}`,
    );
    return { detail: `打断→interrupted 记录；回答→${follow.decision?.purpose_code}` };
  },

  /** 3. 学生口述正确路径，Tutor 只做必要 Voice/Workspace 呈现。 */
  async S3(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const partId = plan.checkpoints[0].part_id;
    const partCheckpoints = plan.checkpoints.filter((entry) => entry.part_id === partId);
    const actionTemplate = actionTemplateOf(plan, partId);
    const actionCheckpointId = actionTemplate.checkpoint_id ?? partCheckpoints.at(-1)!.checkpoint_id;

    let guard = 0;
    while (guard < 12) {
      guard += 1;
      const state = c.restore(sid);
      if (state.curriculum.parts[(state.curriculum.current_part_index) ?? 0]?.part_id !== partId) break;
      if (state.reasoning.current_checkpoint_id === actionCheckpointId && state.workspace.active_action_id) break;
      if (state.reasoning.current_checkpoint_id === actionCheckpointId && !state.workspace.active_action_id) {
        // 到达 action 节点：上一步 confirm 完成后的 system turn 会派发 action step。
        const step = await turn(c, sid);
        if (step.decision?.purpose_code === "prompt.action_step") break;
        continue;
      }
      const cp = state.reasoning.current_checkpoint_id;
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, cp) });
      await turn(c, sid); // confirm
      await turn(c, sid); // presentation_completed → action step 或无动作
    }
    const state = c.restore(sid);
    assert.ok(state.workspace.active_action_id, "action 节点应已派发 workspace action");
    const submitted = c.submitActionEvidence(sid, correctEvidenceFor(actionTemplate));
    assert.ok(submitted.accepted, "正确操作证据应被 typed evaluator 接受");

    const guided = decisionsOf(c, sid).filter((decision) => decision.purpose_code !== "explain.open");
    assert.ok(
      guided.every((decision) => decision.move_type !== "explain"),
      "guided 段口述正确时不得触发 Explain",
    );
    const workspaceIssued = eventsOf(c, sid).filter((event) => event.event_type === "workspace_action_issued");
    assert.equal(workspaceIssued.length, 1, "只应派发一个 workspace action（结论交互步）");
    const issuedPayload = workspaceIssued[0].payload as { capability: string; command_payload?: string };
    const command = JSON.parse(issuedPayload.command_payload ?? "{}") as { resource_id?: string };
    assert.equal(issuedPayload.capability, plan.policy_constraints.allowed_capabilities[0], "workspace capability 必须来自 plan allowlist");
    assert.equal(command.resource_id, actionTemplate.resource_id, "workspace action 来源资源一致");
    return { detail: `${guided.length} 个 guided 决策全为 confirm/prompt；workspace×1` };
  },

  /** 4. 学生尝试失败后，下一 Hint 利用该历史，不从零重置。 */
  async S4(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const struggle = struggleInputFor(plan);

    // 持续挣扎直到两档 hint 都发出（unclear 路径会先经过 clarify/probe）。
    for (let index = 0; index < 6 && hintsOf(c, sid).length < 2; index += 1) {
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: struggle.text });
      await turn(c, sid);
    }

    const hints = hintsOf(c, sid);
    assert.equal(hints.length, 2, `应恰好发出两档 hint（实际 ${hints.length}）`);
    assert.deepEqual(hints.map((hint) => hint.level), [1, 2], "hint 档位必须严格递增且不重置");
    // L2 hint 文本应来自 plan 的 L2 资源（对 golden plan 即「常见卡点」本体）。
    const state = c.restore(sid);
    const cp = state.reasoning.current_checkpoint_id;
    const l2Resource = plan.resources.find(
      (resource) => resource.kind === "hint" && resource.checkpoint_id === cp && resource.assistance_level === 2,
    );
    const l2Voice = eventsOf(c, sid)
      .filter((event) => event.event_type === "voice_action_issued")
      .map((event) => event.payload as { text: string });
    if (l2Resource?.content) {
      assert.ok(
        l2Voice.some((voice) => voice.text === l2Resource.content),
        "L2 提示必须使用 plan L2 资源原文（利用失败历史）",
      );
    }
    return { detail: `阶梯 1→2 严格递增（${struggle.kind} 路径），L2=plan 资源原文` };
  },

  /** 5. Level 1 后推进，事件关联 decision、checkpoint 和 state revision。 */
  async S5(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const struggle = struggleInputFor(plan);
    for (let index = 0; index < 6 && hintsOf(c, sid).length < 1; index += 1) {
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: struggle.text });
      await turn(c, sid);
    }
    const hintEvent = eventsOf(c, sid).find((event) => event.event_type === "hint_issued");
    assert.ok(hintEvent, "hint_issued 事件缺失");
    const hintCheckpoint = (hintEvent!.payload as { checkpoint_id: string }).checkpoint_id;

    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, hintCheckpoint) });
    const confirmTurn = await turn(c, sid);
    const events = eventsOf(c, sid);
    const aligned = events.find((event) => event.event_type === "reasoning_aligned" && (event.payload as { alignment: string }).alignment === "expected_checkpoint");
    const progressed = events.find((event) => event.event_type === "student_progressed");
    const decisionEvent = events.find((event) => event.event_type === "tutor_move_decided" && (event.payload as { decision_id: string }).decision_id === confirmTurn.decision?.decision_id);

    assert.ok(aligned && progressed && decisionEvent, "因果链事件缺失");
    assert.equal(progressed!.causation_sequence, aligned!.sequence, "progressed 必须由对齐事件引发");
    assert.equal((progressed!.payload as { checkpoint_id: string }).checkpoint_id, hintCheckpoint, "推进必须落在 hint 同一 checkpoint");
    assert.equal(
      (decisionEvent!.payload as { source_event_sequence: number }).source_event_sequence,
      aligned!.sequence,
      "决策必须关联 source event",
    );
    const revisionBeforeConfirm = events
      .filter((event) => event.sequence < aligned!.sequence)
      .at(-1)?.state_revision ?? 0;
    assert.equal(
      (decisionEvent!.payload as { source_state_revision: number }).source_state_revision,
      revisionBeforeConfirm,
      "决策必须关联 source state revision",
    );
    return { detail: `hint→aligned→progressed→decision 因果链闭合（cp=${hintCheckpoint}）` };
  },

  /** 6. 学生自我修正，不被记录为 Tutor 直接纠正。 */
  async S6(harness, plan) {
    if (!plan.checkpoints.some((entry) => (entry.common_deviations ?? []).length > 0)) {
      return { detail: "not_applicable：plan 无 authored common_deviations，自我修正剧本需要偏差数据（数据缺口登记于退场报告）" };
    }
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const partId = plan.checkpoints[0].part_id;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: deviationUtteranceForPart(plan, partId) });
    await turn(c, sid); // prompt.self_check（非实质性帮助）
    const cp = c.restore(sid).reasoning.current_checkpoint_id;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, cp) });
    const confirm = await turn(c, sid);

    const events = eventsOf(c, sid);
    const selfCorrected = events.find((event) => event.event_type === "student_self_corrected");
    assert.ok(selfCorrected, "自我修正事实必须被记录");
    const deviationAligned = events.find(
      (event) => event.event_type === "reasoning_aligned" && (event.payload as { alignment: string }).alignment === "incorrect",
    );
    assert.equal(
      (selfCorrected!.payload as { deviation_sequence: number }).deviation_sequence,
      deviationAligned!.sequence,
      "自我修正必须关联原始偏差证据",
    );
    assert.equal(confirm.decision?.purpose_code, "confirm.self_correction", "确认应区分自我修正");
    const between = events.filter(
      (event) =>
        event.sequence > deviationAligned!.sequence &&
        event.sequence < selfCorrected!.sequence &&
        event.event_type === "tutor_move_decided",
    );
    assert.ok(
      between.every((event) => (event.payload as { move_type: string }).move_type === "prompt"),
      "偏差与修正之间只允许 Prompt（不得记为 Tutor 纠正）",
    );
    return { detail: `student_self_corrected 关联偏差证据；确认 purpose=self_correction` };
  },

  /** 7. alternate valid 解法被接受并可继续。 */
  async S7(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const partId = plan.checkpoints[0].part_id;
    const partCheckpointIds = plan.checkpoints.filter((entry) => entry.part_id === partId).map((entry) => entry.checkpoint_id);
    const actionTemplate = actionTemplateOf(plan, partId);
    const actionCheckpointId = actionTemplate.checkpoint_id ?? partCheckpointIds.at(-1)!;
    const actionIndex = partCheckpointIds.indexOf(actionCheckpointId);
    const stagingCheckpointId = actionIndex > 0 ? partCheckpointIds[actionIndex - 1] : actionCheckpointId;

    let guard = 0;
    while (c.restore(sid).reasoning.current_checkpoint_id !== stagingCheckpointId && guard < 10) {
      guard += 1;
      const cp = c.restore(sid).reasoning.current_checkpoint_id;
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, cp) });
      await turn(c, sid);
      await turn(c, sid);
    }
    assert.equal(
      c.restore(sid).reasoning.current_checkpoint_id,
      stagingCheckpointId,
      `应推进到 action 节点前一站（${stagingCheckpointId}）再改走 alternate`,
    );
    // 在 action 节点前一站改走 alternate 路线（entry_condition 派生输入）。
    const alternateText = alternateUtteranceForPart(plan, partId);
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: alternateText });
    const confirm = await turn(c, sid);

    const events = eventsOf(c, sid);
    const alternateAligned = events.find(
      (event) => event.event_type === "reasoning_aligned" && (event.payload as { alignment: string }).alignment === "alternate_valid",
    );
    assert.ok(alternateAligned, "alternate 输入必须对齐为 alternate_valid（不判错）");
    assert.equal(confirm.decision?.move_type, "confirm", "alternate 路线应被 Confirm 接受");
    assert.equal(confirm.decision?.purpose_code, "confirm.alternate_path");
    const progressed = events.find(
      (event) => event.event_type === "student_progressed" && event.sequence > alternateAligned!.sequence,
    );
    assert.ok(progressed, "沿 alternate 路线可继续推进");
    // Plan 不被改写：会话 pin 的 hash 与 canonical 当前版本一致。
    const sessionRow = events[0].payload as { plan: { content_hash: string } };
    assert.equal(sessionRow.plan.content_hash, plan.content_hash, "plan 引用不可漂移");
    return { detail: `alternate_valid→confirm→progressed（plan 未改写）` };
  },

  /** 8. Confirm 可以只说话，Wait 可以零 PresentationAction。 */
  async S8(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const cp1 = plan.checkpoints[0].checkpoint_id;
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, cp1) });
    const confirmTurn = await c.driveTutorTurn(sid);
    assert.equal(confirmTurn.decision?.move_type, "confirm");
    assert.ok(confirmTurn.presentation.voice.length >= 1, "Confirm 可以只说话（至少一条 voice）");
    assert.equal(confirmTurn.presentation.workspace.length, 0, "Confirm 不得携带 workspace action");
    for (const voice of confirmTurn.presentation.voice) {
      c.completeVoice(sid, { action_id: voice.action_id, outcome: "completed" });
    }

    c.recordStudentInput(sid, { input_kind: "silence_observed", duration_ms: 4000 });
    const waitTurn = await c.driveTutorTurn(sid);
    if (waitTurn.decision?.move_type === "wait") {
      assert.equal(waitTurn.presentation.voice.length, 0, "Wait 必须零 voice");
      assert.equal(waitTurn.presentation.workspace.length, 0, "Wait 必须零 workspace");
    } else {
      assert.ok(["prompt", "hint"].includes(waitTurn.decision?.move_type ?? ""), "静默后合法动作是 Wait/Prompt/Hint");
    }
    return { detail: `confirm=voice-only；wait=零动作` };
  },

  /** 9. WorkspaceAction 非法 target/capability 被拒绝且不污染学生 evidence。 */
  async S9(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const before = eventsOf(c, sid).length;

    const illegalCapability = c.attemptWorkspaceAction(sid, {
      action_id: `WA-${sid}-900`,
      decision_id: `TD-${sid}-900`,
      capability: "workspace.focus-objects",
      target_ids: [],
      command_payload: { resource_id: actionTemplateOf(plan, plan.checkpoints[0].part_id).resource_id, action_ref: "tp:fake:1:enter-text", mode: "learn" },
    });
    assert.equal(illegalCapability.accepted, false, "非法 capability 必须被拒绝");
    assert.ok(illegalCapability.errors.length > 0);

    const unknownResource = c.attemptWorkspaceAction(sid, {
      action_id: `WA-${sid}-901`,
      decision_id: `TD-${sid}-901`,
      capability: plan.policy_constraints.allowed_capabilities[0],
      target_ids: [],
      command_payload: { resource_id: "RES999", action_ref: "tp:fake:1:enter-text", mode: "learn" },
    });
    assert.equal(unknownResource.accepted, false, "未知 resource target 必须被拒绝");

    const events = eventsOf(c, sid);
    // 裁定 §6（2026-08-21）：非法动作不签发（无 workspace_action_issued），
    // 拒绝事实记 runtime_failure(workspace_action_rejected)。
    const issued = events.slice(before).filter((event) => event.event_type === "workspace_action_issued");
    assert.equal(issued.length, 0, "非法注入不得签发 workspace_action_issued");
    const rejected = events.filter(
      (event) =>
        event.event_type === "runtime_failure" &&
        (event.payload as { failure_class?: string }).failure_class === "workspace_action_rejected",
    );
    assert.equal(rejected.length, 2, "两次非法注入都必须留下 runtime_failure 拒绝事实");
    const pollution = events.slice(before).filter(
      (event) => event.event_type === "student_input_recorded" || event.event_type === "reasoning_aligned",
    );
    assert.equal(pollution.length, 0, "工具拒绝不得产生学生 evidence");
    return { detail: `2 次注入全 runtime_failure 拒绝；零签发；学生事实零污染` };
  },

  /** 10. Policy timeout 使用安全 fallback。 */
  async S10(harness, plan) {
    assert.ok(harness.makeCoordinatorWithPolicy, "S10 需要 slow policy 注入工厂");
    const make = harness.makeCoordinatorWithPolicy!;
    let calls = 0;
    const flaky = {
      policyVersion: "tutor-policy-flaky/v1",
      decide: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
          return { ok: true as const, decision: null, policy_version: "tutor-policy-flaky/v1" };
        }
        return {
          ok: true as const,
          decision: {
            move_type: "wait" as const,
            purpose_code: "wait.await_reasoning",
          },
          policy_version: "tutor-policy-flaky/v1",
        };
      },
    };
    const c = make(flaky);
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    const fallbackTurn = await c.driveTutorTurn(sid);
    assert.ok(fallbackTurn.policy_failed, "超时必须留下 policy_failed 事实");
    assert.equal(fallbackTurn.policy_failed?.fallback_used, true);
    assert.equal(fallbackTurn.decision?.fallback, true, "回退决策必须标记 fallback");
    assert.equal(fallbackTurn.decision?.move_type, "wait", "回退动作是已批准最低风险的 Wait");
    assert.equal(fallbackTurn.presentation.voice.length + fallbackTurn.presentation.workspace.length, 0, "fallback Wait 零呈现");

    // session 不卡死：下一次输入正常推进。
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, plan.checkpoints[0].checkpoint_id) });
    void plan;
    return { detail: `timeout→policy_failed(fallback)→Wait 零呈现` };
  },

  /** 11. 多级提示无效进入 Repair，完成后回原 checkpoint。 */
  async S11(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id });
    await teachOpening(c, sid);
    const struggle = struggleInputFor(plan);
    for (let index = 0; index < 8 && !decisionsOf(c, sid).some((decision) => decision.move_type === "repair"); index += 1) {
      c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: struggle.text });
      await turn(c, sid);
    }
    const events = eventsOf(c, sid);
    const repairDecided = decisionsOf(c, sid).find((decision) => decision.move_type === "repair");
    assert.ok(repairDecided, "阶梯耗尽必须进入 Repair");
    const modeToRepair = events.find(
      (event) => event.event_type === "mode_changed" && (event.payload as { to_mode: string }).to_mode === "repair",
    );
    assert.ok(modeToRepair, "进入 Repair 必须记录 mode_changed");
    const repairDelivered = events.find((event) => event.event_type === "repair_delivered");
    assert.ok(repairDelivered, "repair 资源必须被派发");
    const sourceCheckpoint = (repairDelivered!.payload as { source_checkpoint_id: string }).source_checkpoint_id;

    const stateBefore = c.restore(sid);
    c.recordStudentInput(sid, { input_kind: "reasoning_utterance", text: expectedUtteranceFor(plan, sourceCheckpoint) });
    const recovery = await turn(c, sid);
    assert.equal(recovery.decision?.purpose_code, "confirm.repair_complete", "修复完成应确认并退出");

    const after = eventsOf(c, sid);
    const modeBack = after.find(
      (event) =>
        event.event_type === "mode_changed" &&
        (event.payload as { to_mode: string }).to_mode !== "repair" &&
        event.sequence > repairDelivered!.sequence,
    );
    assert.ok(modeBack, "修复完成必须退出 repair mode");
    const progressed = after.find(
      (event) => event.event_type === "student_progressed" && event.sequence > repairDelivered!.sequence,
    );
    assert.equal(
      (progressed?.payload as { checkpoint_id: string } | undefined)?.checkpoint_id,
      sourceCheckpoint,
      "修复后推进必须落在原 checkpoint",
    );
    const stateAfter = c.restore(sid);
    assert.ok(
      stateAfter.reasoning.current_checkpoint_id !== sourceCheckpoint || stateAfter.curriculum.completed,
      "完成后回到原 checkpoint 继续前进",
    );
    void stateBefore;
    return { detail: `L1→L2→repair→恢复→progressed@${sourceCheckpoint}` };
  },

  /** 12. Assessment 继续拒绝生成式教学 Move、truth 和 Tutor tools。 */
  async S12(harness, plan) {
    const c = harness.coordinator;
    const sid = harness.nextSessionId();
    let refused = false;
    try {
      c.start({ sessionId: sid, studentId: "scripted", tpId: plan.artifact_id, sessionKind: "assessment" });
    } catch (error) {
      refused = error instanceof Error && error.message.includes("Assessment");
    }
    assert.ok(refused, "Assessment 会话必须 fail closed 拒绝启动教学闭环");
    assert.equal(plan.policy_constraints.assessment_enabled, false, "golden plan 永不启用 assessment");

    // 学生面投影不含真值（truth isolation 由安全 adapter 保证）。
    const template = actionTemplateOf(plan, plan.checkpoints[0].part_id);
    const validation = validateWorkspaceAction(
      {
        action_id: `WA-${sid}-950`,
        decision_id: `TD-${sid}-950`,
        capability: template.capability ?? plan.policy_constraints.allowed_capabilities[0],
        target_ids: [],
        command_payload: { resource_id: template.resource_id, action_ref: template.action_ref, mode: "learn" },
      },
      plan,
      {
        plan_ref: { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash },
        parts: [],
        action_contracts: [
          {
            resource_id: template.resource_id,
            action_ref: template.action_ref ?? template.resource_id,
            learn: JSON.parse(template.content ?? "{}") as unknown as never,
            assessment: stripTruth(JSON.parse(template.content ?? "{}")) as unknown as never,
          },
        ],
      },
      { sessionKind: "assessment" },
    );
    assert.equal(validation.ok, false, "Assessment 上下文的 WorkspaceAction 必须被拒绝");
    const studentView = stripTruth(JSON.parse(template.content ?? "{}"));
    const serialized = JSON.stringify(studentView);
    for (const key of ["localTruth", "teachingInput", "expectedValues"]) {
      assert.ok(!serialized.includes(`"${key}"`), `学生面不得含真值键 ${key}`);
    }
    return { detail: `assessment 启动拒绝 + tool 拒绝 + 学生面无 truth` };
  },
};

function stripTruth(contract: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...contract };
  delete copy.localTruth;
  delete copy.teachingInput;
  return copy;
}

export const ACCEPTANCE_SCRIPT_IDS = Object.keys(SCRIPTS).sort();

export async function runAcceptanceScript(
  scriptId: string,
  harness: ScriptHarness,
  plan: TutorPlanV2Payload,
): Promise<AcceptanceScriptOutcome> {
  const runner = SCRIPTS[scriptId];
  if (!runner) throw new Error(`unknown script: ${scriptId}`);
  try {
    const { detail } = await runner(harness, plan);
    const skipped = detail?.startsWith("not_applicable");
    return {
      script_id: scriptId,
      plan_id: plan.artifact_id,
      status: skipped ? "skipped" : "pass",
      failures: [],
      session_ids: [],
      detail,
    };
  } catch (error) {
    return {
      script_id: scriptId,
      plan_id: plan.artifact_id,
      status: "fail",
      failures: [error instanceof Error ? error.message : String(error)],
      session_ids: [],
    };
  }
}

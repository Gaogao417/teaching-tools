/**
 * tutorHttpProfile（F7 Step 4 — 统一 HTTP application profile，spec §0-§2）。
 *
 * teaching-tools 内前后端共用的**唯一**线格式真源（spec §0 裁决 2：禁止后端
 * 手拼一份、前端再声明一份）。application profile——不进 canonical/（跨仓
 * 合同真源），但组合成员引用 canonical 合同（views 三视图 / pending
 * presentation=delivery/v1 / command=student-workspace-command/v1）。
 *
 * - `sessionSnapshotHttpV1Schema`：所有成功端点同型 SessionSnapshot（spec §1.2
 *   线 JSON：profile/session_id/task_id/revision/completed/assessment/question/
 *   views 四成员/render{workspace_revision,geometry}/active_action?/
 *   pending_presentation?/turn?；render 与四 views 成员不得缺省）；
 * - `actionSubmissionHttpV1Schema`：五判别互斥（evidence-rejected|
 *   workspace-committed 携 evaluation；revision-conflict|command-rejected|
 *   runtime-failure 携 failure 且**结构上禁 evaluation**——消除
 *   「command-rejected + correct」）；
 * - 请求 schema 组（start/student-inputs[action-evidence/workspace-commands/
 *   presentation outcome/asr]——HTTP /student-inputs 只收 utterance|control
 *   浏览器子集，workspace_command 输入成员仅服务端结构化链落库）；
 * - `parseSessionSnapshotHttp` + `validateSessionSnapshotConsistency`：spec §1.3
 *   一致性门禁的结构可检子集（#1/2/4/5/6/7/8/11/13），fail closed 单入口——
 *   服务端产出前自证 + 前端采用前同一入口（Step 5 接线）。
 */
import { z } from "zod";
import { visualExecutionOwnerSchema, visualBarrierSchema, studentWorkspaceViewV3Schema, presentationDeliveryV2Schema, studentInputV2Schema, geometryVisualCommandSchema } from "./canonical/visualSchemas";

import {
  tutorRuntimeStateV3Schema,
  coachPanelViewV1Schema,
  mainlineParticipationV1Schema,
  presentationDeliveryV1Schema,
  studentInputV1Schema,
  studentWorkspaceCommandV1Schema,
  studentWorkspaceViewV1Schema,
  studentWorkspaceViewV2Schema,
} from "./canonical/schemas";
import { isActionEvaluationResponse } from "./actionRuntime";

export const TUTOR_RUNTIME_HTTP_PROFILE = "f7-tutor-runtime-http/v1" as const;

const sessionIdPattern = z.string().regex(/^TS-[0-9]{4,}$/);
const clientRequestIdPattern = z.string().regex(/^[A-Za-z0-9._:-]{4,128}$/);

// --------------------------------------------------------------------------- //
// 线格式：views / status / render / active_action / turn
// --------------------------------------------------------------------------- //

const statusViewSchema = z
  .object({
    session_id: sessionIdPattern,
    session_revision: z.number().int().min(0),
    workspace_revision: z.number().int().min(0),
    completed: z.boolean(),
    last_failure: z
      .object({
        category: z.string().min(1),
        failure_class: z.string().min(1),
        message: z.string().optional(),
        // 失败事实的流内溯源（F6 status 投影携带；只读引用）。
        event_type: z.string().optional(),
        sequence: z.number().int().min(1).optional(),
        gate_id: z.string().optional(),
        beat_id: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const viewsSchema = z
  .object({
    // F7 P2（动态板书规格/view v2）：student_workspace_view 按 schema marker 判别
    // v1|v2——v2 在 solution_board 上增可选 fragments（临场解释板书 EF- 的
    // student-safe 投影）。两形状均过 canonical 镜像 schema（单一真源）。
    student_workspace_view: z.union([studentWorkspaceViewV1Schema, studentWorkspaceViewV2Schema, studentWorkspaceViewV3Schema]),
    coach_panel_view: coachPanelViewV1Schema,
    participation: mainlineParticipationV1Schema,
    status: statusViewSchema,
  })
  .strict();

const questionSchema = z
  .object({
    artifact_id: z.string().min(1),
    question_type: z.string().min(1),
    stem: z.string(),
  })
  .strict();

/** render.geometry = student-safe composed TopicGeometryModel（宽松对象——深度
 * 校验属 buildGeometryModel 消费面；此处保证存在性与 revision 对账）。 */
const renderSchema = z
  .object({
    workspace_revision: z.number().int().min(0),
    geometry: z.record(z.unknown()).nullable(),
  })
  .strict();

const activeActionSchema = z
  .object({
    action_id: z.string().min(1),
    resource_id: z.string().min(1),
    action_ref: z.string().min(1),
    capability: z.string().min(1),
    target_ids: z.array(z.string().min(1)),
    student_view: z.record(z.unknown()),
    action_plan: z.record(z.unknown()),
    form: z.string().min(1),
  })
  .strict();

const turnFailureSchema = z
  .object({
    category: z.string().min(1),
    failure_class: z.string().min(1),
    message: z.string().optional(),
    retryable: z.boolean(),
  })
  .strict();

const turnSchema = z
  .object({
    status: z.enum(["committed", "revision-conflict", "command-rejected", "runtime-failure"]),
    decision_kind: z.string().min(1).optional(),
    to_beat_id: z.string().min(1).optional(),
    failure: turnFailureSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // spec §1.2：非 committed 必带 failure，不得同时伪装 committed。
    if (value.status !== "committed" && value.failure === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `turn.status=${value.status} requires failure` });
    }
    if (value.status === "committed" && value.failure !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "turn.status=committed must not carry failure" });
    }
  });

// --------------------------------------------------------------------------- //
// S1 冻结字段合同（F7 P2 组合接线；spec s1-http-media-handshake-execution-spec
// + f7-s1-interface-package §1）——generation/scope 的唯一形状与跨字段规则。
// 字段测试数据源 web/shared/fixtures/s1-http-field-cases.json（两工作树同步）。
// --------------------------------------------------------------------------- //

const adaptiveGenerationSlot = tutorRuntimeStateV3Schema.innerType().shape.generation_slot;
const generationBudgetFields = {
  attempt: z.number().int().min(1),
  max_attempts: z.number().int().min(1),
};
const adaptivePresentationFieldsObject = z.object({
  generation: z.discriminatedUnion("status", [
    adaptiveGenerationSlot.options[0],
    adaptiveGenerationSlot.options[1].pick({ status: true, request_id: true }).extend({
      ...generationBudgetFields,
      phase: z.enum(["running", "waiting_retry"]),
      retry_at: z.string().datetime().optional(),
    }),
    adaptiveGenerationSlot.options[2].extend({
      ...generationBudgetFields,
      error_class: adaptiveGenerationSlot.options[2].shape.error_class.or(z.literal("RETRY_EXHAUSTED")),
    }),
  ]),
  scope: adaptiveGenerationSlot.options[1].shape.scope.nullable(),
}).strict();
export const adaptivePresentationSnapshotFieldsSchema = adaptivePresentationFieldsObject.superRefine((value, ctx) => {
  const add = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  const generation = value.generation;
  if (generation.status === "idle") return;
  if (value.scope === null) add("generation requires an active teaching scope");
  if (generation.attempt > generation.max_attempts) add("generation attempt exceeds budget");
  if (generation.status === "pending") {
    if (generation.phase === "waiting_retry") {
      if (!generation.retry_at || generation.attempt >= generation.max_attempts) add("retry requires remaining budget and retry_at");
    } else if (generation.retry_at !== undefined) add("running generation cannot carry retry_at");
  }
});

/** S1 generation 投影（快照可选携带；A 的 view-model/轮询与 B 的 projector 共用）。 */
export type AdaptivePresentationFields = z.infer<typeof adaptivePresentationSnapshotFieldsSchema>;
export type AdaptiveGenerationStatus = AdaptivePresentationFields["generation"];

export const sessionSnapshotHttpV1Schema = z
  .object({
    profile: z.literal(TUTOR_RUNTIME_HTTP_PROFILE),
    session_id: sessionIdPattern,
    task_id: z.string().min(1),
    revision: z.number().int().min(0),
    completed: z.boolean(),
    assessment: z.boolean(),
    question: questionSchema,
    views: viewsSchema,
    render: renderSchema,
    active_action: activeActionSchema.optional(),
    pending_presentation: z.union([presentationDeliveryV1Schema, presentationDeliveryV2Schema]).optional(),
    presentation_execution_owner: visualExecutionOwnerSchema.optional(),
    visual_barrier: visualBarrierSchema.nullable().optional(),
    turn: turnSchema.optional(),
    // F7 P2（S1 §1 组合接线）：generation/scope 成对可选——服务端 projector 已
    // 升级时逐快照投影（idle 也投影）；未携带 = 该服务端尚无自适应生成状态
    //（行为与既有快照完全一致）。字段一旦出现即过 S1 冻结字段 schema 的全量
    // 形状 + 跨字段规则（见 validateSessionSnapshotConsistency #14——单一裁决
    // 点，不在 schema 层重复）。不加第二套 DTO/endpoint/runtime。
    generation: z.optional(adaptivePresentationFieldsObject.shape.generation),
    scope: z.optional(adaptivePresentationFieldsObject.shape.scope),
  })
  .strict();

export type SessionSnapshotHttpV1 = z.infer<typeof sessionSnapshotHttpV1Schema>;

// --------------------------------------------------------------------------- //
// ActionSubmission（spec §2.6 五判别，结构互斥）
// --------------------------------------------------------------------------- //

const evaluationSchema = z.record(z.unknown()).superRefine((value, ctx) => {
  if (!isActionEvaluationResponse(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evaluation fails ActionEvaluationResponse runtime validation" });
  }
});

const submissionBase = {
  revision: z.number().int().min(0),
};

export const actionSubmissionHttpV1Schema = z.union([
  z.object({ ...submissionBase, status: z.literal("evidence-rejected"), evaluation: evaluationSchema }).strict(),
  z.object({ ...submissionBase, status: z.literal("workspace-committed"), evaluation: evaluationSchema }).strict(),
  z
    .object({ ...submissionBase, status: z.literal("revision-conflict"), failure: turnFailureSchema })
    .strict()
    .superRefine((value, ctx) => {
      if ("evaluation" in value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "revision-conflict must not carry evaluation" });
      }
    }),
  z
    .object({ ...submissionBase, status: z.literal("command-rejected"), failure: turnFailureSchema })
    .strict()
    .superRefine((value, ctx) => {
      if ("evaluation" in value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "command-rejected must not carry evaluation" });
      }
    }),
  z
    .object({ ...submissionBase, status: z.literal("runtime-failure"), failure: turnFailureSchema })
    .strict()
    .superRefine((value, ctx) => {
      if ("evaluation" in value) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "runtime-failure must not carry evaluation" });
      }
    }),
]);

export type ActionSubmissionHttpV1 = z.infer<typeof actionSubmissionHttpV1Schema>;

/** action-evidence 成功响应 = 同型 SessionSnapshot + action_submission。 */
export const actionEvidenceResponseHttpV1Schema = sessionSnapshotHttpV1Schema.extend({
  action_submission: actionSubmissionHttpV1Schema,
});

// --------------------------------------------------------------------------- //
// availability / 错误 envelope / action-evidence 组合解析（Step 4.1：后端路由
// 与前端 adapter 共用，消除两侧手拼）
// --------------------------------------------------------------------------- //

export const availabilityResponseHttpV1Schema = z
  .object({
    task_id: z.string().min(1).max(64),
    enabled: z.boolean(),
    profile: z.literal(TUTOR_RUNTIME_HTTP_PROFILE),
  })
  .strict();

/** 稳定错误 envelope（spec §2.1：所有错误保留稳定 error.code）。 */
export const errorEnvelopeHttpV1Schema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export type AvailabilityResponseHttpV1 = z.infer<typeof availabilityResponseHttpV1Schema>;
export type ErrorEnvelopeHttpV1 = z.infer<typeof errorEnvelopeHttpV1Schema>;

/** action-evidence 响应组合解析（snapshot 过 §1.3 一致性门禁 + 五判别互斥）——
 *  前后端同一入口；任一失败 → 错误列表（不部分采用）。 */
export function parseActionEvidenceResponseHttp(payload: unknown):
  { ok: true; snapshot: SessionSnapshotHttpV1; submission: ActionSubmissionHttpV1 } | { ok: false; errors: readonly string[] } {
  const parsed = actionEvidenceResponseHttpV1Schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`) };
  }
  const issues = validateSessionSnapshotConsistency(parsed.data);
  if (issues.length > 0) {
    return { ok: false, errors: issues.map((issue) => `[${issue.check}] ${issue.message}`) };
  }
  const { action_submission: submission, ...snapshot } = parsed.data;
  return { ok: true, snapshot, submission };
}

// --------------------------------------------------------------------------- //
// 请求 schema 组（spec §2.3-§2.9）
// --------------------------------------------------------------------------- //

export const startRequestHttpV1Schema = z
  .object({
    task_id: z.string().min(1).max(64),
    student_id: z.string().trim().min(1).max(64),
    assessment: z.boolean().optional(),
    client_instance_id: visualExecutionOwnerSchema.shape.client_instance_id.optional(),
    client_request_id: clientRequestIdPattern,
  })
  .strict();

/** HTTP /student-inputs 只收浏览器入口子集（utterance|control；canonical
 * student-input/v1 的 input 联合减去 workspace_command——该成员仅服务端链落库）。 */
const browserStudentInputBody = studentInputV1Schema.shape.input.superRefine((value, ctx) => {
  if (value.kind !== "utterance" && value.kind !== "control") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `HTTP /student-inputs only accepts utterance|control (got ${String(value.kind)}); workspace commands enter via /workspace-commands`,
    });
  }
});

export const studentInputRequestHttpV1Schema = z
  .object({
    input: z.union([browserStudentInputBody, studentInputV2Schema.shape.input]),
    execution_owner: visualExecutionOwnerSchema.optional(),
    client_request_id: clientRequestIdPattern,
    expected_revision: z.number().int().min(0),
  })
  .strict();

export const actionEvidenceRequestHttpV1Schema = z
  .object({
    execution_owner: visualExecutionOwnerSchema.optional(),
    evidence: z
      .object({
        actionId: z.string().min(1),
        sourceStepId: z.string().min(1),
        kind: z.string().min(1),
        version: z.literal(1),
        values: z.record(z.string(), z.string()),
      })
      .strict(),
    expected_revision: z.number().int().min(0),
    client_request_id: clientRequestIdPattern,
  })
  .strict();

/** /workspace-commands 请求：canonical student-workspace-command/v1 + expected_revision。 */
export const workspaceCommandRequestHttpV1Schema = z
  .object({
    command: studentWorkspaceCommandV1Schema,
    execution_owner: visualExecutionOwnerSchema.optional(),
    expected_revision: z.number().int().min(0),
  })
  .strict();

export const presentationOutcomeRequestHttpV1Schema = z
  .object({
    sequence_id: z.string().regex(/^PS-[0-9]{4,}$/),
    execution_owner: visualExecutionOwnerSchema.optional(),
    hold_for_control: z.object({ client_request_id: clientRequestIdPattern }).strict().optional(),
    ordinal: z.number().int().min(0),
    outcome: z.enum(["presented", "interrupted", "failed"]),
    failure_class: z.string().min(1).optional(),
    message: z.string().optional(),
    client_request_id: clientRequestIdPattern,
    expected_revision: z.number().int().min(0),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.outcome === "failed" && value.failure_class === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "outcome=failed requires failure_class" });
    }
    if (value.outcome !== "failed" && value.failure_class !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `outcome=${value.outcome} must not carry failure_class` });
    }
  });

export const asrRequestHttpV1Schema = z
  .object({
    execution_owner: visualExecutionOwnerSchema.optional(),
    audio: z
      .object({
        data_url: z.string().min(1),
        mime_type: z.string().min(1),
        duration_ms: z.number().int().min(0).max(60000).optional(),
      })
      .strict(),
    client_request_id: clientRequestIdPattern,
  })
  .strict();

export const asrResponseHttpV1Schema = z
  .object({
    session_id: sessionIdPattern,
    observed_revision: z.number().int().min(0),
    execution_owner: visualExecutionOwnerSchema.optional(),
    transcript: z.string(),
    model: z.string().min(1),
    language: z.string().optional(),
  })
  .strict();

// --------------------------------------------------------------------------- //
// 一致性门禁（spec §1.3 结构可检子集；fail closed 单入口）
// --------------------------------------------------------------------------- //

export interface SnapshotConsistencyIssue {
  readonly check: string;
  readonly message: string;
}

/**
 * spec §1.3 的结构可检子集（输入须已过 sessionSnapshotHttpV1Schema parse）：
 * #1 profile（Zod literal 承担）；#2 session_id 三视图一致；#4 envelope revision
 * == status revision；#5 workspace revision 三处一致；#6 canonical view/v1 的
 * participation 只有一份（views.participation——strict schema 已封死 View 内
 * 第二份，无需运行时比对）；#7 completed 与 participation read_only_completed
 * 互相蕴含；#8 workspace_input ⇒ active_action；#11 pending 与 workspace_input
 * 互斥（默认串行）；#13 未知形态 fail closed 由 Zod strict 承担。
 */
export function validateSessionSnapshotConsistency(snapshot: SessionSnapshotHttpV1): readonly SnapshotConsistencyIssue[] {
  const issues: SnapshotConsistencyIssue[] = [];
  const add = (check: string, message: string) => issues.push({ check, message });

  // Visual successor fields are atomic: never accept a partial upgrade.
  const visual = snapshot.views.student_workspace_view.schema === 'ai_teaching_student_workspace_view/v3';
  const owner = snapshot.presentation_execution_owner;
  const barrier = snapshot.visual_barrier;
  const delivery = snapshot.pending_presentation;
  const sameOwner = (a: {client_instance_id:string;epoch:number}, b: {client_instance_id:string;epoch:number}) => a.client_instance_id === b.client_instance_id && a.epoch === b.epoch;
  if (visual !== (owner !== undefined && barrier !== undefined)) add('visual-version', 'visual View requires paired execution owner and barrier fields');
  if (!visual && (owner !== undefined || barrier !== undefined)) add('visual-version', 'historical View cannot carry visual lifecycle fields');
  if (delivery && (visual !== (delivery.schema === 'ai_teaching_presentation_delivery/v2'))) add('visual-version', 'delivery codec differs from View');
  if (delivery?.schema === 'ai_teaching_presentation_delivery/v2' && (!owner || !sameOwner(delivery.execution_owner,owner))) add('visual-owner','delivery owner differs from snapshot');
  if (barrier) {
    if (!owner || !sameOwner(barrier.execution_owner,owner)) add('visual-owner','barrier owner differs from snapshot');
    if (snapshot.active_action) add('visual-barrier','student action cannot mount before cleanup');
    if (barrier.status === 'awaiting-cleanup') {
      if (!delivery || delivery.sequence_id !== barrier.cleanup_sequence_id || delivery.ordinal !== 0 || delivery.action.workspace_action?.capability !== 'geometry.visual.reconcile') add('visual-barrier','cleanup barrier requires exact unique cleanup delivery');
      else {
        try {
          const command=geometryVisualCommandSchema.parse(JSON.parse(delivery.action.workspace_action.command_payload ?? ''));
          if(command.op!=='reconcile' || command.barrier_id!==barrier.barrier_id || command.target_digest!==barrier.target_digest || command.target_visual_revision!==barrier.target_visual_revision) add('visual-target','cleanup command target drift');
        } catch { add('visual-target','invalid cleanup command'); }
      }
      if (snapshot.views.student_workspace_view.schema === 'ai_teaching_student_workspace_view/v3') {
        const target=snapshot.views.student_workspace_view.canvas.visual;
        if (target.digest!==barrier.target_digest || target.visual_revision!==barrier.target_visual_revision) add('visual-target','cleanup View differs from frozen target');
      }
    } else if (delivery) add('visual-barrier','non-executing barrier cannot carry a delivery');
  }

  // #2 envelope / Workspace View / Coach View session_id 完全相同。
  if (
    snapshot.views.student_workspace_view.session_id !== snapshot.session_id
    || snapshot.views.coach_panel_view.session_id !== snapshot.session_id
  ) {
    add(
      "session-id-consistency",
      `session_id mismatch across envelope/workspace/coach: ${snapshot.session_id} vs ${snapshot.views.student_workspace_view.session_id} vs ${snapshot.views.coach_panel_view.session_id}`,
    );
  }
  // #4 envelope session revision 与 Status 的 session revision 完全相同。
  if (snapshot.views.status.session_revision !== snapshot.revision) {
    add(
      "revision-consistency",
      `envelope revision ${snapshot.revision} ≠ status session_revision ${snapshot.views.status.session_revision}`,
    );
  }
  // #5 Workspace View revision、Status workspace revision、render workspace revision 相同。
  if (
    snapshot.views.student_workspace_view.revision !== snapshot.views.status.workspace_revision
    || snapshot.render.workspace_revision !== snapshot.views.status.workspace_revision
  ) {
    add(
      "workspace-revision-consistency",
      `workspace revision mismatch: view=${snapshot.views.student_workspace_view.revision} status=${snapshot.views.status.workspace_revision} render=${snapshot.render.workspace_revision}`,
    );
  }
  // #7 envelope completed 与 participation read_only_completed 互相蕴含。
  const participationKind = snapshot.views.participation.kind;
  if (participationKind === "read_only_completed" && !snapshot.completed) {
    add("completed-consistency", "participation kind=read_only_completed but envelope completed=false");
  }
  if (participationKind !== "read_only_completed" && snapshot.completed) {
    add("completed-consistency", `envelope completed=true but participation kind=${participationKind}`);
  }
  if (snapshot.completed !== snapshot.views.status.completed) {
    add("completed-consistency", `envelope completed ${snapshot.completed} ≠ status completed ${snapshot.views.status.completed}`);
  }
  // #8 participation.kind=workspace_input ⇒ 必须有 active_action（无 pending 呈现时
  // ——参与类型是相位派生视图，重锚定呈现期间可能滞后；「输入已开放」的权威
  // 信号是 active_action 挂载）；其他 participation 不得挂载。
  if (participationKind === "workspace_input" && !snapshot.visual_barrier && snapshot.pending_presentation === undefined && snapshot.active_action === undefined) {
    add("active-action-mount", "participation.kind=workspace_input requires active_action");
  }
  if (participationKind !== "workspace_input" && snapshot.active_action !== undefined) {
    add("active-action-mount", `participation.kind=${participationKind} must not mount an operable active_action`);
  }
  // #11/#12 默认串行的执行点 = 挂载门禁：pending 呈现期间不得挂 active_action
  //（spec §1.3 #12 允许 pending 与学生参与类型共存——Voice/动画未完成时输入
  // 不开放由 mount 门禁保证，而非禁止参与类型字段）。
  if (snapshot.pending_presentation !== undefined && snapshot.active_action !== undefined) {
    add("serial-presentation", "snapshot carries both a pending tutor presentation and a mounted active_action (default serial contract)");
  }
  // #14/#15/#16（F7 P2 组合接线）：S1 generation/scope 投影对账——成对出现、
  // 字段 schema 全量裁决、pending 期间零交付零挂载、active_action 挂载要求
  // generation idle。字段缺席（服务端未升级 projector）时全部跳过。
  for (const issue of validateAdaptiveGenerationConsistency(snapshot)) {
    add(issue.check, issue.message);
  }
  return issues;
}

/**
 * #14 generation/scope 成对投影 + S1 字段 schema 全量裁决；
 * #15 pending generation ⇒ 无 pending_presentation、无 active_action
 *    （state/v4 镜像规则 ⑤「pending generation slot 期间 presentation_cursor
 *    必须 idle」的 HTTP 投影 + S1 R1 挂载门禁）；
 * #16 active_action 挂载 ⇒ generation idle（S1 R1：active Action 仅在合法教学
 *    phase、cursor idle、generation idle 时可挂载）。
 */
export function validateAdaptiveGenerationConsistency(snapshot: SessionSnapshotHttpV1): readonly SnapshotConsistencyIssue[] {
  const issues: SnapshotConsistencyIssue[] = [];
  const add = (check: string, message: string) => issues.push({ check, message });
  const generation = snapshot.generation;
  if ((generation !== undefined) !== (snapshot.scope !== undefined)) {
    add("generation-projection", "generation and scope must be projected as a pair (or both absent)");
    return issues;
  }
  if (generation === undefined || snapshot.scope === undefined) return issues;
  const projection = adaptivePresentationSnapshotFieldsSchema.safeParse({ generation, scope: snapshot.scope });
  if (!projection.success) {
    for (const issue of projection.error.issues) {
      add("generation-projection", `${issue.path.join(".") || "<root>"}: ${issue.message}`);
    }
    return issues;
  }
  if (generation.status === "pending") {
    if (snapshot.pending_presentation !== undefined) {
      add("generation-pending", "pending generation must not carry a pending delivery (presentation cursor must be idle)");
    }
    if (snapshot.active_action !== undefined) {
      add("generation-pending", "pending generation must not mount an active action (S1 R1)");
    }
  }
  if (generation.status !== "idle" && snapshot.active_action !== undefined) {
    add("generation-mount", `active_action requires generation idle (got status=${generation.status})`);
  }
  return issues;
}

/** fail closed 单入口：parse + 一致性门禁；任一失败 → 错误列表（不部分采用）。 */
export function parseSessionSnapshotHttp(payload: unknown):
  { ok: true; snapshot: SessionSnapshotHttpV1 } | { ok: false; errors: readonly string[] } {
  const parsed = sessionSnapshotHttpV1Schema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`) };
  }
  const issues = validateSessionSnapshotConsistency(parsed.data);
  if (issues.length > 0) {
    return { ok: false, errors: issues.map((issue) => `[${issue.check}] ${issue.message}`) };
  }
  return { ok: true, snapshot: parsed.data };
}

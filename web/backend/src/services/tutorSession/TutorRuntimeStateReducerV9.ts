/**
 * TutorRuntimeState v4 纯 reducer（F7 RT4 — v9 Session Kernel）。
 *
 * State = f(Pinned Plan + 有序 committed v9 events + session-pinned capability
 * registry) 的纯函数；输出合同 state/v4/tutor-runtime-state（v2 全字段 +
 * presenter_generation_pin + generation_slot + generation_requests）。
 *
 * 结构策略（架构 §9.1：不按合同 major 复制整套实现）：v9 的 21 类共享事件
 * 与 v7 逐字段同形（除 planned 升 v4 形状——其 v7 fold 只消费 sequence_id/
 * actions，不读 protocol_id/beat_id，可安全委托）；v9 reducer 委托
 * applyV7Event 承接全部共享 fold（含 capability 门禁/有序交付/cursor 对账/
 * 两条输入因果链），自身只新增：
 * 1. 初始态：session_started 必带 presenter_generation_pin（state/v4 必填——
 *    缺失 fail closed，不降级为无 pin 会话）；
 * 2. 生成事件族（requested/attempt_started/retry_scheduled/failed/invalidated）
 *    的 GenerationRequestRecord 快照演化：request/slot 唯一性、pending ⇒
 *    presentation cursor idle、attempt/epoch 单调、RETRY_EXHAUSTED 只在预算
 *    耗尽、cancel_reason 只随 cancelled；
 * 3. planned(v4)：带 generation 的序列提交 ⇒ 对应 request → committed
 *    （sequence_id 落账）且 slot 原子清回 idle（同一事件内完成——规格
 *    「planned 与 slot 清空原子完成」）；slot pending 期间不允许无 generation
 *    的 planned 混入（先取消/失效再走确定性链）。
 *
 * lineage 桥接：共享事件委托会通过 V7 模块内 WeakMap 维护 fold lineage；
 * 生成事件不触碰 lineage（不登记输入/命令/序列），经 adoptV7Lineage 过继
 * 保持连续。
 */
import type { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { explanationFragmentContentHash } from "./WorkspaceExplanationFragmentsV5";

import { tutorRuntimeStateV4Schema } from "../../../../shared/canonical";
import { applyV7Event, initialStateFromSessionStartedV7, adoptV7Lineage, type TutorRuntimeStateV7, type V7FoldContext } from "./TutorRuntimeStateReducerV7";
import {
  RuntimeStateReducerV9Error,
  type StoredV9Event,
  type V9GenerationEventPayload,
  type V9PresentationSequencePlannedPayload,
} from "./TutorSessionEventV9";

/** Ephemeral integrity index, reconstructed only from the authoritative event stream. */
interface RecoveryLineage {
  plans: ReadonlyMap<string,V9PresentationSequencePlannedPayload>;
  events: readonly StoredV9Event[];
  previous?: StoredV9Event;
  failedBeforePrevious?: TutorRuntimeStateV9["presentation_cursor"];
}
const recoveryLineage = new WeakMap<object, RecoveryLineage>();
function verifiedRecoveryReference(state:TutorRuntimeStateV9,event:StoredV9Event,payload:V9PresentationSequencePlannedPayload):boolean {
  const index=recoveryLineage.get(state), previous=index?.previous;
  if (!payload.generation || recordOf(state,payload.generation.request_id)?.status !== "committed") return false;
  const fail=():never=>{throw new RuntimeStateReducerV9Error("GENERATION_REQUEST_STATE_INVALID","recovery delivery must be an exact committed suffix with same-transaction failed retry causation",event.sequence);};
  if (event.schema !== "ai_teaching_tutor_session_event/v9") return fail();
  const superseded=previous?.payload as {sequence_id?:string;reason?:string;pending_ordinal?:number;pending_action_id?:string}|undefined;
  const cursor=index?.failedBeforePrevious;
  const cause=index?.events.find(e=>e.sequence===previous?.causation_sequence);
  const failure=cause?.payload as {sequence_id?:string;ordinal?:number;action_id?:string;outcome?:string;failure_class?:string;related_event_sequence?:number}|undefined;
  const sourceEvent=index?.events.find(e=>e.sequence===failure?.related_event_sequence && e.event_type==="presentation_sequence_planned");
  const sourcePayload=sourceEvent?.payload as unknown as V9PresentationSequencePlannedPayload|undefined;
  const presented=new Set(index?.events.filter(e=>e.event_type==="presentation_action_outcome_recorded"
    && (e.payload as {sequence_id?:string}).sequence_id===superseded?.sequence_id && (e.payload as {outcome?:string}).outcome==="presented")
    .map(e=>(e.payload as {ordinal:number}).ordinal));
  const next=sourcePayload?.actions.find(a=>!presented.has(a.ordinal));
  const browserFailure=cursor?.status==="failed" && cause?.event_type==="presentation_action_outcome_recorded" && failure?.outcome==="failed"
    && failure.sequence_id===cursor.sequence_id && failure.ordinal===cursor.ordinal && failure.action_id===cursor.action_id;
  const systemFailure=cursor?.status==="idle" && cause?.event_type==="runtime_failure" && failure?.failure_class==="internal_error"
    && sourcePayload?.sequence_id===superseded?.sequence_id && next?.ordinal===superseded?.pending_ordinal
    && (next?.voice_action??next?.workspace_action)?.action_id===superseded?.pending_action_id
    && !index?.events.some(e=>e.sequence>cause.sequence && e.event_type==="presentation_action_delivered" && (e.payload as {sequence_id:string}).sequence_id===sourcePayload?.sequence_id);
  if(previous?.event_type!=="presentation_sequence_superseded" || previous.state_revision!==event.state_revision
    || event.causation_sequence!==previous.sequence || superseded?.reason!=="retry_recovery" || (!browserFailure&&!systemFailure)) return fail();
  const failed={sequence_id:superseded.sequence_id!,ordinal:superseded.pending_ordinal!,action_id:superseded.pending_action_id!};
  if(browserFailure && cursor && (failed.sequence_id!==cursor.sequence_id || failed.ordinal!==cursor.ordinal || failed.action_id!==cursor.action_id))return fail();
  const source=index!.plans.get(failed.sequence_id);
  if(!source || !isDeepStrictEqual(source.generation,payload.generation) || source.decision_id!==payload.decision_id
    || !isDeepStrictEqual(source.scope,payload.scope) || payload.explanation_fragments?.length) return fail();
  const normalize=(action:V9PresentationSequencePlannedPayload["actions"][number])=>{
    const {ordinal:_ordinal,...body}=action;
    const clean=(value:Record<string,unknown>)=>{const {action_id:_id,...content}=value;return content;};
    return {...body,...(body.voice_action?{voice_action:clean(body.voice_action)}:{}),...(body.workspace_action?{workspace_action:clean(body.workspace_action)}:{})};
  };
  const suffix=source.actions.slice(failed.ordinal);
  if(!isDeepStrictEqual(suffix.map(normalize),payload.actions.map(normalize))) return fail();
  const oldIds=new Set([...index!.plans.values()].flatMap(p=>p.actions.map(a=>(a.voice_action??a.workspace_action)!.action_id)));
  if(payload.actions.some(a=>oldIds.has((a.voice_action??a.workspace_action)!.action_id))) return fail();
  const used=new Set(suffix.flatMap(a=>a.workspace_action?.capability==="board.explain"?[String(a.workspace_action.command_payload)]:[]));
  const refs=[...used].map(fragment_id=>{
    const origin=[...index!.plans.values()].find(p=>p.explanation_fragments?.some(f=>f.fragment_id===fragment_id));
    const fragment=origin?.explanation_fragments?.find(f=>f.fragment_id===fragment_id);
    if(!origin||!fragment)return fail();
    return {fragment_id,source_sequence_id:origin.sequence_id,content_hash:explanationFragmentContentHash(fragment)};
  });
  if(!isDeepStrictEqual(refs,payload.existing_fragment_refs??[])) return fail();
  return true;
}

/** state/v4 TutorRuntimeState（canonical Zod 推导类型，唯一形状）。 */
export type TutorRuntimeStateV9 = z.infer<typeof tutorRuntimeStateV4Schema>;

export type V9FoldContext = V7FoldContext;

/** 初始态：session_started 必带 presenter_generation_pin（state/v4 必填）。 */
export function initialStateFromSessionStartedV9(event: StoredV9Event): TutorRuntimeStateV9 {
  const payload = event.payload as unknown as {
    session_mode?: "teaching" | "assessment";
    presenter_generation_pin?: V9GenerationEventPayload["presenter_pin"];
  };
  if (!payload.presenter_generation_pin) {
    throw new RuntimeStateReducerV9Error(
      "PRESENTER_PIN_MISMATCH",
      `sequence ${event.sequence}: v9 session_started carries no presenter_generation_pin (state/v4 requires a session-level presenter pin; fail closed)`,
      event.sequence,
    );
  }
  const base = initialStateFromSessionStartedV7(event as never) as unknown as TutorRuntimeStateV9;
  base.schema = "ai_teaching_tutor_runtime_state/v4";
  base.pinned_plan = { ...base.pinned_plan, presenter_generation_pin: payload.presenter_generation_pin };
  base.generation_slot = { status: "idle" };
  base.generation_requests = [];
  return base;
}

type GenerationRecord = TutorRuntimeStateV9["generation_requests"][number];

function cloneGenerationState(state: TutorRuntimeStateV9): { slot: TutorRuntimeStateV9["generation_slot"]; requests: GenerationRecord[] } {
  return {
    slot: state.generation_slot.status === "idle" ? { status: "idle" } : { ...state.generation_slot },
    requests: state.generation_requests.map((record) => ({ ...record })),
  };
}

function recordOf(state: TutorRuntimeStateV9, requestId: string): GenerationRecord | undefined {
  return state.generation_requests.find((record) => record.request_id === requestId);
}

/** 生成事件族归约（纯函数；lineage 不变——经 adoptV7Lineage 过继）。 */
function applyGenerationEventV9(state: TutorRuntimeStateV9, event: StoredV9Event): TutorRuntimeStateV9 {
  const payload = event.payload as unknown as V9GenerationEventPayload;
  const next: TutorRuntimeStateV9 = { ...state, state_revision: event.state_revision };
  // 先复制再改：归约只写克隆数组（requestOf 一律查克隆——写原始数组会被
  // 末尾的整体赋值覆盖，纯度纪律）。
  const generation = cloneGenerationState(next);
  const recordOfClone = (requestId: string): GenerationRecord | undefined =>
    generation.requests.find((record) => record.request_id === requestId);

  switch (event.event_type) {
    case "presentation_generation_requested": {
      if (recordOfClone(payload.request_id)) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_REQUEST_DUPLICATE",
          `sequence ${event.sequence}: generation request ${payload.request_id} registered twice`,
          event.sequence,
        );
      }
      if (generation.requests.some((record) => record.source_request_id === payload.source_request_id)) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_REQUEST_DUPLICATE",
          `sequence ${event.sequence}: source_request_id ${payload.source_request_id} already owns a generation request (idempotent identity; conflicting payload must be refused before the stream)`,
          event.sequence,
        );
      }
      if (next.generation_slot.status === "pending") {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_SLOT_MISMATCH",
          `sequence ${event.sequence}: cannot request generation ${payload.request_id} while request ${next.generation_slot.request_id} is pending (one active slot per session; cancel or commit first)`,
          event.sequence,
        );
      }
      if (next.presentation_cursor.status !== "idle") {
        throw new RuntimeStateReducerV9Error(
          "PRESENTATION_CURSOR_MISMATCH",
          `sequence ${event.sequence}: cannot reserve generation ${payload.request_id} while presentation cursor is ${next.presentation_cursor.status} (pending generation ⇒ idle cursor)`,
          event.sequence,
        );
      }
      generation.requests.push({ ...payload } as GenerationRecord);
      generation.slot = { status: "pending", request_id: payload.request_id };
      break;
    }
    case "presentation_generation_attempt_started": {
      const record = requirePendingRecord(generation.requests, next.generation_slot, payload, event.sequence);
      // requested(1,1) is only the reservation baseline. Every subsequent
      // ownership claim represents another consumed call, including takeover.
      const firstClaim = record.attempt === 1 && record.epoch === 1
        && payload.attempt === 1 && payload.epoch === 2;
      if (!firstClaim && payload.attempt !== record.attempt + 1) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_BUDGET_INVALID",
          `sequence ${event.sequence}: attempt_started attempt=${payload.attempt} must consume the successor of registered attempt ${record.attempt} (only initial reservation 1/1 → claim 1/2 may retain attempt)`,
          event.sequence,
        );
      }
      if (payload.epoch < payload.attempt || payload.epoch <= record.epoch) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_BUDGET_INVALID",
          `sequence ${event.sequence}: epoch ${payload.epoch} must exceed previous epoch ${record.epoch} and fence attempt ${payload.attempt}`,
          event.sequence,
        );
      }
      record.attempt = payload.attempt;
      record.epoch = payload.epoch;
      record.phase = "running";
      delete record.retry_at;
      break;
    }
    case "presentation_generation_retry_scheduled": {
      const record = requirePendingRecord(generation.requests, next.generation_slot, payload, event.sequence);
      if (payload.attempt !== record.attempt) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_BUDGET_INVALID",
          `sequence ${event.sequence}: retry_scheduled attempt=${payload.attempt} does not match the consumed attempt ${record.attempt}`,
          event.sequence,
        );
      }
      if (payload.attempt >= payload.max_attempts || payload.retry_at === undefined) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_BUDGET_INVALID",
          `sequence ${event.sequence}: retry_scheduled requires remaining budget and retry_at (got attempt=${payload.attempt}/${payload.max_attempts})`,
          event.sequence,
        );
      }
      record.phase = "waiting_retry";
      record.retry_at = payload.retry_at;
      break;
    }
    case "presentation_generation_failed": {
      const record = requirePendingRecord(generation.requests, next.generation_slot, payload, event.sequence);
      if (payload.attempt !== record.attempt || payload.epoch !== record.epoch) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_REQUEST_STATE_INVALID",
          `sequence ${event.sequence}: failed snapshot attempt/epoch (${payload.attempt}/${payload.epoch}) drifts from the registered request (${record.attempt}/${record.epoch}) — late or forged worker result`,
          event.sequence,
        );
      }
      if (payload.error_class === "RETRY_EXHAUSTED" && payload.attempt !== payload.max_attempts) {
        throw new RuntimeStateReducerV9Error(
          "GENERATION_BUDGET_INVALID",
          `sequence ${event.sequence}: RETRY_EXHAUSTED requires the budget to be spent (attempt=${payload.attempt}/${payload.max_attempts})`,
          event.sequence,
        );
      }
      record.status = "failed";
      record.error_class = payload.error_class;
      delete record.phase;
      delete record.retry_at;
      generation.slot = { status: "failed", request_id: payload.request_id };
      break;
    }
    case "presentation_generation_invalidated": {
      const record = requirePendingRecord(generation.requests, next.generation_slot, payload, event.sequence);
      record.status = "cancelled";
      record.cancel_reason = payload.cancel_reason;
      delete record.phase;
      delete record.retry_at;
      generation.slot = { status: "idle" };
      break;
    }
    default:
      throw new RuntimeStateReducerV9Error("REDUCER_INVARIANT", `internal: non-generation event ${event.event_type} routed to generation fold`, event.sequence);
  }

  next.generation_slot = generation.slot;
  next.generation_requests = generation.requests;
  return adoptV7Lineage(next, state);
}

function requirePendingRecord(
  requests: readonly GenerationRecord[],
  slot: TutorRuntimeStateV9["generation_slot"],
  payload: V9GenerationEventPayload,
  sequence: number,
): GenerationRecord {
  const record = requests.find((candidate) => candidate.request_id === payload.request_id);
  if (!record) {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_REQUEST_STATE_INVALID",
      `sequence ${sequence}: generation event references unknown request ${payload.request_id}`,
      sequence,
    );
  }
  if (record.status !== "pending") {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_REQUEST_STATE_INVALID",
      `sequence ${sequence}: generation event targets request ${payload.request_id} in terminal status ${record.status} (late/fenced worker zero-commit)`,
      sequence,
    );
  }
  return record;
}

/** planned(v4) 提交的生成态收口：带 generation ⇒ request committed + slot 原子清空。 */
function settleGenerationOnPlanned(state: TutorRuntimeStateV9, event: StoredV9Event, payload: V9PresentationSequencePlannedPayload): TutorRuntimeStateV9 {
  if (!payload.generation) {
    if (state.generation_slot.status === "pending") {
      throw new RuntimeStateReducerV9Error(
        "GENERATION_SLOT_MISMATCH",
        `sequence ${event.sequence}: deterministic planned ${payload.sequence_id} cannot enter while generation request ${state.generation_slot.request_id} is pending (invalidate first)`,
        event.sequence,
      );
    }
    return state;
  }
  const record = recordOf(state, payload.generation.request_id);
  if (!record) {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_REQUEST_STATE_INVALID",
      `sequence ${event.sequence}: planned ${payload.sequence_id} carries generation ${payload.generation.request_id} which has no registered request`,
      event.sequence,
    );
  }
  if (record.status !== "pending") {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_REQUEST_STATE_INVALID",
      `sequence ${event.sequence}: planned ${payload.sequence_id} commits generation ${payload.generation.request_id} already in status ${record.status} (at most one committed sequence per request)`,
      event.sequence,
    );
  }
  if (
    record.presenter_pin.provider !== payload.generation.presenter_pin.provider
    || record.presenter_pin.model_id !== payload.generation.presenter_pin.model_id
    || record.presenter_pin.prompt_version !== payload.generation.presenter_pin.prompt_version
    || record.presenter_pin.context_builder_version !== payload.generation.presenter_pin.context_builder_version
    || record.presenter_pin.tool_catalog_version !== payload.generation.presenter_pin.tool_catalog_version
    || record.input_digest !== payload.generation.input_digest
  ) {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_REQUEST_STATE_INVALID",
      `sequence ${event.sequence}: planned ${payload.sequence_id} generation provenance drifts from the reserved request ${payload.generation.request_id} (pin/digest mismatch — late or forged candidate)`,
      event.sequence,
    );
  }
  if (payload.generation.epoch !== record.epoch || payload.generation.attempt !== record.attempt) {
    throw new RuntimeStateReducerV9Error(
      "GENERATION_SLOT_MISMATCH",
      `sequence ${event.sequence}: planned ${payload.sequence_id} carries attempt/epoch (${payload.generation.attempt}/${payload.generation.epoch}) that lost the fence (registered ${record.attempt}/${record.epoch}) — zero commit for late workers`,
      event.sequence,
    );
  }
  const next: TutorRuntimeStateV9 = { ...state };
  next.generation_requests = state.generation_requests.map((candidate) =>
    candidate.request_id === record.request_id
      ? (() => {
          const settled = { ...candidate, status: "committed" as const, sequence_id: payload.sequence_id };
          delete settled.phase;
          delete settled.retry_at;
          return settled;
        })()
      : candidate,
  );
  next.generation_slot = { status: "idle" };
  return adoptV7Lineage(next, state);
}

/** 单事件归约（纯函数）。事件须已过 canonical v9 判定。 */
export function applyV9Event(state: TutorRuntimeStateV9, event: StoredV9Event, context: V9FoldContext): TutorRuntimeStateV9 {
  const eventType = event.event_type;
  const prior=recoveryLineage.get(state)??{plans:new Map(),events:[]};
  const track=(next:TutorRuntimeStateV9):TutorRuntimeStateV9=>{
    const plans=new Map(prior.plans);
    if(eventType==="presentation_sequence_planned") {const p=event.payload as unknown as V9PresentationSequencePlannedPayload;plans.set(p.sequence_id,p);}
    recoveryLineage.set(next,{plans,events:[...prior.events,event],previous:event,failedBeforePrevious:state.presentation_cursor});
    return next;
  };
  if (
    eventType === "presentation_generation_requested"
    || eventType === "presentation_generation_attempt_started"
    || eventType === "presentation_generation_retry_scheduled"
    || eventType === "presentation_generation_failed"
    || eventType === "presentation_generation_invalidated"
  ) {
    return track(applyGenerationEventV9(state, event));
  }
  // 共享事件：委托 V7 fold（lineage/capability/交付门禁同链）。cloneState 的
  // spread 保留 v4 增量字段；随后按 v9 语义收口 planned 的生成态。
  const recovery=eventType === "presentation_sequence_planned" && verifiedRecoveryReference(state,event,event.payload as unknown as V9PresentationSequencePlannedPayload);
  const folded = applyV7Event(state as unknown as TutorRuntimeStateV7, event as never, context) as unknown as TutorRuntimeStateV9;
  if (eventType === "presentation_sequence_planned") {
    return track(recovery ? folded : settleGenerationOnPlanned(folded, event, event.payload as unknown as V9PresentationSequencePlannedPayload));
  }
  return track(folded);
}

/** 全量折叠（session_started 起步 + 逐事件归约；在线预折叠与重建共用）。 */
export function foldCommittedV9Events(events: readonly StoredV9Event[], context: V9FoldContext): TutorRuntimeStateV9 {
  if (events.length === 0) {
    throw new RuntimeStateReducerV9Error("MISSING_SESSION_START", "committed stream is empty");
  }
  let state = initialStateFromSessionStartedV9(events[0]);
  for (const event of events) {
    state = applyV9Event(state, event, context);
  }
  return state;
}

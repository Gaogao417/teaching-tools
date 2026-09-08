/**
 * Session kernel codec 注入接口（F7 Step 2 — V6 Session Kernel 抽取缝）。
 *
 * PLAN.md Step 2：「将 SQLite append/revision/idempotency/causation 逻辑抽成按
 * codec 和 reducer 注入的内部 kernel。TutorSessionKernelV5 继续使用旧
 * codec/reducer，行为和测试不变；新增 V6 kernel、reducer、rebuilder。」
 *
 * 一个 codec = 一个事件合同版本的完整词表与折叠语义：
 * - 存储标记（`event_schema` 列值 + canonical schema const）；
 * - causation 必带集（store 写侧提前给出可读错误；canonical superRefine 为准）；
 * - 纯 reducer（applyEvent / foldCommitted / initialState）+ fold context 解析；
 * - 事件与状态的 canonical Zod 判定（rebuilder 组装/收口用）；
 * - 错误工厂（V5/V6 各自封闭错误码枚举；V6 增加 SESSION_VERSION_UNSUPPORTED）；
 * - 语义比较钩子（G2 对账 parity 用）。
 *
 * fold context（C）：V5 为 undefined（无跨事件外部 pin 依赖）；V6 为
 * session-pinned capability registry——由 `resolveFoldContext` 从已提交
 * session_started payload 的 pin 确定性重导出，append 事务内每次重解析
 * （append 边界自证，不信任调用方缓存）。
 */
import type { z } from "zod";
import type { StoredSessionEvent } from "./sessionKernelTypes";

/** G2 对账差异记录（与 RuntimeStateSemanticComparatorV5.SemanticDifference 结构同构）。 */
export interface SessionStateDifference {
  path: string;
  left: unknown;
  right: unknown;
  ignored: boolean;
}

export interface SessionStateComparison {
  equal: boolean;
  differences: SessionStateDifference[];
}

export interface SessionKernelCodec<S, C = undefined> {
  /** tutor_sessions.event_schema 列写入值（'v5' | 'v6'）。 */
  readonly eventSchemaColumn: string;
  /** canonical 事件 schema const（envelope 组装与 Zod 判定派发键）。 */
  readonly eventSchemaConst: string;
  /** 要求 causation_sequence 的事件集合（镜像 canonical 各版本必带集）。 */
  readonly causationRequired: ReadonlySet<string>;
  /**
   * 版本隔离错误码（store 写侧）：V5 = VALIDATION_FAILED（既有行为）；
   * V6 = SESSION_VERSION_UNSUPPORTED（spec §2.4：V6 client 恢复/写入 v5 会话
   * 返回 SESSION_VERSION_UNSUPPORTED，UI 明示重新开始）。
   */
  readonly storeSchemaMismatchCode: string;
  /**
   * 版本隔离错误码（rebuilder 读侧）：V5 = SCHEMA_ISOLATION（既有行为）；
   * V6 = SESSION_VERSION_UNSUPPORTED（restore 409 集成员）。
   */
  readonly integritySchemaMismatchCode: string;
  /** store 写侧错误构造（V5StoreErrorCode / V6StoreErrorCode 封闭枚举由 codec 收窄）。 */
  readonly makeStoreError: (code: string, message: string) => Error;
  /** 读侧完整性错误构造（含 relatedSequence 时附于错误）。 */
  readonly makeIntegrityError: (code: string, message: string, relatedSequence?: number) => Error;
  /** canonical 事件 envelope Zod（rebuilder 逐行组装判定）。 */
  readonly eventEnvelopeSchema: z.ZodType<StoredSessionEvent>;
  /** canonical 状态 Zod（rebuilder 折叠结果收口判定）。 */
  readonly stateSchema: z.ZodType<S>;
  /** 单事件归约（纯函数；与在线/重建共用，无第二条 state machine）。 */
  readonly applyEvent: (state: S, event: StoredSessionEvent, ctx: C) => S;
  /** 全量折叠（session_started 起步 + 逐事件归约；在线预折叠与重建共用）。 */
  readonly foldCommitted: (events: readonly StoredSessionEvent[], ctx: C) => S;
  /** 首事件（session_started）起步 state。 */
  readonly initialStateFromSessionStarted: (event: StoredSessionEvent) => S;
  /**
   * 从已提交 session_started payload 解析 fold context（V6 = session-pinned
   * capability registry，含 catalog pin 对账；V5 = undefined）。pin 不可变，
   * 结果确定性；解析失败即 fail closed（零事件、零状态变更）。
   */
  readonly resolveFoldContext: (sessionStartedPayload: Record<string, unknown>) => C;
  /** G2 对账语义比较（在线缓存 vs 全量重建）。 */
  readonly compareStates: (left: S, right: S) => SessionStateComparison;
  /** Whole transaction invariants; runs inside SQLite transaction before commit. */
  readonly validateBatchEnd?: (before: S, events: readonly StoredSessionEvent[], after: S, context: C) => void;
}

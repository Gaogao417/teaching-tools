/**
 * RuntimeState semantic comparator（F2 — Event / Revision / Replay 内核）。
 *
 * 用途：live（在线 kernel 缓存）vs rebuilt（事件流重建）的语义比较，以及
 * committed 事件流对账（F6 的 live/replay parity 复用此模块）。
 *
 * Ephemeral 白名单（f2-scope-ledger「语义比较与 ephemeral 白名单」显式登记）：
 * - STATE 层：`SEMANTICALLY_IGNORED_STATE_FIELDS = []`（空集）。F1 state/v1 按
 *   ephemeral boundary 设计为全持久语义（hover/drag/pan/animation 留在前端，
 *   ADR-008 §6 不变量 6），因此 live 与 rebuilt 的 TutorRuntimeState 语义比较
 *   不允许忽略任何 canonical 字段——白名单为空是设计事实，不是遗漏。
 *   未来要加入任何字段，必须先在 f2-scope-ledger 与此处同步登记理由。
 * - EVENT 行层：`SEMANTICALLY_IGNORED_EVENT_FIELDS = ["recorded_at"]`。DB 写入
 *   时间戳是写入侧元数据，不属于 canonical v5 envelope；重放/迁移对账时忽略。
 *   sequence / state_revision / occurred_at / idempotency_key /
 *   causation_sequence / payload 全部参与比较。
 *
 * 白名单以外的任何差异都判 unequal（fail visible，不静默）。
 */

export interface SemanticDifference {
  path: string;
  left: unknown;
  right: unknown;
  /** 差异字段在显式白名单内（计入报告但不影响 equal 判定）。 */
  ignored: boolean;
}

export interface SemanticComparison {
  equal: boolean;
  differences: SemanticDifference[];
}

/** state/v1 层显式忽略名单（见文件头；空集=不允许忽略任何 canonical 字段）。 */
export const SEMANTICALLY_IGNORED_STATE_FIELDS: readonly string[] = [];

/** 事件原始行层显式忽略名单（DB 写入时间戳）。 */
export const SEMANTICALLY_IGNORED_EVENT_FIELDS: readonly string[] = ["recorded_at"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function deepDiff(
  left: unknown,
  right: unknown,
  path: string,
  ignored: ReadonlySet<string>,
  out: SemanticDifference[],
): void {
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Array.from(new Set([...Object.keys(left), ...Object.keys(right)])).sort();
    for (const key of keys) {
      const childPath = path === "" ? key : `${path}.${key}`;
      deepDiff(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        childPath,
        ignored,
        out,
      );
    }
    return;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      out.push({ path: `${path}.length`, left: left.length, right: right.length, ignored: ignored.has(`${path}.length`) });
      return;
    }
    left.forEach((item, index) => deepDiff(item, right[index], `${path}[${index}]`, ignored, out));
    return;
  }
  if (left !== right) {
    // 白名单按「全路径或叶字段名」匹配（事件行层的 recorded_at 在数组下标
    // 路径如 `[0].recorded_at`，叶名匹配保证字段级语义）。
    const leaf = path.slice(path.lastIndexOf(".") + 1);
    out.push({ path, left, right, ignored: ignored.has(path) || ignored.has(leaf) });
  }
}

function compare(left: unknown, right: unknown, ignoredFields: readonly string[]): SemanticComparison {
  const differences: SemanticDifference[] = [];
  deepDiff(left, right, "", new Set(ignoredFields), differences);
  return { equal: differences.every((difference) => difference.ignored), differences };
}

/**
 * TutorRuntimeState 语义比较（live vs rebuilt）。默认不忽略任何字段
 * （SEMANTICALLY_IGNORED_STATE_FIELDS 为空集）；options.ignoredFields 仅供
 * 未来 F3/F6 投影层携带已登记的 ephemeral 字段，调用方自证合规。
 */
export function compareTutorRuntimeStatesSemantically(
  left: unknown,
  right: unknown,
  options?: { ignoredFields?: readonly string[] },
): SemanticComparison {
  const ignored = options?.ignoredFields ?? SEMANTICALLY_IGNORED_STATE_FIELDS;
  return compare(left, right, ignored);
}

/**
 * committed 事件流对账（canonical 事件或含 recorded_at 的原始行均可）。
 * recorded_at 在显式白名单内；其余任何字段差异都判 unequal。
 */
export function compareCommittedEventStreamsSemantically(
  left: readonly unknown[],
  right: readonly unknown[],
  options?: { ignoredFields?: readonly string[] },
): SemanticComparison {
  const ignored = options?.ignoredFields ?? SEMANTICALLY_IGNORED_EVENT_FIELDS;
  return compare(left, right, ignored);
}

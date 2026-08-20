/**
 * publication 校验（Phase 1 退出门禁 3，fail closed）。
 * 与 Python 侧 integrations/ai_teaching_contracts/publication.py 同一规则：
 * 1. 只有 Approved 状态的 authoring/planning artifact 可发布；
 * 2. canonical 对象内任何字符串不得是绝对本地路径或 file:// URI。
 */

export const PUBLISHABLE_SCHEMAS: ReadonlySet<string> = new Set([
  "ai_teaching_question_truth/v1",
  "ai_teaching_question_truth/v2",
  "ai_teaching_teaching_approach/v1",
  "ai_teaching_teaching_approach/v2",
  "ai_teaching_teaching_approach/v3",
  "ai_teaching_approach_set/v1",
  "ai_teaching_tutor_plan_bundle/v1",
  "ai_teaching_tutor_plan_bundle/v2",
]);

const NOT_PUBLISHED_STATUSES: ReadonlySet<string> = new Set([
  "Draft",
  "InReview",
  "Stale",
  "Disabled",
  "Superseded",
]);

const UNIX_ABS = /(?<![A-Za-z0-9])\/(?:Users|home|Volumes|tmp|var|opt|etc|private)\//;
const WIN_ABS = /(?<![A-Za-z0-9])[A-Za-z]:\\/;
const FILE_SCHEME = "file://";

export type PublicationErrorCode =
  | "not_a_canonical_object"
  | "not_publishable_type"
  | "not_approved"
  | "absolute_local_path";

export interface PublicationIssue {
  readonly code: PublicationErrorCode;
  readonly detail: string;
}

function* iterStrings(
  node: unknown,
  prefix = "$",
): Generator<{ where: string; value: string }> {
  if (typeof node === "string") {
    yield { where: prefix, value: node };
  } else if (Array.isArray(node)) {
    for (let index = 0; index < node.length; index += 1) {
      yield* iterStrings(node[index], `${prefix}[${index}]`);
    }
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      yield* iterStrings(value, `${prefix}.${key}`);
    }
  }
}

function absolutePathReason(value: string): string | null {
  if (value.includes(FILE_SCHEME)) {
    return "file:// URI is forbidden in canonical artifacts";
  }
  if (UNIX_ABS.test(value)) {
    return "absolute local path is forbidden in canonical artifacts";
  }
  if (WIN_ABS.test(value)) {
    return "absolute windows path is forbidden in canonical artifacts";
  }
  return null;
}

/** 返回全部拒绝原因；空数组 = 可发布。 */
export function validateForPublication(payload: unknown): PublicationIssue[] {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return [{ code: "not_a_canonical_object", detail: typeof payload }];
  }
  const record = payload as Record<string, unknown>;
  const schema = record.schema;
  if (typeof schema !== "string" || !PUBLISHABLE_SCHEMAS.has(schema)) {
    return [{ code: "not_publishable_type", detail: String(schema) }];
  }
  const issues: PublicationIssue[] = [];
  const status = record.status;
  if (typeof status !== "string" || NOT_PUBLISHED_STATUSES.has(status) || status !== "Approved") {
    issues.push({ code: "not_approved", detail: String(status) });
  }
  for (const { where, value } of iterStrings(record)) {
    const reason = absolutePathReason(value);
    if (reason) {
      issues.push({ code: "absolute_local_path", detail: `${where}: ${reason}` });
    }
  }
  return issues;
}

/**
 * ApproachSet ↔ TutorPlan 传递依赖对账（Phase 5 UI 集成 §1）。
 *
 * 单一实现供两侧消费：planBuild 的 v3 升级/发布链（构建期 fail closed）
 * 与 tutorSession 的 TopicQuestionSelector（装载期 fail closed）。纯函数、
 * 无 IO；Plan v3 的 approach_refs 必须与其 approach_set_ref 指向的
 * ApproachSet.parts 小问选择逐 part 三元组一致（artifact_id/version/hash）。
 */
import type { ApproachSetPayload, TutorPlanV3Payload } from "./canonicalInputs";

export function refEquals(
  ref: { artifact_id: string; version: string; content_hash: string },
  current: { artifact_id: string; version: string; content_hash: string },
): boolean {
  return (
    ref.artifact_id === current.artifact_id &&
    ref.version === current.version &&
    ref.content_hash === current.content_hash
  );
}

/** 省略 part_id 的整题 part 按装载层约定映射为 "1"（与 truth part 约定一致）。 */
export function approachRefsMatchSet(
  plan: Pick<TutorPlanV3Payload, "approach_refs">,
  approachSet: Pick<ApproachSetPayload, "parts">,
): boolean {
  const setParts = approachSet.parts.map((part) => ({
    part_id: part.part_id ?? "1",
    approach: part.approach,
  }));
  if (plan.approach_refs.length !== setParts.length) return false;
  const byPart = new Map(setParts.map((part) => [part.part_id, part.approach]));
  for (const ref of plan.approach_refs) {
    const chosen = byPart.get(ref.part_id);
    if (!chosen || !refEquals(ref, chosen)) return false;
  }
  return true;
}

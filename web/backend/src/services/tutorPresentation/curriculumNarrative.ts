/**
 * 课程进度叙事（波次 G 任务 3：讲解质量护栏——反馈 (b) confirm/进度类话术接地）。
 *
 * 进度语义（推进到哪步、还差什么）只能从 curriculum 投影确定性生成，
 * 模型话术只承载讲解内容——杜绝与课程状态不符的越级宣称（实证：课程停
 * 在第 1 小问 CP2，DeepSeek confirm 却说「第一问完成、进入第二问」）。
 *
 * 接地不变量：某 part 的结论操作步（action_template）没有 accepted 证据
 * 时，该 part 永远不会被叙事跳过——焦点 part 取第一个「还有推理剩余或
 * 结论待提交」的 part，结构上不可能宣称进入下一小问。
 */
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";

function satisfiedConclusionResourceIds(state: TutorRuntimeState): Set<string> {
  return new Set(
    state.workspace.action_history
      .filter((entry) => entry.resource_id && entry.outcome === "completed")
      .map((entry) => entry.resource_id as string),
  );
}

/** 该 part 是否还有挂 action_template 且尚无 accepted 证据的结论操作步。 */
function hasPendingConclusion(plan: TutorPlanV2Payload, state: TutorRuntimeState, checkpointIds: string[]): boolean {
  const satisfied = satisfiedConclusionResourceIds(state);
  return plan.resources.some(
    (resource) =>
      (resource.kind === "action_template" || resource.kind === "workspace") &&
      resource.checkpoint_id !== undefined &&
      checkpointIds.includes(resource.checkpoint_id) &&
      !satisfied.has(resource.resource_id),
  );
}

/** confirm/进度类话术的接地进度叙事（纯函数；不含答案值，可过泄漏自查）。 */
export function renderProgressNarrative(
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
): string {
  const parts = state.curriculum.parts;
  if (state.curriculum.completed) {
    return "这道题的推理和结论都完成了。";
  }
  const focusIndex = parts.findIndex((part) => {
    const remaining = part.checkpoint_ids.filter((id) => !part.completed_checkpoints.includes(id));
    return remaining.length > 0 || hasPendingConclusion(plan, state, part.checkpoint_ids);
  });
  if (focusIndex < 0) {
    return "推理已经全部完成，把结论提交就可以收尾了。";
  }
  const part = parts[focusIndex];
  const total = part.checkpoint_ids.length;
  const done = part.checkpoint_ids.filter((id) => part.completed_checkpoints.includes(id)).length;
  const partLabel = parts.length > 1 ? `第 ${focusIndex + 1} 小问（共 ${parts.length} 小问）` : "本题";
  const remaining = total - done;
  if (remaining > 0) {
    return `现在在${partLabel}：推理已过 ${done}/${total} 步，还剩 ${remaining} 步。`;
  }
  return `${partLabel}的推理已经全部成立，还差把这一小问的结论在右侧操作提交。`;
}

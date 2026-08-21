/**
 * build_context / grounding 校验的纯函数（Phase 5 remediation）。
 *
 * LangGraph 的 build_context 节点只做确定性裁剪：当前与相邻 checkpoint 的
 * 对齐候选、合法备选路线（含节点序）、本 part 常见偏差。模型输出的
 * grounding_refs 必须能落到这里的候选上，否则对齐结论确定性降级
 * （expected/alternate → unclear）。阈值规则同样在这里确定性执行：
 * expected/alternate ≥0.85 且 refs 合法、incorrect ≥0.75、其余 → unclear。
 */
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";

export interface CheckpointCandidate {
  checkpoint_id: string;
  expected_reasoning: string;
  accepted_alternatives: string[];
  common_deviations: string[];
}

export interface RouteCandidate {
  route_id: string;
  part_id: string;
  role: string;
  entry_condition?: string;
  completion_condition?: string;
  checkpoint_ids: string[];
}

export interface AlignmentContextView {
  current_checkpoint_id: string;
  part_id: string;
  candidates: CheckpointCandidate[];
  alternate_routes: RouteCandidate[];
}

export const EXPECTED_CONFIDENCE_THRESHOLD = 0.85;
export const INCORRECT_CONFIDENCE_THRESHOLD = 0.75;

/** 相邻 = 同 part 内按 checkpoint 声明序与当前节点相邻（含当前）。
 *  模型只能在这些节点里对齐；远距离节点的错误表述由本 part 的
 *  common_deviations（题目级陷阱清单）候选承载。 */
export function buildAlignmentContext(
  plan: TutorPlanV2Payload,
  state: TutorRuntimeState,
): AlignmentContextView {
  const currentId = state.reasoning.current_checkpoint_id;
  const current = plan.checkpoints.find((entry) => entry.checkpoint_id === currentId);
  const partId = current?.part_id ?? "1";
  const partCheckpoints = plan.checkpoints.filter((entry) => entry.part_id === partId);
  const index = partCheckpoints.findIndex((entry) => entry.checkpoint_id === currentId);
  const included = new Set(
    partCheckpoints
      .filter((_entry, position) => Math.abs(position - index) <= 1)
      .map((entry) => entry.checkpoint_id),
  );
  for (const entry of partCheckpoints) {
    if ((entry.common_deviations ?? []).length) included.add(entry.checkpoint_id);
  }
  const candidates: CheckpointCandidate[] = [...included]
    .map((checkpointId) => plan.checkpoints.find((entry) => entry.checkpoint_id === checkpointId))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .map((entry) => ({
      checkpoint_id: entry.checkpoint_id,
      expected_reasoning: entry.expected_reasoning,
      accepted_alternatives: [...(entry.accepted_alternatives ?? [])],
      common_deviations: [...(entry.common_deviations ?? [])],
    }));
  const alternate_routes: RouteCandidate[] = plan.recommended_routes
    .filter((route) => (route.part_id ?? "1") === partId)
    .map((route) => ({
      route_id: route.route_id,
      part_id: route.part_id ?? "1",
      role: route.role,
      entry_condition: route.entry_condition,
      completion_condition: route.completion_condition,
      checkpoint_ids: [...route.checkpoint_ids],
    }));
  return { current_checkpoint_id: currentId, part_id: partId, candidates, alternate_routes };
}

export type GroundingClassification = "expected_checkpoint" | "alternate_valid" | "incorrect";

export interface GroundingResolution {
  ok: boolean;
  errors: string[];
  /** ref 命中的节点；deviation 归当前节点，route.entry 为路线首节点。 */
  checkpoint_id?: string;
  route_id?: string;
  classification?: GroundingClassification;
}

/** 校验单条 grounding ref 是否落在 context view 的候选上。 */
export function validateGroundingRef(ref: string, view: AlignmentContextView): GroundingResolution {
  const candidateOf = (checkpointId: string) =>
    view.candidates.find((entry) => entry.checkpoint_id === checkpointId);

  let match = /^([A-Za-z0-9-]+)\.expected$/.exec(ref);
  if (match) {
    const checkpointId = match[1];
    return candidateOf(checkpointId)
      ? { ok: true, errors: [], checkpoint_id: checkpointId, classification: "expected_checkpoint" }
      : { ok: false, errors: [`${ref}: 节点不在对齐候选内`] };
  }
  match = /^([A-Za-z0-9-]+)\.alt\[(\d+)\]$/.exec(ref);
  if (match) {
    const checkpointId = match[1];
    const index = Number(match[2]);
    const candidate = candidateOf(checkpointId);
    if (!candidate) return { ok: false, errors: [`${ref}: 节点不在对齐候选内`] };
    if (index >= candidate.accepted_alternatives.length) {
      return { ok: false, errors: [`${ref}: accepted_alternatives 序号越界`] };
    }
    return { ok: true, errors: [], checkpoint_id: checkpointId, classification: "alternate_valid" };
  }
  match = /^([A-Za-z0-9-]+)\.deviation\[(\d+)\]$/.exec(ref);
  if (match) {
    const checkpointId = match[1];
    const index = Number(match[2]);
    const candidate = candidateOf(checkpointId);
    if (!candidate) return { ok: false, errors: [`${ref}: 节点不在对齐候选内`] };
    if (index >= candidate.common_deviations.length) {
      return { ok: false, errors: [`${ref}: common_deviations 序号越界`] };
    }
    return {
      ok: true,
      errors: [],
      checkpoint_id: view.current_checkpoint_id,
      classification: "incorrect",
    };
  }
  match = /^route\.([A-Za-z0-9-]+)\.entry$/.exec(ref);
  if (match) {
    const routeId = match[1];
    const route = view.alternate_routes.find((entry) => entry.route_id === routeId);
    if (!route) return { ok: false, errors: [`${ref}: 路线不在本 part 合法路线内`] };
    return {
      ok: true,
      errors: [],
      route_id: routeId,
      ...(route.checkpoint_ids[0] ? { checkpoint_id: route.checkpoint_ids[0] } : {}),
      classification: "alternate_valid",
    };
  }
  return { ok: false, errors: [`${ref}: 格式非法`] };
}

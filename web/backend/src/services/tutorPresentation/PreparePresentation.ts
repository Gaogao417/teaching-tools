/**
 * Presenter：TutorMove → PresentationAction 派生（Phase 5 / P5-09，PRD 04 §2.4）。
 *
 * 一条 Move 产生零到多个动作：
 * - Explain → 1..n 条 Voice（voice_seed 开场 + 讲解资源原文）；
 * - Prompt → 1 条 Voice（脚手架或 probe 资源）+ 可选 1 条 WorkspaceAction
 *   （当前 checkpoint 有 action_template 且无进行中的 workspace 步时，
 *   把结论交互步交给学生操作）；
 * - Hint → 1 条 Voice（hint 资源原文，无包装句——2026-08-21 教师裁定）；
 * - Confirm → 仅 1 条 Voice（允许只说话）；Wait → 零动作（AC-4）；
 * - Repair → 1 条 Voice（repair 资源原文）。
 *
 * 泄漏自查兜底：prompt/confirm 的脚手架句必须不含当前 part 的答案值
 * （资源文本已在 materializer 门禁过审，此处只查自产文本——双保险）。
 */
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";
import type { TutorDecision } from "../tutorPolicy/TutorMove";
import { normalizeForAlignment } from "../tutorSession/ReasoningAligner";
import { VOICE_SCAFFOLDS, type VoiceActionPlan } from "./VoiceAction";
import type { WorkspaceActionPlan } from "./WorkspaceAction";

export interface PresentationPlan {
  voice: VoiceActionPlan[];
  workspace: WorkspaceActionPlan[];
}

export interface PresentationResult {
  ok: boolean;
  errors: string[];
  presentation?: PresentationPlan;
}

export interface PreparePresentationInput {
  decision: TutorDecision;
  plan: TutorPlanV2Payload;
  state: TutorRuntimeState;
  /** 会话内 id 序号（coordinator 按事件流派生，replay 一致）。 */
  voiceOrdinal: number;
  workspaceOrdinal: number;
  sessionId: string;
  /** 当前 part 的 canonical answer 值（脚手架泄漏自查用）。 */
  answerValues: readonly string[];
}

function resourceTexts(input: PreparePresentationInput): string[] {
  const texts: string[] = [];
  for (const resourceId of input.decision.resource_ids ?? []) {
    const resource = input.plan.resources.find((entry) => entry.resource_id === resourceId);
    if (resource?.content) texts.push(resource.content);
  }
  return texts;
}

function scaffoldLeakCheck(texts: readonly string[], answerValues: readonly string[]): string[] {
  const problems: string[] = [];
  const normalizedTexts = texts.map((text) => normalizeForAlignment(text));
  for (const value of answerValues) {
    const normalizedValue = normalizeForAlignment(value);
    if (!normalizedValue || normalizedValue.length < 1) continue;
    for (let index = 0; index < texts.length; index += 1) {
      if (normalizedTexts[index].includes(normalizedValue)) {
        problems.push(`脚手架文本命中答案值「${value}」`);
      }
    }
  }
  return problems;
}

export function preparePresentation(input: PreparePresentationInput): PresentationResult {
  const { decision, plan, state } = input;
  const voice: VoiceActionPlan[] = [];
  const workspace: WorkspaceActionPlan[] = [];
  const scaffoldTexts: string[] = [];

  switch (decision.move_type) {
    case "explain":
    case "hint":
    case "repair": {
      const texts = resourceTexts(input);
      if (!texts.length) {
        return { ok: false, errors: [`${decision.move_type} move 无可用资源文本（资源缺失）`] };
      }
      texts.forEach((text, index) => {
        voice.push({
          action_id: `VA-${input.sessionId}-${input.voiceOrdinal + index}`,
          decision_id: decision.decision_id,
          text,
          interruptible: true,
          ...(decision.resource_ids?.[index] ? { resource_id: decision.resource_ids[index] } : {}),
        });
      });
      break;
    }
    case "prompt": {
      const probeResource = (decision.resource_ids ?? [])
        .map((resourceId) => plan.resources.find((entry) => entry.resource_id === resourceId))
        .find((resource) => resource?.kind === "diagnostic_probe");
      const scaffold = VOICE_SCAFFOLDS[decision.purpose_code] ?? VOICE_SCAFFOLDS["prompt.generic"];
      const text = probeResource?.content ?? scaffold;
      if (!probeResource) scaffoldTexts.push(text);
      voice.push({
        action_id: `VA-${input.sessionId}-${input.voiceOrdinal}`,
        decision_id: decision.decision_id,
        text,
        interruptible: true,
        ...(probeResource ? { resource_id: probeResource.resource_id } : {}),
      });

      // Workspace 附着：把结论交互步交给学生（prompt = 邀请学生操作）。
      const checkpointId = decision.checkpoint_id ?? state.reasoning.current_checkpoint_id;
      const actionTemplate = plan.resources.find(
        (resource) => resource.kind === "action_template" && resource.checkpoint_id === checkpointId,
      );
      const alreadyCompleted = state.curriculum.parts
        .flatMap((part) => part.completed_checkpoints)
        .includes(checkpointId);
      if (actionTemplate && !state.workspace.active_action_id && !alreadyCompleted && actionTemplate.capability) {
        workspace.push({
          action_id: `WA-${input.sessionId}-${input.workspaceOrdinal}`,
          decision_id: decision.decision_id,
          capability: actionTemplate.capability,
          target_ids: [],
          command_payload: {
            resource_id: actionTemplate.resource_id,
            action_ref: actionTemplate.action_ref ?? actionTemplate.resource_id,
            mode: "learn",
          },
        });
      }
      break;
    }
    case "confirm": {
      const scaffold = VOICE_SCAFFOLDS[decision.purpose_code] ?? VOICE_SCAFFOLDS["confirm.generic"];
      scaffoldTexts.push(scaffold);
      voice.push({
        action_id: `VA-${input.sessionId}-${input.voiceOrdinal}`,
        decision_id: decision.decision_id,
        text: scaffold,
        interruptible: true,
      });
      break;
    }
    case "wait":
    default:
      // Wait：零 PresentationAction（AC-4），不派生任何动作。
      break;
  }

  const leaks = scaffoldLeakCheck(scaffoldTexts, input.answerValues);
  if (leaks.length) {
    return { ok: false, errors: leaks };
  }

  return { ok: true, errors: [], presentation: { voice, workspace } };
}

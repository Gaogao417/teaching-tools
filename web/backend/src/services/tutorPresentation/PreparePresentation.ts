/**
 * Presenter：TutorMove → PresentationAction 派生（Phase 5 / P5-09，PRD 04 §2.4；
 * 2026-08-21 追加裁定：责任边界合同化）。
 *
 * Presenter 是 WorkspaceAction 的唯一生产者：LLM/Policy 只选择
 * TutorMove.resource_ids；这里从服务端私有的 Plan/runtime projection 按
 * resource kind 确定性解析，不把 action_template JSON 当 Voice 文本。
 *
 * 一条 Move 产生零到多个动作（kind 分流，裁定 §5）：
 * - explanation / hint / diagnostic_probe / repair / voice_seed → Voice；
 * - action_template / workspace → Workspace（经 resolveWorkspacePresentation
 *   五重校验后升格为 ValidatedWorkspaceAction，未验证形态不出 Presenter 后）；
 * - Hint/Repair 始终逐字采用批准资源原文（2026-08-21 教师裁定）；
 * - Question/Explain/Prompt/Confirm 才允许受控动态 voiceText（智能链集成层
 *   注入，本模块对 prompt/confirm 的脚手架做泄漏自查兜底）。
 *
 * 泄漏自查兜底：prompt/confirm 的自产文本必须不含当前 part 的答案值
 * （资源文本已在 materializer 门禁过审，此处只查脚手架——双保险）。
 */
import type { TutorPlanV2Payload } from "../planBuild/canonicalInputs";
import type { TutorRuntimeState } from "../tutorSession/TutorRuntimeStateProjection";
import type { TutorDecision } from "../tutorPolicy/TutorMove";
import { normalizeForAlignment } from "../tutorSession/ReasoningAligner";
import type { RuntimeRegistrySnapshot } from "../planBuild/RuntimeRegistrySnapshot";
import type { RuntimeProjectionBody } from "../planBuild/MaterializeTutorPlan";
import { validateWorkspaceAction } from "./adapters/legacyActionRuntime/workspaceActionAdapter";
import { VOICE_SCAFFOLDS, type VoiceActionPlan } from "./VoiceAction";
import type { ValidatedWorkspaceAction, WorkspaceActionPlan } from "./WorkspaceAction";

export interface PresentationPlan {
  voice: VoiceActionPlan[];
  /** 未验证 Workspace 草案（仅 Presenter→resolver 内部流转，不下发学生）。 */
  workspace: WorkspaceActionPlan[];
}

export interface ValidatedPresentation {
  voice: VoiceActionPlan[];
  /** 已过五重校验的学生安全 Workspace 呈现（唯一可下发形态）。 */
  workspace: ValidatedWorkspaceAction[];
}

export interface PresentationResult {
  ok: boolean;
  errors: string[];
  presentation?: PresentationPlan;
}

/** Voice 可用（纯文本）资源 kind；action_template/workspace 一律走 Workspace。 */
const VOICE_RESOURCE_KINDS = new Set(["explanation", "hint", "diagnostic_probe", "repair", "voice_seed"]);
const WORKSPACE_RESOURCE_KINDS = new Set(["action_template", "workspace"]);

export function isVoiceResourceKind(kind: string): boolean {
  return VOICE_RESOURCE_KINDS.has(kind);
}

export function isWorkspaceResourceKind(kind: string): boolean {
  return WORKSPACE_RESOURCE_KINDS.has(kind);
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

function resourceTexts(input: PreparePresentationInput): Array<{ resource_id: string; text: string }> {
  const pairs: Array<{ resource_id: string; text: string }> = [];
  for (const resourceId of input.decision.resource_ids ?? []) {
    const resource = input.plan.resources.find((entry) => entry.resource_id === resourceId);
    // kind 分流（裁定 §5）：action_template 的 JSON 内容绝不当 Voice 文本。
    if (resource?.content && isVoiceResourceKind(resource.kind)) {
      pairs.push({ resource_id: resource.resource_id, text: resource.content });
    }
  }
  return pairs;
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

/** 决策引用的 action_template 资源（Presenter 派生 Workspace 的依据）。 */
function referencedActionTemplates(
  decision: TutorDecision,
  plan: TutorPlanV2Payload,
): TutorPlanV2Payload["resources"] {
  return (decision.resource_ids ?? [])
    .map((resourceId) => plan.resources.find((entry) => entry.resource_id === resourceId))
    .filter((resource): resource is NonNullable<typeof resource> =>
      Boolean(resource && isWorkspaceResourceKind(resource.kind)),
    );
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
      const pairs = resourceTexts(input);
      if (!pairs.length) {
        return { ok: false, errors: [`${decision.move_type} move 无可用资源文本（资源缺失）`] };
      }
      pairs.forEach((pair, index) => {
        voice.push({
          action_id: `VA-${input.sessionId}-${input.voiceOrdinal + index}`,
          decision_id: decision.decision_id,
          text: pair.text,
          interruptible: true,
          resource_id: pair.resource_id,
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

      // Workspace 派生（裁定 §4：LLM 只选 resource_id，Presenter 确定性解析）：
      // a) 决策显式引用的 action_template 资源；b) deterministic provider 的
      //    prompt.action_step 信号 → 当前 checkpoint 的模板（沿用 Phase 5 语义）。
      const templates = referencedActionTemplates(decision, plan);
      if (decision.purpose_code === "prompt.action_step") {
        const checkpointId = decision.checkpoint_id ?? state.reasoning.current_checkpoint_id;
        const auto = plan.resources.find(
          (resource) => resource.kind === "action_template" && resource.checkpoint_id === checkpointId,
        );
        if (auto && !templates.some((entry) => entry.resource_id === auto.resource_id)) {
          templates.push(auto);
        }
      }
      const alreadyCompleted = state.curriculum.parts
        .flatMap((part) => part.completed_checkpoints)
        .includes(decision.checkpoint_id ?? state.reasoning.current_checkpoint_id);
      for (const template of templates) {
        if (alreadyCompleted || state.workspace.active_action_id) continue;
        if (!template.capability) continue;
        workspace.push({
          action_id: `WA-${input.sessionId}-${input.workspaceOrdinal + workspace.length}`,
          decision_id: decision.decision_id,
          capability: template.capability,
          target_ids: [],
          command_payload: {
            resource_id: template.resource_id,
            action_ref: template.action_ref ?? template.resource_id,
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

// --------------------------------------------------------------------------- //
// 裁定 §6：Workspace 生命周期隔离（未验证草案 → 五重校验 → 可信呈现）
// --------------------------------------------------------------------------- //

export interface WorkspaceResolutionFailure {
  action: WorkspaceActionPlan;
  errors: string[];
}

export interface WorkspaceResolution {
  /** 可下发学生面的已验证呈现（唯一可信形态）。 */
  presentation: ValidatedWorkspaceAction[];
  /** 未通过校验的草案与错误（记录 runtime_failure，不签发、不下发）。 */
  failures: WorkspaceResolutionFailure[];
}

export function resolveWorkspacePresentation(
  plans: readonly WorkspaceActionPlan[],
  plan: TutorPlanV2Payload,
  projection: RuntimeProjectionBody,
  options?: { registrySnapshot?: RuntimeRegistrySnapshot; sessionKind?: "tutoring" | "assessment" },
): WorkspaceResolution {
  const presentation: ValidatedWorkspaceAction[] = [];
  const failures: WorkspaceResolutionFailure[] = [];
  for (const action of plans) {
    const validation = validateWorkspaceAction(action, plan, projection, options);
    if (!validation.ok || !validation.student_view) {
      failures.push({ action, errors: validation.ok ? ["解析缺失学生面投影"] : validation.errors });
      continue;
    }
    presentation.push({
      action_id: action.action_id,
      decision_id: action.decision_id,
      capability: action.capability,
      target_ids: [...action.target_ids],
      resource_id: validation.resource_id ?? "",
      action_ref: validation.action_ref ?? "",
      student_view: validation.student_view,
    });
  }
  return { presentation, failures };
}

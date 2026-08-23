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
import { validateVoiceText } from "../tutorIntelligence/proposalValidation";
import type { RuntimeRegistrySnapshot } from "../planBuild/RuntimeRegistrySnapshot";
import type { RuntimeProjectionBody } from "../planBuild/MaterializeTutorPlan";
import { validateWorkspaceAction } from "./adapters/legacyActionRuntime/workspaceActionAdapter";
import { buildTutorWorkspacePlan, type TutorWorkspacePlanContext } from "./adapters/legacyActionRuntime/workspacePlanProjector";
import { VOICE_SCAFFOLDS, type VoiceActionPlan } from "./VoiceAction";
import type { ValidatedWorkspaceAction, WorkspaceActionPlan } from "./WorkspaceAction";
import type { ActionContract } from "../../../../shared/actionRuntime";

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
  /** 智能链受控动态文案（裁定 §4：仅 explain/prompt/confirm 允许；
   *  hint/repair/wait 一律忽略；泄漏/长度自查失败时降级回批准资源/脚手架）。 */
  dynamicVoice?: { text: string; source: "model-generated" };
}

function dynamicVoiceText(
  input: PreparePresentationInput,
  moveType: string,
): { text: string; source: "model-generated" } | undefined {
  if (!input.dynamicVoice) return undefined;
  if (moveType !== "explain" && moveType !== "prompt" && moveType !== "confirm") return undefined;
  const check = validateVoiceText(input.dynamicVoice.text, input.answerValues);
  if (!check.ok) return undefined;
  return input.dynamicVoice;
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
      const dynamic = dynamicVoiceText(input, decision.move_type);
      if (dynamic) {
        // 受控动态文案（explain 允许）：一次 voice，来源 model-generated；
        // 资源仍在 decision.resource_ids 上留审计，不重复读为文本。
        voice.push({
          action_id: `VA-${input.sessionId}-${input.voiceOrdinal}`,
          decision_id: decision.decision_id,
          text: dynamic.text,
          interruptible: true,
          voice_source: "model-generated",
          generation_id: `VG-${input.sessionId}-${input.voiceOrdinal}`,
        });
        break;
      }
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
      const dynamic = dynamicVoiceText(input, decision.move_type);
      const probeResource = (decision.resource_ids ?? [])
        .map((resourceId) => plan.resources.find((entry) => entry.resource_id === resourceId))
        .find((resource) => resource?.kind === "diagnostic_probe");
      if (dynamic) {
        voice.push({
          action_id: `VA-${input.sessionId}-${input.voiceOrdinal}`,
          decision_id: decision.decision_id,
          text: dynamic.text,
          interruptible: true,
          voice_source: "model-generated",
          generation_id: `VG-${input.sessionId}-${input.voiceOrdinal}`,
        });
      } else {
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
      }

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
      const dynamic = dynamicVoiceText(input, decision.move_type);
      if (dynamic) {
        voice.push({
          action_id: `VA-${input.sessionId}-${input.voiceOrdinal}`,
          decision_id: decision.decision_id,
          text: dynamic.text,
          interruptible: true,
          voice_source: "model-generated",
          generation_id: `VG-${input.sessionId}-${input.voiceOrdinal}`,
        });
        break;
      }
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

  // 波次 E 真实链修复（part 终结结论步强制）：某 part 的全部 checkpoint 已
  // 完成、其结论 action_template 尚无 accepted 证据且无挂起动作时，无论
  // Provider 本回合选了什么 move，都确定性派生该结论操作步——结论提交是
  // 题目完成的一部分（curriculum.completed 同口径，见
  // TutorRuntimeStateProjection），不依赖模型主动选择 prompt.action_step
  //（真实 DeepSeek 曾在学生口述含最终答案时直接推进，跳过操作链）。
  if (!state.workspace.active_action_id) {
    const satisfied = new Set(
      (state.workspace.action_history ?? [])
        .filter((entry) => entry.resource_id && entry.outcome === "completed")
        .map((entry) => entry.resource_id as string),
    );
    const pendingConclusion = plan.resources.find((resource): resource is typeof resource & { capability: string } => {
      if (!isWorkspaceResourceKind(resource.kind) || !resource.capability) return false;
      if (satisfied.has(resource.resource_id)) return false;
      if (workspace.some((entry) => entry.command_payload?.resource_id === resource.resource_id)) return false;
      const checkpoint = plan.checkpoints.find((entry) => entry.checkpoint_id === resource.checkpoint_id);
      if (!checkpoint) return false;
      const part = state.curriculum.parts.find((candidate) =>
        candidate.checkpoint_ids.includes(checkpoint.checkpoint_id),
      );
      return Boolean(part && part.current_index >= part.checkpoint_ids.length);
    });
    if (pendingConclusion) {
      workspace.push({
        action_id: `WA-${input.sessionId}-${input.workspaceOrdinal + workspace.length}`,
        decision_id: decision.decision_id,
        capability: pendingConclusion.capability,
        target_ids: [],
        command_payload: {
          resource_id: pendingConclusion.resource_id,
          action_ref: pendingConclusion.action_ref ?? pendingConclusion.resource_id,
          mode: "learn",
        },
      });
    }
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
  options?: { registrySnapshot?: RuntimeRegistrySnapshot; sessionKind?: "tutoring" | "assessment"; question?: TutorWorkspacePlanContext },
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
      ...(options?.question && validation.template
        ? {
            action_plan: buildTutorWorkspacePlan(
              plan,
              validation.template,
              validation.student_view as ActionContract,
              options.question,
            ),
          }
        : {}),
    });
  }
  return { presentation, failures };
}

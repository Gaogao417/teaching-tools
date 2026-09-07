import { geometryVisualCommandSchema } from "../../../../../shared/canonical/visualSchemas";
import { applyDomainCommands } from "../../../../../shared/actionWorld";
import { reduceVisual } from "../../tutorSession/WorkspaceVisualReducer";
import type { VisualCompilationInput, CompiledPresentationPlanV5 } from "./IntentCompiler";
import { registerWorkspaceExplanationFragmentsV5 } from "../../tutorSession/WorkspaceExplanationFragmentsV5";
/**
 * SequencePreflight（F7 RT3 — 整段顺序依赖预演；动态板书事实链规格）。
 *
 * 对编译产物在**隔离 Workspace 副本**上按序模拟（构造 O → 解析 O → 引用 O 合法；
 * 高亮 O → 构造 O 非法）：每个 workspace action 经既有 F3 纯执行器
 * （executeWorkspacePresentationV5：canonical+capability+target/mode/truth+几何
 * dry-run）在**上一动作的模拟后 fold** 上执行，逐项推进 nextFold。
 *
 * 预演只证明整段在开始状态下可执行；真实执行仍逐项重新验证并等待浏览器
 * outcome（规格：不能为让后面动作过校验而提前把整个 sequence 应用到真实
 * Workspace）。一项失败 ⇒ 整段候选不提交（preflight_failed，不走模型超时重试）。
 */
import { executeWorkspacePresentationV5 } from "../../tutorSession/WorkspaceActionRuntimeV5";
import type { WorkspaceFold } from "../../tutorSession/WorkspaceRuntimeReducerV5";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";
import type { CompiledPresentationPlanV4 } from "./IntentCompiler";

export class SequencePreflightError extends Error {
  constructor(
    readonly ordinal: number,
    readonly actionId: string,
    readonly reason: string,
  ) {
    super(`preflight failed at ordinal ${ordinal} (${actionId}): ${reason}`);
    this.name = "SequencePreflightError";
  }
}

export interface PreflightResult {
  readonly ok: true;
  /** 模拟结束时的 workspace revision（真实 applied 事件的期望终值参考）。 */
  readonly resultingWorkspaceRevision: number;
}

/** 深拷贝隔离副本（fold 不可变纪律下的防御复制：预演零真实 Workspace 效果）。 */
function isolateFold(fold: WorkspaceFold): WorkspaceFold {
  return structuredClone(fold);
}

/**
 * 整段预演：按 ordinal 顺序在隔离 fold 上执行全部 workspace 动作。
 * voice 动作不触 Workspace（真实链 outcome 由浏览器报告），只保持顺序占位。
 */
export function preflightPresentationSequence(args: {
  readonly fold: WorkspaceFold;
  readonly catalog: WorkspacePresentationCatalogV5;
  readonly plan: CompiledPresentationPlanV4 | CompiledPresentationPlanV5;
  readonly visual?: VisualCompilationInput;
}): PreflightResult {
  let current: WorkspaceFold;
  try {
    current = registerWorkspaceExplanationFragmentsV5(isolateFold(args.fold), args.plan);
  } catch (error) {
    throw new SequencePreflightError(0, args.plan.sequence_id, `fragment registration rejected: ${String(error)}`);
  }
  let visualState = args.visual ? structuredClone(args.visual.state) : undefined;
  let world = args.visual?.constructionWorld ? structuredClone(args.visual.constructionWorld) : undefined;
  let completed = new Set(args.visual?.permission.completedConstructions ?? []);
  for (const action of args.plan.actions) {
    if (action.kind !== "workspace" || !action.workspace_action) continue;
    if (action.workspace_action.capability.startsWith("geometry.visual.")) {
      if (!args.visual || !visualState || args.plan.schema !== "ai_teaching_presentation_plan/v5" || args.plan.purpose !== "teaching") throw new SequencePreflightError(action.ordinal, action.workspace_action.action_id, "visual context/purpose required");
      try {
        const command = geometryVisualCommandSchema.parse(JSON.parse(action.workspace_action.command_payload ?? ""));
        if (command.op === "reconcile") throw new Error("system reconcile is not a teaching preflight command");
        if (action.workspace_action.capability !== `geometry.visual.${command.op}` || action.workspace_action.presentation_only) throw new Error("visual capability/effect mismatch");
        const reduction = reduceVisual(visualState, command, args.visual.catalog, { ...args.visual.permission, owner: args.visual.owner,
          completedConstructions: completed, existingPoints: world?.geometry ? new Map(world.geometry.points.map(p => [p.id, { x:p.x,y:p.y }])) : args.visual.permission.existingPoints,
          action: { session_id:args.plan.session_id,sequence_id:args.plan.sequence_id,ordinal:action.ordinal,action_id:action.workspace_action.action_id } });
        visualState=reduction.state;
        if(reduction.changed)current={...current,state:{...current.state,revision:current.state.revision+1}};
      } catch (error) { throw new SequencePreflightError(action.ordinal, action.workspace_action.action_id, String(error)); }
      continue;
    }
    const execution = executeWorkspacePresentationV5({
      fold: current,
      catalog: args.catalog,
      action: {
        schema: "ai_teaching_workspace_surface_action/v1" as const,
        session_id: args.plan.session_id,
        ...action.workspace_action,
        beat_id: args.plan.scope.kind === "approved" ? args.plan.scope.beat_id : args.plan.scope.anchor.beat_id,
      },
    });
    if (execution.status === "rejected") {
      throw new SequencePreflightError(action.ordinal, action.workspace_action.action_id, execution.reason);
    }
    if (args.visual && world && action.workspace_action.capability === "geometry.construct") {
      const command = JSON.parse(action.workspace_action.command_payload!);
      world = applyDomainCommands(world, [command]);
      const output = command.outputPointId ?? command.outputLineId;
      // Construction bindings become complete only once every declared output exists.
      for (const [binding, outputs] of args.visual.catalog.constructionEntries()) if (outputs.every(id => world!.geometry!.points.some(p => p.id===id) || world!.geometry!.segments.some(s=>s.id===id))) completed.add(binding);
    }
    if (execution.nextFold) {
      current = execution.nextFold;
    }
  }
  return { ok: true, resultingWorkspaceRevision: current.state.revision };
}

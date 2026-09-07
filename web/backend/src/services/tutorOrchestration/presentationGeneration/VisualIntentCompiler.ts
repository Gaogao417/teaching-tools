import { applyDomainCommands, type DomainCommand } from "../../../../../shared/actionWorld";
import type { WorldProjection } from "../../../../../shared/actionRuntime";
import type { VisualCommand as WireCommand, VisualOwner } from "../../../../../shared/canonical/visualSchemas";
import { VisualBindingCatalog, VisualBindingError, type VisualForm, type VisualLifetime } from "../../tutorSession/VisualBindingCatalog";
import { reduceVisual, visualHash, type WorkspaceVisualState, type VisualReductionContext, type VisualCommand } from "../../tutorSession/WorkspaceVisualReducer";
export interface VisualToolIntent { tool_id: string; binding_ref?: string; params?: Record<string, unknown> }
export interface VisualCompilerContext {
  catalog: VisualBindingCatalog; state: WorkspaceVisualState; owner: VisualOwner;
  sessionId: string; sequenceId: string;
  permission: Omit<VisualReductionContext, "action" | "owner">;
  constructionWorld?: WorldProjection;
}
export interface CompiledVisualAction { ordinal: number; action_id: string; capability: string; command: VisualCommand; basis_refs: string[] }
const SCHEMA = "ai_teaching_geometry_visual_command/v1" as const;
/** One compiler instance per candidate; owns only a preflight copy, never runtime state. */
export class VisualIntentCompiler {
  private state: WorkspaceVisualState;
  private readonly groups = new Map<string, string>();
  private active: string | null = null;
  private world?: WorldProjection;
  constructor(private readonly context: VisualCompilerContext) { this.state = structuredClone(context.state); this.context = { ...context, permission: { ...context.permission } }; this.world = context.constructionWorld ? structuredClone(context.constructionWorld) : undefined; }
  advanceConstruction(bindingId: string, command: DomainCommand): void {
    if (!this.world) throw new VisualBindingError("VISUAL_CONSTRUCTION_WORLD_REQUIRED", bindingId);
    this.world = applyDomainCommands(this.world, [command]);
    this.context.permission = { ...this.context.permission, existingPoints: new Map(this.world.geometry!.points.map(p => [p.id, { x:p.x, y:p.y }])),
      completedConstructions: new Set([...this.context.permission.completedConstructions, ...this.context.catalog.constructionEntries().filter(([,outputs]) => outputs.every(id => this.world!.geometry!.points.some(p=>p.id===id) || this.world!.geometry!.segments.some(s=>s.id===id))).map(([id])=>id)]) };
  }
  private group(alias: unknown, open: boolean): string {
    if (typeof alias !== "string" || !/^[a-z][a-z0-9_]{0,15}$/.test(alias)) throw new VisualBindingError("VISUAL_GROUP_ALIAS", String(alias));
    let id = this.groups.get(alias);
    if (!id) {
      if (!open) throw new VisualBindingError("VISUAL_UNKNOWN_GROUP", alias);
      id = `${this.context.sequenceId}/g/${this.groups.size}`; this.groups.set(alias, id);
    }
    if (open) {
      if (this.active !== null && this.active !== id) throw new VisualBindingError("VISUAL_GROUP_NESTING", alias);
      this.active = id;
    } else if (this.active !== id) throw new VisualBindingError("VISUAL_GROUP_CLOSED", alias);
    return id;
  }
  compile(intent: VisualToolIntent, ordinal: number, actionId: string): CompiledVisualAction {
    const p = intent.params ?? {};
    const allowed = intent.tool_id === "geometry.annotate" ? ["form", "lifetime", "group"] : intent.tool_id === "geometry.emphasize" ? ["group", "pair_index", "mode"] : intent.tool_id === "geometry.clear-visual" ? ["group"] : [];
    if (!allowed.length || Object.keys(p).some(k => !allowed.includes(k))) throw new VisualBindingError("VISUAL_ILLEGAL_PARAM", intent.tool_id);
    let command: VisualCommand, basis: string[] = [];
    if (intent.tool_id === "geometry.clear-visual") {
      if (intent.binding_ref !== undefined) throw new VisualBindingError("VISUAL_ILLEGAL_BINDING", intent.tool_id);
      command = { schema: SCHEMA, op: "close-group", group_id: this.group(p.group, false), owner: this.context.owner };
      this.active = null;
    } else {
      if (!intent.binding_ref) throw new VisualBindingError("VISUAL_BINDING_REQUIRED", intent.tool_id);
      const resolved = this.context.catalog.resolve(intent.binding_ref, { ...this.context.permission, scope: this.context.owner.scope,
        ...(intent.tool_id === "geometry.annotate" ? { form: p.form as VisualForm, lifetime: p.lifetime as VisualLifetime } : {pair_index:p.pair_index as 0|1|2|undefined}) });
      basis = resolved.binding.basis_refs;
      if (intent.tool_id === "geometry.annotate") {
        if (typeof p.form !== "string" || typeof p.lifetime !== "string") throw new VisualBindingError("VISUAL_ILLEGAL_PARAM", "form/lifetime required");
        const group = p.group === undefined ? undefined : this.group(p.group, true);
        const content = "expression_ref" in resolved.binding.relation ? resolved.binding.relation.expression_ref : undefined;
        const semantic = visualHash([this.context.catalog.planHash, intent.binding_ref, p.form, intent.binding_ref, content ?? null]);
        const previous = this.state.annotations.find(a => a.semantic_key === semantic);
        command = { schema: SCHEMA, op: "upsert", annotation_id: previous?.annotation_id ?? `${actionId}/a/0`, semantic_key: semantic,
          expected_version: previous?.version ?? 0, binding_ref: intent.binding_ref, form: p.form as VisualForm, role_key: intent.binding_ref,
          ...(content === undefined ? {} : { content_ref: content }), resolved_targets: resolved.targets,
          owner: { ...this.context.owner, ...(group === undefined ? {} : { group_id: group }) }, lifetime: p.lifetime as VisualLifetime };
      } else {
        if (p.mode !== "steady" && p.mode !== "pulse") throw new VisualBindingError("VISUAL_ILLEGAL_PARAM", "mode required");
        if (p.pair_index !== undefined && p.pair_index !== 0 && p.pair_index !== 1 && p.pair_index !== 2) throw new VisualBindingError("INVALID_PAIR_INDEX", String(p.pair_index));
        command = { schema: SCHEMA, op: "focus", group_id: this.group(p.group, true), owner: this.context.owner,
          binding_ref: intent.binding_ref, mode: p.mode, ...(p.pair_index === undefined ? {} : { pair_index: p.pair_index }), resolved_targets: resolved.targets };
      }
    }
    this.state = reduceVisual(this.state, command, this.context.catalog, { ...this.context.permission, owner: this.context.owner,
      action: { session_id: this.context.sessionId, sequence_id: this.context.sequenceId, ordinal, action_id: actionId } }).state;
    return { ordinal, action_id: actionId, command, capability: `geometry.visual.${command.op}`, basis_refs: basis };
  }
  finish(ordinal: number, actionId: string): CompiledVisualAction[] {
    if (this.active === null) return [];
    const alias = [...this.groups].find(([, id]) => id === this.active)![0];
    return [this.compile({ tool_id: "geometry.clear-visual", params: { group: alias } }, ordinal, actionId)];
  }
}
/** Explicitly reject system reconcile at the model boundary. */
export function isTeachingVisualCommand(command: WireCommand): command is VisualCommand { return command.op !== "reconcile"; }

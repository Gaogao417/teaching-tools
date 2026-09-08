import type { VisualBinding, VisualOwner } from "../../../../../shared/canonical/visualSchemas";
import { visualScopeAllows } from "../../tutorSession/VisualBindingCatalog";
export const VISUAL_TOOL_CATALOG_VERSION = "presentation-tool-catalog/v2-visual";
export const VISUAL_CONTEXT_BUILDER_VERSION = "presentation-context-builder/v2-visual";
export interface VisibleVisualTool {
  tool: "geometry.annotate" | "geometry.emphasize" | "geometry.clear-visual";
  capability: string; description: string;
  parameters: { name: string; value_type: string; required: boolean; allowed_values?: string[] }[];
  binding_refs: string[];
}
/** Requires both execution implementations and current binding authorization. */
export function visibleVisualTools(input: { bindings: readonly VisualBinding[]; scope: VisualOwner["scope"]; sessionMode: "teaching" | "assessment";
  scopeAllows?:typeof visualScopeAllows;
  registeredCapabilities: ReadonlySet<string>; revealAuthorized: (binding: VisualBinding) => boolean }): VisibleVisualTool[] {
  if (input.sessionMode !== "teaching") return [];
  const bindings = input.bindings.filter(b => b.allowed_scopes.some(s => (input.scopeAllows??visualScopeAllows)(s,input.scope)) && input.revealAuthorized(b));
  if (!bindings.length || !input.registeredCapabilities.has("geometry.visual.close-group")) return [];
  const specs: VisibleVisualTool[] = [
    { tool: "geometry.annotate", capability: "geometry.visual.upsert", description: "显示批准数学关系标注；正文与对象由绑定解析。", parameters: [
      { name: "form", value_type: "enum", required: true, allowed_values: ["angle-arcs", "paired-sides", "triangle-outline", "length-label", "ratio-label"] },
      { name: "lifetime", value_type: "enum", required: true, allowed_values: ["explanation-group", "teaching-scope", "problem-part"] },
      { name: "group", value_type: "string", required: false },
    ], binding_refs: bindings.map(b => b.binding_id) },
    { tool: "geometry.emphasize", capability: "geometry.visual.focus", description: "用同一说明组指认批准关系；相似对应边按pair_index逐对展示。", parameters: [
      { name: "group", value_type: "string", required: true }, { name: "pair_index", value_type: "number", required: false },
      { name: "mode", value_type: "enum", required: true, allowed_values: ["steady", "pulse"] },
    ], binding_refs: bindings.map(b => b.binding_id) },
    { tool: "geometry.clear-visual", capability: "geometry.visual.close-group", description: "结束当前说明组；无binding_ref。", parameters: [{ name: "group", value_type: "string", required: true }], binding_refs: [] },
  ];
  return specs.filter(s => input.registeredCapabilities.has(s.capability));
}

/** New visual pin only; includes compiler-inserted close-group actions. */
export const VISUAL_MAX_ACTIONS = 32;

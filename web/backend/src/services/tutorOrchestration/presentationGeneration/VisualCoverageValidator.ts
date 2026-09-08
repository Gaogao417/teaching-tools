import type { VisualRequirement, VisualView } from "../../../../../shared/canonical/visualSchemas";
import type { CompiledVisualAction } from "./VisualIntentCompiler";
export interface VisualCoverageIssue { binding_ref: string; code: "missing-form" | "missing-pair" | "late-visual" | "missing-pulse"; form?: string; pair_index?: number }
/** Existing evidence must already be cutoff/identity-filtered by ContextProjection.
 * Fresh clarify-reference obligations always require a new action. */
export function validateVisualCoverage(requirements: readonly VisualRequirement[], actions: readonly CompiledVisualAction[], alreadyPresented: VisualView,
  uses: readonly { ordinal: number; binding_ref: string }[] = [], options: { readonly requireEntryPulse?: boolean } = {}): VisualCoverageIssue[] {
  const issues: VisualCoverageIssue[] = [];
  for (const r of requirements) {
    const matching = actions.filter(a => "binding_ref" in a.command && a.command.binding_ref === r.binding_ref);
    for (const form of r.forms) {
      const candidates = matching.filter(a => a.command.op === "upsert" ? a.command.form === form : a.command.op === "focus" && (form === "paired-sides" ? a.command.pair_index !== undefined : form === "triangle-outline" ? a.command.pair_index === undefined : form === "angle-arcs"));
      const historical = r.trigger !== "clarify-reference" && alreadyPresented.annotations.some(a => a.binding_ref === r.binding_ref && a.form === form);
      if (!historical && !candidates.length) issues.push({ binding_ref: r.binding_ref, code: "missing-form", form });
      if (!historical && candidates.length && uses.some(u => u.binding_ref === r.binding_ref && !candidates.some(c => c.ordinal < u.ordinal))) issues.push({ binding_ref: r.binding_ref, code: "late-visual", form });
    }
    for (const pair of r.required_pair_indices) {
      // Historic animation never substitutes a required pair demonstration.
      const candidates=matching.filter(a=>a.command.op==="focus"&&a.command.pair_index===pair);
      if (!candidates.length) issues.push({ binding_ref: r.binding_ref, code: "missing-pair", pair_index: pair });
      const requiresPulse = options.requireEntryPulse && (r.trigger === "introduce" || r.trigger === "clarify-reference");
      const effective = requiresPulse ? candidates.filter(a => a.command.op === "focus" && a.command.mode === "pulse") : candidates;
      if (requiresPulse && candidates.length && !effective.length) issues.push({binding_ref:r.binding_ref,code:"missing-pulse",pair_index:pair});
      if(effective.length && uses.some(u=>u.binding_ref===r.binding_ref&&!effective.some(a=>a.ordinal<u.ordinal)))issues.push({binding_ref:r.binding_ref,code:"late-visual",pair_index:pair});
    }
  }
  return issues;
}

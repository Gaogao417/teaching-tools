import type { VisualRequirement, VisualView } from "../../../../../shared/canonical/visualSchemas";
import type { CompiledVisualAction } from "./VisualIntentCompiler";
export interface VisualCoverageIssue { binding_ref: string; code: "missing-form" | "missing-pair" | "late-visual" | "missing-pulse" | "missing-focus" | "ambiguous-visual-reference"; form?: string; pair_index?: number; speech_ordinal?: number; draft_item_index?: number }
/** Existing evidence must already be cutoff/identity-filtered by ContextProjection.
 * Fresh clarify-reference obligations always require a new action. */
export function validateVisualCoverage(requirements: readonly VisualRequirement[], actions: readonly CompiledVisualAction[], alreadyPresented: VisualView,
  uses: readonly { ordinal: number; binding_ref: string }[] = [], options: { readonly requireEntryPulse?: boolean; readonly requireCurrentPresentation?: boolean } = {}): VisualCoverageIssue[] {
  const issues: VisualCoverageIssue[] = [];
  const focusBefore = (ordinal:number) => {
    let focus: Extract<CompiledVisualAction["command"], {op:"focus"}> | undefined;
    for(const action of [...actions].sort((a,b)=>a.ordinal-b.ordinal)) {
      if(action.ordinal>=ordinal)break;
      if(action.command.op==="focus")focus=action.command;
      else if(action.command.op==="close-group"&&focus?.group_id===action.command.group_id)focus=undefined;
    }
    return focus;
  };
  for (const r of requirements) {
    const matching = actions.filter(a => "binding_ref" in a.command && a.command.binding_ref === r.binding_ref);
    for (const form of r.forms) {
      const candidates = matching.filter(a => a.command.op === "upsert" ? a.command.form === form : a.command.op === "focus" && (form === "paired-sides" ? a.command.pair_index !== undefined : form === "triangle-outline" ? a.command.pair_index === undefined : form === "angle-arcs"));
      const historical = !options.requireCurrentPresentation && r.trigger !== "clarify-reference" && alreadyPresented.annotations.some(a => a.binding_ref === r.binding_ref && a.form === form);
      if (!historical && !candidates.length) issues.push({ binding_ref: r.binding_ref, code: "missing-form", form });
      if (!historical && candidates.length) for(const use of uses.filter(u=>u.binding_ref===r.binding_ref)) {
        if(!candidates.some(c=>c.ordinal<use.ordinal))issues.push({binding_ref:r.binding_ref,code:"late-visual",form,speech_ordinal:use.ordinal});
      }
    }
    if (options.requireCurrentPresentation) for (const use of uses.filter(u => u.binding_ref === r.binding_ref)) {
      const focus=focusBefore(use.ordinal);
      if (focus?.binding_ref !== r.binding_ref || (r.required_pair_indices.length>0 && (focus.pair_index===undefined || !r.required_pair_indices.includes(focus.pair_index)))) issues.push({binding_ref:r.binding_ref,code:"missing-focus",speech_ordinal:use.ordinal});
    }
    for (const pair of r.required_pair_indices) {
      // Historic animation never substitutes a required pair demonstration.
      const candidates=matching.filter(a=>a.command.op==="focus"&&a.command.pair_index===pair);
      if (!candidates.length) issues.push({ binding_ref: r.binding_ref, code: "missing-pair", pair_index: pair });
      const requiresPulse = options.requireEntryPulse && (r.trigger === "introduce" || r.trigger === "clarify-reference");
      const effective = requiresPulse ? candidates.filter(a => a.command.op === "focus" && a.command.mode === "pulse") : candidates;
      if (requiresPulse && candidates.length && !effective.length) issues.push({binding_ref:r.binding_ref,code:"missing-pulse",pair_index:pair});
      for(const use of uses.filter(u=>u.binding_ref===r.binding_ref)) {
        const focus=focusBefore(use.ordinal);
        const currentPair=!options.requireCurrentPresentation || (focus?.binding_ref===r.binding_ref&&focus.pair_index===pair);
        if(currentPair&&effective.length&&!effective.some(a=>a.ordinal<use.ordinal))issues.push({binding_ref:r.binding_ref,code:"late-visual",pair_index:pair,speech_ordinal:use.ordinal});
      }
    }
  }
  return issues;
}

/** Structural target resolution, never speech text or inferred geometry. Direct
 * required binding references select the current target; other FN/IF refs may
 * remain supporting premises. Without an explicit target, ambiguity is quality. */
export function resolveVisualSpeechUses(input: {
  speeches: readonly {ordinal:number; basis_refs?:readonly string[]}[];
  bindings: readonly {binding_id:string;basis_refs:readonly string[]}[];
  inferences: ReadonlyMap<string,{conclusion:string}>;
}): {uses:{ordinal:number;binding_ref:string}[];issues:VisualCoverageIssue[]} {
 const uses:{ordinal:number;binding_ref:string}[]=[],issues:VisualCoverageIssue[]=[];
 const required=new Set(input.bindings.map(b=>b.binding_id));
 for(const speech of input.speeches){
  const refs=new Set(speech.basis_refs??[]);
  const direct=[...refs].filter(ref=>required.has(ref));
  const facts=new Set([...refs,...[...refs].flatMap(ref=>{const conclusion=input.inferences.get(ref)?.conclusion;return conclusion?[conclusion]:[];})]);
  const targets=[...new Set(direct.length?direct:input.bindings.filter(b=>b.basis_refs.some(ref=>facts.has(ref))).map(b=>b.binding_id))];
  if(targets.length>1){for(const binding_ref of targets)issues.push({binding_ref,code:"ambiguous-visual-reference",speech_ordinal:speech.ordinal});continue;}
  if(targets.length===1)uses.push({ordinal:speech.ordinal,binding_ref:targets[0]});
 }
 return {uses,issues};
}

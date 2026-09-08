import type { BuiltPresentationContext } from './ContextBuilder';
import type { createPinnedVisualWorkspaceBridge } from '../../tutorSession/VisualViewProjector';
import type { StoredSessionEvent } from '../../tutorSession/kernel/sessionKernelTypes';
import { projectVisualContext } from './VisualContextProjection';
import { visibleVisualTools, VISUAL_CONTEXT_BUILDER_VERSION } from './VisualPresentationTools';
import { visualHash } from '../../tutorSession/WorkspaceVisualReducer';
export const VISUAL_CONTEXT_POLICY={version:"visual-context-budget/v1",max_total_chars:16000} as const;
/** Both reservation and retry rebuild from the same revision cutoff and pinned refs. */
export function frozenVisualGeneration(input:{base:BuiltPresentationContext;events:readonly StoredSessionEvent[];hooks:ReturnType<typeof createPinnedVisualWorkspaceBridge>;sessionId:string;capabilities:ReadonlySet<string>}) {
 const events=input.events.filter(e=>e.state_revision<=input.base.context.event_cutoff);
 const source=input.hooks.generationAt(events);
 const projected=projectVisualContext({state:source.state,catalog:source.catalog,authorization:source.authorization,requirements:source.requirements,
  outcomes:events.filter(e=>e.event_type==='presentation_action_outcome_recorded').map(e=>({action:{session_id:e.session_id,sequence_id:String(e.payload.sequence_id),ordinal:Number(e.payload.ordinal),action_id:String(e.payload.action_id)},outcome:e.payload.outcome as 'presented'|'failed'|'interrupted',event_sequence:e.sequence})),
  sessionId:input.sessionId,eventCutoff:events.at(-1)?.sequence??0,availableChars:VISUAL_CONTEXT_POLICY.max_total_chars-input.base.budget.approx_chars});
 const tools=visibleVisualTools({bindings:projected.bindings,scope:source.authorization.currentOwner.scope,sessionMode:'teaching',registeredCapabilities:input.capabilities,scopeAllows:source.authorization.scopeAllows,revealAuthorized:source.authorization.revealAuthorized});
 const context={...input.base,visual:projected,digest:visualHash({refs:input.base.context,visual:projected,builder:VISUAL_CONTEXT_BUILDER_VERSION,policy:VISUAL_CONTEXT_POLICY}),budget:{...input.base.budget,approx_chars:input.base.budget.approx_chars+projected.chars}};
 return {context,source,visual:{catalog:source.catalog,state:source.state,owner:source.authorization.currentOwner,permission:source.authorization,constructionWorld:source.authorization.constructionWorld,requirements:projected.requirements,alreadyPresented:projected.already_presented,visibleTools:tools}};
}

/** A recovered visual request may only offer outputs absent from its frozen
 * authoritative world. Planned actions alone never count as construction.
 * Keep partial bindings, but narrow their template IDs before prompt AND compile.
 * Legacy presenter pins do not call this projection.
 */
export function remainingVisualConstructionTools(
 tools: readonly import('./PresentationToolCatalog').VisibleToolInstance[],
 source: ReturnType<ReturnType<typeof createPinnedVisualWorkspaceBridge>['generationAt']>,
): readonly import('./PresentationToolCatalog').VisibleToolInstance[] {
 const world=source.authorization.constructionWorld;
 if (!world?.geometry) throw new Error('visual construction catalog requires frozen geometry');
 const entities=new Set([...world.geometry.points.map(p=>p.id),...world.geometry.segments.map(s=>s.id)]);
 return tools.flatMap(tool=>{
  if(tool.spec.effect_class!=='construct') return [tool];
  const bindings=tool.bindings.flatMap(binding=>{
   if(binding.binding_kind!=='geometry') return [];
   if(source.authorization.completedConstructions.has(binding.binding_id)) return [];
   const remaining=binding.allowed_template_ids.filter(id=>!entities.has(id));
   return remaining.length?[{...binding,allowed_template_ids:remaining}]:[];
  });
  return bindings.length?[{...tool,bindings}]:[];
 });
}

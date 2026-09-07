/** Narrow v4 quality requirement over already-visible, closed approved bindings. */
import { renderFragmentContent, type IntentCompilerInput } from './IntentCompiler';
import { PresenterGenerationError, type PresentationDraftV2 } from './GeneratorPort';
import type { RequiredBoardBinding } from './PresenterPrompts';
import type { VisibleToolInstance } from './PresentationToolCatalog';

export function requiredBoardBindings(input: {
 readonly visibleTools: readonly VisibleToolInstance[];
 readonly graph: IntentCompilerInput['graph'];
 readonly alreadyPresentedBoardContent: readonly string[];
}): RequiredBoardBinding[] {
 const result = new Map<string, RequiredBoardBinding>();
 for (const tool of input.visibleTools) {
  if (tool.spec.tool_id !== 'board.explain'
    || !tool.spec.parameters.some(p => p.name === 'note_kind' && p.allowed_values?.includes('approved_math_note'))) continue;
  for (const binding of tool.bindings) {
   // Closed parameter, visibility and source authority stay with the existing compiler.
   // No lookup of other Beat bindings or inference expansion is permitted here.
   if (binding.binding_kind !== 'explanation') continue;
   const content = renderFragmentContent('approved_math_note', binding, input.graph, input.alreadyPresentedBoardContent, true);
   if (content) result.set(binding.binding_id, {binding_ref: binding.binding_id, note_kind: 'approved_math_note'});
  }
 }
 return [...result.values()];
}

export function assertRequiredBoardBindings(draft: PresentationDraftV2, required: readonly RequiredBoardBinding[]): void {
 const covered = new Set(draft.items.flatMap(item => item.type === 'tool_intent'
  && item.tool === 'board.explain'
  && (item.args?.params?.note_kind === 'approved_math_note' || item.args?.params?.note_kind === 'relation_note')
  ? [item.args?.binding_ref] : []));
 const missing = required.filter(binding => !covered.has(binding.binding_ref));
 if (missing.length) throw new PresenterGenerationError('draft_invalid',
  `required approved board proof omitted: ${missing.map(binding => binding.binding_ref).join(', ')}; speech/explanation_text does not satisfy it`, true);
}

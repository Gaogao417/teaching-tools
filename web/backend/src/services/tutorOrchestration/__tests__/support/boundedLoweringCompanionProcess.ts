/** T-14/BL-N9 D3: commit and restore in real independent OS processes over one SQLite file.
 * The restore presenter is a sentinel — any model call aborts the child, so a
 * passing restore proves the persisted v15 sequence was consumed without regeneration. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TutorRuntimeApplicationV7 } from '../../TutorRuntimeApplicationV7';
import { TutorTaskBindingResolver } from '../../TutorTaskBindingResolver';
import { importVisualReviewCandidate } from '../../../planBuild/visual/ImportVisualReviewCandidate';
import { FixedResponseGateProvider } from '../../../tutorNavigator/ModelGateAdjudicatorV5';
import { f6Model, realCanonicalRoot } from '../f6Support';
import { VISUAL_PRESENTER_PROMPT_VERSION } from '../../presentationGeneration/PresenterPrompts';
import { VISUAL_CONTEXT_BUILDER_VERSION, VISUAL_TOOL_CATALOG_VERSION } from '../../presentationGeneration/VisualPresentationTools';
import type { PresenterGeneratorPort, PresentationDraftV2 } from '../../presentationGeneration/GeneratorPort';
import { db } from '../../../../db/database';

const root = realCanonicalRoot();
const loaded = importVisualReviewCandidate({ canonicalRoot: root, candidateDirectory: resolve('src/services/planBuild/review/geometry-visual/candidate-v14') });
if (!loaded.ok) throw new Error(loaded.errors.join(';'));
const recorded = JSON.parse(readFileSync(resolve('src/services/tutorOrchestration/presentationGeneration/__tests__/fixtures/v13Bt02AdjacentVisual.json'), 'utf8')).items as PresentationDraftV2['items'];
const pin = { provider: 'visual-subprocess-test', model_id: 'visual-subprocess-test', prompt_version: VISUAL_PRESENTER_PROMPT_VERSION, context_builder_version: VISUAL_CONTEXT_BUILDER_VERSION, tool_catalog_version: VISUAL_TOOL_CATALOG_VERSION };

function annotate(binding_ref: string, form: string) {
  return { type: 'tool_intent' as const, tool: 'geometry.annotate', args: { binding_ref, params: { form, lifetime: 'teaching-scope', group: 'seg' } } };
}
function legalItems(p: any): PresentationDraftV2['items'] {
  const items: PresentationDraftV2['items'] = [];
  for (const req of p.visual.requirements) {
    for (const form of req.forms) items.push(annotate(req.binding_ref, form));
    for (const pair of req.required_pair_indices) items.push({ type: 'tool_intent', tool: 'geometry.emphasize', args: { binding_ref: req.binding_ref, params: { group: 'seg', pair_index: pair, mode: 'pulse' } } });
  }
  items.push({ type: 'speech', text: '我们依据当前批准关系看这一步。', basis_refs: [p.allowed_knowledge[0].ref] });
  for (const b of p.required_board_bindings ?? []) items.push({ type: 'tool_intent', tool: 'board.explain', args: { binding_ref: b.binding_ref, params: { note_kind: 'approved_math_note' } } });
  return items;
}
async function settle(s: any, generate = true) {
  for (let n = 0; n < 80; n++) {
    if (s.hasPendingGeneration()) {
      if (!generate) return;
      const outcome = await s.drivePendingGeneration();
      if (outcome.kind !== 'committed') throw new Error('settle commit failed: ' + outcome.kind);
    }
    const cursor = s.rebuildRuntimeState().presentation_cursor;
    if (cursor.status !== 'awaiting_browser') return;
    s.reportPresentationOutcome({ sequence_id: cursor.sequence_id, ordinal: cursor.ordinal, action_id: cursor.action_id, outcome: 'presented', execution_owner: s.visualLifecycle!.presentation_execution_owner, expected_revision: s.revision, client_request_id: `subprocess-outcome-${n}` });
  }
  throw new Error('settle exceeded');
}
const commitPresenter: PresenterGeneratorPort = {
  provider: 'visual-subprocess-test', modelId: 'visual-subprocess-test', pin,
  async generatePresentationDraft(r) {
    const p = r.userPayload as any;
    const items = p.visual.requirements.some((x: any) => x.binding_ref === 'VB-104') ? structuredClone(recorded) : legalItems(p);
    return { draft: { schema: 'ai_teaching_presentation_draft/v2', request_id: r.request_id, items }, latencyMs: 0 };
  },
};
const application = (presenter: PresenterGeneratorPort) => TutorRuntimeApplicationV7.create({
  canonicalRoot: root,
  bindingResolver: new TutorTaskBindingResolver(root, () => loaded),
  model: f6Model(new FixedResponseGateProvider([1, 2].map(n => JSON.stringify({ response_kind: 'understanding_confirmation', matched_gate_id: `GT-0${n}`, verdict: 'pass', reasoning_location: 'unknown', grounding_refs: [] }))),'visual-subprocess-test'),
  presenter,
});

const [mode, sessionId] = process.argv.slice(2);
async function main() {
  if (mode === 'commit') {
    const started = application(commitPresenter).start({ task_id: 'goldenMinhangFold2020', student_id: 'v15-subprocess', client_instance_id: 'CI-v15-subprocess', client_request_id: 'v15-subprocess-start', sessionIdAllocator: () => 'TS-9977330001' });
    if (!('orchestrator' in started)) throw new Error('start failed: ' + started.kind);
    const s = started.orchestrator;
    await settle(s);
    await s.submitStudentInput({ input: { kind: 'utterance', channel: 'mainline', text: '这一步关系我听懂了。' }, execution_owner: s.visualLifecycle!.presentation_execution_owner, client_request_id: 'v15-subprocess-confirm' }, { expectedRevision: s.revision });
    await settle(s, false);
    const cursor = s.rebuildRuntimeState().teaching_cursor;
    if (cursor.beat_id !== 'BT-02') throw new Error('expected BT-02, got ' + cursor.beat_id);
    const outcome = await s.drivePendingGeneration();
    if (outcome.kind !== 'committed') throw new Error('commit failed: ' + outcome.kind);
    const events = db.prepare('SELECT sequence,event_type,payload_json,recorded_revision,causation_sequence FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(s.sessionId);
    const companions = db.prepare('SELECT sequence_id,request_id,attempt,epoch,policy_version FROM tutor_generation_companions WHERE session_id=?').all(s.sessionId);
    process.send?.({ sessionId: s.sessionId, events, companions });
    return;
  }
  if (mode === 'restore') {
    let presenterCalls = 0;
    const sentinel: PresenterGeneratorPort = {
      provider: 'visual-subprocess-sentinel', modelId: 'visual-subprocess-sentinel', pin,
      async generatePresentationDraft() { presenterCalls += 1; throw new Error('SUBPROCESS_SENTINEL_MODEL_CALL'); },
    };
    try {
      const session = application(sentinel).restore(sessionId!);
      session.rebuildRuntimeState();
      const parity = session.assertReplayParity();
      const events = db.prepare('SELECT sequence,event_type,payload_json,recorded_revision,causation_sequence FROM tutor_session_events WHERE session_id=? ORDER BY sequence').all(sessionId!);
      process.send?.({ restored: true, sessionId, events, parity, presenterCalls });
    } catch (error) {
      process.send?.({ restored: false, sessionId, error: String((error as Error).message ?? error), presenterCalls });
      process.exitCode = 5;
    }
    return;
  }
  throw new Error('unknown mode ' + mode);
}
main().then(() => { db.close(); process.disconnect?.(); }).catch(error => { console.error(error); process.exit(1); });

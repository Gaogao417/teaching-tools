/** Review-only joint TP/PR candidate. No approval or registry writer exists here. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalHash, type CanonicalRegistries, type TeachingProtocolV2Payload, type TutorPlanV5Payload } from "../canonicalInputs";
import { importApprovedPlanV5, type ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { validateApprovedPlanV5 } from "../v5/MaterializeTutorPlanV5";
import { validatePlanV7WorkspaceBindings } from "../v7/ValidatePlanV7WorkspaceBindings";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import { auditTeachFollowAlongContexts } from "./TeachFollowAlongContextAudit";
import { MAINLINE_CONTENT, TEACH_FEEDBACK_BOUNDARY } from "./TeachFollowAlongContent";

export const C1_VERSIONS = { plan: "v13", mainline: "v11", inquiry: "v10" } as const;
export interface TeachFollowAlongCandidate {
  plan: TutorPlanV5Payload;
  protocols: TeachingProtocolV2Payload[];
}
const ref = (p: { version: string; content_hash: string; artifact_id?: string; protocol_id?: string }) =>
  ({ artifact_id: (p.artifact_id ?? p.protocol_id)!, version: p.version, content_hash: p.content_hash });
const record = (p: unknown) => p as Record<string, unknown>;
function draftProtocol(source: TeachingProtocolV2Payload, version: string) {
  const p = structuredClone(source);
  p.schema = "ai_teaching_teaching_protocol/v3";
  p.version = version; p.status = "Draft"; delete p.approval;
  p.artifact_uri = `artifact://teaching-protocol/${p.protocol_id}@${version}`;
  return p;
}

/** Checks joint refs against both candidate PRs, not old registry current refs. */
export function validateTeachFollowAlongCandidate(candidate: TeachFollowAlongCandidate, source: ImportedApprovedPlanV5): string[] {
  const errors: string[] = [];
  if (candidate.plan.status !== "Draft" || candidate.plan.approval) errors.push("candidate TP must be Draft without inherited approval");
  if (candidate.plan.version === "v12") errors.push("withdrawn v12 is not a C1 candidate");
  if (candidate.protocols.length !== 2 || new Set(candidate.protocols.map(p => p.protocol_id)).size !== 2) errors.push("joint bundle requires distinct mainline and inquiry PRs");
  const protocols = new Map(candidate.protocols.map(p => [p.protocol_id, p]));
  const inquiry = protocols.get("PR-SMV-002");
  if (!inquiry || inquiry.beats.length !== 1 || inquiry.entry_beat_id !== inquiry.beats[0]?.beat_id
    || inquiry.beats[0]?.transitions.length !== 1 || inquiry.beats[0]?.transitions[0]?.to_beat !== inquiry.entry_beat_id)
    errors.push("Inquiry must be a single terminal repair Beat, not sequential confirmations");
  for (const original of source.protocols.get("PR-SMV-001")!.beats) {
    const current = protocols.get("PR-SMV-001")?.beats.find(b => b.beat_id === original.beat_id);
    if (current?.inquiry_branch?.return_beat_id !== original.inquiry_branch?.return_beat_id
      || current?.inquiry_branch?.expand_region_id !== original.inquiry_branch?.expand_region_id)
      errors.push(`${original.beat_id}: preserve existing inquiry return/region anchor`);
  }

  for (const protocol of candidate.protocols) {
    if (protocol.status !== "Draft" || protocol.approval) errors.push(`${protocol.protocol_id}: candidate must be Draft without approval`);
    if (protocol.artifact_uri !== `artifact://teaching-protocol/${protocol.protocol_id}@${protocol.version}`) errors.push("protocol identity/URI mismatch");
    for (const beat of protocol.beats) {
      if (protocol.schema !== "ai_teaching_teaching_protocol/v3" || beat.completion_evidence.confirmation_target !== "follow_along" || beat.completion_evidence.evidence_kind !== "student_confirmation" || beat.participation !== "confirm") errors.push(`${protocol.protocol_id}/${beat.beat_id}: Teach requires student_confirmation and confirm participation`);
      if (!beat.presentation_intent.voice.includes("narrate")) errors.push(`${protocol.protocol_id}/${beat.beat_id}: Teach must permit explanation, not question-only presentation`);
      if (beat.completion_evidence.gate?.capability) errors.push(`${beat.beat_id}: Teach cannot require an evaluator capability`);
      if (beat.resource_ids?.includes("RES8")) errors.push(`${beat.beat_id}: exercise-only RES8 cannot gate Teach`);
      if (beat.pacing.wait_policy !== "student_driven" || beat.transitions.some(t => t.on !== "evidence_collected")) errors.push(`${beat.beat_id}: no timeout/narration progression in C1`);
    }
  }
  if (candidate.plan.resources.some(r => r.kind === "action_template")) errors.push("Teach bundle must not expose mandatory practice action templates");
  // Current Beat refs allow target facts in Context; dynamic board.explain still obeys existing tool visibility and permissions.
  for (const binding of candidate.plan.resource_bindings ?? []) {
    if (binding.binding_kind === "board") errors.push("C1 intermediate explanation must not add a solve-first board binding");
    if (binding.binding_kind === "explanation") {
      const resource = candidate.plan.resources.find(r => r.resource_id === binding.presentation_resource);
      const beat = candidate.protocols.find(p => p.protocol_kind === "mainline")?.beats.find(b => b.beat_id === resource?.beat_ref);
      if (!beat || beat.completion_evidence.confirmation_target !== "follow_along" || binding.basis_refs.fact_ids.some(id => !beat.solution_refs.fact_ids.includes(id))) errors.push(`${binding.binding_id}: explanation must belong to the marked current Beat`);
    }
  }
  for (const region of candidate.plan.solution_regions) for (const reference of region.local_protocol_refs ?? []) {
    const target = protocols.get(reference.artifact_id);
    if (!target || JSON.stringify(ref(target)) !== JSON.stringify(reference)) errors.push(`${region.region_id}: stale joint local protocol ref`);
  }
  const inputs = { ...source, protocols, snapshot: buildRuntimeRegistrySnapshot() };
  const checked = validateApprovedPlanV5(candidate.plan, inputs, { requireApproved: false });
  if (!checked.ok) errors.push(...checked.errors);
  try { errors.push(...validatePlanV7WorkspaceBindings({ ...source, plan: candidate.plan, protocols })); }
  catch (error) { errors.push(String(error)); }
  try { auditTeachFollowAlongContexts(candidate, source); }
  catch (error) { errors.push(`candidate context: ${String(error)}`); }
  return errors;
}

export function prepareTeachFollowAlongCandidate(deps: CanonicalRegistries, builtAt: string) {
  const result = importApprovedPlanV5(deps, "TP-SMV-009");
  if (!result.ok) throw new Error(result.errors.join("; "));
  const source = result.imported;
  if (source.plan.version !== "v11" || source.plan.schema !== "ai_teaching_tutor_plan_bundle/v5") throw new Error("C1 derives from current Approved TP@v11/v5, never the withdrawn v12");
  const oldMain = source.protocols.get("PR-SMV-001")!;
  const oldInquiry = source.protocols.get("PR-SMV-002")!;
  if (oldMain?.version !== "v10" || oldInquiry?.version !== "v9") throw new Error("source PR pins changed; re-audit C1 inputs");
  for (const [namespace, id, version] of [["tutor-plan", "TP-SMV-009", C1_VERSIONS.plan], ["teaching-protocol", "PR-SMV-001", C1_VERSIONS.mainline], ["teaching-protocol", "PR-SMV-002", C1_VERSIONS.inquiry]]) {
    if (existsSync(join(deps.canonicalRoot, namespace, id, `${version}.json`))) throw new Error(`target version already exists: ${id}@${version}`);
  }
  const inquiry = draftProtocol(oldInquiry, C1_VERSIONS.inquiry);
  // One bounded repair task. The old four stages are diagnostic directions,
  // not a mandatory sequence of confirmations. Last-beat completion uses the
  // existing Navigator inquiry return rule and the saved mainline return anchor.
  const repair = inquiry.beats.find(b => b.beat_id === inquiry.entry_beat_id)!;
  inquiry.beats = [repair];
  repair.purpose = "只针对本次学生问题与返回锚点补讲一个断点：从诊断资源选择相关方向，不依次讲完四项。已明确断点直接解释；不明确时先简短澄清。接上即返回原拍，不追加同义确认。";
  repair.solution_refs = {
    // Established angle/length facts keep all three diagnostic directions bounded;
    // earlier proofs remain read-only region/resource references, not required tasks.
    fact_ids: [3,4,5,6,12,13,14,16,17,18,19,20,21].map(n => `FN-${String(n).padStart(2, "0")}`),
    inference_ids: [2,10,16,17].map(n => `IF-${String(n).padStart(2, "0")}`),
  };
  repair.completion_evidence = { evidence_kind: "student_confirmation", confirmation_target: "follow_along", gate: {
    gate_id: repair.completion_evidence.gate!.gate_id,
    requirement: `只判断本次问题对应的断点是否接上，不要求逐项复述四个诊断方向。一次相关、无矛盾的自述或有效复述即可完成补讲，不追加同义确认；未解决的问题留在本拍澄清。${TEACH_FEEDBACK_BOUNDARY}`,
  } };
  repair.participation = "confirm"; repair.pacing = { wait_policy: "student_driven" };
  repair.presentation_intent.voice = ["narrate", "question"];
  repair.transitions = [{ to_beat: repair.beat_id, on: "evidence_collected" }];
  repair.support_boundary = { may_reveal_answer: false, may_reveal_intermediate: true, max_support: "provide_intermediate_conclusion" };
  repair.accepted_alternatives = ["针对刚才的问题明确表示已接上，且无待解决矛盾", "用自己的话解释刚才卡住的关系，关键内容成立；直接结束补讲，不再要求说懂了"];
  repair.common_deviations = oldInquiry.beats.flatMap(b => b.common_deviations ?? []);
  repair.resource_ids = oldInquiry.beats.map((_, i) => `RES${i + 9}`);
  inquiry.content_hash = canonicalHash(record(inquiry), "authoring");
  const mainline = draftProtocol(oldMain, C1_VERSIONS.mainline);
  for (const beat of mainline.beats) {
    const content = MAINLINE_CONTENT.find(c => c.beat === beat.beat_id)!;
    // Reuse established facts rather than replaying every earlier derivation as core.
    // BT-04 keeps the second similarity and length calculations; angle/fold proofs
    // remain in the unchanged source regions and diagnostic resource references.
    if (beat.beat_id === "BT-04") beat.solution_refs = {
      fact_ids: [1,8,10,11,12,13,14,15,16,17,18,19].map(n => `FN-${String(n).padStart(2, "0")}`),
      inference_ids: [10,11,12,13,14,15].map(n => `IF-${String(n).padStart(2, "0")}`),
    };
    // Recap the three similarities and established lengths, not their full proofs.
    if (beat.beat_id === "BT-06") beat.solution_refs = {
      fact_ids: [6,8,10,14,16,17,18,19,21,22,23].map(n => `FN-${String(n).padStart(2, "0")}`),
      inference_ids: ["IF-19"],
    };
    beat.purpose = content.purpose;
    if (beat.role === "practice" || beat.role === "verification") beat.role = "reasoning";
    beat.cognitive_activity = beat.beat_id === "BT-01" ? "attend" : "relate";
    beat.cognitive_process = beat.beat_id === "BT-01" ? "retrieve" : "monitor";
    beat.completion_evidence = { evidence_kind: "student_confirmation", confirmation_target: "follow_along", gate: {
      gate_id: beat.completion_evidence.gate!.gate_id,
      requirement: `当前关键关系：${content.relation}。${TEACH_FEEDBACK_BOUNDARY}`,
      // Retain fact anchoring; follow_along is not student-answer correctness. Current Beat Context permits the target fact; dynamic board.explain remains subject to existing visibility/permissions.
      ...(beat.beat_id === "BT-05" ? { graph_fact_id: "FN-23" } : {}),
    } };
    beat.participation = "confirm"; beat.pacing = { wait_policy: "student_driven" };
    beat.transitions = beat.transitions.filter(t => t.on !== "timeout").map(t => ({ ...t, on: "evidence_collected" }));
    beat.accepted_alternatives = ["这一步听懂了，可以继续（相关、无未解决矛盾）", content.restatement];
    beat.common_deviations = [...new Set([...(beat.common_deviations ?? []), content.misconception, "只说跳过或把播放完成当作听懂"] )];
    beat.presentation_intent.voice = ["narrate", "question"];
    beat.support_boundary = { may_reveal_answer: false, may_reveal_intermediate: beat.beat_id !== "BT-01", max_support: beat.beat_id === "BT-01" ? "orient" : "provide_intermediate_conclusion" };
    beat.resource_ids = [content.resource, ...(beat.beat_id === "BT-04" ? ["RES7"] : [])];
    if (beat.inquiry_branch) beat.inquiry_branch.inquiry_protocol_ref = ref(inquiry);
  }
  mainline.content_hash = canonicalHash(record(mainline), "authoring");
  const plan = structuredClone(source.plan);
  plan.schema = "ai_teaching_tutor_plan_bundle/v7"; plan.version = C1_VERSIONS.plan; plan.status = "Draft";
  delete plan.approval; delete record(plan).runtime_projection;
  plan.artifact_uri = `artifact://tutor-plan/${plan.artifact_id}@${plan.version}`;
  const refs = new Map([mainline, inquiry].map(p => [p.protocol_id, ref(p)]));
  plan.resources = plan.resources.filter(r => r.resource_id !== "RES8");
  for (const [index, original] of oldInquiry.beats.entries()) plan.resources.push({
    resource_id: `RES${index + 9}`, kind: "diagnostic_probe", source: "authored", beat_ref: repair.beat_id,
    solution_refs: structuredClone(original.solution_refs),
    content: `可选诊断方向（不是必过步骤）：${original.purpose}。原诊断提示「${original.completion_evidence.gate!.requirement}」仅用于选择解释方向，不作为额外作答门槛。只在与本次学生问题/返回锚点相关时选用，已有断点不再追问定位；用当前上下文的批准依据解释，不把资源引用当新增事实展示授权。一次相关自述或有效复述可结束本次补讲，不逐项确认。`,
  });
  for (const content of MAINLINE_CONTENT) {
    const resource = plan.resources.find(r => r.resource_id === content.resource)!;
    resource.kind = "voice_seed"; resource.beat_ref = content.beat; resource.content = content.narration;
    resource.solution_refs = structuredClone(mainline.beats.find(b => b.beat_id === content.beat)!.solution_refs);
  }
  for (const chunk of plan.chunks) {
    chunk.protocol_refs = chunk.protocol_refs.map(r => refs.get(r.artifact_id) ?? r);
    chunk.resource_ids = (chunk.resource_ids ?? []).filter(id => id !== "RES3" && id !== "RES8");
    chunk.teacher_narration_refs = chunk.teacher_narration_refs.filter(id => id !== "RES3");
    if (chunk.chunk_id === "CH-01") { chunk.resource_ids.push("RES3"); chunk.teacher_narration_refs.push("RES3"); }
    chunk.instructional_intent = `Teach 讲解：${chunk.instructional_intent}；确认学生接上，不强制独立作答。`;
    chunk.exit_understanding = "学生针对当前关键关系的自述跟上或相关正确复述；不代表独立掌握。";
  }
  for (const region of plan.solution_regions) if (region.local_protocol_refs) region.local_protocol_refs = region.local_protocol_refs.map(r => refs.get(r.artifact_id) ?? r);
  for (const profile of plan.resolution_profiles) profile.learner_description += "；粒度仅用于上下文与表达选择，各拍理解衔接均保留，不跳过确认。";
  const bindings: NonNullable<TutorPlanV5Payload["resource_bindings"]> = [];
  for (const [index, target] of ["pt-O", "seg-AO", "seg-DO", "seg-BO", "seg-OE"].entries()) bindings.push({
    binding_id: `VB-${String(index + 1).padStart(2, "0")}`, binding_kind: "geometry", purpose: `Teach BT-04 复用 RES7 构造 ${target}，不要求学生先填数`,
    geometry_target: target, semantic_role: "second-similarity-construction", allowed_template_ids: [target],
  });
  for (const [index, beat] of mainline.beats.entries()) {
    const facts = [...new Set(beat.solution_refs.fact_ids)];
    const inferences = beat.solution_refs.inference_ids.filter(id => { const inference = source.graph.inferences.find(i => i.inference_id === id)!; return [...inference.premises, inference.conclusion].every(f => facts.includes(f)); });
    bindings.push({ binding_id: `VB-${String(index + 6).padStart(2, "0")}`, binding_kind: "explanation", purpose: `${beat.beat_id} 的当前讲解依据；限 Teach/当前范围，不代表学生已验证正确`,
      basis_refs: { fact_ids: facts, inference_ids: inferences }, presentation_resource: MAINLINE_CONTENT[index].resource });
  }
  plan.resource_bindings = bindings;
  plan.build_provenance = { ...plan.build_provenance, provider: "deterministic-rules", model_id: "none", workflow_version: "c1-teach-follow-along-candidate/1", run_id: "c1-teach-follow-along-v13", built_at: builtAt };
  plan.content_hash = canonicalHash(record(plan), "plan");
  const candidate = { plan, protocols: [inquiry, mainline] };
  const errors = validateTeachFollowAlongCandidate(candidate, source);
  if (errors.length) throw new Error(errors.join("; "));
  return { candidate, review: {
    status: "DRAFT_NOT_APPROVED", release_ready: false,
    c0_decision: "protocol/v3 + confirmation_target=follow_along 已裁定；当前 Beat 已有 Context 允许目标 fact；动态 board.explain 仍受现有工具可见性/权限约束，不新增最终答案展示政策，不扩大 support_boundary。待 C4 真实板书验证。",
    context_budget_audit: auditTeachFollowAlongContexts(candidate, source).map(a => ({ protocol_id: a.protocol_id, beat_id: a.beat_id, budget: a.budget, context_truncated: a.context_truncated })),
    source_refs: [ref(source.plan), ref(oldMain), ref(oldInquiry), { artifact_id: source.graph.graph_id, version: source.graph.version, content_hash: source.graph.content_hash }],
    proposed_publish_order: [ref(inquiry), ref(mainline), ref(plan)],
    review_rule: "三件候选共同审核各自精确 hash，不继承 v12 或来源 approval；C0 按 protocol/v3 裁定，真实批准后整包验证并协调切换，禁止边发布边服务混装版本。",
    inquiry_revision: { source_protocol: ref(oldInquiry), source_diagnostic_beats: structuredClone(oldInquiry.beats),
      mapping: oldInquiry.beats.map((b, i) => ({ source_beat_id: b.beat_id, diagnostic_resource: `RES${i + 9}` })),
      rule: "四个诊断方向改为单拍可选资源；只补当前断点，一次有效证据结束 Inquiry 并沿既有保存锚点返回，不代填主线 gate。未解决问题可留本拍继续澄清。" },
    preserved_practice: { source_plan: ref(source.plan), source_protocol: ref(oldMain), resource: structuredClone(source.plan.resources.find(r => r.resource_id === "RES8")),
      evidence_requirements: oldMain.beats.filter(b => ["student_answer", "workspace_command"].includes(b.completion_evidence.evidence_kind)).map(b => ({ beat_id: b.beat_id, completion_evidence: b.completion_evidence, participation: b.participation })),
      note: "只读历史验证要求，未接入本 Teach bundle；选择练习必须用明确验证任务，听懂不替代其正确性。C1 不发明练习入口。" },
  } };
}

import { geometryVisualCommandSchema, visualStateSchema } from "../../../../shared/canonical/visualSchemas";
import { createHash } from "node:crypto";
import { VisualBindingCatalog, VisualBindingError, type VisualForm, type VisualLifetime } from "./VisualBindingCatalog";

import type { VisualActionKey, VisualOwner, VisualState, VisualCommand as CanonicalVisualCommand } from "../../../../shared/canonical/visualSchemas";
export type { VisualActionKey, VisualOwner } from "../../../../shared/canonical/visualSchemas";
export type WorkspaceVisualState = VisualState;
export type VisualAnnotation = VisualState["annotations"][number];
export type VisualLease = VisualAnnotation["leases"][number];
export type VisualGroup = VisualState["groups"][number];
export interface VisualLeaseChange { annotation_id: string; lease_id: string; before: VisualLease | null; after_version: number }
export type VisualCommand = Exclude<CanonicalVisualCommand, { op: "reconcile" }>;
export interface VisualReductionContext {
  action: VisualActionKey; owner: VisualOwner;
  completedConstructions: ReadonlySet<string>; existingPoints: ReadonlyMap<string, { x: number; y: number }>;
  scopeAllows?:Parameters<VisualBindingCatalog["resolve"]>[1]["scopeAllows"];
  inquiryScope?:VisualOwner["scope"];
  revealAuthorized: Parameters<VisualBindingCatalog["resolve"]>[1]["revealAuthorized"];
}
export const emptyVisualState = (): WorkspaceVisualState => ({ visual_revision: 0, annotations: [], groups: [], active_group_id: null });
export function stableVisualJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableVisualJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableVisualJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
}
export function visualHash(value: unknown): string { return `sha256:${createHash("sha256").update(stableVisualJson(value)).digest("hex")}`; }
export function sameVisualOwner(a: VisualOwner, b: VisualOwner): boolean {
  return stableVisualJson(a.scope) === stableVisualJson(b.scope) && a.scope_epoch === b.scope_epoch && a.part_ref === b.part_ref;
}
const fail = (code: string, message: string): never => { throw new VisualBindingError(code, message); };
function assertOwner(actual: VisualOwner, expected: VisualOwner): void {
  if (!sameVisualOwner(actual, expected) || !Number.isSafeInteger(actual.scope_epoch) || actual.scope_epoch < 1) fail("VISUAL_OWNER_MISMATCH", "command owner is not current scope visit");
}
function ensureGroup(state: WorkspaceVisualState, id: string, owner: VisualOwner, action: VisualActionKey): VisualGroup {
  if (!id.startsWith(`${action.sequence_id}/g/`)) fail("VISUAL_GROUP_SCOPE", id);
  if (state.active_group_id !== null && state.active_group_id !== id) fail("VISUAL_GROUP_NESTING", id);
  const previous = state.groups.find(g => g.group_id === id);
  if (previous) {
    if (previous.status === "closed" || !sameVisualOwner(previous.owner, owner)) fail("VISUAL_GROUP_CLOSED", id);
    return previous;
  }
  const group: VisualGroup = { group_id: id, owner: structuredClone(owner), status: "active", focus: null, opened_by: { ...action } };
  state.groups.push(group); state.active_group_id = id; return group;
}
/** Same validator is used by compiler preflight and authoritative action application. */
export function reduceVisual(original: WorkspaceVisualState, command: VisualCommand, catalog: VisualBindingCatalog, context: VisualReductionContext): { state: WorkspaceVisualState; changed: boolean; lease_changes: VisualLeaseChange[] } {
  geometryVisualCommandSchema.parse(command);
  visualStateSchema.parse(original);
  assertOwner(command.owner, context.owner);
  const state = structuredClone(original);
  const changes: VisualLeaseChange[] = [];
  if (command.op === "close-group") {
    const group = state.groups.find(g => g.group_id === command.group_id);
    if (!group || !sameVisualOwner(group.owner, command.owner)) fail("VISUAL_UNKNOWN_GROUP", command.group_id);
    if (group!.status === "closed") {
      if (stableVisualJson(group!.closed_by) !== stableVisualJson(context.action)) fail("VISUAL_GROUP_CLOSED", command.group_id);
      return { state: original, changed: false, lease_changes: [] };
    }
    group!.status = "closed"; group!.focus = null; group!.closed_by = { ...context.action }; state.active_group_id = null;
    for (const annotation of state.annotations) for (const lease of annotation.leases) if (lease.status !== "retired" && lease.owner.group_id === command.group_id && lease.lifetime === "explanation-group") {
      changes.push({ annotation_id: annotation.annotation_id, lease_id: lease.lease_id, before: structuredClone(lease), after_version: lease.version + 1 });
      lease.status = "retired"; lease.version++; lease.last_changed_by = { ...context.action }; annotation.version++; annotation.last_changed_by = { ...context.action };
    }
  } else {
    const resolved = catalog.resolve(command.binding_ref, { ...context, scope: context.owner.scope,
      ...(command.op === "upsert" ? { form: command.form, lifetime: command.lifetime } : {pair_index:command.pair_index}) });
    if (stableVisualJson(command.resolved_targets) !== stableVisualJson(resolved.targets)) fail("VISUAL_TARGET_MISMATCH", command.binding_ref);
    if (command.op === "focus") {
      if (command.mode !== "steady" && command.mode !== "pulse") fail("VISUAL_MODE_INVALID", command.binding_ref);
      if (resolved.binding.relation.type === "similarity") {
        if (command.pair_index !== undefined) catalog.pairedSides(command.binding_ref, command.pair_index);
        if (!resolved.binding.allowed_forms.includes(command.pair_index === undefined ? "triangle-outline" : "paired-sides")) fail("VISUAL_FORM_NOT_ALLOWED", command.binding_ref);
      } else if (command.pair_index !== undefined) fail("INVALID_PAIR_INDEX", command.binding_ref);
      const group = ensureGroup(state, command.group_id, command.owner, context.action);
      group.focus = { binding_ref: command.binding_ref, mode: command.mode, resolved_targets: structuredClone(command.resolved_targets), ...(command.pair_index === undefined ? {} : { pair_index: command.pair_index }) };
    } else {
      const relation = resolved.binding.relation;
      const expectedContent = "expression_ref" in relation ? relation.expression_ref : undefined;
      if (command.content_ref !== expectedContent || command.role_key !== command.binding_ref) fail("VISUAL_CONTENT_MISMATCH", command.binding_ref);
      const semantic = visualHash([catalog.planHash, command.binding_ref, command.form, command.role_key, command.content_ref ?? null]);
      if (command.semantic_key !== semantic) fail("VISUAL_SEMANTIC_MISMATCH", command.binding_ref);
      let annotation = state.annotations.find(a => a.semantic_key === semantic);
      if ((annotation?.version ?? 0) !== command.expected_version || annotation && annotation.annotation_id !== command.annotation_id) fail("VISUAL_VERSION_CONFLICT", command.annotation_id);
      if (!annotation) {
        if (state.annotations.some(a => a.annotation_id === command.annotation_id) || !command.annotation_id.startsWith(`${context.action.action_id}/a/`)) fail("VISUAL_ID_CONFLICT", command.annotation_id);
        annotation = { annotation_id: command.annotation_id, semantic_key: semantic, binding_ref: command.binding_ref, form: command.form, role_key: command.role_key,
          ...(command.content_ref === undefined ? {} : { content_ref: command.content_ref }), resolved_targets: structuredClone(command.resolved_targets), version: 0, leases: [], introduced_by: { ...context.action }, last_changed_by: { ...context.action } };
        state.annotations.push(annotation);
      }
      if (command.lifetime === "explanation-group" && !command.owner.group_id) fail("VISUAL_GROUP_REQUIRED", command.binding_ref);
      if (command.owner.group_id) ensureGroup(state, command.owner.group_id, command.owner, context.action);
      const existing = annotation.leases.find(l => sameVisualOwner(l.owner, command.owner) && l.owner.group_id === command.owner.group_id && l.lifetime === command.lifetime && l.status === "active");
      if (!existing) {
        const lease: VisualLease = { lease_id: `${context.action.action_id}/l/${annotation.leases.length}`, owner: structuredClone(command.owner), lifetime: command.lifetime,
          status: "active", version: 1, introduced_by: { ...context.action }, last_changed_by: { ...context.action } };
        annotation.leases.push(lease); annotation.version++; annotation.last_changed_by = { ...context.action };
        changes.push({ annotation_id: annotation.annotation_id, lease_id: lease.lease_id, before: null, after_version: 1 });
      }
    }
  }
  const changed = stableVisualJson(state) !== stableVisualJson(original);
  if (changed) state.visual_revision++;
  return { state: changed ? state : original, changed, lease_changes: changes };
}

/** Revoke an unconfirmed action without inventing its browser outcome. The caller
 * supplies lineage reconstructed from applied events, never client-provided changes. */
export function rollbackVisualLeaseChanges(original: WorkspaceVisualState, changes: readonly VisualLeaseChange[], action: VisualActionKey): WorkspaceVisualState {
  const state = structuredClone(original);
  for (const change of changes) {
    const annotation = state.annotations.find(a => a.annotation_id === change.annotation_id);
    const lease = annotation?.leases.find(l => l.lease_id === change.lease_id);
    if (!annotation || !lease || lease.version !== change.after_version) fail("VISUAL_ROLLBACK_CONFLICT", change.lease_id);
    const replacement: VisualLease = change.before ? structuredClone(change.before) : { ...lease!, status: "retired" };
    // Restore content/status, never reuse an old version (ABA protection).
    replacement.version = lease!.version + 1; replacement.last_changed_by = { ...action };
    annotation!.leases[annotation!.leases.indexOf(lease!)] = replacement; annotation!.version++; annotation!.last_changed_by = { ...action };
  }
  if (changes.length) state.visual_revision++;
  return state;
}
export type VisualOwnerTransition = "enter-inquiry" | "return-inquiry" | "next-beat" | "next-part" | "completion" | "barge-in";
export function invalidateVisualOwner(original: WorkspaceVisualState, owner: VisualOwner, transition: VisualOwnerTransition, action: VisualActionKey): { state: WorkspaceVisualState; lease_ids: string[]; group_ids: string[] } {
  const state = structuredClone(original), leases: string[] = [], groups: string[] = [];
  for (const group of state.groups) if (group.status === "active" && sameVisualOwner(group.owner, owner)) {
    group.status = "closed"; group.focus = null; group.closed_by = { ...action }; groups.push(group.group_id);
    if (state.active_group_id === group.group_id) state.active_group_id = null;
  }
  for (const annotation of state.annotations) for (const lease of annotation.leases) {
    const applies = transition === "next-part" ? lease.owner.part_ref === owner.part_ref : sameVisualOwner(lease.owner, owner);
    const retire = transition === "next-part" || transition === "return-inquiry" || (transition === "next-beat" || transition === "completion") && lease.lifetime !== "problem-part" || lease.lifetime === "explanation-group";
    if (applies && retire && lease.status !== "retired") {
      lease.status = "retired"; lease.version++; lease.last_changed_by = { ...action }; annotation.version++; annotation.last_changed_by = { ...action }; leases.push(lease.lease_id);
    }
  }
  if (leases.length || groups.length) state.visual_revision++;
  return { state, lease_ids: leases.sort(), group_ids: groups.sort() };
}

export interface PrepareVisualInvalidationInput {
  state:WorkspaceVisualState; workspaceRevision:number; reason:import("../../../../shared/canonical/visualSchemas").VisualInvalidation["reason"];
  owner:VisualOwner; transition:VisualOwnerTransition; action:VisualActionKey;
  additionalTransitions?:readonly {owner:VisualOwner;transition:VisualOwnerTransition}[];
  unconfirmed:readonly {action:VisualActionKey;changes:readonly VisualLeaseChange[]}[];
}
/** One lifecycle event = at most one visual revision, regardless of lease count. */
export function prepareVisualInvalidation(input:PrepareVisualInvalidationInput): {state:WorkspaceVisualState;invalidation:import("../../../../shared/canonical/visualSchemas").VisualInvalidation} {
  let state=input.state;
  const touched=new Set<string>();
  for(const pending of [...input.unconfirmed].reverse()) {
    state=rollbackVisualLeaseChanges(state,pending.changes,input.action);
    for(const c of pending.changes)touched.add(c.lease_id);
  }
  const groups=new Set<string>();
  for(const step of [{owner:input.owner,transition:input.transition},...(input.additionalTransitions??[])]) {
    const result=invalidateVisualOwner(state,step.owner,step.transition,input.action);state=result.state;
    for(const id of result.lease_ids)touched.add(id);
    for(const id of result.group_ids)groups.add(id);
  }
  const changed=stableVisualJson({...input.state,visual_revision:0})!==stableVisualJson({...state,visual_revision:0});
  state={...state,visual_revision:input.state.visual_revision+(changed?1:0)};
  return {state,invalidation:{reason:input.reason,owner_keys:[...new Set([input.owner,...(input.additionalTransitions??[]).map(s=>s.owner)].map(visualHash))],group_ids:[...groups].sort(),lease_ids:[...touched].sort(),rollback_action_keys:input.unconfirmed.map(u=>({...u.action})),resulting_visual_revision:state.visual_revision,resulting_workspace_revision:input.workspaceRevision+(changed?1:0)}};
}
/** Wire invalidation is a claim, independently recomputed from history. */
export function foldVisualInvalidation(input:Omit<PrepareVisualInvalidationInput,"reason"> & {payload:import("../../../../shared/canonical/visualSchemas").VisualInvalidation}):WorkspaceVisualState {
  const expected=prepareVisualInvalidation({...input,reason:input.payload.reason});
  const normalize=(p:typeof input.payload)=>({...p,owner_keys:[...p.owner_keys].sort(),group_ids:[...p.group_ids].sort(),lease_ids:[...p.lease_ids].sort(),rollback_action_keys:[...p.rollback_action_keys].sort((a,b)=>stableVisualJson(a).localeCompare(stableVisualJson(b)))});
  if(stableVisualJson(normalize(input.payload))!==stableVisualJson(normalize(expected.invalidation)))fail("VISUAL_INVALIDATION_MISMATCH","affected owner/lease/group/rollback/revision");
  return expected.state;
}

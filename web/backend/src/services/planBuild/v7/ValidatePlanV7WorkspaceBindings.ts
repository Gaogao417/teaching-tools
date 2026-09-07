import type { ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import { buildGoldenWorkspaceCatalogV5 } from "../../tutorOrchestration/GoldenWorkspaceCatalog";
import type { WorkspacePresentationCatalogV5 } from "../../tutorSession/WorkspacePresentationCatalogV5";

/** Resolve against the actual workspace catalog, never synthesize BE ids from refs. */
export function validatePlanV7WorkspaceBindings(imported: ImportedApprovedPlanV5, supplied?: WorkspacePresentationCatalogV5): string[] {
  const bindings = imported.plan.resource_bindings ?? [];
  if (!bindings.some(b => b.binding_kind !== "explanation")) return [];
  if (!supplied && imported.plan.artifact_id !== "TP-SMV-009") return ["v7 workspace bindings require the task workspace catalog"];
  const catalog = supplied ?? buildGoldenWorkspaceCatalogV5(imported).catalog;
  const errors: string[] = [];
  const outputIds = new Set<string>();
  for (const resource of imported.plan.resources) {
    if (resource.kind !== "workspace" || !resource.content) continue;
    try {
      const body = JSON.parse(resource.content);
      for (const command of body.constructions ?? []) {
        const id = command.type === "intersect-lines" ? command.outputPointId : command.type === "construct-carrier" ? command.outputLineId : undefined;
        if (typeof id === "string") outputIds.add(id);
      }
    } catch { errors.push(`invalid workspace construction resource ${resource.resource_id}`); }
  }
  const geometryIds = new Set([...Object.keys(catalog.authoredElementKinds ?? {}),
    ...(catalog.baseGeometry?.points ?? []).map(p => p.id), ...(catalog.baseGeometry?.segments ?? []).map(s => s.id), ...outputIds]);
  for (const binding of bindings) {
    if (binding.binding_kind === "board") {
      const entry = catalog.boardEntries.find(e => e.entryId === binding.board_entry_id);
      if (!entry) errors.push(`binding ${binding.binding_id}: unknown board entry ${binding.board_entry_id}`);
      else if (entry.revealGate && (entry.revealGate.gateId !== binding.reveal_after_gate.gate_id || entry.revealGate.protocolId !== binding.reveal_after_gate.protocol_id)) errors.push(`binding ${binding.binding_id}: board reveal gate disagrees with workspace catalog`);
    }
    if (binding.binding_kind === "geometry") {
      if (!geometryIds.has(binding.geometry_target)) errors.push(`binding ${binding.binding_id}: unknown geometry target ${binding.geometry_target}`);
      for (const id of binding.allowed_template_ids) if (!outputIds.has(id)) errors.push(`binding ${binding.binding_id}: unknown approved construction output ${id}`);
    }
  }
  return errors;
}

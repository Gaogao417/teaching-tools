/** Explicit isolated visual review reader. Does not alter the C1/v13 reader and
 * does not publish, approve, or silently upgrade any historical session. */
import { readFileSync } from "node:fs";
import { join,resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { tutorPlanBundleV8Schema } from "../../../../../shared/canonical/visualSchemas";
import { importReviewCandidate } from "../c1/ImportReviewCandidate";
import { attachFirstTopicVisualCandidate } from "./FirstTopicVisualCandidate";
import { importVisualBindings } from "./ImportVisualBindings";
import { buildGoldenWorkspaceCatalogV5 } from "../../tutorOrchestration/GoldenWorkspaceCatalog";
import { materializeTutorPlanV5 } from "../v5/MaterializeTutorPlanV5";
import { buildRuntimeRegistrySnapshot } from "../RuntimeRegistrySnapshot";
import type { ImportedApprovedPlanV5 } from "../v5/ImportApprovedPlanV5";
import type { ImportReviewCandidateOptions } from "../c1/ImportReviewCandidate";
export function importVisualReviewCandidate(options:ImportReviewCandidateOptions):
 |{ok:true;imported:ImportedApprovedPlanV5;reviewContext:"draft-local-review";visual:ReturnType<typeof importVisualBindings>}
 |{ok:false;errors:string[]} {
 try{
  const directory=resolve(options.candidateDirectory);
  const base=importReviewCandidate({canonicalRoot:options.canonicalRoot,candidateDirectory:join(directory,"base")});
  if(!base.ok)return base;
  const read=(file:string)=>JSON.parse(readFileSync(join(directory,file),"utf8"));
  const manifest=read("visual-review-manifest.json");
  if(manifest.status!=="DRAFT_NOT_APPROVED"||manifest.release_ready!==false||manifest.plan_version!=="v14")throw new Error("invalid visual review manifest");
  const plan=tutorPlanBundleV8Schema.parse(read("TP-SMV-009.v14.draft.json"));
  const regenerated=attachFirstTopicVisualCandidate({plan:base.imported.plan,graphHash:base.imported.graph.content_hash,facts:new Map(base.imported.graph.facts.map(f=>[f.fact_id,f])),targetVersion:"v14"});
  if(!isDeepStrictEqual(plan,regenerated.plan)||!isDeepStrictEqual(read("visual-binding-evidence.json"),regenerated.evidence))throw new Error("visual candidate/evidence differs from audited pinned source");
  if(manifest.plan_hash!==plan.content_hash||manifest.graph_hash!==base.imported.graph.content_hash||manifest.base_plan_hash!==base.imported.plan.content_hash)throw new Error("visual review pin mismatch");
  // Existing mathematical materializer dispatches canonical schema by marker.
  // Its legacy TS view is only an internal shape adapter; the actual payload
  // remains v8 with the new hash/version throughout projection and session pins.
  const snapshot=buildRuntimeRegistrySnapshot();
  const legacyShape=plan as unknown as ImportedApprovedPlanV5["plan"];
  const materialized=materializeTutorPlanV5(legacyShape,{...base.imported,snapshot},{requireApproved:false});
  if(!materialized.ok)return materialized;
  const imported:ImportedApprovedPlanV5={...base.imported,plan:legacyShape,projection:materialized.projection,projection_hash:materialized.projection_hash};
  const workspaceCatalog=buildGoldenWorkspaceCatalogV5(imported).catalog;
  const visual=importVisualBindings({plan,imported,workspaceCatalog,reviewContext:"draft-local-review"});
  return {ok:true,imported,reviewContext:"draft-local-review",visual};
 }catch(error){return {ok:false,errors:[`visual review candidate rejected: ${String(error)}`]};}
}

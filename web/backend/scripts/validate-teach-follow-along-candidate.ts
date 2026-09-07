/** tsx scripts/validate-teach-follow-along-candidate.ts ROOT CANDIDATE_DIR */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { importApprovedPlanV5 } from "../src/services/planBuild/v5/ImportApprovedPlanV5";
import { C1_VERSIONS, validateTeachFollowAlongCandidate } from "../src/services/planBuild/c1/PrepareTeachFollowAlongCandidate";
import type { TeachingProtocolV2Payload, TutorPlanV5Payload } from "../src/services/planBuild/canonicalInputs";
const [root, directory] = process.argv.slice(2);
if (!root || !directory) throw new Error("Required: canonical ROOT CANDIDATE_DIR");
const read = (file: string) => JSON.parse(readFileSync(join(resolve(directory), file), "utf8"));
const plan = read(`TP-SMV-009.${C1_VERSIONS.plan}.draft.json`) as TutorPlanV5Payload;
const protocols = [read(`PR-SMV-002.${C1_VERSIONS.inquiry}.draft.json`), read(`PR-SMV-001.${C1_VERSIONS.mainline}.draft.json`)] as TeachingProtocolV2Payload[];
const manifest = read("review-manifest.json");
const loaded = importApprovedPlanV5({ canonicalRoot: resolve(root) }, "TP-SMV-009");
if (!loaded.ok) throw new Error(loaded.errors.join("; "));
const errors = validateTeachFollowAlongCandidate({ plan, protocols }, loaded.imported);
const publishedRefs = [...protocols.map(p => ({ artifact_id: p.protocol_id, version: p.version, content_hash: p.content_hash })),
  { artifact_id: plan.artifact_id, version: plan.version, content_hash: plan.content_hash }];
if (!isDeepStrictEqual(publishedRefs, manifest.proposed_publish_order)) errors.push("review manifest candidate pins differ from actual files");
const source = loaded.imported;
const sourceRefs = [{ artifact_id: source.plan.artifact_id, version: source.plan.version, content_hash: source.plan.content_hash },
  ...["PR-SMV-001", "PR-SMV-002"].map(id => { const p = source.protocols.get(id)!; return { artifact_id: id, version: p.version, content_hash: p.content_hash }; }),
  { artifact_id: source.graph.graph_id, version: source.graph.version, content_hash: source.graph.content_hash }];
if (!isDeepStrictEqual(sourceRefs, manifest.source_refs)) errors.push("review source pins differ from current Approved inputs; re-audit before approval");
if (manifest.status !== "DRAFT_NOT_APPROVED" || manifest.release_ready !== false) errors.push("candidate review must not claim approval/readiness");
if (errors.length) throw new Error(errors.join("\n"));
console.log(JSON.stringify({ ok: true, status: "DRAFT_NOT_APPROVED", checked: publishedRefs, publicationPerformed: false }, null, 2));

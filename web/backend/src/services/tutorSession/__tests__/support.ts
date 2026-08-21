/**
 * Phase 5 测试共用工件：临时 sqlite + 合成 canonical root（truth/TA→build→
 * approve→materialize→publish，与 planCases.test 同管线）+ coordinator harness。
 *
 * 注意：planBuild 链会经 topicPlanProjector→questionSolutionRepository 提前
 * require db/database——所以本模块对 planBuild 的依赖全部惰性化，确保
 * ensureSqlite 设置 SQLITE_PATH 发生在任何 db 加载之前。
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const SHA = (seed: string): string => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

/** 每个测试进程独占 sqlite（进程内在首次 require db 前调用一次）。 */
export function ensureSqlite(name: string): string {
  const sqlitePath = path.resolve(process.cwd(), `.${name}.test.sqlite`);
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${sqlitePath}${suffix}`, { force: true });
    } catch {
      /* 不存在即跳过 */
    }
  }
  process.env.SQLITE_PATH = sqlitePath;
  return sqlitePath;
}

export function tempRoot(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

type CanonicalInputsModule = typeof import("../../planBuild/canonicalInputs");
type BuildModule = typeof import("../../planBuild/BuildTutorPlan");
type ReviewModule = typeof import("../../planBuild/ReviewTutorPlan");
type MaterializeModule = typeof import("../../planBuild/MaterializeTutorPlan");
type RegistryModule = typeof import("../../planBuild/RuntimeRegistrySnapshot");

/** 惰性加载（禁止提升到模块顶部：见文件头注释）。 */
function lazy<T>(modulePath: string): () => T {
  let cached: T | undefined;
  return () => (cached ??= require(modulePath) as T);
}

const canonicalInputs = lazy<CanonicalInputsModule>("../../planBuild/canonicalInputs");
const buildModule = lazy<BuildModule>("../../planBuild/BuildTutorPlan");
const reviewModule = lazy<ReviewModule>("../../planBuild/ReviewTutorPlan");
const materializeModule = lazy<MaterializeModule>("../../planBuild/MaterializeTutorPlan");
const registryModule = lazy<RegistryModule>("../../planBuild/RuntimeRegistrySnapshot");

function writeVersioned(root: string, namespace: string, artifactId: string, payload: Record<string, unknown>): void {
  const dir = path.join(root, namespace, artifactId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${payload.version as string}.json`), `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(
    path.join(dir, "registry.yaml"),
    [
      `artifact_id: ${artifactId}`,
      `current_version: ${payload.version as string}`,
      "versions:",
      `- {version: ${payload.version as string}, status: Approved}`,
      "",
    ].join("\n"),
  );
}

function makeTruth(qtId: string, partCount: number): Record<string, unknown> {
  const subquestions = Array.from({ length: partCount }, (_, index) => ({
    part_id: String(index + 1),
    prompt: `(${index + 1}) 求证：$\\triangle AOB \\sim \\triangle DOC$；`,
    canonical_answer: { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" },
    reviewed_solution: "由平行得内错角相等，AA 判定。",
  }));
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_question_truth/v2",
    artifact_id: qtId,
    version: "v1",
    status: "Approved",
    question_type: "solution",
    stem: `如图（${qtId}），$AB \\parallel CD$。求证：$\\triangle AOB \\sim \\triangle DOC$。`,
    subquestions: partCount > 0 ? subquestions : undefined,
    ...(partCount > 0
      ? {}
      : {
          canonical_answer: { kind: "proof", value: "$\\triangle AOB \\sim \\triangle DOC$" },
          reviewed_solution: "由平行得内错角相等，AA 判定。",
        }),
    source_evidence_refs: [{ evidence_id: "SE-TST-001", artifact_uri: "artifact://source-evidence/SE-TST-001" }],
    approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://question-truth/${qtId}@v1`,
  };
  payload.content_hash = canonicalInputs().canonicalHash(payload, "authoring");
  return payload;
}

function makeApproach(qtId: string, taId: string, partId: string | undefined, truthHash: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_teaching_approach/v2",
    artifact_id: taId,
    version: "v1",
    status: "Approved",
    question_ref: {
      artifact_id: qtId,
      version: "v1",
      content_hash: truthHash,
      ...(partId ? { part_id: partId } : {}),
    },
    title: `${taId}`,
    goal: "建立平行到相似的推理链",
    entry_signal: "学生能先指出目标三角形，再转换条件",
    steps: [
      {
        step_id: "S1",
        intent: "识别目标三角形",
        narration: "看两个三角形。",
        expected_student_reasoning: "学生能指出目标三角形",
        common_errors: ["只看数值不指出目标三角形"],
        skill_ids: ["SKILL-SMV-008"],
      },
      {
        step_id: "S2",
        intent: "转换平行条件",
        narration: "平行给内错角。",
        expected_student_reasoning: "学生能说出内错角相等",
        skill_ids: ["SKILL-SMV-005"],
      },
      {
        step_id: "S3",
        intent: "AA 收尾",
        narration: "AA 判定。",
        expected_student_reasoning: "学生能写出 AA 判定结论",
        common_errors: ["在斜三角形中硬凑勾股"],
        skill_ids: ["SKILL-SMV-009"],
      },
    ],
    evidence: {
      audio: [{ artifact_uri: `artifact://audio/${taId}@v1/a.wav`, content_hash: SHA("a"), recorded_at: "2026-08-21T00:00:00Z" }],
      transcripts: [{ artifact_uri: `artifact://transcript/${taId}@v1/a.txt`, asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" } }],
      polished: [],
      manual_edit_notes: ["tst"],
    },
    approval: { reviewer_id: "tst", approved_at: "2026-08-21T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://teaching-approach/${taId}@v1`,
  };
  payload.content_hash = canonicalInputs().canonicalHash(payload, "authoring");
  return payload;
}

/** 发布一个合成 golden plan（TP id 与 golden 白名单一致，feature flag 可通过）。 */
export function publishSyntheticPlan(
  root: string,
  options: { qtId: string; tpId: string; parts: number },
): import("../../planBuild/canonicalInputs").TutorPlanV2Payload {
  const { qtId, tpId, parts } = options;
  const truth = makeTruth(qtId, parts) as unknown as import("../../planBuild/canonicalInputs").TruthPayload;
  writeVersioned(root, "question-truth", qtId, truth as unknown as Record<string, unknown>);
  const qtSeq = qtId.slice(-1);
  const approaches = Array.from({ length: parts === 0 ? 1 : parts }, (_, index) => {
    const taId = `TA-TST-${qtSeq}0${index + 1}`;
    return makeApproach(qtId, taId, parts === 0 ? undefined : String(index + 1), truth.content_hash) as unknown as import("../../planBuild/canonicalInputs").ApproachPayload;
  });
  for (const approach of approaches) {
    writeVersioned(root, "teaching-approach", approach.artifact_id, approach as unknown as Record<string, unknown>);
  }
  const snapshot = registryModule().buildRuntimeRegistrySnapshot();
  const build = buildModule().buildTutorPlanDraft({
    planId: tpId,
    runId: "run-tst",
    builtAt: "2026-08-21T00:00:00Z",
    truth,
    approachSet: null,
    approaches,
    snapshot,
    capabilityPath: ["select-option", "enter-text"],
  });
  if (!build.ok) throw new Error(build.errors.join(";"));
  const inputs = {
    truth,
    approaches: new Map(approaches.map((approach) => [approach.artifact_id, approach])),
    snapshot,
  };
  const { projection_hash } = materializeModule().projectApprovedPlan(build.plan, inputs);
  const approval = reviewModule().approveTutorPlan(build.plan, {
    reviewer_id: "reviewer-tst",
    approved_at: "2026-08-21T01:00:00Z",
    review_note: "tst",
    runtime_projection: {
      materializer_version: materializeModule().MATERIALIZER_VERSION,
      runtime_registry_version: snapshot.runtime_registry_version,
      projection_hash,
      validation_status: "passed",
    },
  });
  if (!approval.ok) throw new Error(approval.errors.join(";"));
  const materialized = materializeModule().materializeTutorPlan(approval.plan, inputs);
  if (!materialized.ok) throw new Error(materialized.errors.join(";"));
  writeVersioned(root, "tutor-plan", tpId, materialized.plan as unknown as Record<string, unknown>);
  return materialized.plan;
}

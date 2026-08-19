/**
 * P3-10：C-APP deterministic case 判定与 Run 记录合法性测试。
 * 与本仓测试约定一致：node 直跑 + node:assert/strict（无测试框架）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const {
  buildApproachRun,
  canonicalContentHash,
  normalizeForMatch,
  resolveEvidenceFile,
  runApproachCases,
  staticAnswerTargets,
} = require("../approachCases") as typeof import("../approachCases");

interface Step {
  step_id: string;
  intent: string;
  narration: string;
  expected_student_reasoning: string;
  accepted_alternatives?: string[];
  common_errors?: string[];
  skill_ids: string[];
}

interface Fixture {
  root: string;
  approachRegistryDir: string;
  truthRegistryDir: string;
  canonicalRoot: string;
}

function writeRegistry(dir: string, artifactId: string, current: string, statuses: Array<[string, string]>): void {
  mkdirSync(path.join(dir, artifactId), { recursive: true });
  const lines = [`artifact_id: ${artifactId}`, `current_version: ${current}`, "versions:"];
  for (const [version, status] of statuses) {
    lines.push(`- {version: ${version}, status: ${status}}`);
  }
  writeFileSync(path.join(dir, artifactId, "registry.yaml"), `${lines.join("\n")}\n`, "utf8");
}

function makeTruthPayload(qtId: string, version: string): Record<string, unknown> {
  const payload = {
    schema: "ai_teaching_question_truth/v1",
    artifact_id: qtId,
    version,
    status: "Approved",
    question_type: "solution",
    stem: "如图。（1）求证：$CE \\perp AB$；（2）求 $AF \\cdot DE = AG \\cdot BC$。",
    canonical_answer: {
      kind: "expression",
      value: "(1) $CE \\perp AB$ 得证；（2）$AF \\cdot DE = AG \\cdot BC$ 得证",
    },
    reviewed_solution: "参考答案（测试）",
    source_evidence_refs: [
      { evidence_id: "SE-TEST-001", artifact_uri: "artifact://source-evidence/SE-TEST-001" },
    ],
    approval: { reviewer_id: "fixture", approved_at: "2026-08-19T00:00:00Z" },
    content_hash: "",
    artifact_uri: `artifact://question-truth/${qtId}@${version}`,
  };
  payload.content_hash = canonicalContentHash(payload);
  return payload;
}

function makeApproachPayload(
  taId: string,
  questionRef: { artifact_id: string; version: string; content_hash: string },
  steps: Step[],
): Record<string, unknown> {
  const payload = {
    schema: "ai_teaching_teaching_approach/v1",
    artifact_id: taId,
    version: "v1",
    status: "Approved",
    question_ref: questionRef,
    title: "测试思路",
    goal: "学会等积式改比例",
    entry_signal: "见到等积式先交叉",
    steps,
    evidence: {
      audio: [
        {
          artifact_uri: `artifact://audio/${taId}@v1/r01.webm`,
          content_hash: `sha256:${createHash("sha256").update("fake-audio").digest("hex")}`,
          recorded_at: "2026-08-19T00:00:00Z",
        },
      ],
      transcripts: [
        {
          artifact_uri: `artifact://transcript/${taId}@v1/r01.transcript.txt`,
          asr_provenance: { provider: "dashscope", model_id: "qwen3-asr-flash" },
          revision: 1,
        },
      ],
      polished: [
        {
          artifact_uri: `artifact://transcript/${taId}@v1/r01.polished.txt`,
          polish_provenance: { provider: "dashscope", model_id: "qwen-plus", prompt_version: "t" },
        },
      ],
      manual_edit_notes: ["2026-08-19 editor=teacher edited=steps,goal"],
    },
    approval: { reviewer_id: "reviewer-r", approved_at: "2026-08-19T00:00:00Z", review_note: "ok" },
    content_hash: "",
    artifact_uri: `artifact://teaching-approach/${taId}@v1`,
  };
  payload.content_hash = canonicalContentHash(payload);
  return payload;
}

function fullSteps(): Step[] {
  return [
    {
      step_id: "S1",
      intent: "模型识别",
      narration: "由等积式得比例，配相似三角形。",
      expected_student_reasoning: "学生能改比例配相似。",
      common_errors: ["上下位写反"],
      skill_ids: ["SKILL-SMV-008"],
    },
    {
      step_id: "S2",
      intent: "导角证垂直",
      narration: "导角推出 $CE \\perp AB$。",
      expected_student_reasoning: "学生能写全导角链。",
      skill_ids: ["SKILL-SMV-006"],
    },
    {
      step_id: "S3",
      intent: "比例式收口",
      narration: "两次比例相乘得 $AF \\cdot DE = AG \\cdot BC$。",
      expected_student_reasoning: "学生能规划两组相似。",
      skill_ids: ["SKILL-SMV-007"],
    },
  ];
}

function buildFixture(options?: {
  steps?: Step[];
  tamperAudioHash?: boolean;
  staleBinding?: boolean;
  dropManualNotes?: boolean;
}): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "approach-cases-"));
  const canonicalRoot = path.join(root, "canonical-authoring");
  const approachRegistryDir = path.join(canonicalRoot, "teaching-approach");
  const truthRegistryDir = path.join(canonicalRoot, "question-truth");

  const truth = makeTruthPayload("QT-SMV-001", "v1");
  mkdirSync(path.join(truthRegistryDir, "QT-SMV-001"), { recursive: true });
  writeFileSync(
    path.join(truthRegistryDir, "QT-SMV-001", "v1.json"),
    JSON.stringify(truth, null, 2),
    "utf8",
  );
  writeRegistry(truthRegistryDir, "QT-SMV-001", "v1", [["v1", "Approved"]]);

  const questionRef = options?.staleBinding
    ? { artifact_id: "QT-SMV-001", version: "v1", content_hash: `sha256:${"0".repeat(64)}` }
    : { artifact_id: "QT-SMV-001", version: "v1", content_hash: String(truth.content_hash) };
  const approach = makeApproachPayload("TA-SMV-101", questionRef, options?.steps ?? fullSteps());
  if (options?.tamperAudioHash) {
    const evidence = approach.evidence as { audio: Array<{ content_hash: string }> };
    evidence.audio[0].content_hash = `sha256:${"9".repeat(64)}`;
    approach.content_hash = canonicalContentHash(approach);
  }
  if (options?.dropManualNotes) {
    const evidence = approach.evidence as { manual_edit_notes: string[] };
    evidence.manual_edit_notes = [];
    approach.content_hash = canonicalContentHash(approach);
  }
  mkdirSync(path.join(approachRegistryDir, "TA-SMV-101"), { recursive: true });
  writeFileSync(
    path.join(approachRegistryDir, "TA-SMV-101", "v1.json"),
    JSON.stringify(approach, null, 2),
    "utf8",
  );
  writeRegistry(approachRegistryDir, "TA-SMV-101", "v1", [["v1", "Approved"]]);

  // 证据文件副本（audio/transcript），与 resolveEvidenceFile 的解析规则对应。
  const audioDir = path.join(canonicalRoot, "audio", "TA-SMV-101", "v1");
  const transcriptDir = path.join(canonicalRoot, "transcript", "TA-SMV-101", "v1");
  mkdirSync(audioDir, { recursive: true });
  mkdirSync(transcriptDir, { recursive: true });
  writeFileSync(path.join(audioDir, "r01.webm"), "fake-audio", "utf8");
  writeFileSync(path.join(transcriptDir, "r01.transcript.txt"), "转写稿", "utf8");
  writeFileSync(path.join(transcriptDir, "r01.polished.txt"), "润色稿", "utf8");
  return { root, approachRegistryDir, truthRegistryDir, canonicalRoot };
}

function byCase(results: ReturnType<typeof runApproachCases>): Map<string, (typeof results)[number]> {
  return new Map(results.map((entry) => [entry.case_id, entry]));
}

function main(): void {
  const goldenSix = ["QT-SMV-001", "QT-SMV-002", "QT-SMV-003", "QT-SMV-004", "QT-SMV-005", "QT-SMV-006"];

  // 1) 干净 fixture：4/4 pass。
  {
    const fixture = buildFixture();
    try {
      const results = runApproachCases({
        approachRegistryDir: fixture.approachRegistryDir,
        truthRegistryDir: fixture.truthRegistryDir,
        canonicalRoot: fixture.canonicalRoot,
      });
      const map = byCase(results);
      // 该 fixture 只有 1 题（非 golden 六题），C-APP-03 对 golden 缺覆盖应 fail；
      assert.equal(map.get("C-APP-01")?.status, "pass");
      assert.equal(map.get("C-APP-02")?.status, "pass");
      assert.equal(map.get("C-APP-03")?.status, "fail");
      assert.equal(map.get("C-APP-03")?.failure_class, "math_fact_inconsistent");
      assert.match(String(map.get("C-APP-03")?.metrics?.detail), /QT-SMV-002: truth missing/);
      assert.equal(map.get("C-APP-04")?.status, "pass");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 2) 步骤不足 3 → C-APP-01 结构失败。
  {
    const fixture = buildFixture({ steps: fullSteps().slice(0, 2) });
    try {
      const map = byCase(
        runApproachCases({
          approachRegistryDir: fixture.approachRegistryDir,
          truthRegistryDir: fixture.truthRegistryDir,
          canonicalRoot: fixture.canonicalRoot,
        }),
      );
      assert.equal(map.get("C-APP-01")?.status, "fail");
      assert.equal(map.get("C-APP-01")?.failure_class, "approach_structure_invalid");
      // Zod schema 先拦（steps 至少 3），自写结构检查兜底——两者都属结构失败。
      assert.match(String(map.get("C-APP-01")?.metrics?.detail), /steps/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 3) 音频副本 hash 漂移 → C-APP-02 证据链失败。
  {
    const fixture = buildFixture({ tamperAudioHash: true });
    try {
      const map = byCase(
        runApproachCases({
          approachRegistryDir: fixture.approachRegistryDir,
          truthRegistryDir: fixture.truthRegistryDir,
          canonicalRoot: fixture.canonicalRoot,
        }),
      );
      assert.equal(map.get("C-APP-02")?.status, "fail");
      assert.equal(map.get("C-APP-02")?.failure_class, "evidence_untraceable");
      assert.match(String(map.get("C-APP-02")?.metrics?.detail), /audio hash drift/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 4) 绑定 hash 与当前 Truth 不符 → C-APP-04 版本绑定失败。
  {
    const fixture = buildFixture({ staleBinding: true });
    try {
      const map = byCase(
        runApproachCases({
          approachRegistryDir: fixture.approachRegistryDir,
          truthRegistryDir: fixture.truthRegistryDir,
          canonicalRoot: fixture.canonicalRoot,
        }),
      );
      assert.equal(map.get("C-APP-04")?.status, "fail");
      assert.equal(map.get("C-APP-04")?.failure_class, "version_binding_stale");
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 5) 无人工编辑痕迹 → C-APP-02/C-APP-03 都要拦（AI 建议未经教师触碰）。
  {
    const fixture = buildFixture({ dropManualNotes: true });
    try {
      const map = byCase(
        runApproachCases({
          approachRegistryDir: fixture.approachRegistryDir,
          truthRegistryDir: fixture.truthRegistryDir,
          canonicalRoot: fixture.canonicalRoot,
        }),
      );
      assert.equal(map.get("C-APP-02")?.status, "pass"); // polished 链仍在
      assert.equal(map.get("C-APP-03")?.status, "fail");
      assert.match(String(map.get("C-APP-03")?.metrics?.detail), /无人工编辑痕迹/);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 6) Run 记录合法性（含 fail case 时的 failure_class 必填）。
  {
    const fixture = buildFixture();
    try {
      const result = buildApproachRun({
        runId: "BR-9999",
        sutId: "sut-a-test",
        datasetId: "similarity-mvp-benchmark-v1",
        datasetVersion: "v1",
        inputs: {
          approachRegistryDir: fixture.approachRegistryDir,
          truthRegistryDir: fixture.truthRegistryDir,
          canonicalRoot: fixture.canonicalRoot,
        },
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        const record = result.record as {
          case_results: Array<{ case_id: string; status: string }>;
          summary: Record<string, number>;
        };
        assert.deepEqual(
          record.case_results.map((entry) => entry.case_id),
          ["C-APP-01", "C-APP-02", "C-APP-03", "C-APP-04"],
        );
        assert.equal(record.summary.passed + record.summary.failed, 4);
      }
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }

  // 7) 答案目标提取与归一化（TS 镜像与 skills 规则一致）。
  {
    const truth = makeTruthPayload("QT-SMV-001", "v1") as unknown as Parameters<typeof staticAnswerTargets>[0];
    const targets = staticAnswerTargets(truth);
    assert.ok(targets.includes(normalizeForMatch("CE \\perp AB")));
    assert.ok(targets.includes(normalizeForMatch("AF \\cdot DE = AG \\cdot BC")));
    const resolved = resolveEvidenceFile("/root", "artifact://audio/TA-SMV-101@v1/r01.webm");
    assert.equal(resolved, path.join("/root", "audio", "TA-SMV-101", "v1", "r01.webm"));
  }

  // 8) golden 六题常量冻结（与 PRDS golden-slice-manifest 对齐）。
  assert.deepEqual(
    goldenSix,
    ["QT-SMV-001", "QT-SMV-002", "QT-SMV-003", "QT-SMV-004", "QT-SMV-005", "QT-SMV-006"],
  );

  console.log("PASS approachCases (8 scenarios)");
}

try {
  main();
} catch (error) {
  console.error("FAIL approachCases", error);
  throw error;
}

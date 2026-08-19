/**
 * P2-09：C-INT/C-TRU deterministic case 判定与 Run 记录合法性测试。
 * 与本仓测试约定一致：node 直跑 + node:assert/strict（无测试框架）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const {
  buildIntakeTruthRun,
  canonicalContentHash,
  normalizeAnswerLatex,
  runIntakeTruthCases,
  verifyPagePackIntegrity,
} = require("../intakeTruthCases") as typeof import("../intakeTruthCases");

interface EvidenceEntry {
  evidence_id: string;
  source_pack_id: string;
  artifact_uri: string;
  locator: { kind: string; page: number };
  notes?: string;
}

interface Item {
  source_key: string;
  source_evidence: EvidenceEntry[];
  question_candidate: {
    candidate_id: string;
    question_type: "choice" | "fill_blank" | "solution";
    stem: string;
    source_evidence_refs: Array<{ evidence_id: string; artifact_uri: string }>;
  };
}

function candidateItem(sourceKey: string, stem?: string): Item {
  const packId = sourceKey.includes("HUANGPU")
    ? "pack-B-huangpu-2025-yimo"
    : "pack-A-minhang-2020-yimo";
  return {
    source_key: sourceKey,
    source_evidence: [
      {
        evidence_id: "SE-SMV-001",
        source_pack_id: packId,
        artifact_uri: `artifact://page-image/${packId}@v1/word/pages/006.png`,
        locator: { kind: "page", page: 6 },
        notes: "role=question; run page 6",
      },
      {
        evidence_id: "SE-SMV-002",
        source_pack_id: packId,
        artifact_uri: `artifact://page-image/${packId}@v1/word-answer/pages/002.png`,
        locator: { kind: "page", page: 2 },
        notes: "role=official_solution; run page 9",
      },
    ],
    question_candidate: {
      candidate_id: "QC-SMV-001",
      question_type: "fill_blank",
      stem: stem ?? "如图，等腰三角形 ABC 中 AB=AC=4，BC=6，折叠后求 BE 的长。",
      source_evidence_refs: [
        { evidence_id: "SE-SMV-001", artifact_uri: "artifact://source-evidence/SE-SMV-001" },
        { evidence_id: "SE-SMV-002", artifact_uri: "artifact://source-evidence/SE-SMV-002" },
      ],
    },
  };
}

function packAExport(): { schema: string; paper_id: string; pack_id: string; items: Item[] } {
  return {
    schema: "ai_teaching_candidate_export/v1",
    paper_id: "2020-MINHANG-YIMO",
    pack_id: "pack-A-minhang-2020-yimo",
    items: [
      candidateItem("2020-MINHANG-YIMO-Q18"),
      candidateItem("2020-MINHANG-YIMO-Q23"),
      candidateItem(
        "2020-MINHANG-YIMO-Q25",
        "已知：如图，在 Rt△ABC 和 Rt△ACD 中……（1）求证：∠DAB=∠DCF；（2）当点 E 在边 CD 上时，求 y 关于 x 的函数关系式；（3）如果△CDG 是等腰三角形，试求 AD 的长.",
      ),
    ],
  };
}

function packBExport(): { schema: string; paper_id: string; pack_id: string; items: Item[] } {
  return {
    schema: "ai_teaching_candidate_export/v1",
    paper_id: "2025-HUANGPU-YIMO",
    pack_id: "pack-B-huangpu-2025-yimo",
    items: [22, 23, 25].map((number, index) => {
      const item = candidateItem(`2025-HUANGPU-YIMO-Q${number}`);
      // 黄浦卷：题目页 2..7、官方解答页 8..11。
      item.source_evidence[0].locator.page = 6 + (index % 2);
      item.source_evidence[1].locator.page = 8 + (index % 3);
      return item;
    }),
  };
}

function truthPayload(
  artifactId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schema: "ai_teaching_question_truth/v1",
    artifact_id: artifactId,
    version: "v1",
    status: "Approved",
    question_type: "fill_blank",
    stem: "等腰三角形折叠求 BE 的长（题干足够长）。",
    canonical_answer: { kind: "expression", value: "$1$" },
    reviewed_solution: "参考答案：1",
    source_evidence_refs: [
      { evidence_id: "SE-SMV-001", artifact_uri: "artifact://source-evidence/SE-SMV-001" },
    ],
    content_hash: "",
    artifact_uri: `artifact://question-truth/${artifactId}@v1`,
    ...overrides,
  };
  payload.content_hash = canonicalContentHash(payload);
  return payload;
}

function makeTruthRegistry(dir: string): string {
  const registryDir = path.join(dir, "question-truth");
  const entries: Array<[string, Record<string, unknown>]> = [
    ["QT-SMV-001", truthPayload("QT-SMV-001")],
    [
      "QT-SMV-003",
      truthPayload("QT-SMV-003", {
        stem:
          "已知：如图……（1）求证：∠DAB=∠DCF；（2）求 y 关于 x 的函数关系式，并写出 x 的取值范围；（3）试求 AD 的长.",
      }),
    ],
    [
      "QT-SMV-004",
      truthPayload("QT-SMV-004", {
        stem: "测高仪测量树高的实际应用题（题干足够长，含 A 字型相似结构）。",
      }),
    ],
    ["QT-SMV-005", truthPayload("QT-SMV-005")],
  ];
  for (const [artifactId, payload] of entries) {
    const itemDir = path.join(registryDir, artifactId);
    mkdirSync(itemDir, { recursive: true });
    writeFileSync(path.join(itemDir, "v1.json"), JSON.stringify(payload, null, 2));
    writeFileSync(
      path.join(itemDir, "registry.yaml"),
      `artifact_id: ${artifactId}\ncurrent_version: v1\nversions:\n- version: v1\n  status: Approved\n`,
    );
  }
  return registryDir;
}

function makeSourcePack(dir: string): string {
  const packDir = path.join(dir, "pack");
  mkdirSync(packDir, { recursive: true });
  const images: Array<{ file: string; sha256: string }> = [];
  for (const name of ["001.jpg", "002.png", "003.png"]) {
    const bytes = Buffer.from(`page-bytes-${name}`);
    writeFileSync(path.join(packDir, name), bytes);
    images.push({ file: name, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  writeFileSync(path.join(packDir, "manifest.json"), JSON.stringify({ images }));
  return packDir;
}

function makeInputs(dir: string) {
  return {
    candidates: [packAExport(), packBExport()],
    truthRegistryDir: makeTruthRegistry(dir),
    sourcePackDir: makeSourcePack(dir),
  };
}

function resultByCaseId(results: ReturnType<typeof runIntakeTruthCases>, caseId: string) {
  return results.find((entry) => entry.case_id === caseId);
}

async function main(): Promise<void> {
  // 1) 正形输入：8 case 全 pass。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const results = runIntakeTruthCases(makeInputs(dir));
      assert.equal(results.length, 8);
      assert.deepEqual(
        results.filter((entry) => entry.status === "fail"),
        [],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 2) C-INT-01：证据引用非 canonical（绝对路径）→ fail closed。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const inputs = makeInputs(dir);
      inputs.candidates[0].items[0].question_candidate.source_evidence_refs = [
        { evidence_id: "SE-X", artifact_uri: "/Users/who/local/path.json" },
      ];
      const caseResult = resultByCaseId(runIntakeTruthCases(inputs), "C-INT-01")!;
      assert.equal(caseResult.status, "fail");
      assert.equal(caseResult.failure_class, "candidate_structure_invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 3) C-INT-02：解答页锚点落到题目页 → fail closed。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const inputs = makeInputs(dir);
      const item = inputs.candidates[1].items[0];
      item.source_evidence[1].notes = "role=official_solution; run page 6";
      item.source_evidence[1].locator.page = 6;
      const caseResult = resultByCaseId(runIntakeTruthCases(inputs), "C-INT-02")!;
      assert.equal(caseResult.status, "fail");
      assert.equal(caseResult.failure_class, "evidence_invalid");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 4) C-INT-04：真包通过、篡改样本被拒。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const packDir = makeSourcePack(dir);
      assert.equal(verifyPagePackIntegrity(packDir).ok, true);
      const detected = verifyPagePackIntegrity(packDir, {
        images: [{ file: "001.jpg", sha256: "0".repeat(64) }],
      });
      assert.equal(detected.ok, false);
      assert.ok(detected.detail.includes("sha256 drift"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 5) C-TRU-01：答案与官方真值不一致 → math_answer_mismatch。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const inputs = makeInputs(dir);
      const itemDir = path.join(inputs.truthRegistryDir, "QT-SMV-001");
      const payload = JSON.parse(readFileSync(path.join(itemDir, "v1.json"), "utf8"));
      payload.canonical_answer.value = "$\\sqrt{3}$";
      writeFileSync(path.join(itemDir, "v1.json"), JSON.stringify(payload));
      const caseResult = resultByCaseId(runIntakeTruthCases(inputs), "C-TRU-01")!;
      assert.equal(caseResult.status, "fail");
      assert.equal(caseResult.failure_class, "math_answer_mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 6) C-TRU-04：注册表哈希自校验失败 → fail closed。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const inputs = makeInputs(dir);
      const itemDir = path.join(inputs.truthRegistryDir, "QT-SMV-005");
      const payload = JSON.parse(readFileSync(path.join(itemDir, "v1.json"), "utf8"));
      payload.stem = "tampered without hash update";
      writeFileSync(path.join(itemDir, "v1.json"), JSON.stringify(payload));
      const caseResult = resultByCaseId(runIntakeTruthCases(inputs), "C-TRU-04")!;
      assert.equal(caseResult.status, "fail");
      assert.equal(caseResult.failure_class, "content_hash_drift_undetected");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 7) Run 记录：completed + summary + 8 case 顺序。
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), "intake-truth-"));
    try {
      const result = buildIntakeTruthRun({
        runId: "BR-0003",
        sutId: "sut-a-claudecode-glm52-qwen",
        datasetId: "similarity-mvp-benchmark-v1",
        datasetVersion: "v1",
        inputs: makeInputs(dir),
      });
      assert.equal(result.ok, true);
      if (result.ok) {
        const record = result.record as {
          status: string;
          summary: Record<string, number>;
          case_results: Array<{ case_id: string }>;
        };
        assert.equal(record.status, "completed");
        assert.deepEqual(record.summary, {
          passed: 8,
          failed: 0,
          errored: 0,
          not_executed: 0,
        });
        assert.deepEqual(
          record.case_results.map((entry) => entry.case_id),
          [
            "C-INT-01",
            "C-INT-02",
            "C-INT-03",
            "C-INT-04",
            "C-TRU-01",
            "C-TRU-02",
            "C-TRU-03",
            "C-TRU-04",
          ],
        );
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // 8) 答案归一化：装饰性变体折叠，真值差异保留。
  assert.equal(normalizeAnswerLatex("$1$"), normalizeAnswerLatex("1"));
  assert.equal(normalizeAnswerLatex("\\text{1}"), "1");
  assert.notEqual(normalizeAnswerLatex("$1$"), normalizeAnswerLatex("$\\sqrt{3}$"));

  console.log("PASS intakeTruthCases (8 scenarios)");
}

void main().catch((error) => {
  console.error("FAIL intakeTruthCases", error);
  throw error;
});

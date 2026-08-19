/**
 * Phase 1 合同测试（TypeScript 侧）：
 * - 门禁 1：Zod 对全部 canonical fixture 的正反例校验（与 fixtures-manifest 对账）
 * - 门禁 2：adapter 无原地更新 API（公开导出白名单）
 * - 门禁 3：未批准对象 / 绝对本地路径无法通过 publication 校验
 * - 门禁 5：Assessment fixture 不含答案真值与 Tutor tool capability
 * - P1-03：artifact:// URI 语法与 resolver
 *
 * fixture 位于 web/shared/canonical/fixtures（PRD 仓 contracts/fixtures 的
 * vendored 副本，sha256 由 manifest 锁定）。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

interface ManifestEntry {
  file: string;
  object_schema: string;
  expect_schema: "valid" | "invalid";
  expect_publication: "valid" | "invalid" | "n/a";
  sha256: string;
}

interface Manifest {
  schema: string;
  fixtures: ManifestEntry[];
  assessment_scan: {
    assessment_files: string[];
    forbidden_keys: string[];
    empty_only_keys: string[];
    forbidden_answer_values: string[];
  };
}

const FIXTURES_DIR = path.resolve(process.cwd(), "../shared/canonical/fixtures");
const manifest: Manifest = JSON.parse(
  readFileSync(path.join(FIXTURES_DIR, "fixtures-manifest.json"), "utf8"),
) as Manifest;

const canonical = require("../../../../../shared/canonical") as typeof import("../../../../../shared/canonical");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, name), "utf8"));
}

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function walkStringsAndKeys(
  node: unknown,
  visit: (where: string, key: string | null, value: unknown) => void,
  prefix = "$",
  parentKey: string | null = null,
): void {
  visit(prefix, parentKey, node);
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkStringsAndKeys(item, visit, `${prefix}[${index}]`, null));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      walkStringsAndKeys(value, visit, `${prefix}.${key}`, key);
    }
  }
}

async function main(): Promise<void> {
  await runTest("manifest fixture list matches directory", () => {
    const files = new Set(readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")));
    files.delete("fixtures-manifest.json");
    const registered = new Set(manifest.fixtures.map((entry) => entry.file));
    assert.deepEqual([...files].sort(), [...registered].sort());
  });

  await runTest("vendored fixtures match manifest sha256", () => {
    for (const entry of manifest.fixtures) {
      const digest = createHash("sha256")
        .update(readFileSync(path.join(FIXTURES_DIR, entry.file)))
        .digest("hex");
      assert.equal(digest, entry.sha256.slice("sha256:".length), `sha256 drift: ${entry.file}`);
    }
  });

  await runTest("every schema has positive and negative fixtures", () => {
    const bySchema = new Map<string, Set<string>>();
    for (const entry of manifest.fixtures) {
      const set = bySchema.get(entry.object_schema) ?? new Set<string>();
      set.add(entry.expect_schema);
      bySchema.set(entry.object_schema, set);
    }
    // 与 Zod 分派表一一对应（新 schema 常量即新正反例义务，ADR-005 起 13）。
    assert.equal(bySchema.size, 13);
    for (const [schemaConst, outcomes] of bySchema) {
      assert.ok(outcomes.has("valid"), `${schemaConst}: no positive fixture`);
      assert.ok(outcomes.has("invalid"), `${schemaConst}: no negative fixture`);
    }
  });

  await runTest("zod validates all fixtures per manifest (gate 1)", () => {
    const mismatches: unknown[] = [];
    for (const entry of manifest.fixtures) {
      const payload = loadFixture(entry.file);
      const { ok, errors } = canonical.validatePayload(payload);
      const expected = entry.expect_schema === "valid";
      assert.equal(typeof ok, "boolean");
      if (ok !== expected) {
        mismatches.push({ file: entry.file, ok, expected, errors: errors.slice(0, 2) });
      }
    }
    assert.deepEqual(mismatches, []);
  });

  await runTest("invalid fixtures yield nonempty error strings", () => {
    for (const entry of manifest.fixtures) {
      if (entry.expect_schema !== "invalid") continue;
      const { ok, errors } = canonical.validatePayload(loadFixture(entry.file));
      assert.equal(ok, false, entry.file);
      assert.ok(errors.length > 0, entry.file);
      for (const message of errors) {
        assert.equal(typeof message, "string");
        assert.ok(message.length > 0, entry.file);
      }
    }
  });

  await runTest("validatePayload does not mutate its input", () => {
    const payload = { schema: "ai_teaching_question_truth/v1", status: "Draft" };
    const snapshot = JSON.parse(JSON.stringify(payload));
    canonical.validatePayload(payload);
    assert.deepEqual(payload, snapshot);
  });

  await runTest("assessment fixtures contain no answer truth or tutor tools (gate 5)", () => {
    const rules = manifest.assessment_scan;
    assert.ok(rules.assessment_files.length > 0);
    for (const name of rules.assessment_files) {
      const payload = loadFixture(name);
      walkStringsAndKeys(payload, (where, key, value) => {
        if (key !== null && rules.forbidden_keys.includes(key)) {
          assert.fail(`${name}: 答案真值字段泄漏 ${where}`);
        }
        if (key !== null && rules.empty_only_keys.includes(key)) {
          assert.deepEqual(value, [], `${name}: ${where} 必须为空（Assessment 禁止 Tutor tools）`);
        }
        if (typeof value === "string") {
          for (const forbidden of rules.forbidden_answer_values) {
            assert.ok(!value.includes(forbidden), `${name}: 字符串含答案真值 ${forbidden}`);
          }
        }
      });
    }
  });

  await runTest("publishable fixtures pass publication validation (gate 3)", () => {
    for (const entry of manifest.fixtures) {
      if (entry.expect_publication !== "valid") continue;
      const issues = canonical.validateForPublication(loadFixture(entry.file));
      assert.deepEqual(issues, [], entry.file);
    }
  });

  await runTest("unapproved and absolute-path objects fail publication (gate 3)", () => {
    const draft = canonical.validateForPublication(loadFixture("question-truth.pubfail.draft-status.json"));
    assert.ok(draft.some((issue) => issue.code === "not_approved"), JSON.stringify(draft));
    for (const name of [
      "question-truth.pubfail.absolute-path.json",
      "teaching-approach.pubfail.absolute-path.json",
    ]) {
      const issues = canonical.validateForPublication(loadFixture(name));
      assert.ok(issues.some((issue) => issue.code === "absolute_local_path"), name);
    }
  });

  await runTest("every non-Approved status is rejected for publication", () => {
    const truth = loadFixture("question-truth.positive.json") as Record<string, unknown>;
    for (const status of ["Draft", "InReview", "Stale", "Disabled", "Superseded"]) {
      const issues = canonical.validateForPublication({ ...truth, status });
      assert.ok(issues.some((issue) => issue.code === "not_approved"), status);
    }
  });

  await runTest("file:// and windows paths are rejected", () => {
    const truth = JSON.parse(JSON.stringify(loadFixture("question-truth.positive.json")));
    for (const bad of [
      "file:///Users/gaochong/audio.wav",
      "C:\\Users\\gaochong\\audio.wav",
      "录音见 /var/tmp/rec.wav",
    ]) {
      truth.approval.review_note = `备注 ${bad}`;
      const issues = canonical.validateForPublication(truth);
      assert.ok(issues.some((issue) => issue.code === "absolute_local_path"), bad);
    }
  });

  await runTest("non-publishable types fail publication outright", () => {
    for (const name of ["tutor-session-event.positive.json", "skill-hypothesis.positive.json"]) {
      const issues = canonical.validateForPublication(loadFixture(name));
      assert.equal(issues[0].code, "not_publishable_type", name);
    }
    assert.equal(canonical.validateForPublication(null)[0].code, "not_a_canonical_object");
    assert.equal(canonical.validateForPublication({})[0].code, "not_publishable_type");
  });

  await runTest("canonical module exports no in-place update API (gate 2)", () => {
    const allowed = new Set([
      "sourceEvidenceSchema",
      "questionCandidateSchema",
      "questionTruthSchema",
      "questionTruthV2Schema",
      "teachingApproachSchema",
      "teachingApproachV2Schema",
      "approachSetSchema",
      "tutorPlanBundleSchema",
      "tutorSessionEventSchema",
      "tutorSessionEventTypeEnum",
      "skillHypothesisSchema",
      "interventionSchema",
      "sutConfigSchema",
      "benchmarkRunSchema",
      "KNOWN_ARTIFACT_NAMESPACES",
      "ArtifactUriError",
      "parseArtifactUri",
      "LocalArtifactResolver",
      "resolverFromEnv",
      "PUBLISHABLE_SCHEMAS",
      "validateForPublication",
      "validatePayload",
    ]);
    const exported = Object.keys(require("../../../../../shared/canonical/index") as object);
    for (const name of exported) {
      assert.ok(allowed.has(name), `未登记的公开导出: ${name}（新增需先改白名单并评审）`);
    }
    for (const name of exported) {
      assert.ok(
        !/(^|_)(update|patch|mutate|overwrite|replace|edit|delete|remove|save|write|set)/i.test(name),
        `${name} 疑似原地更新 API（ADR-004 §3）`,
      );
    }
    for (const name of allowed) {
      assert.ok(exported.includes(name), `白名单导出缺失: ${name}`);
    }
  });

  await runTest("artifact URI parsing and resolver (P1-03)", () => {
    const uri = canonical.parseArtifactUri(
      "artifact://page-image/pack-A-minhang-2020-yimo@v1/pages/page-004.png",
    );
    assert.equal(uri.namespace, "page-image");
    assert.equal(uri.artifactId, "pack-A-minhang-2020-yimo");
    assert.equal(uri.version, "v1");
    assert.deepEqual([...uri.path], ["pages", "page-004.png"]);

    const versionless = canonical.parseArtifactUri("artifact://source-evidence/SE-SMV-001");
    assert.equal(versionless.version, null);

    for (const bad of [
      "/Users/gaochong/develop/some/file.png",
      "file:///Users/gaochong/x.png",
      "artifact://Unknown-Ns/id@v1",
      "artifact://question-truth/",
      "artifact://question-truth/QT-SMV-001@v2/../../escape",
      "http://example.com/x",
      "",
    ]) {
      assert.throws(() => canonical.parseArtifactUri(bad as string), canonical.ArtifactUriError, bad);
    }

    const resolver = new canonical.LocalArtifactResolver({
      "question-truth": path.resolve(process.cwd(), "fixtures-do-not-exist-root"),
    });
    const resolved = resolver.resolve("artifact://question-truth/QT-SMV-001@v1/truth.json");
    assert.ok(path.isAbsolute(resolved));
    assert.ok(
      resolved.includes(path.join("QT-SMV-001", "v1", "truth.json")),
      "version 段必须进入本地布局",
    );

    assert.throws(
      () => new canonical.LocalArtifactResolver({ "no-such-namespace": "/tmp" }),
      canonical.ArtifactUriError,
    );
    assert.throws(
      () => new canonical.LocalArtifactResolver({}).resolve("artifact://tutor-plan/TP-SMV-001@v1"),
      /no local root/,
    );
    const envResolver = canonical.resolverFromEnv({
      AI_TEACHING_ARTIFACT_ROOTS: "tutor-plan=/tmp/tp;audio=/tmp/audio",
    });
    assert.equal(
      envResolver.resolve("artifact://tutor-plan/TP-SMV-001@v1"),
      path.resolve("/tmp/tp", "TP-SMV-001", "v1"),
    );
    assert.equal(
      envResolver.resolve("artifact://audio/TA-SMV-001@v1/x.wav"),
      path.resolve("/tmp/audio", "TA-SMV-001", "v1", "x.wav"),
    );
    assert.throws(
      () => envResolver.resolve("artifact://tutor-plan-missing/x@v1"),
      /unregistered artifact namespace/,
    );
    assert.throws(
      () => canonical.resolverFromEnv({ AI_TEACHING_ARTIFACT_ROOTS: "bad-entry-no-eq" }),
      /bad AI_TEACHING_ARTIFACT_ROOTS/,
    );
  });
}

void main().catch((error) => {
  console.error("FAIL canonicalContracts", error);
  throw error;
});

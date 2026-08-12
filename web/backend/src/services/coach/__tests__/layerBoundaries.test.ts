import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Boundary proof (ADR-005 §Architectural Invariants #7, #8): the transport,
 * ports and application layers of the coach must NOT import any concrete
 * provider client, model or SDK. Provider names (CosyVoice, DashScope, Claude,
 * Qwen, Anthropic, OpenAI) may appear only in adapters, the composition root
 * and telemetry. This test mirrors the repo gate grep so the invariant is
 * enforced in the test suite, not just in review.
 */

const FORBIDDEN_IMPORT = /import\b.*(?:cosyvoice|dashscope|claude|qwen|anthropic|openai)/i;
const SRC_ROOT = path.resolve(process.cwd(), "src");
const SCANNED_DIRS = [
  path.join(SRC_ROOT, "transport"),
  path.join(SRC_ROOT, "services", "coach", "ports"),
  path.join(SRC_ROOT, "services", "coach", "application"),
];

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function main(): void {
  const violations: string[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const file of listTsFiles(dir)) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (FORBIDDEN_IMPORT.test(line)) violations.push(`${path.relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(violations, [], "transport/ports/application must not import any provider client");
  console.log("PASS layer boundaries: transport, ports and application import no provider client");
}

main();

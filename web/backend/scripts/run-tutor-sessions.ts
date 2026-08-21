/**
 * Phase 5 退出门禁 1/2 CLI：12 条验收剧本 × 6 道 golden question 实跑
 * （真实 canonical Approved TutorPlan v2），并做 event replay 对账。
 *
 * 用法（在 web/backend 下）：
 *   tsx scripts/run-tutor-sessions.ts \
 *     --canonical-root /abs/teaching-skills-mvp/artifacts/canonical-authoring \
 *     --out data/tutor-sessions/golden-report.json \
 *     [--sqlite data/tutor-sessions-golden.sqlite]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

// db 依赖链会经 topicPlanProjector 提前加载 database——SQLITE_PATH 必须先落。
function parseArgs(argv: string[]): Record<string, string[]> {
  const args: Record<string, string[]> = {};
  let current: string | null = null;
  for (const token of argv) {
    if (token.startsWith("--")) {
      current = token.slice(2);
      args[current] = args[current] ?? [];
    } else if (current) {
      args[current].push(token);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const canonicalRootArg = (args["canonical-root"] ?? [])[0];
if (!canonicalRootArg) {
  console.error("--canonical-root is required");
  process.exit(2);
}
const canonicalRoot = path.resolve(canonicalRootArg);
const out = path.resolve((args["out"] ?? ["data/tutor-sessions/golden-report.json"])[0]);
const sqlitePath = path.resolve((args["sqlite"] ?? ["data/tutor-sessions-golden.sqlite"])[0]);
for (const suffix of ["", "-wal", "-shm"]) {
  try {
    rmSync(`${sqlitePath}${suffix}`, { force: true });
  } catch {
    /* 不存在即跳过 */
  }
}
process.env.SQLITE_PATH = sqlitePath;

const { createTutorSessionCoordinator } = require("../src/services/tutorSession/TutorSession") as typeof import("../src/services/tutorSession/TutorSession");
const { ACCEPTANCE_SCRIPT_IDS, runAcceptanceScript } = require("../src/services/tutorSession/acceptanceScripts") as typeof import("../src/services/tutorSession/acceptanceScripts");
const { loadCurrentPlan } = require("../src/services/planBuild/canonicalInputs") as typeof import("../src/services/planBuild/canonicalInputs");
const { projectRuntimeState } = require("../src/services/tutorSession/TutorRuntimeStateProjection") as typeof import("../src/services/tutorSession/TutorRuntimeStateProjection");
const { db, close } = require("../src/db/database") as typeof import("../src/db/database") & { close: () => void };

const GOLDEN_TP_IDS = ["TP-SMV-001", "TP-SMV-002", "TP-SMV-003", "TP-SMV-004", "TP-SMV-005", "TP-SMV-006"];

interface SessionAudit {
  session_id: string;
  script_id: string;
  plan_id: string;
  events: number;
  decisions: number;
  replay_deterministic: boolean;
  decision_causality_ok: boolean;
  issued_linked_to_decision: boolean;
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const coordinator = createTutorSessionCoordinator({ canonicalRoot });
  const createdSessions: Array<{ sessionId: string; scriptId: string; planId: string }> = [];
  let sessionCounter = 7000;
  const harness = {
    coordinator,
    canonicalRoot,
    nextSessionId: () => {
      const sessionId = `TS-${(sessionCounter += 1)}`;
      return sessionId;
    },
    makeCoordinatorWithPolicy: (policy: unknown) =>
      createTutorSessionCoordinator({ canonicalRoot, policy: policy as never, policyTimeoutMs: 50 }),
  };
  // 追踪会话创建（audit 用）：包一层 start。
  const originalStart = coordinator.start.bind(coordinator);
  let currentScriptTag = { scriptId: "?", planId: "?" };
  (coordinator as unknown as { start: typeof coordinator.start }).start = (options => {
    const result = originalStart(options);
    createdSessions.push({
      sessionId: options.sessionId,
      scriptId: currentScriptTag.scriptId,
      planId: options.tpId,
    });
    return result;
  }) as typeof coordinator.start;

  const outcomes = [];
  for (const tpId of GOLDEN_TP_IDS) {
    const planResult = loadCurrentPlan({ canonicalRoot }, tpId);
    if (!planResult.ok) {
      outcomes.push({
        script_id: "(load)",
        plan_id: tpId,
        status: "fail",
        failures: planResult.errors,
        session_ids: [],
      });
      continue;
    }
    const plan = planResult.payload;
    for (const scriptId of ACCEPTANCE_SCRIPT_IDS) {
      currentScriptTag = { scriptId, planId: tpId };
      outcomes.push(await runAcceptanceScript(scriptId, harness, plan));
    }
  }

  // gate 2 replay 对账：每个会话两次投影一致 + 决策因果 + issued 关联
  const audits: SessionAudit[] = [];
  const planCache = new Map<string, unknown>();
  for (const { sessionId, scriptId, planId } of createdSessions) {
    if (!planCache.has(planId)) {
      const result = loadCurrentPlan({ canonicalRoot }, planId);
      planCache.set(planId, result.ok ? result.payload : null);
    }
    const plan = planCache.get(planId) as never;
    const events = coordinator.getEvents(sessionId);
    const first = projectRuntimeState(plan, events);
    const second = projectRuntimeState(plan, events);
    const decisions = events.filter((event) => event.event_type === "tutor_move_decided");
    const causalityOk = decisions.every((decision) => {
      const payload = decision.payload as { source_event_sequence: number; source_state_revision: number };
      return events.some((event) => event.sequence === payload.source_event_sequence) && payload.source_state_revision >= 0;
    });
    // 被拒（S9 注入演练）的 workspace 动作不参与呈现因果合同——它们从未执行。
    const rejectedActions = new Set(
      events
        .filter(
          (event) =>
            event.event_type === "workspace_action_completed" && (event.payload as { outcome: string }).outcome === "rejected",
        )
        .map((event) => (event.payload as { action_id: string }).action_id),
    );
    const issuedOk = events
      .filter(
        (event) =>
          event.event_type === "voice_action_issued" ||
          (event.event_type === "workspace_action_issued" &&
            !rejectedActions.has((event.payload as { action_id: string }).action_id)),
      )
      .every((event) => {
        const decisionId = (event.payload as { decision_id: string }).decision_id;
        return decisions.some((decision) => (decision.payload as { decision_id: string }).decision_id === decisionId);
      });
    audits.push({
      session_id: sessionId,
      script_id: scriptId,
      plan_id: planId,
      events: events.length,
      decisions: decisions.length,
      replay_deterministic: JSON.stringify(first) === JSON.stringify(second),
      decision_causality_ok: causalityOk,
      issued_linked_to_decision: issuedOk,
    });
  }

  const scriptFailures = outcomes.filter((outcome) => outcome.status === "fail");
  const auditFailures = audits.filter(
    (audit) => !audit.replay_deterministic || !audit.decision_causality_ok || !audit.issued_linked_to_decision,
  );
  const report = {
    schema: "ai_teaching_tutor_sessions_report/v1",
    run: "phase5-golden-tutor-sessions",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    canonical_root: canonicalRoot,
    scripts: ACCEPTANCE_SCRIPT_IDS,
    plans: GOLDEN_TP_IDS,
    totals: {
      script_runs: outcomes.length,
      script_passes: outcomes.filter((outcome) => outcome.status === "pass").length,
      script_skipped: outcomes.filter((outcome) => outcome.status === "skipped").length,
      script_failures: scriptFailures.length,
      sessions: audits.length,
      events: audits.reduce((sum, audit) => sum + audit.events, 0),
      decisions: audits.reduce((sum, audit) => sum + audit.decisions, 0),
      audit_failures: auditFailures.length,
    },
    outcomes,
    session_audits: audits,
  };
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  for (const outcome of outcomes) {
    console.log(
      `${outcome.status.toUpperCase()} ${outcome.plan_id} ${outcome.script_id}${outcome.detail ? `: ${outcome.detail}` : ""}`,
    );
    for (const failure of outcome.failures) console.error(`  ↳ ${failure}`);
  }
  console.log(
    `totals: ${report.totals.script_passes}/${report.totals.script_runs} script runs, ` +
      `${report.totals.sessions} sessions, ${report.totals.events} events, ` +
      `${report.totals.decisions} decisions, replay/audit failures=${report.totals.audit_failures}`,
  );
  console.log(`report → ${out}`);
  (close ?? db.close).call(db);
  return scriptFailures.length + auditFailures.length > 0 ? 1 : 0;
}

void main().then((code) => process.exit(code));

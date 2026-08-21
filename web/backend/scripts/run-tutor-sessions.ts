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
// F-4 CI 口径：--provider deepseek-langgraph --fake-model 时，剧本的学生输入
// 轮透明改走 processTurn（智能链全链路），系统触发轮仍走 driveTutorTurn。
const providerArg = (args["provider"] ?? ["deterministic"])[0] as "deterministic" | "deepseek-langgraph";
// --fake-model 是无值开关：parseArgs 里呈现为空数组（key 存在）。
const fakeModel = args["fake-model"] !== undefined || process.env.TUTOR_FAKE_STRUCTURED_MODEL === "1";
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

const { createTutorSessionCoordinator, createDefaultTutorSessionCoordinator } = require("../src/services/tutorSession/TutorSession") as typeof import("../src/services/tutorSession/TutorSession");
const { FakeStructuredModel } = require("../src/services/tutorIntelligence/adapters/fake/FakeStructuredModel") as typeof import("../src/services/tutorIntelligence/adapters/fake/FakeStructuredModel");
const { tutorSessionRevision } = require("../src/services/tutorSession/TutorSessionEventStore") as typeof import("../src/services/tutorSession/TutorSessionEventStore");

/** 学生输入轮 → processTurn 的透明合并（仅 fake-model 剧本运行使用）。 */
function wrapIntelligentScripts(base: ReturnType<typeof createTutorSessionCoordinator>): ReturnType<typeof createTutorSessionCoordinator> {
  // 队列语义：S2 连续两条输入（interrupted + question）都必须成为事实——
  // 逐条 processTurn 落库，决策取最后一条（与 node 剧本的单一 turn 断言对齐）。
  const pending = new Map<string, Array<{ input_kind: string; text?: string; object_id?: string; duration_ms?: number }>>();
  let turnSeq = 0;
  return {
    ...base,
    recordStudentInput: (sid: string, input: Parameters<ReturnType<typeof createTutorSessionCoordinator>["recordStudentInput"]>[1]) => {
      // student_interrupted 立即处理（S2 在两条输入之间读事件流断言 interrupted
      // 完成——延迟到 turn() 才落库会丢事实）；其余输入延迟合并进 processTurn。
      if (input.input_kind === "student_interrupted") {
        void base
          .processTurn(sid, tutorSessionRevision(sid), `script-turn-${(turnSeq += 1)}`, input)
          .catch(() => undefined);
        return { input_sequence: 0, appendedSequences: [], alignment: undefined, progressed: false, self_corrected: false };
      }
      const queue = pending.get(sid) ?? [];
      queue.push(input);
      pending.set(sid, queue);
      return { input_sequence: 0, appendedSequences: [], alignment: undefined, progressed: false, self_corrected: false };
    },
    driveTutorTurn: async (sid: string, explicit?: Parameters<ReturnType<typeof createTutorSessionCoordinator>["driveTutorTurn"]>[1]) => {
      const queue = pending.get(sid);
      if (queue?.length && !explicit) {
        pending.delete(sid);
        let response: Awaited<ReturnType<ReturnType<typeof createTutorSessionCoordinator>["processTurn"]>> | undefined;
        for (const deferred of queue) {
          turnSeq += 1;
          response = await base.processTurn(sid, tutorSessionRevision(sid), `script-turn-${turnSeq}`, deferred);
        }
        const last = response!;
        return {
          decision: last.decision
            ? ({
                ...last.decision,
                source_event_sequence: 1,
                source_state_revision: last.revision,
              } as never)
            : null,
          presentation: {
            voice: last.voice.map((voice) => ({
              action_id: voice.action_id,
              decision_id: last.decision?.decision_id ?? "",
              text: voice.text,
              interruptible: voice.interruptible,
            })),
            workspace: last.workspace as never,
          },
          appendedSequences: [],
        };
      }
      return base.driveTutorTurn(sid, explicit);
    },
  } as ReturnType<typeof createTutorSessionCoordinator>;
}
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
  /** 修复（Phase 5 remediation）三方对账：DB 直读投影 / 增量投影 /
   *  独立预期状态（简化 reducer，不依赖 projection 代码）。 */
  db_restore_projection_ok: boolean;
  incremental_projection_ok: boolean;
  independent_state_ok: boolean;
}

async function main(): Promise<number> {
  const startedAt = new Date().toISOString();
  const useIntelligentScripts = providerArg === "deepseek-langgraph";
  const baseCoordinator = useIntelligentScripts
    ? createDefaultTutorSessionCoordinator({
        canonicalRoot,
        provider: "deepseek-langgraph",
        ...(fakeModel ? { structuredModel: new FakeStructuredModel() } : {}),
      }).coordinator
    : createTutorSessionCoordinator({ canonicalRoot });
  const coordinator = useIntelligentScripts ? wrapIntelligentScripts(baseCoordinator) : baseCoordinator;
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

    // ---- 三方对账（修复：不再用同流二次投影冒充 replay 校验）----
    // A) DB 直读：绕过 coordinator 读取路径，从 sqlite 原始行重建事件再投影。
    const rawRows = (
      db.prepare(
        "SELECT session_id, sequence, event_type, payload_json, occurred_at, idempotency_key, recorded_revision, causation_sequence FROM tutor_session_events WHERE session_id = ? ORDER BY sequence ASC",
      ).all(sessionId) as Array<{
        session_id: string;
        sequence: number;
        event_type: string;
        payload_json: string;
        occurred_at: string;
        idempotency_key: string;
        recorded_revision: number;
        causation_sequence: number | null;
      }>
    ).map(
      (row) =>
        ({
          schema: "ai_teaching_tutor_session_event/v2",
          session_id: row.session_id,
          sequence: row.sequence,
          state_revision: row.recorded_revision,
          occurred_at: row.occurred_at,
          event_type: row.event_type,
          payload: JSON.parse(row.payload_json),
          ...(row.causation_sequence !== null ? { causation_sequence: row.causation_sequence } : {}),
          idempotency_key: row.idempotency_key,
        }) as never,
    );
    const dbRestoreProjectionOk =
      JSON.stringify(projectRuntimeState(plan, rawRows)) === JSON.stringify(first);

    // B) 增量投影：index 前缀与 revision 前缀必须等价（事件序 ↔ store 盖章的
    //    revision 单调一致；任一 prefix 的投影 revision 回读不跳变）。
    const revisions = [...new Set(events.map((event) => event.state_revision))].sort((a, b) => a - b);
    let incrementalOk = true;
    for (const revision of revisions) {
      const byRevision = projectRuntimeState(
        plan,
        events.filter((event) => event.state_revision <= revision),
      );
      const upToIndex = events.findIndex((event) => event.state_revision > revision);
      const byIndex = projectRuntimeState(plan, upToIndex === -1 ? events : events.slice(0, upToIndex));
      if (JSON.stringify(byRevision) !== JSON.stringify(byIndex)) incrementalOk = false;
      if (byRevision.revision !== revision) incrementalOk = false;
    }

    // C) 独立预期状态：简化 reducer（独立于 TutorRuntimeStateProjection 实现）。
    const expectedCompleted = new Set<string>();
    let expectedMode: string | undefined;
    const expectedHintLevels = new Map<string, Set<number>>();
    let expectedInterruptedVoice = 0;
    const issuedVoiceActions = new Set<string>();
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>;
      switch (event.event_type) {
        case "session_started":
          expectedMode = String(payload.initial_mode);
          break;
        case "mode_changed":
          expectedMode = String(payload.to_mode);
          break;
        case "student_progressed":
          expectedCompleted.add(String(payload.checkpoint_id));
          break;
        case "hint_issued":
          const hintKey = String(payload.checkpoint_id);
          (expectedHintLevels.get(hintKey) ?? expectedHintLevels.set(hintKey, new Set()).get(hintKey)!).add(Number(payload.level));
          break;
        case "voice_action_issued":
          issuedVoiceActions.add(String(payload.action_id));
          break;
        case "voice_action_completed":
          if (payload.outcome === "interrupted") expectedInterruptedVoice += 1;
          break;
        default:
          break;
      }
    }
    const projectionCompleted = new Set(
      (first as { curriculum: { parts: Array<{ completed_checkpoints: string[] }> } }).curriculum.parts.flatMap(
        (part) => part.completed_checkpoints,
      ),
    );
    const projectionHintLevels = new Map<string, Set<number>>();
    for (const [checkpointId, ledger] of Object.entries(
      (first as { assistance: Record<string, { hintLevelsIssued: number[] }> }).assistance,
    )) {
      projectionHintLevels.set(checkpointId, new Set(ledger.hintLevelsIssued));
    }
    const independentStateOk =
      expectedMode === (first as { mode: string }).mode &&
      [...expectedCompleted].every((checkpointId) => projectionCompleted.has(checkpointId)) &&
      projectionCompleted.size === expectedCompleted.size &&
      [...expectedHintLevels.entries()].every(
        ([checkpointId, levels]) =>
          projectionHintLevels.get(checkpointId)?.size === levels.size &&
          [...levels].every((level) => projectionHintLevels.get(checkpointId)?.has(level)),
      ) &&
      expectedInterruptedVoice === (first as { reasoning: { interruptions: unknown[] } }).reasoning.interruptions.length;
    const decisions = events.filter((event) => event.event_type === "tutor_move_decided");
    const causalityOk = decisions.every((decision) => {
      const payload = decision.payload as { source_event_sequence: number; source_state_revision: number };
      return events.some((event) => event.sequence === payload.source_event_sequence) && payload.source_state_revision >= 0;
    });
    // 裁定 §6（2026-08-21）：workspace issued 只可能是已验证动作（S9 非法注入
    // 不再签发，拒绝事实记 runtime_failure），全部参与呈现因果合同。
    const issuedOk = events
      .filter(
        (event) => event.event_type === "voice_action_issued" || event.event_type === "workspace_action_issued",
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
      replay_deterministic: dbRestoreProjectionOk,
      decision_causality_ok: causalityOk,
      issued_linked_to_decision: issuedOk,
      db_restore_projection_ok: dbRestoreProjectionOk,
      incremental_projection_ok: incrementalOk,
      independent_state_ok: independentStateOk,
    });
  }

  const scriptFailures = outcomes.filter((outcome) => outcome.status === "fail");
  const auditFailures = audits.filter(
    (audit) =>
      !audit.replay_deterministic ||
      !audit.decision_causality_ok ||
      !audit.issued_linked_to_decision ||
      !audit.db_restore_projection_ok ||
      !audit.incremental_projection_ok ||
      !audit.independent_state_ok,
  );
  const report = {
    schema: "ai_teaching_tutor_sessions_report/v1",
    run: "phase5-golden-tutor-sessions",
    provider: providerArg + (fakeModel ? "+fake-model" : ""),
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

/**
 * Paid real-model QA, manual only; deliberately not in npm test / default CI.
 * Reuses r3-claude-gate-evidence.ts's context -> provider -> validated evidence pattern,
 * but calls the production DeepSeekStructuredModel + StructuredModelGateProvider.
 * No mocks, fixed responses, student records, candidate approval, or asset writes.
 *
 * FOLLOW_ALONG_REAL_GATE_EVIDENCE=1 node --import tsx scripts/follow-along-real-gate-evidence.ts --out /absolute/run.json
 * Optional --case F01. The output filename must not exist; each run is immutable evidence.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { NavigatorBeatView, NavigatorPlanV5 } from "../src/services/tutorNavigator/NavigatorPlanV5";
import type { StoredV5Event } from "../src/services/tutorSession/TutorSessionEventV5";
import type { StructuredModelPort, StructuredCompletionRequest, StructuredCompletionResult } from "../src/services/tutorIntelligence/structuredModelPort";

async function main(): Promise<void> {
  if (process.env.FOLLOW_ALONG_REAL_GATE_EVIDENCE !== "1") {
    console.log("Disabled: explicit FOLLOW_ALONG_REAL_GATE_EVIDENCE=1 required; real API calls are billable.");
    return;
  }
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const out = arg("--out");
  if (!out || !out.startsWith("/") || existsSync(out)) throw new Error("--out must be a new absolute output file");
  mkdirSync(dirname(out), { recursive: true });
  process.env.SQLITE_PATH ??= resolve(tmpdir(), `follow-along-real-gate-${process.pid}.sqlite`);
  const { DeepSeekStructuredModel } = await import("../src/services/tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel");
  const { StructuredModelGateProvider } = await import("../src/services/tutorOrchestration/StructuredModelGateProvider");
  const { ModelGateAdjudicatorV5, buildGateAdjudicationContext, GATE_ADJUDICATION_SYSTEM_PROMPT, MODEL_GATE_ADJUDICATOR_VERSION } = await import("../src/services/tutorNavigator/ModelGateAdjudicatorV5");
  const { hypothesisFromAdjudication, hypothesisEventPayload } = await import("../src/services/tutorNavigator/SemanticInterpreterV5");
  const config_presence = Object.fromEntries(["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "TUTOR_DEEPSEEK_MODEL"].map((name) => [name, process.env[name]?.trim() ? "present" : "missing"]));
  const secret = process.env.DEEPSEEK_API_KEY?.trim();
  const sanitize = (value: unknown): unknown => {
    const encoded = JSON.stringify(value);
    return JSON.parse(secret ? encoded.split(secret).join("[REDACTED]") : encoded);
  };
  const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const sources = ["scripts/follow-along-real-gate-evidence.ts", "src/services/tutorNavigator/ModelGateAdjudicatorV5.ts", "src/services/tutorNavigator/SemanticInterpreterV5.ts", "src/services/tutorOrchestration/StructuredModelGateProvider.ts", "src/services/tutorIntelligence/adapters/deepseek/DeepSeekStructuredModel.ts"];
  const source_sha256 = Object.fromEntries(sources.map((p) => [p, sha(readFileSync(resolve(p)))]));
  const fixture = JSON.parse(readFileSync(resolve("../shared/canonical/fixtures/teaching-protocol.v3.positive.mainline-follow-along.json"), "utf8"));
  const beat: NavigatorBeatView = {
    ...fixture.beats[0], protocol_id: "PR-QA-001", beat_id: "BT-01", role: "reasoning",
    purpose: "跟上解方程时保持等式平衡的解释，而不是独立解题验收。", graph_fact_refs: ["FN-01", "FN-02"], inference_refs: [], resource_ids: [],
    completion_evidence: { evidence_kind: "student_confirmation", confirmation_target: "follow_along", gate: { gate_id: "GT-01", requirement: "学生确认跟上等式两边同时减3、再同时除以2的讲解；接受明确理解自述或正确说明自己的理解。", graph_fact_id: "FN-01" } }, participation: "confirm",
  };
  const practice: NavigatorBeatView = { ...beat, role: "practice", purpose: "独立解方程并给出正确结果和过程。", participation: "answer", completion_evidence: { evidence_kind: "student_answer", gate: { gate_id: "GT-01", requirement: "独立解出 2x+3=7，给出 x=2 并说明等式变形。", graph_fact_id: "FN-02" } } };
  const plan = {
    question: { artifact_id: "QT-QA-001", question_type: "solution", stem: "解方程 2x+3=7，说明等式变形过程。" },
    facts: new Map([["FN-01", { fact_id: "FN-01", statement: "等式两边同时减3，得到 2x=4；只改一边不保持等式平衡。" }], ["FN-02", { fact_id: "FN-02", statement: "2x=4 的两边同时除以2，得到 x=2。" }]]),
    graph_inferences: new Map(), solution_variants: [],
  } as unknown as NavigatorPlanV5;
  const ev = (sequence: number, event_type: string, payload: Record<string, unknown>): StoredV5Event => ({ schema: "ai_teaching_tutor_session_event/v5", session_id: "TS-1000", sequence, state_revision: sequence, occurred_at: "2026-09-07T15:00:00Z", event_type, payload, idempotency_key: `qa-${sequence}` }) as StoredV5Event;
  const presentation = (sequence: number, id: string, text: string, presented = true, scope = { kind: "approved", protocol_id: beat.protocol_id, beat_id: beat.beat_id }): StoredV5Event[] => [
    ev(sequence, "presentation_sequence_planned", { sequence_id: id, scope, actions: [{ ordinal: 0, kind: "voice", voice_action: { action_id: `VA-${id}`, decision_id: `TD-${id}`, text, intent: "question" } }] }),
    ev(sequence + 1, "presentation_action_delivered", { sequence_id: id, ordinal: 0, action_id: `VA-${id}`, kind: "voice" }),
    ...(presented ? [ev(sequence + 2, "presentation_action_outcome_recorded", { sequence_id: id, ordinal: 0, action_id: `VA-${id}`, kind: "voice", outcome: "presented" })] : []),
  ];
  const baseline = presentation(1, "PS-QA-1", "我们解 2x+3=7。为了保持等式平衡，两边同时减3，得到2x=4；再两边同时除以2，得到x=2。这两步为什么两边要做同样的变化，现在跟上了吗？");
  const contradiction = [
    ev(4, "student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "我理解的是只要左边减3，右边不用减，所以2x=7。" } }),
    ev(5, "semantic_interpretation_recorded", { intent: "submit_answer:restatement", reasoning_location: "misaligned", grounding_refs: ["FN-01"], reasoning_alignment: { kind: "incorrect_reasoning", anchored_fact_ids: ["FN-01"] } }),
  ];
  const correction = "刚才你说只减左边，这是需要纠正的地方。等式像平衡的天平，两边必须同时减3；所以右边也从7变成4，得到2x=4。不是2x=7。这一点现在跟上了吗？";
  // Artificial Inquiry history: the repair covers subtraction only, while the saved
  // mainline goal also requires understanding division. No real classroom is claimed.
  const respondingTo = { protocol_id: "PR-QA-002", beat_id: "BT-01", purpose: "仅补讲为什么等式两边同时减3；不补讲随后同时除以2的关系。" };
  const returnHistory = [
    ...baseline,
    ev(4, "student_input_recorded", { input: { kind: "utterance", channel: "mainline", text: "为什么两边都要减3？后面两边除以2我也还没懂。" } }),
    ...presentation(5, "PS-QA-REPAIR", "我们先只解决减3这一点：等式像平衡的天平，两边同时减3，左边成为2x，右边成为4，所以2x=4。这里只补讲减3，后面同时除以2的关系还没有补讲。减3这一点现在跟上了吗？", true,
      { kind: "approved", protocol_id: respondingTo.protocol_id, beat_id: respondingTo.beat_id }),
  ];
  interface Case { id: string; label: string; text: string; expectation: "pass" | "not_pass"; expected_kind?: string; events?: StoredV5Event[]; old?: boolean; control?: "confirm" | "continue"; responding_to?: typeof respondingTo; }
  const cases: Case[] = [
    { id: "F01", label: "明确懂了", text: "懂了，这一步我跟上了。", expectation: "pass", expected_kind: "understanding_confirmation" },
    { id: "F02", label: "正确表达自身理解", text: "我的理解是要让等式继续平衡，所以不能只减左边。两边都减3就是2x=4，再两边除以2就是x=2。", expectation: "pass", expected_kind: "restatement" },
    { id: "F03", label: "懂了但存在误解", text: "懂了，只要左边减3，右边不用减，所以2x=7。", expectation: "not_pass" },
    { id: "F04", label: "仅要求跳过", text: "我还没懂，但先跳过这步，继续下一步吧。", expectation: "not_pass" },
    { id: "F05", label: "只引用题目", text: "题目说：解方程2x+3=7，说明等式变形过程。我只是把题目读了一遍。", expectation: "not_pass" },
    { id: "F06", label: "未修复矛盾后只说懂了", text: "懂了。", expectation: "not_pass", events: [...baseline, ...contradiction] },
    { id: "F07", label: "相关补讲实际呈现后确认", text: "现在懂了，跟上了。", expectation: "pass", expected_kind: "understanding_confirmation", events: [...baseline, ...contradiction, ...presentation(6, "PS-QA-2", correction)] },
    { id: "F08", label: "补讲仅发出未完成呈现", text: "懂了。", expectation: "not_pass", events: [...baseline, ...contradiction, ...presentation(6, "PS-QA-2", correction, false)] },
    { id: "F09", label: "演算请求", text: "能不能把从2x+3=7到x=2的演算一步一步再写给我看？我还没明白为什么两边都要减。", expectation: "not_pass" },
    { id: "F10", label: "old practice仅自述", text: "听懂了，继续。", expectation: "not_pass", old: true },
    { id: "F11", label: "old practice正确作答", text: "两边减3得2x=4，再两边除以2得x=2，所以答案是x=2。", expectation: "pass", old: true, expected_kind: "final_answer" },
    { id: "F12", label: "confirm控件", text: "", expectation: "pass", control: "confirm", expected_kind: "understanding_confirmation" },
    { id: "F13", label: "continue控件", text: "", expectation: "not_pass", control: "continue" },
    { id: "F14", label: "含混自述", text: "差不多吧，可能是吧，也许。", expectation: "not_pass" },
    { id: "F15", label: "只引用正确材料但未理解", text: "书上写的是‘两边减3得到2x=4，再除以2得到x=2’，我是在照读材料，自己还没理解。", expectation: "not_pass" },
    { id: "F16", label: "补讲原话明确接回主线完整目标", text: "减3这点现在明白了，也能接回刚才整个解方程过程了：要保持等式平衡，两边都减3，所以2x=4；接下来两边都除以2，因为2x是两个x，4也要分成两份，得到x=2。减3和除以2这整条关系我都跟上了。", expectation: "pass", expected_kind: "restatement", events: returnHistory, responding_to: respondingTo },
    { id: "F17", label: "补讲只确认局部而另一关键关系仍不懂", text: "两边都减3得到2x=4这点我现在懂了。但接下来为什么两边还要除以2，怎么变成x=2，我仍然不懂。", expectation: "not_pass", events: returnHistory, responding_to: respondingTo },
    { id: "F18", label: "裸补讲懂了不能扩大到原拍", text: "懂了。", expectation: "not_pass", events: returnHistory, responding_to: respondingTo },
  ];
  const selected = arg("--case") ? cases.filter((c) => c.id === arg("--case")) : cases;
  if (!selected.length) throw new Error("unknown --case");
  const run: Record<string, any> = {
    evidence_type: "real-production-gate-api-on-synthetic-context", started_at: new Date().toISOString(), status: "running",
    synthetic_context: true, synthetic_event_history: true, real_model: true, model_response_stub: false,
    limitations: ["One model sample per case; not a statistical accuracy estimate.", "Presentation/input histories are synthetic completed-event fixtures, not browser/session evidence.", "No real student data or asset approval; does not constitute C4/G7 acceptance.", "QA request timeout is explicitly 30s (production adapter default is 8s); no model switch or retries."],
    configuration_presence: config_presence, source_sha256, prompt_version: MODEL_GATE_ADJUDICATOR_VERSION,
    system_prompt_sha256: sha(GATE_ADJUDICATION_SYSTEM_PROMPT), system_prompt: GATE_ADJUDICATION_SYSTEM_PROMPT,
    planned_cases: selected, results: [],
  };
  const save = () => writeFileSync(out, JSON.stringify(sanitize(run), null, 2) + "\n");
  save();
  if (!secret) { run.status = "blocked_missing_api_config"; save(); console.log("DEEPSEEK_API_KEY: missing; no API calls made."); process.exitCode = 3; return; }
  const real = new DeepSeekStructuredModel({ timeoutMs: 30_000 });
  run.provider = real.provider; run.model = real.modelId;
  for (const c of selected) {
    const selectedBeat = c.old ? practice : beat;
    const context = buildGateAdjudicationContext({ plan, beat: selectedBeat, events: c.events ?? baseline, studentInput: { intent_kind: c.control ?? "utterance", text: c.text } });
    // Match secondary adjudication's explicit original Inquiry identity.
    if (c.responding_to) context.student_input.responding_to = c.responding_to;
    if (c.responding_to && (context.student_input.intent_kind !== "utterance"
      || context.current_beat.completion_evidence?.confirmation_target !== "follow_along"
      || !context.recent_presentations?.some((p) => p.in_current_beat && p.protocol_id === beat.protocol_id)
      || !context.recent_presentations?.some((p) => !p.in_current_beat && p.protocol_id === c.responding_to!.protocol_id && p.beat_id === c.responding_to!.beat_id && p.text.includes("还没有补讲")))) {
      throw new Error("Return QA requires original utterance, full marked mainline goal, and separately scoped completed repair presentation");
    }
    let receipt: Record<string, unknown> | undefined;
    let providerFailure: { code: string; detail: string } | undefined;
    // Observes actual production calls. It cannot manufacture responses or skip the real delegate.
    const observed: StructuredModelPort = {
      provider: real.provider, modelId: real.modelId,
      async complete<T>(request: StructuredCompletionRequest): Promise<StructuredCompletionResult<T>> {
        try {
          const result = await real.complete<T>(request);
          receipt = { provider: real.provider, model_id: result.modelId, prompt_version: result.promptVersion, latency_ms: result.latencyMs, usage: result.usage };
          return result;
        } catch (e) {
          providerFailure = { code: typeof (e as any)?.code === "string" ? (e as any).code : "provider-error", detail: e instanceof Error ? e.message : "unknown provider error" };
          throw e;
        }
      },
    };
    const provider = new StructuredModelGateProvider(observed);
    const started = Date.now();
    const result = await new ModelGateAdjudicatorV5(provider, { timeoutMs: 35_000 }).adjudicate(context);
    const mapped = hypothesisFromAdjudication({ plan, beat: selectedBeat, intent_kind: c.control ?? "submit_answer", text: c.text, adjudication: result, evidence_sequence: 20 });
    const { raw_output, ...validated } = result;
    const semantic = hypothesisEventPayload(mapped);
    const expectedPass = c.expectation === "pass";
    const decision_matches = (result.verdict === "pass") === expectedPass;
    const kind_matches = !c.expected_kind || result.response_kind === c.expected_kind;
    const no_false_confirmation = expectedPass || !semantic.intent.startsWith("confirm:follow_along:");
    const no_mastery_upgrade = c.old || result.verdict !== "pass" || (mapped.matched_fact_id === undefined && mapped.reasoning_alignment?.kind !== "expected_region");
    const status = providerFailure ? "provider_unavailable" : decision_matches && kind_matches && no_false_confirmation && no_mastery_upgrade ? "matched" : "mismatch";
    run.results.push({ id: c.id, label: c.label, expectation: c.expectation, expected_kind: c.expected_kind, context, model_output: raw_output ? JSON.parse(raw_output) : undefined, validated, semantic, gate_assessment: mapped.gate_assessment, checks: { decision_matches, kind_matches, no_false_confirmation, no_mastery_upgrade }, provider_receipt: receipt, provider_failure: providerFailure, elapsed_ms: Date.now() - started, status });
    save();
    console.log(`${c.id}: ${status}; response=${result.response_kind}; verdict=${result.verdict}; ${Date.now()-started}ms`);
    if (providerFailure && ["auth-error", "not-configured"].includes(providerFailure.code)) { run.status = "blocked_provider"; break; }
  }
  run.completed_at = new Date().toISOString();
  run.summary = { planned: selected.length, executed: run.results.length, matched: run.results.filter((r: any) => r.status === "matched").length, mismatched: run.results.filter((r: any) => r.status === "mismatch").length, provider_unavailable: run.results.filter((r: any) => r.status === "provider_unavailable").length };
  run.status = run.summary.provider_unavailable ? "incomplete_provider_failures" : run.summary.mismatched ? "completed_with_semantic_mismatches" : "completed_matched";
  save();
  console.log(JSON.stringify(run.summary));
  process.exitCode = run.summary.provider_unavailable ? 3 : run.summary.mismatched ? 2 : 0;
}
void main().catch((error) => { console.error(error instanceof Error ? error.message.replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]") : "run failed"); process.exitCode = 1; });

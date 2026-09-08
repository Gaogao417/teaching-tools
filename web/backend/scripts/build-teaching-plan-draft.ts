/** Model authoring over explicitly selected Approved inputs. Never publishes. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
async function main() {
  process.env.SQLITE_PATH = ":memory:";
  const { loadPlanAuthoringInputs, reviewPlanDraft } = await import("../src/services/planBuild/authoring/ReviewPlanDraft");
  const { canonicalHash } = await import("../src/services/planBuild/canonicalInputs");
  const args = process.argv.slice(2);
  const arg = (key: string) => { const i = args.indexOf(key); if (i < 0 || !args[i + 1]) throw new Error(`${key} required`); return args[i + 1]; };
  const root = resolve(arg("--canonical-root")); const output = resolve(arg("--output"));
  const request = JSON.parse(readFileSync(resolve(arg("--request")), "utf8"));
  const contracts = resolve(arg("--contracts-root"));
  mkdirSync(output, { recursive: false });
  const write = (name: string, value: unknown) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  try {
    const source = loadPlanAuthoringInputs(root, request.question_id, request.graph_id, request.approach_set_id, request.profile_id);
    const schemas = { plan: JSON.parse(readFileSync(join(contracts, "schemas/planning/v7/tutor-plan-bundle.schema.json"), "utf8")),
      protocol: JSON.parse(readFileSync(join(contracts, "schemas/planning/v5/teaching-protocol.schema.json"), "utf8")) };
    const payload = { ...request, approved_inputs: source, canonical_schemas: schemas,
      asset_meanings: { QT: "题目事实：题干、条件、图、答案和解答", RG: "解法依据：事实、推理、目标和路线", TA: "一种教师讲法", AS: "各小问的讲法选择", Plan: "可执行教学任务", Protocol: "互动步骤、完成条件与合法转移" } };
    write("model-request.json", payload);
    const model = request.model_id || process.env.TEACHING_PLAN_MODEL || "qwen-plus";
    const key = process.env.DASHSCOPE_API_KEY;
    if (!key) throw new Error("DASHSCOPE_API_KEY missing");
    // Model endpoint follows the same OpenAI-compatible contract as the MVP
    // DashScopeStructuredModel; local deterministic acceptance runs may point
    // it at a local endpoint instead of the real provider.
    const baseUrl = process.env.TEACHING_PLAN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(180000), body: JSON.stringify({ model, temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: `面向${request.student_context?.region ?? "上海市"}${request.student_context?.grade ?? "九年级（初三）"}学生，使用该阶段常见数学知识和表达。生成待独立AI验收的教学计划，严格JSON {plan,protocols}，遵守提供的canonical schemas。只使用提供的Approved题目、解法、讲法、讲法组合、工具能力和资源目录。保持教师策略，不从答案猜节奏。Plan/Protocol均Draft且不含approval。只使用request提供的plan_id/plan_version和protocol_versions分配。content_hash允许留占位，程序将确定性计算；所有引用必须用输入中的实际ID与version。覆盖细图推理，完成门槛不把播放完成当学生掌握。不得编造资源target/geometry。如有previous_candidate和validation_errors，修复这些问题并返回完整候选。` },
          { role: "user", content: JSON.stringify(payload) }] }) });
    if (!response.ok) throw new Error(`model HTTP ${response.status}`);
    const body = await response.json() as { choices: { message: { content: string } }[] };
    const candidate = JSON.parse(body.choices[0].message.content);
    write("model-raw.json", candidate);
    if (!candidate.plan || !Array.isArray(candidate.protocols)) throw new Error("invalid candidate shape");
    if (candidate.plan.artifact_id !== request.plan_id || candidate.plan.version !== request.plan_version) throw new Error("Plan allocation mismatch");
    const pins = new Map<string, { artifact_id: string; version: string; content_hash: string }>();
    for (const a of [source.truth, source.graph, source.approachSet, source.profile, ...source.approaches]) {
      const id = "graph_id" in a ? a.graph_id : a.artifact_id;
      pins.set(id, { artifact_id: id, version: a.version, content_hash: a.content_hash });
    }
    if (!request.protocol_versions || Object.keys(request.protocol_versions).length !== candidate.protocols.length) throw new Error("Protocol allocations required");
    function bindRefs(value: any): any {
      if (Array.isArray(value)) return value.map(bindRefs);
      if (!value || typeof value !== "object") return value;
      if (!value.schema && typeof value.artifact_id === "string" && "content_hash" in value) {
        const pin = pins.get(value.artifact_id);
        if (pin) { if (value.version !== pin.version) throw new Error("model changed pinned version"); return { ...value, ...pin }; }
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bindRefs(v)]));
    }
    const seen = new Set<string>();
    // Protocol references can form dependencies: hash in dependency order, reject cycles.
    const pending = [...candidate.protocols]; const normalized: any[] = [];
    for (let round = 0; pending.length && round <= candidate.protocols.length; round++) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i]; const id = p.protocol_id;
        if (seen.has(id) || request.protocol_versions[id] !== p.version) throw new Error("Protocol allocation mismatch");
        const dependencies = (p.beats ?? []).flatMap((b: any) => b.inquiry_branch ? [b.inquiry_branch.inquiry_protocol_ref.artifact_id] : []);
        if (dependencies.some((d: string) => !pins.has(d))) continue;
        const bound = bindRefs(p); bound.content_hash = canonicalHash(bound, "authoring");
        pins.set(id, { artifact_id: id, version: bound.version, content_hash: bound.content_hash });
        normalized.push(bound); seen.add(id); pending.splice(i, 1);
      }
    }
    if (pending.length) throw new Error("unresolved/cyclic protocol references");
    candidate.protocols = normalized; candidate.plan = bindRefs(candidate.plan);
    candidate.plan.content_hash = canonicalHash(candidate.plan, "plan");
    write("candidate.json", candidate);
    const result = reviewPlanDraft(root, candidate, request.resource_catalog);
    write("review.json", result);
    (writeFileSync)(join(output, "review.md"), `# 教学计划待审\n\n状态：${result.ok ? "待 AI 验收" : "需返工"}。未批准、未发布。\n\n` +
      candidate.protocols.flatMap((p: any) => p.beats.map((b: any) => `- ${p.protocol_id}/${b.beat_id}: ${b.purpose}；参与：${b.participation}；完成条件：${JSON.stringify(b.gate ?? b.completion_evidence ?? null)}`)).join("\n") + "\n", { flag: "wx" });
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) { write("failure.json", { status: "Failed", error_class: error instanceof Error ? error.name : "unknown" }); process.exitCode = 1; }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "failed"); process.exitCode = 1; });

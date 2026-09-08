/** Local author review, real providers; never publishes or relabels Draft assets.
 * Run from web/backend: npm run review:live -- --root <canonical-root>
 */
import "../src/loadEnv";
import { mkdtempSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Author review cannot run in production");
  const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const root = arg("--root");
  if (!root) throw new Error("--root <canonical-authoring> required");
  const canonicalRoot = resolve(root);
  const visual = process.argv.includes("--visual");
  const candidateDir = resolve(arg("--candidate") ?? (visual ? "src/services/planBuild/review/geometry-visual/candidate-v14" : "src/services/planBuild/review/c1-teach-follow-along/candidate-v13-r3"));
  const backendPort = Number(arg("--backend-port") ?? 3124);
  const frontendPort = Number(arg("--frontend-port") ?? 5184);
  const resumeRun = arg("--resume-run");
  const runDir = resumeRun ? resolve(resumeRun) : mkdtempSync(join(tmpdir(), "teach-live-review-"));
  const previousRun = resumeRun ? JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")) : undefined;
  if (previousRun && (previousRun.mode !== "author-review" || previousRun.status !== "Draft" || previousRun.publicationPerformed !== false)) {
    throw new Error("--resume-run must reference a local unpublished author-review run");
  }
  process.env.SQLITE_PATH = join(runDir, "review.sqlite");
  process.env.TUTOR_VNEXT_ROOT = canonicalRoot;
  process.env.TUTOR_VNEXT_GENERATION = "1";
  process.env.TUTOR_VNEXT_SCRIPTED_GATE = "0";
  process.env.TUTOR_TELEMETRY = "off";
  process.env.FRONTEND_ORIGIN = `http://127.0.0.1:${frontendPort}`;
  if (!process.env.DEEPSEEK_API_KEY?.trim() || !process.env.DASHSCOPE_API_KEY?.trim()) {
    throw new Error("Real review requires configured DEEPSEEK_API_KEY and DASHSCOPE_API_KEY (values never logged)");
  }
  const { importReviewCandidate } = await import("../src/services/planBuild/c1/ImportReviewCandidate");
  const { importVisualReviewCandidate } = await import("../src/services/planBuild/visual/ImportVisualReviewCandidate");
  const loaded = (visual ? importVisualReviewCandidate : importReviewCandidate)({ canonicalRoot, candidateDirectory: candidateDir });
  if (!loaded.ok) throw new Error(loaded.errors.join("; "));
  if (previousRun && (previousRun.plan?.artifact_id !== loaded.imported.plan.artifact_id
    || previousRun.plan?.version !== loaded.imported.plan.version || previousRun.plan?.content_hash !== loaded.imported.plan.content_hash)) {
    throw new Error("Cannot resume review data with a different candidate pin");
  }
  const { TutorTaskBindingResolver } = await import("../src/services/tutorOrchestration/TutorTaskBindingResolver");
  const { TutorRuntimeApplicationV7 } = await import("../src/services/tutorOrchestration/TutorRuntimeApplicationV7");
  const { vNextGateModel } = await import("../src/services/tutorOrchestration/VNextGateModelFactory");
  const { createPresenterGenerator, presenterFailureDiagnostic } = await import("../src/services/tutorOrchestration/presentationGeneration/GeneratorPort");
  const resolver = new TutorTaskBindingResolver(canonicalRoot, (_deps, id) => id === loaded.imported.plan.artifact_id
    ? loaded : { ok: false, errors: ["Review importer is limited to the pinned candidate"] });
  const realModel = vNextGateModel();
  const model = { pin: realModel.pin, provider: {
    name: realModel.provider.name,
    async adjudicate(contextJson: string) {
      const started = Date.now();
      try {
        const result = await realModel.provider.adjudicate(contextJson);
        appendFileSync(join(runDir, "gate.jsonl"), JSON.stringify({ context: JSON.parse(contextJson), result, elapsedMs: Date.now() - started }) + "\n");
        return result;
      } catch (error) {
        appendFileSync(join(runDir, "gate.jsonl"), JSON.stringify({ context: JSON.parse(contextJson), error: error instanceof Error ? error.name : "Error", elapsedMs: Date.now() - started }) + "\n");
        throw error;
      }
    },
  } };
  const { VISUAL_PRESENTER_PROMPT_VERSION } = await import("../src/services/tutorOrchestration/presentationGeneration/PresenterPrompts");
  const realPresenter = createPresenterGenerator(previousRun ? { promptVersion: previousRun.presenter.prompt_version } : visual ? { promptVersion: VISUAL_PRESENTER_PROMPT_VERSION } : {});
  const presenter: typeof realPresenter = {
    provider: realPresenter.provider, modelId: realPresenter.modelId, pin: realPresenter.pin,
    async generatePresentationDraft(request) {
      // Explicit local review evidence: teaching context and model output only, never config/headers.
      appendFileSync(join(runDir, "presenter.jsonl"), JSON.stringify({ kind: "request", request_id: request.request_id, systemPrompt: request.systemPrompt, userPayload: request.userPayload }) + "\n");
      try {
        const result = await realPresenter.generatePresentationDraft(request);
        appendFileSync(join(runDir, "presenter.jsonl"), JSON.stringify({ kind: "result", request_id: request.request_id, ...result }) + "\n");
        return result;
      } catch (error) {
        appendFileSync(join(runDir, "presenter.jsonl"), JSON.stringify({ kind: "error", request_id: request.request_id, ...presenterFailureDiagnostic(error) }) + "\n");
        throw error;
      }
    },
  };
  const applicationFactory = () => TutorRuntimeApplicationV7.create({ canonicalRoot, bindingResolver: resolver, model, presenter });
  const { createApp } = await import("../src/app");
  const { createGenerationWakeChannel } = await import("../src/services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker");
  const generationWake = createGenerationWakeChannel();
  const app = createApp({ vnext: { applicationFactory, generationWake: generationWake.notify } });
  const metadata = { mode: "author-review", status: "Draft", publicationPerformed: false, runDir,
    plan: { artifact_id: loaded.imported.plan.artifact_id, version: loaded.imported.plan.version, content_hash: loaded.imported.plan.content_hash },
    gate: model.pin, presenter: presenter.pin, url: `http://127.0.0.1:${frontendPort}/learn/goldenMinhangFold2020` };
  app.get("/api/author-review", (_req, res) => res.json(metadata));
  // Do not start a frontend against an occupied (possibly unrelated) backend port.
  const server = await new Promise<import("node:http").Server>((resolve, reject) => {
    const listening = app.listen(backendPort, "127.0.0.1", () => resolve(listening));
    listening.once("error", reject);
  });
  console.log(JSON.stringify(metadata));
  const vite = spawn(process.execPath, [resolve("../frontend/node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {
    cwd: resolve("../frontend"), stdio: "inherit", env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${backendPort}`, VITE_TEACH_REVIEW: "1" },
  });
  const { startGenerationRecoveryWorker } = await import("../src/services/tutorOrchestration/presentationGeneration/GenerationRecoveryWorker");
  const stopWorker = startGenerationRecoveryWorker(applicationFactory, (error) => console.error("review recovery failed", error instanceof Error ? error.name : "Error"));
  writeFileSync(join(runDir, "run.json"), JSON.stringify(metadata, null, 2));
  const unsubscribeWake = generationWake.subscribe(() => stopWorker.wake());
  const stop = () => { unsubscribeWake(); stopWorker.stop(); vite.kill(); server.close(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  vite.once("exit", () => { unsubscribeWake(); stopWorker.stop(); server.close(); });
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Review startup failed"); process.exitCode = 1; });

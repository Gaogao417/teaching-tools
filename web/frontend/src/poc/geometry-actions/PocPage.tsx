/**
 * PocPage — rewritten to the real front-end/back-end architecture.
 *
 * The frontend is now a THIN PROJECTION layer:
 *   - spec (from mock backend) → projectSpecToWorld → WorldState → JSXGraph
 *   - spec → projectSpecToInteraction → InteractionView → clickable canvas
 *   - GeometryEvent → local draft accumulation → buildSubmitAction → async POST
 *   - backend judges (private answerKey) → new spec → re-project
 *
 * The frontend NEVER judges, NEVER commits WorldState, NEVER holds the answer.
 * This is the ADR-001/ADR-002 invariant made concrete.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createMockSession, startMockSession, submitMockAction } from "./backend/mockBackend.ts";
import type { MockSession } from "./backend/mockBackend.ts";
import { emptyDraft, applyEvent, buildSubmitAction } from "./projector/eventAdapter.ts";
import type { DraftState } from "./projector/eventAdapter.ts";
import { projectSpecToInteraction } from "./projector/specToInteraction.ts";
import { projectSpecToWorld } from "./projector/specToWorld.ts";
import { GeometryCanvas } from "./renderer/GeometryCanvas.tsx";
import type { GeometryEvent } from "./domain/events.ts";
import type { WorldState } from "./domain/geometry.ts";
import type { PocRuntimeSpec } from "./shared/runtimeContracts.ts";
import "./poc.css";

export default function PocPage() {
  const [spec, setSpec] = useState<PocRuntimeSpec | null>(null);
  const [draft, setDraft] = useState<DraftState>(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  // The mock session lives in a ref — it's the backend's authoritative state.
  const sessionRef = useRef<MockSession | null>(null);

  useEffect(() => {
    const started = startMockSession();
    sessionRef.current = started.session ?? null;
    setSpec(started.spec);
  }, []);

  const world: WorldState | null = useMemo(
    () => (spec ? projectSpecToWorld(spec) : null),
    [spec],
  );
  const interaction = useMemo(
    () => (spec ? projectSpecToInteraction(spec) : null),
    [spec],
  );

  if (!spec || !world || !interaction) {
    return <div className="ks-poc"><p className="ks-poc__loading">加载中…</p></div>;
  }

  const activeStep = spec.flow.steps.find((s) => s.status === "active");
  const selectionSlot = activeStep ? slotForStep(activeStep.id) : undefined;

  function handleEvent(event: GeometryEvent) {
    if (event.kind === "submit" || submitting) return;
    setDraft((d) => applyEvent(d, event, selectionSlot));
  }

  async function handleSubmit() {
    if (submitting || !sessionRef.current || !activeStep) return;
    setSubmitting(true);
    const action = buildSubmitAction(activeStep.id, draft);
    // Simulate network latency to make the round-trip observable.
    await new Promise((r) => setTimeout(r, 150));
    const res = submitMockAction(sessionRef.current, action);
    setSpec(res.runtime);
    setDraft(emptyDraft());
    setSubmitting(false);
  }

  const finished = spec.runtimeState.phase === "group_finished";

  return (
    <div className="ks-poc">
      <header className="ks-poc__header">
        <h1>Geometry Actions — POC (front/back architecture)</h1>
        <p className="ks-poc__subtitle">
          Backend holds truth (mock) · frontend projects spec → WorldState · async round-trip
        </p>
      </header>

      <div className="ks-poc__layout">
        <section className="ks-poc__stage">
          <GeometryCanvas
            world={world}
            interaction={interaction}
            viewBox={spec.scene.viewBox}
            onEvent={handleEvent}
          />
          <div className="ks-poc__actions">
            {interaction.canSubmit && !finished && (
              <button
                type="button"
                className="ks-poc__submit"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "提交中…" : "提交"}
              </button>
            )}
            {/* immediate-submit steps: a click already advances via a submit-on-select */}
            {!interaction.canSubmit && !finished && hasSelection(draft, selectionSlot) && (
              <button
                type="button"
                className="ks-poc__submit"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "提交中…" : "提交选择"}
              </button>
            )}
          </div>
        </section>

        <aside className="ks-poc__panel">
          <StatusRow label="当前步骤" value={activeStep?.title ?? "已完成"} />
          <StatusRow label="阶段" value={phaseLabel(spec.runtimeState.phase)} />
          <StatusRow label="尝试次数" value={String(spec.runtimeState.attempts)} />
          <div className="ks-poc__row ks-poc__row--block">
            <span className="ks-poc__label">提示</span>
            <div className="ks-poc__value">{interaction.prompt}</div>
          </div>
          <div className="ks-poc__row ks-poc__row--block">
            <span className="ks-poc__label">反馈</span>
            <div className={"ks-poc__value " + feedbackClass(spec.feedback?.kind)}>
              {spec.feedback ? spec.feedback.message : "—"}
            </div>
          </div>

          <details className="ks-poc__debug" open>
            <summary>WorldState (前端投影)</summary>
            <pre className="ks-poc__json">{JSON.stringify(world, null, 2)}</pre>
          </details>
          <details className="ks-poc__debug">
            <summary>Draft (本地，未提交)</summary>
            <pre className="ks-poc__json">{JSON.stringify(draft, null, 2)}</pre>
          </details>
          <details className="ks-poc__debug">
            <summary>PocRuntimeSpec (后端返回)</summary>
            <pre className="ks-poc__json">{JSON.stringify(spec, null, 2)}</pre>
          </details>

          <button
            type="button"
            className="ks-poc__reset"
            onClick={() => {
              const fresh = createMockSession();
              sessionRef.current = fresh;
              setSpec(buildSpecExternally(fresh));
              setDraft(emptyDraft());
            }}
          >
            重置
          </button>
        </aside>
      </div>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ks-poc__row">
      <span className="ks-poc__label">{label}</span>
      <span className="ks-poc__value">{value}</span>
    </div>
  );
}

/**
 * Map an active step id to the draft selection slot the backend expects.
 * This is the ONE piece of per-step context the frontend needs; it derives from
 * the backend's buildFlow step-id convention, not from a business switch.
 */
function slotForStep(stepId: string): string | undefined {
  if (stepId.endsWith("/pick-through-point")) return "through-point";
  if (stepId.endsWith("/pick-parallel-segment")) return "parallel-segment";
  if (stepId.endsWith("/pick-segment")) return "segment";
  return undefined;
}

function hasSelection(draft: DraftState, slot?: string): boolean {
  if (!slot) return false;
  return (draft.selections[slot]?.length ?? 0) > 0;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case "answering": return "答题中";
    case "correct_pause": return "正确（暂停）";
    case "wrong_feedback": return "错误反馈";
    case "group_finished": return "全部完成";
    default: return phase;
  }
}

function feedbackClass(kind?: "error" | "success" | "info"): string {
  if (kind === "error") return "ks-poc__feedback--error";
  if (kind === "success") return "ks-poc__feedback--success";
  return "";
}

// Helper to expose buildSpec for reset without importing internals.
import { buildSpecExternally } from "./backend/mockBackend.ts";

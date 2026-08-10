/**
 * TopicGeometryWorkspace — the production entry that lets the XState
 * construct-parallel machine own flow + rendering via the tool-agnostic JSXGraph
 * {@link GeometryCanvas}, instead of being translated back into the legacy SVG
 * Canvas's prop shape (`mapConstructParallelView`).
 *
 * This is the plan's "第一阶段：建立生产版新 Canvas 入口". The component consumes
 * only `{ model, runtime }` (the POC Canvas's contract) — it does NOT go through
 * `availablePointIds` / `selectedSegments` / `constructionPreview` / `handlePoint`
 * / `handleSegment` anymore. The machine snapshot is the single source of truth;
 * React no longer infers "should I pick a point or a line now".
 *
 * State ownership (plan 第二阶段):
 *  - XState snapshot: live source of truth for the current operation;
 *  - GeometryModel: source of truth for geometry entities + the constructed
 *    parallel-line relation (the real executor writes it on completion);
 *  - draft: the persisted projection needed for restore + backend submission;
 *  - React: does not infer the current step.
 *
 * Draft sync mirrors the previous in-workspace wiring, now localized here:
 *  - hydration on tool start (replay the confirmed-correct prefix);
 *  - in-progress write-back on every view change;
 *  - completion write-back from `onDone` evidence.
 *
 * NOT rendered here (plan 第一阶段最窄切片): the 411 pre-rendered `.preview.svg`
 * background images. The JSXGraph-native points/segments are the sole hit-testable
 * layer for now; a background layer can be added later without touching the
 * machine or runtime.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { MathText } from "../../components/math/MathText";
import type { TopicActionProjection, TopicGeometryModel } from "../../../../shared/topicPractice";
import { createCommandExecutor } from "../domain/command-executor";
import { GeometryModel } from "../domain/model";
import { toCanvasEvent, type EntityKind, type EntityRef } from "../interaction/events";
import { idleView, type InteractionView } from "../interaction/interaction-view";
import { createInteractionRuntime, type InteractionRuntime } from "../interaction/runtime";
import { GeometryCanvas } from "../react/GeometryCanvas";
import {
  buildGeometryModel,
  buildParallelSpec,
  parseParallelAnswer,
  serializeParallelEvidence,
} from "../adapters/constructParallelAdapter";
import { parallelAnswerFromView } from "./topicAnswerSerializer";

export interface TopicGeometryWorkspaceProps {
  /** The learner-visible step contract (primitive === "construct-parallel"). */
  contract: TopicActionProjection;
  /** The geometry to render + hit-test (contract.interaction.geometry or promptGeometry). */
  geometry: TopicGeometryModel;
  /** Current `topic-answer` draft value (read for hydration, written via onDraftChange). */
  draftValue: string;
  /** Whether the step is read-only (review mode) — clicks are suppressed. */
  readOnly?: boolean;
  /** Write a new value back into the `topic-answer` draft. */
  onDraftChange: (value: string) => void;
}

/**
 * Drives the XState construct-parallel machine behind the JSXGraph Canvas.
 *
 * The runtime is per-step (keyed by contract id + model identity): a new
 * construct-parallel step gets a fresh machine. Built via useMemo so the same
 * instance is reused across renders within one step.
 *
 * The SAME `model` instance is handed to both the executor (which mutates it on
 * completion) and the Canvas (which renders it) — so the `parallel-line` relation
 * the executor adds at completion is the one the Canvas redraws.
 *
 * Unlike the previous in-workspace wiring, this uses the REAL
 * {@link createCommandExecutor} so completion writes the `parallel-line` relation
 * into the model (plan 第六阶段).
 */
function useConstructParallelRuntime(
  contract: TopicActionProjection,
  geometry: TopicGeometryModel,
): { model?: GeometryModel; runtime?: InteractionRuntime; view: InteractionView } {
  const spec = useMemo(
    () => buildParallelSpec(contract.interaction?.construction),
    [contract.interaction?.construction],
  );
  const model = useMemo(() => buildGeometryModel(geometry), [geometry]);

  const runtime = useMemo<InteractionRuntime | undefined>(() => {
    if (!spec) return undefined;
    return createInteractionRuntime(createCommandExecutor(model), model);
    // contract.id + geometry identity are the keys; model is derived from geometry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id, model]);

  useEffect(() => {
    if (!runtime || !spec) return;
    runtime.startTool("construct-parallel", spec);
  }, [runtime, spec]);

  const view = useSyncExternalStore(
    (cb) => (runtime ? runtime.subscribe(cb) : () => {}),
    () => runtime?.getView() ?? idleView,
    () => idleView,
  );

  return { model, runtime, view };
}

export function TopicGeometryWorkspace({
  contract,
  geometry,
  draftValue,
  readOnly,
  onDraftChange,
}: TopicGeometryWorkspaceProps) {
  const { model, runtime, view } = useConstructParallelRuntime(contract, geometry);

  // modelVersion bumps whenever the executor mutates the model (a parallel-line
  // relation is added on completion), telling the Canvas to redraw the final
  // construct. The Canvas also re-renders on every view change for affordance
  // styling; this bump is specifically for the model-mutation redraw.
  const [modelVersion, setModelVersion] = useState(0);

  // Hydrate the machine from an existing draft whenever a (re)started tool
  // begins. Replay only the confirmed-correct prefix (point → parallel →
  // carriers) by sending the matching semantic events; the machine's guards
  // accept each and advance. Runs once per tool start (keyed on the runtime),
  // NOT on every draft change, so it cannot loop against the in-progress
  // write-back effect below.
  useEffect(() => {
    if (!runtime) return;
    if (!draftValue) return;
    if (runtime.activeToolId() !== "construct-parallel") return;
    const parsed = parseParallelAnswer(draftValue);
    if (parsed.throughPointId) runtime.send({ type: "POINT.CLICKED", pointId: parsed.throughPointId });
    if (parsed.referenceLineId) runtime.send({ type: "LINE.CLICKED", lineId: parsed.referenceLineId });
    for (const carrierId of parsed.carrierPointIds) runtime.send({ type: "POINT.CLICKED", pointId: carrierId });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the per-step runtime only; reading the current draft once on tool start is the point.
  }, [runtime]);

  // Reflect the machine's in-progress selection into the draft string on every
  // view change. Byte-identical to the legacy handlers' partial forms at each
  // stage, so the backend grading path is unaffected.
  useEffect(() => {
    const value = parallelAnswerFromView(view);
    if (value !== null) onDraftChange(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onDraftChange is a stable setValue wrapper; depending on it would re-run on every parent render.
  }, [view]);

  // On completion, write the final serialized evidence + bump modelVersion so the
  // Canvas redraws with the parallel-line relation the executor just added.
  useEffect(() => {
    if (!runtime) return;
    return runtime.onDone((completed) => {
      if (completed.toolId !== "construct-parallel") return;
      if (!completed.evidence || !("selectedPointId" in completed.evidence)) return;
      onDraftChange(serializeParallelEvidence(completed.evidence));
      if (completed.result.ok) setModelVersion((v) => v + 1);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  // The POC Canvas mounts its own JSXGraph board + Back/Cancel controls. The
  // machine is the single source of truth for step flow; BACK only sends a
  // machine event (plan 第二阶段验收: React 不判断"当前该选点还是选线").
  return (
    <div className="practice-canvas-zone topic-practice-canvas artifact-topic-canvas">
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage">
          {runtime && model ? (
            <GeometryCanvas model={model} runtime={runtime} modelVersion={modelVersion} />
          ) : (
            <div className="artifact-equation-focus">题图解析中</div>
          )}
        </section>
      </div>

      <section className="topic-answer-panel artifact-action-workbench">
        <div className="topic-answer-copy">
          <h3>{contract.title}</h3>
          <MathText value={contract.promptLatex} block />
        </div>
        <p className="topic-next-object">
          <span className="material-symbols-outlined">ads_click</span>
          {view.prompt}
        </p>
        <button
          type="button"
          className="topic-local-undo"
          disabled={readOnly || !view.canGoBack}
          onClick={() => runtime?.send({ type: "BACK" })}
        >
          <span className="material-symbols-outlined">undo</span>
          撤销刚才
        </button>
        {/* Accessibility layer (plan 第四阶段): a keyboard/screen-reader path that
            lists the entities the current step accepts, independent of Canvas
            pixel hit-testing. Clicking a button sends the same semantic event the
            board would. Disabled entities are excluded (matches the board's
            single `enabled` filter). */}
        {!readOnly && runtime && (
          <EntityButtonRow view={view} onPick={(hit) => runtime.send(toCanvasEvent(hit))} />
        )}
      </section>
    </div>
  );
}

/**
 * Accessibility entity-button row (plan 第四阶段). Renders one button per
 * currently-`enabled` entity in the view, grouped by kind, providing a
 * keyboard/screen-reader path that does not depend on Canvas pixel hit-testing.
 * Picking a button sends the same semantic CanvasEvent the board would.
 */
function EntityButtonRow({
  view,
  onPick,
}: {
  view: InteractionView;
  onPick: (hit: EntityRef) => void;
}) {
  const enabled = Object.values(view.entities).filter((e) => e.enabled);
  if (enabled.length === 0) return null;
  const points = enabled.filter((e) => e.kind === "point");
  const lines = enabled.filter((e) => e.kind === "line");
  const labelFor = (kind: EntityKind) => (kind === "point" ? "点" : kind === "line" ? "线段" : "角");
  return (
    <div className="topic-geometry-entity-row" role="group" aria-label="当前可选对象">
      {points.length > 0 && (
        <span className="topic-geometry-entity-group">
          <span className="sr-only">{labelFor("point")}：</span>
          {points.map((e) => (
            <button key={e.id} type="button" className="topic-geometry-entity-chip" onClick={() => onPick({ kind: "point", id: e.id })}>
              {e.id}
            </button>
          ))}
        </span>
      )}
      {lines.length > 0 && (
        <span className="topic-geometry-entity-group">
          <span className="sr-only">{labelFor("line")}：</span>
          {lines.map((e) => (
            <button key={e.id} type="button" className="topic-geometry-entity-chip" onClick={() => onPick({ kind: "line", id: e.id })}>
              {e.id}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

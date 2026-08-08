/**
 * PocPage — isolated dev page driving the geometry-actions POC.
 *
 * React owns the RuntimeSnapshot (the single source of truth). The JSXGraph
 * board is a pure projection of `snapshot.world`, driven by `viewOf(snapshot)`.
 *
 * This page is intentionally ugly-but-honest: its job is to make the data flow
 * observable, not to look pretty.
 */
import { useMemo, useState } from "react";
import { makeParallel } from "./actions/makeParallel.ts";
import { markSegmentValue } from "./actions/markSegmentValue.ts";
import { sequence } from "./engine/program.ts";
import { dispatch, initRuntime, viewOf } from "./engine/runtime.ts";
import type { RuntimeSnapshot } from "./engine/runtime.ts";
import { GeometryCanvas } from "./renderer/GeometryCanvas.tsx";
import type { WorldState } from "./domain/geometry.ts";
import "./poc.css";

/** The fixed POC scenario: points A,B,C,D,E and segments BC, DE. */
function initialWorld(): WorldState {
  return {
    objects: {
      A: { kind: "point", id: "A", x: 0, y: 4 },
      B: { kind: "point", id: "B", x: -4, y: -2 },
      C: { kind: "point", id: "C", x: -1, y: -2 },
      D: { kind: "point", id: "D", x: 3, y: 1 },
      E: { kind: "point", id: "E", x: 6, y: -3 },
      BC: { kind: "segment", id: "BC", endpoints: ["B", "C"] },
      DE: { kind: "segment", id: "DE", endpoints: ["D", "E"] },
    },
  };
}

function buildProgram() {
  return sequence(
    makeParallel({
      through: "A",
      parallelTo: "BC",
      intersectionWith: "DE",
      intersectionPoint: "F",
    }),
    markSegmentValue({ segment: "BC", expected: "3" }),
  );
}

export default function PocPage() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>(() =>
    initRuntime(buildProgram(), initialWorld()),
  );

  const interaction = useMemo(() => viewOf(snapshot), [snapshot]);
  const current = snapshot.finished
    ? null
    : snapshot.program[snapshot.actionIndex];

  return (
    <div className="ks-poc">
      <header className="ks-poc__header">
        <h1>Geometry Actions — POC</h1>
        <p className="ks-poc__subtitle">
          Action state machine · generic Runtime · WorldState as source of truth · JSXGraph
          as projection
        </p>
      </header>

      <div className="ks-poc__layout">
        <section className="ks-poc__stage">
          <GeometryCanvas
            world={snapshot.world}
            interaction={interaction}
            onEvent={(event) => setSnapshot((prev) => dispatch(prev, event))}
          />
        </section>

        <aside className="ks-poc__panel">
          <div className="ks-poc__row">
            <span className="ks-poc__label">Action index</span>
            <span className="ks-poc__value">{snapshot.actionIndex}</span>
          </div>
          <div className="ks-poc__row">
            <span className="ks-poc__label">Action kind</span>
            <span className="ks-poc__value">
              {current ? current.actionKind : "—"}
            </span>
          </div>
          <div className="ks-poc__row ks-poc__row--block">
            <span className="ks-poc__label">Prompt</span>
            <div className="ks-poc__value">{interaction?.prompt ?? "—"}</div>
          </div>
          <div className="ks-poc__row ks-poc__row--block">
            <span className="ks-poc__label">Feedback</span>
            <div
              className={
                "ks-poc__value " +
                feedbackClass(snapshot.feedback?.kind)
              }
            >
              {snapshot.feedback ? snapshot.feedback.message : "—"}
            </div>
          </div>

          <details className="ks-poc__debug" open>
            <summary>WorldState</summary>
            <pre className="ks-poc__json">{JSON.stringify(snapshot.world, null, 2)}</pre>
          </details>

          <details className="ks-poc__debug" open>
            <summary>ActionState</summary>
            <pre className="ks-poc__json">
              {JSON.stringify(snapshot.actionState, null, 2)}
            </pre>
          </details>

          <details className="ks-poc__debug">
            <summary>InteractionView</summary>
            <pre className="ks-poc__json">
              {JSON.stringify(interaction, null, 2)}
            </pre>
          </details>

          <button
            type="button"
            className="ks-poc__reset"
            onClick={() => setSnapshot(initRuntime(buildProgram(), initialWorld()))}
          >
            重置
          </button>
        </aside>
      </div>
    </div>
  );
}

function feedbackClass(kind?: "error" | "success" | "info"): string {
  if (kind === "error") return "ks-poc__feedback--error";
  if (kind === "success") return "ks-poc__feedback--success";
  return "";
}

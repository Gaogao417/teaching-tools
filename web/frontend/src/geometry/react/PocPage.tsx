/**
 * PocPage — the runnable demo for the XState-driven Geometry Canvas.
 *
 * Full chain on one screen:
 *   pick a tool -> click entities -> machine completes -> command -> executor
 *   mutates GeometryModel -> model re-renders.
 *
 * This is a self-contained demo route. It does not touch the session runtime,
 * the backend API, or the WORKSPACE_RENDERERS registry — it validates the
 * interaction architecture in isolation.
 */
import { useEffect, useMemo, useState } from "react";
import { createCommandExecutor } from "../domain/command-executor";
import { GeometryModel } from "../domain/model";
import { createInteractionRuntime } from "../interaction/runtime";
import { TOOL_REGISTRY, type ToolId } from "../interaction/tool-registry";
import { GeometryCanvas } from "./GeometryCanvas";
// POC styles live in the shared stylesheet (src/styles/geometry-poc.css) per
// the frontend style contract; see main.tsx for the import.

interface FeedEntry {
  kind: "log" | "error";
  text: string;
}

function createPocModel(): GeometryModel {
  return new GeometryModel({
    points: [
      { id: "A", x: 1, y: 4 },
      { id: "B", x: -4, y: -1 },
      { id: "C", x: 5, y: -1 },
    ],
    lines: [
      { id: "AB", kind: "segment", from: "A", to: "B" },
      { id: "BC", kind: "segment", from: "B", to: "C" },
      { id: "AC", kind: "segment", from: "A", to: "C" },
    ],
  });
}

export default function PocPage() {
  // The model is the single source of geometry truth. We bump modelVersion to
  // tell the Canvas to re-render after the executor mutates it.
  const [model] = useState(() => createPocModel());
  const [modelVersion, setModelVersion] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([
    { kind: "log", text: "选择一个工具，然后在画布上点击几何对象。" },
  ]);

  // The executor owns the only mutation path. The runtime forwards completed
  // commands to it.
  const executor = useMemo(() => createCommandExecutor(model), [model]);
  const runtime = useMemo(() => createInteractionRuntime(executor, model), [executor, model]);

  // Subscribe so tool-selection buttons reflect the active tool, and re-render
  // whenever the runtime notifies (start/cancel/complete).
  useRuntimeSubscription(runtime);

  // Wire onDone once for the runtime's lifetime.
  useEffect(() => {
    return runtime.onDone(({ toolId, result }) => {
      if (result.ok) {
        setFeed((f) => [{ kind: "log", text: `✓ ${toolId}：${result.summary}` } satisfies FeedEntry, ...f].slice(0, 8));
        setModelVersion((v) => v + 1);
      } else {
        setFeed((f) => [{ kind: "error", text: `✗ ${toolId}：${result.message}` } satisfies FeedEntry, ...f].slice(0, 8));
      }
    });
  }, [runtime]);

  // Start a tool with a demo task spec. In production this input comes from the
  // backend's TopicActionProjection (interaction.construction); here it is
  // hardcoded to the seed model so the POC is task-driven (not free-drawing):
  // construct-parallel expects through-point A, reference line BC, and the two
  // carrier points B and C — the full PRD-03 §5.3 four-stage flow.
  function startDemoTool(toolId: ToolId) {
    if (toolId === "construct-parallel") {
      runtime.startTool("construct-parallel", {
        throughPointId: "A",
        referenceLineId: "BC",
        carrierPoints: ["B", "C"],
      });
    } else {
      runtime.startTool("construct-circle", undefined);
    }
  }

  return (
    <div className="poc-page screen">
      <header className="poc-page__header panel">
        <h1 className="poc-page__title">XState Geometry Canvas · POC</h1>
        <p className="text-muted">
          工具流程状态由 XState 管理；几何实体由 GeometryModel 作为唯一事实来源。机器完成只产出 command，由独立 executor 写入模型。
        </p>
      </header>

      <section className="poc-page__tools action-row">
        {(Object.keys(TOOL_REGISTRY) as ToolId[]).map((toolId) => {
          const tool = TOOL_REGISTRY[toolId];
          const isActive = runtime.activeToolId() === toolId;
          return (
            <button
              key={toolId}
              type="button"
              className={isActive ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => startDemoTool(toolId)}
            >
              {tool.title}
            </button>
          );
        })}
        <button type="button" className="btn btn-ghost" onClick={() => setModelVersion((v) => v + 1)}>
          重绘
        </button>
      </section>

      <div className="poc-page__body">
        <div className="poc-page__canvas panel panel-pad">
          <GeometryCanvas model={model} runtime={runtime} modelVersion={modelVersion} />
        </div>
        <aside className="poc-page__feed panel panel-pad">
          <h2 className="eyebrow">操作记录</h2>
          <ul className="poc-feed">
            {feed.map((entry, i) => (
              <li key={i} className={entry.kind === "error" ? "poc-feed__item poc-feed__item--error" : "poc-feed__item"}>
                {entry.text}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/** Re-render this component whenever the runtime notifies. */
function useRuntimeSubscription(runtime: ReturnType<typeof createInteractionRuntime>) {
  const [, force] = useState(0);
  useEffect(() => {
    return runtime.subscribe(() => force((n) => n + 1));
  }, [runtime]);
}

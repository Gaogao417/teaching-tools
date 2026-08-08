/**
 * JSXGraphCanvas — owns the imperative board lifecycle.
 *
 * - Creates the board on mount, destroys it on unmount.
 * - On every render, hands world + interaction to the adapter to reconcile.
 *
 * This is one of only TWO files allowed to import "jsxgraph" (the other being
 * jsxGraphAdapter.ts). No JXG.* types appear in its public props.
 */
import { useEffect, useRef } from "react";
import type { GeometryEvent } from "../domain/events.ts";
import type { InteractionView } from "../domain/interaction.ts";
import type { WorldState } from "../domain/geometry.ts";
import {
  JsxGraphAdapter,
  createBoard,
  destroyBoard,
} from "./jsxGraphAdapter.ts";

interface Props {
  world: WorldState;
  interaction: InteractionView | null;
  onEvent: (event: GeometryEvent) => void;
}

/**
 * Lazily inject the JSXGraph stylesheet once (shared across instances).
 * We load it at runtime from the node_modules path because jsxgraph's
 * package.json "exports" field does not expose the CSS subpath for static
 * import. This keeps the POC isolated (no global index.html change).
 */
let jsxGraphCssLoaded = false;
function loadJsxGraphCss(): void {
  if (jsxGraphCssLoaded || typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  // Resolved by Vite from the project root at request time.
  link.href = "/node_modules/jsxgraph/distrib/jsxgraph.css";
  document.head.appendChild(link);
  jsxGraphCssLoaded = true;
}

export function JSXGraphCanvas({ world, interaction, onEvent }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<JsxGraphAdapter | null>(null);

  // Stable onEvent: keep the latest handler without re-creating the board.
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    loadJsxGraphCss();
    const el = containerRef.current;
    if (!el) return;
    const board = createBoard(el);
    const adapter = new JsxGraphAdapter(board, (ev) => onEventRef.current(ev));
    adapterRef.current = adapter;
    adapter.render(world, interaction);
    return () => {
      adapter.dispose();
      adapterRef.current = null;
      destroyBoard(board);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile on world / interaction change.
  useEffect(() => {
    adapterRef.current?.render(world, interaction);
  }, [world, interaction]);

  return <div ref={containerRef} className="ks-poc__board" />;
}

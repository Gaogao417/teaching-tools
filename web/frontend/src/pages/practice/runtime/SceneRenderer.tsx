import type { Dispatch, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec } from "../../../../../shared/contracts";
import type { Side } from "../../../../../shared/triangleTrig";
import { edgeSideFromRef, findEntities, findEntity } from "./sceneUtils";
import { InteractionZoneLayer } from "./InteractionZoneLayer";

export function SceneRenderer({
  runtime,
  hoveredSide,
  onHoverSide,
  selectionTarget,
  setDraft,
}: {
  runtime: ExerciseRuntimeSpec;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  selectionTarget?: string;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
}) {
  if (runtime.instance.scene.sceneKind !== "triangle") {
    return <p>当前场景暂不支持渲染。</p>;
  }

  const triangle = findEntity(runtime.instance.scene.entities, "triangle");
  const edges = findEntities(runtime.instance.scene.entities, "edge");
  const vertices = findEntities(runtime.instance.scene.entities, "vertex");
  const vertexMap = Object.fromEntries(vertices.map((vertex) => [vertex.id, vertex])) as Record<
    string,
    typeof vertices[number]
  >;

  if (!triangle) {
    return <p>当前场景暂不支持渲染。</p>;
  }

  return (
    <svg viewBox="0 0 460 340" width="100%" height="100%" aria-label="直角三角形练习图">
      <polygon
        points={Object.values(triangle.vertices)
          .map((point) => `${point.x},${point.y}`)
          .join(" ")}
        fill="rgba(255,252,247,0.8)"
      />

      <InteractionZoneLayer
        entities={runtime.instance.scene.entities}
        zones={runtime.instance.scene.zones}
        hoveredSide={hoveredSide}
        onHoverSide={onHoverSide}
        selectionTarget={selectionTarget}
        setDraft={setDraft}
      />

      {edges.map((edge) => {
        const from = vertexMap[edge.from];
        const to = vertexMap[edge.to];
        const side = edgeSideFromRef(edge.id);
        const active = side && hoveredSide === side;

        return (
          <g key={edge.id}>
            <line
              x1={from?.x ?? 0}
              y1={from?.y ?? 0}
              x2={to?.x ?? 0}
              y2={to?.y ?? 0}
              stroke={active ? "var(--ink)" : "#b8c2cf"}
              strokeWidth={active ? 9 : 6}
              strokeLinecap="round"
              className={active ? "practice-edge-line is-emphasized" : "practice-edge-line"}
            />
            <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2} textAnchor="middle" className="practice-side-label">
              {edge.label}
            </text>
          </g>
        );
      })}

      <path d={triangle.rightAnglePath} stroke="#72808a" strokeWidth="4" fill="none" />
      <path d={triangle.referenceAnglePath} stroke="#72808a" strokeWidth="4" fill="none" />

      {vertices.map((vertex) => (
        <text key={vertex.id} x={vertex.x - 12} y={vertex.y + 6} className="vertex-label">
          {vertex.label}
        </text>
      ))}
    </svg>
  );
}

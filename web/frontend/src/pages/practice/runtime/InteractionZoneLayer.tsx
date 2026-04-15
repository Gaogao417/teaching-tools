import type { Dispatch, SetStateAction } from "react";
import type { ClientDraftState, ExerciseRuntimeSpec, SceneEntity } from "../../../../../shared/contracts";
import type { Side } from "../../../../../shared/triangleTrig";
import { edgeSideFromRef, findEntities } from "./sceneUtils";

export function InteractionZoneLayer({
  entities,
  zones,
  hoveredSide,
  onHoverSide,
  selectionTarget,
  setDraft,
}: {
  entities: SceneEntity[];
  zones: ExerciseRuntimeSpec["instance"]["scene"]["zones"];
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  selectionTarget?: string;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
}) {
  const vertices = findEntities(entities, "vertex");
  const vertexMap = Object.fromEntries(vertices.map((vertex) => [vertex.id, vertex])) as Record<
    string,
    typeof vertices[number]
  >;

  if (!selectionTarget) return null;

  return (
    <>
      {zones.map((zone) => {
        const side = edgeSideFromRef(zone.targetRef);
        if (!side) return null;

        if (zone.shape.type === "polygon") {
          return (
            <polygon
              key={zone.id}
              points={zone.shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
              className="practice-hit-zone diagonal is-interactive"
              onMouseEnter={() => onHoverSide(side)}
              onMouseLeave={() => onHoverSide(null)}
              onClick={() => {
                setDraft((current) => {
                  const previous = current.selections[selectionTarget] || [];
                  const next = previous.includes(side)
                    ? previous
                    : previous.length >= 2
                      ? [side]
                      : [...previous, side];

                  return {
                    ...current,
                    selections: { ...current.selections, [selectionTarget]: next },
                  };
                });
              }}
            />
          );
        }

        if (zone.shape.type !== "lineCorridor") return null;

        return (
          <line
            key={zone.id}
            x1={vertexMap[zone.shape.from]?.x ?? 0}
            y1={vertexMap[zone.shape.from]?.y ?? 0}
            x2={vertexMap[zone.shape.to]?.x ?? 0}
            y2={vertexMap[zone.shape.to]?.y ?? 0}
            strokeWidth={zone.shape.width}
            className={`practice-hit-zone line is-interactive${hoveredSide === side ? " is-hovered" : ""}`}
            onMouseEnter={() => onHoverSide(side)}
            onMouseLeave={() => onHoverSide(null)}
            onClick={() => {
              setDraft((current) => {
                const previous = current.selections[selectionTarget] || [];
                const next = previous.includes(side)
                  ? previous
                  : previous.length >= 2
                    ? [side]
                    : [...previous, side];

                return {
                  ...current,
                  selections: { ...current.selections, [selectionTarget]: next },
                };
              });
            }}
          />
        );
      })}
    </>
  );
}

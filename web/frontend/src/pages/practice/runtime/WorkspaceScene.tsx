import { Fragment, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FormulaSceneEntity,
  SceneAnchor,
  SceneEntity,
} from "../../../../../shared/contracts";
import type { Side } from "../../../../../shared/triangleTrig";
import {
  currentStep,
  edgeSideFromRef,
  findEntities,
  findEntity,
  orderedSelectionPreview,
} from "./sceneUtils";
import type { WorkspaceRendererProps } from "./workspaceRenderers";

type InputRefs = MutableRefObject<Record<string, HTMLInputElement | null>>;

type WorkspaceSceneProps = WorkspaceRendererProps & {
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
};

function FormulaEntity({
  entity,
  anchors,
  draft,
  setDraft,
  inputRefs,
}: {
  entity: FormulaSceneEntity;
  anchors: SceneAnchor[];
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
}) {
  if (!entity.slots?.length || entity.layout !== "fraction") return null;

  const slots = entity.slots
    .map((slotId) => anchors.find((anchor) => anchor.id === slotId))
    .filter((anchor): anchor is SceneAnchor => Boolean(anchor));

  if (slots.length < 2) return null;

  return (
    <div className="practice-formula-entity" style={{ left: `${entity.x || 0}px`, top: `${entity.y || 0}px` }}>
      <div className="practice-final-inline">
        <span>{entity.label}</span>
        <div className="practice-final-stack">
          {slots.map((slot, index) => (
            <Fragment key={slot.id}>
              <input
                ref={(node) => {
                  inputRefs.current[slot.id] = node;
                }}
                value={draft.inputs[slot.id] || ""}
                placeholder={slot.placeholder}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    inputs: { ...current.inputs, [slot.id]: event.target.value },
                  }))
                }
              />
              {index === 0 ? <div className="practice-final-bar" /> : null}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function InteractionZoneLayer({
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

function SceneRenderer({
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

function InputAnchorLayer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  inputTargets,
  onHoverSide,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  inputTargets: Set<string>;
  onHoverSide: (side: Side | null) => void;
}) {
  return (
    <>
      {runtime.instance.scene.anchors
        .filter((anchor) => anchor.anchorKind === "value-input" && inputTargets.has(anchor.id))
        .map((anchor) => {
          const side = edgeSideFromRef(anchor.entityRef);

          return (
            <input
              key={anchor.id}
              ref={(node) => {
                inputRefs.current[anchor.id] = node;
              }}
              className="practice-edge-input"
              style={{ left: `${anchor.x}px`, top: `${anchor.y}px` }}
              value={draft.inputs[anchor.id] || ""}
              placeholder={anchor.placeholder}
              onFocus={() => onHoverSide(side)}
              onBlur={() => onHoverSide(null)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, [anchor.id]: event.target.value },
                }))
              }
            />
          );
        })}
    </>
  );
}

function OverlayLayer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  canSubmitOrderedSelection,
  submitStepId,
  onSubmit,
  onClear,
  clearTarget,
}: {
  runtime: ExerciseRuntimeSpec;
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  canSubmitOrderedSelection: boolean;
  submitStepId?: string;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  clearTarget?: string;
}) {
  const texts = findEntities(runtime.instance.scene.entities, "text");
  const formulas = findEntities(runtime.instance.scene.entities, "formula");
  const inlineTexts = texts.filter((entity) => entity.variant === "inline-formula");
  const angleBadge = texts.find((entity) => entity.variant === "angle-badge");
  const selectionPreview = orderedSelectionPreview(runtime, draft);

  return (
    <>
      {angleBadge ? <div className="practice-angle-badge">{angleBadge.text}</div> : null}

      {formulas.map((entity) => (
        <FormulaEntity
          key={entity.id}
          entity={entity}
          anchors={runtime.instance.scene.anchors}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
        />
      ))}

      <div className="practice-workspace-footer">
        {selectionPreview ? (
          <div className="practice-fraction-preview">
            <div className={`practice-fraction-slot ${selectionPreview.numerator ? "filled" : "active"}`}>
              {selectionPreview.numerator || "第一项"}
            </div>
            <div className="practice-fraction-bar" />
            <div className={`practice-fraction-slot ${selectionPreview.denominator ? "filled" : ""}`}>
              {selectionPreview.denominator || "第二项"}
            </div>
          </div>
        ) : null}

        {inlineTexts.map((entity) => (
          <div key={entity.id} className="practice-inline-formula">
            {entity.text}
          </div>
        ))}

        <div className="practice-workspace-actions">
          <button className="tiny-btn" type="button" onClick={() => onClear(clearTarget)}>
            清空左侧步骤
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!submitStepId || !canSubmitOrderedSelection}
            onClick={() =>
              submitStepId &&
              onSubmit({
                stepId: submitStepId,
                value: JSON.stringify({
                  selections: draft.selections,
                  inputs: draft.inputs,
                }),
              })
            }
          >
            提交左侧步骤
          </button>
        </div>
      </div>
    </>
  );
}

function WorkspaceScene({
  runtime,
  draft,
  setDraft,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: WorkspaceSceneProps) {
  const step = currentStep(runtime);
  const selectAction = step.allowedActions.find((action) => action.type === "select");
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const submitAction = step.allowedActions.find((action) => action.type === "submit");
  const inputTargets = new Set(
    step.allowedActions.filter((action) => action.type === "input").map((action) => action.target),
  );
  const selected = selectAction?.type === "select" ? draft.selections[selectAction.target] || [] : [];
  const canSubmitOrderedSelection =
    selectAction?.type === "select" && selectAction.selectionKind === "ordered" ? selected.length >= 2 : true;

  return (
    <div className="practice-canvas-zone">
      <div className="practice-triangle-stage">
        <SceneRenderer
          runtime={runtime}
          hoveredSide={hoveredSide}
          onHoverSide={onHoverSide}
          selectionTarget={selectAction?.type === "select" ? selectAction.target : undefined}
          setDraft={setDraft}
        />

        <InputAnchorLayer
          runtime={runtime}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
          inputTargets={inputTargets}
          onHoverSide={onHoverSide}
        />

        <OverlayLayer
          runtime={runtime}
          draft={draft}
          setDraft={setDraft}
          inputRefs={inputRefs}
          canSubmitOrderedSelection={canSubmitOrderedSelection}
          submitStepId={submitAction?.type === "submit" ? submitAction.stepId : undefined}
          onSubmit={onSubmit}
          onClear={onClear}
          clearTarget={clearAction?.target || step.id}
        />
      </div>
    </div>
  );
}

export function TriangleTrigWorkspaceRenderer(props: WorkspaceRendererProps) {
  const [hoveredSide, setHoveredSide] = useState<Side | null>(null);

  return (
    <WorkspaceScene
      {...props}
      hoveredSide={hoveredSide}
      onHoverSide={setHoveredSide}
    />
  );
}

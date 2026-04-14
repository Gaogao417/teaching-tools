import { Fragment } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  FlowStep,
  FormulaSceneEntity,
  Role,
  SceneAnchor,
  SceneEntity,
  Side,
} from "../../../../shared/contracts";

type InputRefs = MutableRefObject<Record<string, HTMLInputElement | null>>;

type Props = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
  taskGroup?: string;
};

const ROLE_LABELS: Record<Role, string> = {
  opposite: "对边",
  adjacent: "邻边",
  hypotenuse: "斜边",
};

function edgeSideFromRef(ref?: string): Side | null {
  if (!ref) return null;
  if (ref.startsWith("edge-")) return ref.slice(5) as Side;
  if (ref.startsWith("side-")) return ref.slice(5) as Side;
  if (ref === "AB" || ref === "BC" || ref === "AC") return ref;
  return null;
}

function currentStep(runtime: ExerciseRuntimeSpec): FlowStep {
  return (
    runtime.instance.flow.steps.find((step) => step.id === runtime.runtimeState.currentStepId) ||
    runtime.instance.flow.steps[0]
  );
}

function findEntity<TKind extends SceneEntity["kind"]>(
  entities: SceneEntity[],
  kind: TKind,
): Extract<SceneEntity, { kind: TKind }> | undefined {
  return entities.find((entity): entity is Extract<SceneEntity, { kind: TKind }> => entity.kind === kind);
}

function findEntities<TKind extends SceneEntity["kind"]>(
  entities: SceneEntity[],
  kind: TKind,
): Array<Extract<SceneEntity, { kind: TKind }>> {
  return entities.filter((entity): entity is Extract<SceneEntity, { kind: TKind }> => entity.kind === kind);
}

function roleLabelForEdge(edgeId: string, entities: SceneEntity[]) {
  const edge = entities.find((entity): entity is Extract<SceneEntity, { kind: "edge" }> => entity.id === edgeId && entity.kind === "edge");
  if (!edge?.role) return edge?.label || edgeId.replace("edge-", "");
  return `${ROLE_LABELS[edge.role as Role]} (${edge.label || edge.id.replace("edge-", "")})`;
}

function meaningSelectionPreview(runtime: ExerciseRuntimeSpec, draft: ClientDraftState) {
  const step = currentStep(runtime);
  const selectAction = step.allowedActions.find((action) => action.type === "select");
  if (!selectAction || selectAction.selectionKind !== "ordered") return null;

  const selected = draft.selections[selectAction.target] || [];
  return (
    <div className="practice-fraction-preview">
      <div className={`practice-fraction-slot ${selected[0] ? "filled" : "active"}`}>
        {selected[0] ? roleLabelForEdge(`edge-${selected[0]}`, runtime.instance.scene.entities) : "第一项"}
      </div>
      <div className="practice-fraction-bar" />
      <div className={`practice-fraction-slot ${selected[1] ? "filled" : ""}`}>
        {selected[1] ? roleLabelForEdge(`edge-${selected[1]}`, runtime.instance.scene.entities) : "第二项"}
      </div>
    </div>
  );
}

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
    <div
      className="practice-formula-entity"
      style={{ left: `${entity.x || 0}px`, top: `${entity.y || 0}px` }}
    >
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

function TriangleScene({
  runtime,
  draft,
  setDraft,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: Omit<Props, "sessionPhase" | "taskGroup">) {
  const step = currentStep(runtime);
  const selectAction = step.allowedActions.find((action) => action.type === "select");
  const clearAction = step.allowedActions.find((action) => action.type === "clear");
  const inputTargets = new Set(step.allowedActions.filter((action) => action.type === "input").map((action) => action.target));
  const submitAction = step.allowedActions.find((action) => action.type === "submit");

  const scene = runtime.instance.scene;
  const triangle = findEntity(scene.entities, "triangle");
  const edges = findEntities(scene.entities, "edge");
  const vertices = findEntities(scene.entities, "vertex");
  const texts = findEntities(scene.entities, "text");
  const formulas = findEntities(scene.entities, "formula");
  const vertexMap = Object.fromEntries(vertices.map((vertex) => [vertex.id, vertex])) as Record<string, typeof vertices[number]>;

  if (!triangle) {
    return (
      <div className="practice-canvas-zone">
        <p>当前场景暂不支持渲染。</p>
      </div>
    );
  }

  const inlineTexts = texts.filter((entity) => entity.variant === "inline-formula");
  const angleBadge = texts.find((entity) => entity.variant === "angle-badge");

  const canSubmitOrderedSelection =
    selectAction?.type === "select" && selectAction.selectionKind === "ordered"
      ? (draft.selections[selectAction.target] || []).length >= 2
      : true;

  return (
    <div className="practice-canvas-zone">
      <div className="practice-triangle-stage">
        <svg viewBox="0 0 460 340" width="100%" height="100%" aria-label="直角三角形练习图">
          <polygon
            points={Object.values(triangle.vertices)
              .map((point) => `${point.x},${point.y}`)
              .join(" ")}
            fill="rgba(255,252,247,0.8)"
          />
          {scene.zones.map((zone) => {
            const side = edgeSideFromRef(zone.targetRef);
            const isInteractive = Boolean(selectAction && side);
            if (zone.shape.type === "polygon") {
              return (
                <polygon
                  key={zone.id}
                  points={zone.shape.points.map((point) => `${point.x},${point.y}`).join(" ")}
                  className="practice-hit-zone diagonal is-interactive"
                  onMouseEnter={() => side && onHoverSide(side)}
                  onMouseLeave={() => onHoverSide(null)}
                  onClick={() => {
                    if (!selectAction || !side || !isInteractive) return;
                    setDraft((current) => {
                      const previous = current.selections[selectAction.target] || [];
                      const next =
                        selectAction.selectionKind === "single"
                          ? [side]
                          : previous.includes(side)
                            ? previous
                            : previous.length >= 2
                              ? [side]
                              : [...previous, side];
                      return {
                        ...current,
                        selections: { ...current.selections, [selectAction.target]: next },
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
                className="practice-hit-zone line is-interactive"
                onMouseEnter={() => side && onHoverSide(side)}
                onMouseLeave={() => onHoverSide(null)}
                onClick={() => {
                  if (!selectAction || !side || !isInteractive) return;
                  setDraft((current) => {
                    const previous = current.selections[selectAction.target] || [];
                    const next =
                      selectAction.selectionKind === "single"
                        ? [side]
                        : previous.includes(side)
                          ? previous
                          : previous.length >= 2
                            ? [side]
                            : [...previous, side];
                    return {
                      ...current,
                      selections: { ...current.selections, [selectAction.target]: next },
                    };
                  });
                }}
              />
            );
          })}
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

        {scene.anchors
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

        {angleBadge ? <div className="practice-angle-badge">{angleBadge.text}</div> : null}
        {formulas.map((entity) => (
          <FormulaEntity
            key={entity.id}
            entity={entity}
            anchors={scene.anchors}
            draft={draft}
            setDraft={setDraft}
            inputRefs={inputRefs}
          />
        ))}

        <div className="practice-workspace-footer">
          {selectAction?.type === "select" ? meaningSelectionPreview(runtime, draft) : null}
          {inlineTexts.map((entity) => (
            <div key={entity.id} className="practice-inline-formula">
              {entity.text}
            </div>
          ))}
          <div className="practice-workspace-actions">
            <button className="tiny-btn" type="button" onClick={() => onClear(clearAction?.target || step.id)}>
              清空左侧步骤
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!submitAction || !canSubmitOrderedSelection}
              onClick={() =>
                submitAction &&
                onSubmit({
                  stepId: submitAction.stepId,
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
      </div>
    </div>
  );
}

function GuidePanel({
  runtime,
  sessionPhase,
  taskGroup,
}: Pick<Props, "runtime" | "sessionPhase" | "taskGroup">) {
  return (
    <aside className="practice-guide-zone">
      <div className="practice-guide-timeline">
        <div className="timeline-header">
          {taskGroup ? <span className="task-group-tag">{taskGroup}</span> : null}
          <div className="task-banner-text">{runtime.instance.guide.banner}</div>
          <h2 className="guide-prompt">{runtime.instance.prompt}</h2>
          {runtime.instance.guide.hint ? (
            <p className="guide-support-copy">{runtime.instance.guide.hint}</p>
          ) : null}
        </div>
        <div className="timeline-flow">
          {runtime.instance.guide.stepItems.map((step) => {
            const isCurrent = runtime.runtimeState.currentStepId === step.stepId;
            return (
              <div key={step.stepId} className={`step-flow-item ${step.status} ${isCurrent ? "current" : ""}`}>
                <div className="step-indicator" />
                <div className="step-content">
                  <strong>{step.title}</strong>
                  {(isCurrent || step.status === "active" || step.status === "done") && step.summary ? (
                    <p>{step.summary}</p>
                  ) : (
                    <p>请在左侧区域作答。</p>
                  )}
                  {isCurrent ? (
                    <div className={`step-inline-feedback ${sessionPhase}`}>
                      {runtime.instance.guide.statusCopy}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

export function ExerciseRuntimeHost(props: Props) {
  return (
    <>
      <TriangleScene
        runtime={props.runtime}
        draft={props.draft}
        setDraft={props.setDraft}
        inputRefs={props.inputRefs}
        hoveredSide={props.hoveredSide}
        onHoverSide={props.onHoverSide}
        onSubmit={props.onSubmit}
        onClear={props.onClear}
      />
      <GuidePanel runtime={props.runtime} sessionPhase={props.sessionPhase} taskGroup={props.taskGroup} />
    </>
  );
}

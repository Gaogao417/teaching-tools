import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ClientDraftState,
  ExerciseRuntimeSpec,
  GuidedSolveProblem,
  Problem,
  Role,
  Side,
} from "../../../../shared/contracts";
import { ROLE_LABELS, SIDE_SEQUENCE, sideMap } from "./renderers";

type InputRefs = MutableRefObject<Record<string, HTMLInputElement | null>>;

type Props = {
  problem: Problem;
  runtime: ExerciseRuntimeSpec;
  feedback: { tone: "idle" | "success" | "error"; title: string; body: string };
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  draft: ClientDraftState;
  setDraft: Dispatch<SetStateAction<ClientDraftState>>;
  inputRefs: InputRefs;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  onSubmit: (action: { stepId: string; value: string }) => void;
  onClear: (target?: string) => void;
};

function edgeRole(problem: Problem, side: Side): Role {
  const mapping = sideMap(problem.referenceAngle);
  return ((Object.keys(mapping) as Role[]).find((role) => mapping[role] === side) || "hypotenuse") as Role;
}

function currentGuidedStep(problem: GuidedSolveProblem) {
  return (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) ?? "final";
}

function selectedMeaningRoles(problem: Problem, draft: ClientDraftState) {
  const selectedSides = draft.selections["meaning-selection"] || [];
  return selectedSides.map((side) => ({
    side,
    role: edgeRole(problem, side as Side),
  }));
}

function TriangleBase({
  problem,
  hoveredSide,
  onHoverSide,
  onActivate,
}: {
  problem: Problem;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  onActivate?: (side: Side) => void;
}) {
  const workspace = problem.renderSchema.workspace;

  return (
    <svg
      viewBox={`0 0 ${workspace.stage.width} ${workspace.stage.height}`}
      width="100%"
      height="100%"
      aria-label="直角三角形练习图"
    >
      <polygon
        points={Object.values(workspace.vertices)
          .map((point) => `${point.x},${point.y}`)
          .join(" ")}
        fill="rgba(255,252,247,0.8)"
      />
      {workspace.sides.map((schema) => {
        const start = workspace.vertices[schema.side[0] as "A" | "B" | "C"];
        const end = workspace.vertices[schema.side[1] as "A" | "B" | "C"];
        const active = hoveredSide === schema.side;

        return (
          <g key={schema.side}>
            {schema.hitZone.kind === "polygon" ? (
              <polygon
                points={schema.hitZone.points.map((point) => `${point.x},${point.y}`).join(" ")}
                className="practice-hit-zone diagonal is-interactive"
                onMouseEnter={() => onHoverSide(schema.side)}
                onMouseLeave={() => onHoverSide(null)}
                onClick={() => onActivate?.(schema.side)}
              />
            ) : (
              <line
                x1={schema.hitZone.x1}
                y1={schema.hitZone.y1}
                x2={schema.hitZone.x2}
                y2={schema.hitZone.y2}
                strokeWidth={schema.hitZone.strokeWidth}
                className="practice-hit-zone line is-interactive"
                onMouseEnter={() => onHoverSide(schema.side)}
                onMouseLeave={() => onHoverSide(null)}
                onClick={() => onActivate?.(schema.side)}
              />
            )}
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke={active ? "var(--ink)" : "#b8c2cf"}
              strokeWidth={active ? 9 : 6}
              strokeLinecap="round"
              className={active ? "practice-edge-line is-emphasized" : "practice-edge-line"}
            />
            <text x={schema.label.x} y={schema.label.y} textAnchor="middle" className="practice-side-label">
              {schema.side}
            </text>
          </g>
        );
      })}
      <path d={workspace.rightAnglePath} stroke="#72808a" strokeWidth="4" fill="none" />
      <path d={workspace.referenceAnglePath} stroke="#72808a" strokeWidth="4" fill="none" />
      {(["A", "B", "C"] as const).map((vertex) => (
        <text key={vertex} x={workspace.vertices[vertex].x - 12} y={workspace.vertices[vertex].y + 6} className="vertex-label">
          {vertex}
        </text>
      ))}
    </svg>
  );
}

function MeaningWorkspace({
  problem,
  draft,
  setDraft,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: Props & { problem: Extract<Problem, { type: "meaning" }> }) {
  const selected = selectedMeaningRoles(problem, draft);
  const mapping = sideMap(problem.referenceAngle);

  return (
    <div className="practice-triangle-stage meaning">
      <TriangleBase
        problem={problem}
        hoveredSide={hoveredSide}
        onHoverSide={onHoverSide}
        onActivate={(side) => {
          setDraft((current) => {
            const previous = current.selections["meaning-selection"] || [];
            const next = previous.length >= 2 ? [side] : [...previous, side];
            return {
              ...current,
              selections: { ...current.selections, "meaning-selection": next },
            };
          });
        }}
      />
      <div className="practice-angle-badge">参考角 {problem.referenceAngle}</div>
      <div className="practice-role-legend">
        {Object.entries(mapping).map(([role, side]) => (
          <span key={role}>
            {ROLE_LABELS[role as Role]} = {side}
          </span>
        ))}
      </div>
      <div className="practice-workspace-footer">
        <div className="practice-fraction-preview">
          <div className={`practice-fraction-slot ${selected[0] ? "filled" : "active"}`}>
            {selected[0] ? `${ROLE_LABELS[selected[0].role]} (${selected[0].side})` : "分子边"}
          </div>
          <div className="practice-fraction-bar" />
          <div className={`practice-fraction-slot ${selected[1] ? "filled" : ""}`}>
            {selected[1] ? `${ROLE_LABELS[selected[1].role]} (${selected[1].side})` : "分母边"}
          </div>
        </div>
        <div className="practice-workspace-actions">
          <button className="tiny-btn" type="button" onClick={() => onClear("meaning-selection")}>
            清空左侧选择
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={selected.length < 2}
            onClick={() =>
              onSubmit({
                stepId: "pick-roles",
                value: `${selected[0].role}|${selected[1].role}`,
              })
            }
          >
            提交左侧答案
          </button>
        </div>
      </div>
    </div>
  );
}

function RatioWorkspace({
  problem,
  draft,
  setDraft,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: Props & { problem: Extract<Problem, { type: "ratioToSide" }> }) {
  return (
    <div className="practice-triangle-stage ratioToSide">
      <TriangleBase problem={problem} hoveredSide={hoveredSide} onHoverSide={onHoverSide} />
      {problem.renderSchema.workspace.sides.map((schema) => (
        <input
          key={schema.side}
          ref={(node) => {
            inputRefs.current[`side-${schema.side}`] = node;
          }}
          className="practice-edge-input"
          style={{
            left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
            top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
          }}
          value={draft.inputs[schema.side] || ""}
          onFocus={() => onHoverSide(schema.side)}
          onBlur={() => onHoverSide(null)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              inputs: { ...current.inputs, [schema.side]: event.target.value },
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmit({
                stepId: "fill-lengths",
                value: JSON.stringify({
                  AB: draft.inputs.AB || "",
                  BC: draft.inputs.BC || "",
                  AC: draft.inputs.AC || "",
                }),
              });
            }
          }}
        />
      ))}
      <div className="practice-angle-badge">参考角 {problem.referenceAngle}</div>
      <div className="practice-workspace-footer">
        <div className="practice-inline-formula">
          {problem.target.toUpperCase()} {problem.referenceAngle} = {problem.ratio.numerator}/{problem.ratio.denominator}
        </div>
        <div className="practice-workspace-actions">
          <button className="tiny-btn" type="button" onClick={() => onClear("edge-length")}>
            清空左侧输入
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() =>
              onSubmit({
                stepId: "fill-lengths",
                value: JSON.stringify({
                  AB: draft.inputs.AB || "",
                  BC: draft.inputs.BC || "",
                  AC: draft.inputs.AC || "",
                }),
              })
            }
          >
            提交左侧答案
          </button>
        </div>
      </div>
    </div>
  );
}

function GuidedWorkspace({
  problem,
  draft,
  setDraft,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onSubmit,
  onClear,
}: Props & { problem: GuidedSolveProblem }) {
  const step = currentGuidedStep(problem);
  const known = new Set(problem.given.map((item) => item.edge));
  const thirdSide = SIDE_SEQUENCE.find((side) => !known.has(side)) ?? "AC";

  return (
    <div className="practice-triangle-stage guidedSolve">
      <TriangleBase problem={problem} hoveredSide={hoveredSide} onHoverSide={onHoverSide} />
      {step === "ratio" &&
        problem.given.map((item) => {
          const schema = problem.renderSchema.workspace.sides.find((side) => side.side === item.edge);
          if (!schema) return null;
          return (
            <input
              key={item.role}
              ref={(node) => {
                inputRefs.current[`ratio-${item.role}`] = node;
              }}
              className="practice-edge-input"
              style={{
                left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
                top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
              }}
              value={draft.inputs[`ratio-${item.role}`] || ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, [`ratio-${item.role}`]: event.target.value },
                }))
              }
            />
          );
        })}
      {step === "third" &&
        (() => {
          const schema = problem.renderSchema.workspace.sides.find((side) => side.side === thirdSide);
          if (!schema) return null;
          return (
            <input
              ref={(node) => {
                inputRefs.current.third = node;
              }}
              className="practice-edge-input"
              style={{
                left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
                top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
              }}
              value={draft.inputs.third || ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, third: event.target.value },
                }))
              }
            />
          );
        })()}
      {step === "final" && (
        <div className="practice-final-inline">
          <span>
            {problem.target.toUpperCase()} {problem.referenceAngle} =
          </span>
          <div className="practice-final-stack">
            <input
              ref={(node) => {
                inputRefs.current["final-top"] = node;
              }}
              value={draft.inputs["final-top"] || ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, "final-top": event.target.value },
                }))
              }
            />
            <div className="practice-final-bar" />
            <input
              ref={(node) => {
                inputRefs.current["final-bottom"] = node;
              }}
              value={draft.inputs["final-bottom"] || ""}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  inputs: { ...current.inputs, "final-bottom": event.target.value },
                }))
              }
            />
          </div>
        </div>
      )}
      <div className="practice-angle-badge">参考角 {problem.referenceAngle}</div>
      <div className="practice-workspace-footer">
        <div className="practice-inline-formula">{runtimePrompt(problem)}</div>
        <div className="practice-workspace-actions">
          <button className="tiny-btn" type="button" onClick={() => onClear(step)}>
            清空左侧步骤
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              if (step === "ratio") {
                onSubmit({
                  stepId: "ratio",
                  value: JSON.stringify(
                    Object.fromEntries(problem.given.map((item) => [item.role, draft.inputs[`ratio-${item.role}`] || ""])),
                  ),
                });
                return;
              }
              if (step === "third") {
                onSubmit({
                  stepId: "third",
                  value: JSON.stringify({ third: draft.inputs.third || "" }),
                });
                return;
              }
              onSubmit({
                stepId: "final",
                value: JSON.stringify({
                  numerator: draft.inputs["final-top"] || "",
                  denominator: draft.inputs["final-bottom"] || "",
                }),
              });
            }}
          >
            提交左侧步骤
          </button>
        </div>
      </div>
    </div>
  );
}

function runtimePrompt(problem: Problem) {
  if (problem.type === "guidedSolve") {
    return `已知 ${problem.given.map((item) => `${item.edge}=${item.value}`).join("，")}`;
  }
  if (problem.type === "ratioToSide") {
    return `${problem.target.toUpperCase()} ${problem.referenceAngle} = ${problem.ratio.numerator}/${problem.ratio.denominator}`;
  }
  return problem.prompt;
}

function ContextualIsland({
  feedback,
  fallback,
}: {
  feedback: Props["feedback"];
  fallback: string;
}) {
  const title = feedback.tone === "idle" ? "下一步提示" : feedback.title;
  const message = feedback.tone === "idle" ? fallback : feedback.body;

  return (
    <div className={`contextual-island ${feedback.tone}`} aria-live="polite" aria-atomic="true">
      <span className="contextual-island-label">{title}</span>
      <p>{message}</p>
    </div>
  );
}

function GuidePanel({ runtime, sessionPhase }: { runtime: ExerciseRuntimeSpec; sessionPhase: Props["sessionPhase"] }) {
  return (
    <div className="modern-panel-stage">
      <span className="modern-panel-pill">{runtime.instance.taskId}</span>
      <div className="modern-step-list">
        {runtime.instance.guide.stepItems.map((step) => (
          <article key={step.stepId} className={`modern-step-card ${step.status} ${runtime.runtimeState.currentStepId === step.stepId ? "current" : ""}`}>
            <strong>{step.title}</strong>
            <p>{step.summary || (step.status === "done" ? "已完成。" : "等待当前步骤解锁。")}</p>
          </article>
        ))}
      </div>
      <div className={`modern-feedback-chip ${sessionPhase}`}>{runtime.instance.guide.statusCopy}</div>
    </div>
  );
}

export function ExerciseRuntimeHost(props: Props) {
  let workspace = <GuidedWorkspace {...props} problem={props.problem as GuidedSolveProblem} />;
  if (props.problem.type === "meaning") {
    workspace = <MeaningWorkspace {...props} problem={props.problem} />;
  } else if (props.problem.type === "ratioToSide") {
    workspace = <RatioWorkspace {...props} problem={props.problem} />;
  }

  return (
    <>
      <div className="practice-modern-canvas-card">
        <ContextualIsland feedback={props.feedback} fallback={props.runtime.instance.guide.hint || props.runtime.instance.prompt} />
        {workspace}
      </div>
      <div className="practice-modern-panel">
        <GuidePanel runtime={props.runtime} sessionPhase={props.sessionPhase} />
      </div>
    </>
  );
}

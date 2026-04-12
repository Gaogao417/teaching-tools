import type { Dispatch, MutableRefObject, ReactElement, ReactNode, SetStateAction } from "react";
import type {
  GuidedSolveProblem,
  MeaningProblem,
  Problem,
  Role,
  RatioToSideProblem,
  Side,
  TaskId,
  TriangleWorkspaceSideSchema,
} from "../../../../shared/contracts";

export const SIDE_SEQUENCE: Side[] = ["AB", "BC", "AC"];

export const ROLE_LABELS: Record<Role, string> = {
  opposite: "对边",
  adjacent: "邻边",
  hypotenuse: "斜边",
};

export const TASK_TITLE: Record<TaskId, string> = {
  meaning: "认清 sin / cos / tan / cot 的意思",
  ratioToSide: "已知三角比，把数字放到对应边上",
  guidedSolve: "已知两边，分步求三角比",
};

export type PracticeLocalState = {
  numeratorRole: Role | "";
  denominatorRole: Role | "";
  placements: Record<Side, string>;
  placementErrors: Record<Side, boolean>;
  guidedRatio: Record<string, string>;
  guidedRatioErrors: Record<string, boolean>;
  guidedThird: string;
  guidedThirdError: boolean;
  guidedFinal: { numerator: string; denominator: string };
  guidedFinalErrors: { numerator: boolean; denominator: boolean };
  meaningHintVisible: boolean;
  localHint: string;
  inlineStatus: { tone: "idle" | "success" | "error"; message: string };
};

export type PracticeInputRefs = MutableRefObject<Record<string, HTMLInputElement | null>>;

export function createEmptyLocalState(): PracticeLocalState {
  return {
    numeratorRole: "",
    denominatorRole: "",
    placements: { AB: "", BC: "", AC: "" },
    placementErrors: { AB: false, BC: false, AC: false },
    guidedRatio: {},
    guidedRatioErrors: {},
    guidedThird: "",
    guidedThirdError: false,
    guidedFinal: { numerator: "", denominator: "" },
    guidedFinalErrors: { numerator: false, denominator: false },
    meaningHintVisible: false,
    localHint: "",
    inlineStatus: { tone: "idle", message: "按当前步骤完成作答。" },
  };
}

export function sideMap(angle: "A" | "C"): Record<Role, Side> {
  if (angle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

export function roleForSide(angle: "A" | "C", side: Side): Role {
  const mapping = sideMap(angle);
  return (Object.entries(mapping).find(([, value]) => value === side)?.[0] ?? "hypotenuse") as Role;
}

export function currentGuidedStep(problem: GuidedSolveProblem) {
  return (["ratio", "third", "final"] as const).find((key) => !problem.stepState[key].done) ?? "final";
}

export function taskOrderLabel(taskId: TaskId) {
  if (taskId === "meaning") return "第 1 组";
  if (taskId === "ratioToSide") return "第 2 组";
  return "第 3 组";
}

export function buildDefaultHint(problem: Problem) {
  if (problem.type === "meaning") {
    return "先看参考角：贴着参考角的直角边是邻边，另一条直角边是对边，斜边始终对着直角。";
  }
  if (problem.type === "ratioToSide") {
    return "先根据参考角判断三条边分别是什么角色，再把比值放回边上。";
  }
  const step = currentGuidedStep(problem);
  if (step === "ratio") {
    return "先把两条已知边化成最简的 z 比。";
  }
  if (step === "third") {
    return "第三边要基于前一步的 z 比补出。";
  }
  return "最后一步把分子边和分母边代回目标三角比。";
}

export function buildActionBanner(problem: Problem, localState: PracticeLocalState) {
  if (problem.type === "meaning") {
    return localState.numeratorRole ? "当前任务：再选择分母边" : "当前任务：先选择分子边";
  }
  if (problem.type === "ratioToSide") {
    return "当前任务：在左侧教具上补全三边数值";
  }
  const step = currentGuidedStep(problem);
  if (step === "ratio") return "当前任务：在左侧输入最简 z 比";
  if (step === "third") return "当前任务：在左侧补出第三边";
  return "当前任务：在左侧填写目标三角比";
}

type RendererProps<TProblem extends Problem = Problem> = {
  problem: TProblem;
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
  localState: PracticeLocalState;
  setLocalState: Dispatch<SetStateAction<PracticeLocalState>>;
  inputRefs: PracticeInputRefs;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  onMeaningPick: (role: Role) => void;
  onFocusSide: (side: Side) => void;
  onSubmitRatio: () => void;
  onSubmitGuided: () => void;
};

type GuideProps<TProblem extends Problem = Problem> = Pick<RendererProps<TProblem>, "problem" | "sessionPhase" | "localState">;

export type TaskRenderer = {
  Workspace: (props: RendererProps<any>) => ReactElement;
  Guide: (props: GuideProps<any>) => ReactElement;
};

function sideColor(role: Role) {
  if (role === "opposite") return "var(--role-opposite)";
  if (role === "adjacent") return "var(--role-adjacent)";
  return "var(--role-hypotenuse)";
}

function renderHitZone(
  schema: TriangleWorkspaceSideSchema,
  isInteractive: boolean,
  onHoverSide: (side: Side | null) => void,
  onActivate: () => void,
) {
  const common = {
    className: `practice-hit-zone ${schema.hitZone.kind === "polygon" ? "diagonal" : "line"} ${isInteractive ? "is-interactive" : ""}`,
    onMouseEnter: () => onHoverSide(schema.side),
    onMouseLeave: () => onHoverSide(null),
    onFocus: () => onHoverSide(schema.side),
    onBlur: () => onHoverSide(null),
    onClick: onActivate,
    tabIndex: isInteractive ? 0 : -1,
    role: isInteractive ? "button" : undefined,
    "aria-label": isInteractive ? `${schema.side} ${ROLE_LABELS[schema.role]}` : undefined,
  };
  if (schema.hitZone.kind === "polygon") {
    return (
      <polygon
        {...common}
        points={schema.hitZone.points.map((point) => `${point.x},${point.y}`).join(" ")}
      />
    );
  }
  return (
    <line
      {...common}
      x1={schema.hitZone.x1}
      y1={schema.hitZone.y1}
      x2={schema.hitZone.x2}
      y2={schema.hitZone.y2}
      strokeWidth={schema.hitZone.strokeWidth}
    />
  );
}

function MeaningWorkspace({
  problem,
  localState,
  hoveredSide,
  onHoverSide,
  onMeaningPick,
}: RendererProps<MeaningProblem>) {
  const mapping = sideMap(problem.referenceAngle);
  return (
    <div className={`practice-triangle-stage ${problem.type}`}>
      <TriangleBase problem={problem} hoveredSide={hoveredSide} onHoverSide={onHoverSide}>
        {problem.renderSchema.workspace.sides.map((schema) => {
          const active =
            localState.numeratorRole === schema.role || localState.denominatorRole === schema.role || hoveredSide === schema.side;
          return (
            <g key={schema.side}>
              {renderHitZone(schema, true, onHoverSide, () => onMeaningPick(schema.role))}
              <line
                x1={problem.renderSchema.workspace.vertices[schema.side[0] as "A" | "B" | "C"]?.x ?? 0}
                y1={problem.renderSchema.workspace.vertices[schema.side[0] as "A" | "B" | "C"]?.y ?? 0}
                x2={problem.renderSchema.workspace.vertices[schema.side[1] as "A" | "B" | "C"]?.x ?? 0}
                y2={problem.renderSchema.workspace.vertices[schema.side[1] as "A" | "B" | "C"]?.y ?? 0}
                stroke={active ? sideColor(schema.role) : "#b8c2cf"}
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
      </TriangleBase>
      <div className="practice-angle-badge">参考角 {problem.referenceAngle}</div>
      <div className="practice-role-legend">
        {Object.entries(mapping).map(([role, side]) => (
          <span key={role}>{ROLE_LABELS[role as Role]} = {side}</span>
        ))}
      </div>
      <div className="practice-workspace-footer">
        <div className="practice-fraction-preview">
          <div className={`practice-fraction-slot ${localState.numeratorRole ? "filled" : "active"}`}>
            {localState.numeratorRole ? `${ROLE_LABELS[localState.numeratorRole]} (${mapping[localState.numeratorRole]})` : "分子边 ?"}
          </div>
          <div className="practice-fraction-bar" />
          <div className={`practice-fraction-slot ${localState.denominatorRole ? "filled" : ""}`}>
            {localState.denominatorRole ? `${ROLE_LABELS[localState.denominatorRole]} (${mapping[localState.denominatorRole]})` : "分母边 ?"}
          </div>
        </div>
      </div>
    </div>
  );
}

function RatioWorkspace({
  problem,
  localState,
  setLocalState,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onFocusSide,
  onSubmitRatio,
}: RendererProps<RatioToSideProblem>) {
  const values = { ...localState.placements };
  return (
    <div className={`practice-triangle-stage ${problem.type}`}>
      <TriangleBase problem={problem} hoveredSide={hoveredSide} onHoverSide={onHoverSide}>
        {problem.renderSchema.workspace.sides.map((schema) => {
          const active = hoveredSide === schema.side || Boolean(values[schema.side]);
          return (
            <g key={schema.side}>
              {renderHitZone(schema, true, onHoverSide, () => onFocusSide(schema.side))}
              <EdgeStroke problem={problem} schema={schema} active={active} solved={Boolean(values[schema.side])} />
              <text x={schema.label.x} y={schema.label.y} textAnchor="middle" className="practice-side-label">
                {schema.side}{values[schema.side] ? ` ${values[schema.side]}` : ""}
              </text>
            </g>
          );
        })}
      </TriangleBase>
      {problem.renderSchema.workspace.sides.map((schema) => (
        <input
          key={schema.side}
          ref={(node) => {
            inputRefs.current[`side-${schema.side}`] = node;
          }}
          className={`practice-edge-input ${localState.placementErrors[schema.side] ? "is-error" : ""}`}
          style={{
            left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
            top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
          }}
          value={localState.placements[schema.side]}
          onFocus={() => onHoverSide(schema.side)}
          onBlur={() => onHoverSide(null)}
          onChange={(event) =>
            setLocalState((current) => ({
              ...current,
              placements: { ...current.placements, [schema.side]: event.target.value },
              placementErrors: { ...current.placementErrors, [schema.side]: false },
            }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSubmitRatio();
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
          <button
            className="tiny-btn"
            type="button"
            onClick={() =>
              setLocalState((current) => ({
                ...current,
                placements: { AB: "", BC: "", AC: "" },
                placementErrors: { AB: false, BC: false, AC: false },
              }))
            }
          >
            清空左侧输入
          </button>
          <button className="btn btn-primary" type="button" onClick={onSubmitRatio}>
            提交左侧答案
          </button>
        </div>
      </div>
    </div>
  );
}

function GuidedWorkspace({
  problem,
  localState,
  setLocalState,
  inputRefs,
  hoveredSide,
  onHoverSide,
  onFocusSide,
  onSubmitGuided,
}: RendererProps<GuidedSolveProblem>) {
  const step = currentGuidedStep(problem);
  const values: Record<Side, string> = { AB: "", BC: "", AC: "" };
  problem.given.forEach((item) => {
    values[item.edge] = item.value;
  });
  if (step === "ratio") {
    problem.given.forEach((item) => {
      values[item.edge] = localState.guidedRatio[item.role] || "";
    });
  }
  if (step === "third") {
    const known = new Set(problem.given.map((item) => item.edge));
    const thirdSide = SIDE_SEQUENCE.find((side) => !known.has(side)) ?? "AC";
    values[thirdSide] = localState.guidedThird;
  }
  return (
    <div className={`practice-triangle-stage ${problem.type}`}>
      <TriangleBase problem={problem} hoveredSide={hoveredSide} onHoverSide={onHoverSide}>
        {problem.renderSchema.workspace.sides.map((schema) => {
          const active = hoveredSide === schema.side || Boolean(values[schema.side]);
          return (
            <g key={schema.side}>
              {renderHitZone(schema, step !== "final", onHoverSide, () => onFocusSide(schema.side))}
              <EdgeStroke
                problem={problem}
                schema={schema}
                active={active}
                solved={problem.stepState.final.done || Boolean(values[schema.side])}
              />
              <text x={schema.label.x} y={schema.label.y} textAnchor="middle" className="practice-side-label">
                {schema.side}{values[schema.side] ? ` ${values[schema.side]}` : ""}
              </text>
            </g>
          );
        })}
      </TriangleBase>
      {step === "ratio" &&
        problem.given.map((item) => {
          const schema = problem.renderSchema.workspace.sides.find((side) => side.side === item.edge);
          if (!schema) return null;
          return (
            <input
              key={item.edge}
              ref={(node) => {
                inputRefs.current[`ratio-${item.role}`] = node;
              }}
              className={`practice-edge-input ${localState.guidedRatioErrors[item.role] ? "is-error" : ""}`}
              style={{
                left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
                top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
              }}
              value={localState.guidedRatio[item.role] || ""}
              onFocus={() => onHoverSide(schema.side)}
              onBlur={() => onHoverSide(null)}
              onChange={(event) =>
                setLocalState((current) => ({
                  ...current,
                  guidedRatio: { ...current.guidedRatio, [item.role]: event.target.value },
                  guidedRatioErrors: { ...current.guidedRatioErrors, [item.role]: false },
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitGuided();
                }
              }}
            />
          );
        })}
      {step === "third" && (() => {
        const known = new Set(problem.given.map((item) => item.edge));
        const thirdSide = SIDE_SEQUENCE.find((side) => !known.has(side)) ?? "AC";
        const schema = problem.renderSchema.workspace.sides.find((side) => side.side === thirdSide);
        if (!schema) return null;
        return (
          <input
            ref={(node) => {
              inputRefs.current.third = node;
            }}
            className={`practice-edge-input ${localState.guidedThirdError ? "is-error" : ""}`}
            style={{
              left: `${(schema.input.x / problem.renderSchema.workspace.stage.width) * 100}%`,
              top: `${(schema.input.y / problem.renderSchema.workspace.stage.height) * 100}%`,
            }}
            value={localState.guidedThird}
            onFocus={() => onHoverSide(schema.side)}
            onBlur={() => onHoverSide(null)}
            onChange={(event) =>
              setLocalState((current) => ({
                ...current,
                guidedThird: event.target.value,
                guidedThirdError: false,
              }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmitGuided();
              }
            }}
          />
        );
      })()}
      {step === "final" && (
        <div className="practice-final-inline">
          <span>{problem.target.toUpperCase()} {problem.referenceAngle} =</span>
          <div className="practice-final-stack">
            <input
              ref={(node) => {
                inputRefs.current["final-top"] = node;
              }}
              className={localState.guidedFinalErrors.numerator ? "is-error" : ""}
              value={localState.guidedFinal.numerator}
              onChange={(event) =>
                setLocalState((current) => ({
                  ...current,
                  guidedFinal: { ...current.guidedFinal, numerator: event.target.value },
                  guidedFinalErrors: { ...current.guidedFinalErrors, numerator: false },
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitGuided();
                }
              }}
            />
            <div className="practice-final-bar" />
            <input
              ref={(node) => {
                inputRefs.current["final-bottom"] = node;
              }}
              className={localState.guidedFinalErrors.denominator ? "is-error" : ""}
              value={localState.guidedFinal.denominator}
              onChange={(event) =>
                setLocalState((current) => ({
                  ...current,
                  guidedFinal: { ...current.guidedFinal, denominator: event.target.value },
                  guidedFinalErrors: { ...current.guidedFinalErrors, denominator: false },
                }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSubmitGuided();
                }
              }}
            />
          </div>
        </div>
      )}
      <div className="practice-angle-badge">参考角 {problem.referenceAngle}</div>
      <div className="practice-workspace-footer">
        <div className="practice-inline-formula">
          已知 {problem.given.map((item) => `${item.edge}=${item.value}`).join("，")}
        </div>
        <div className="practice-workspace-actions">
          <button
            className="tiny-btn"
            type="button"
            onClick={() =>
              setLocalState((current) => ({
                ...current,
                guidedRatio: {},
                guidedRatioErrors: {},
                guidedThird: "",
                guidedThirdError: false,
                guidedFinal: { numerator: "", denominator: "" },
                guidedFinalErrors: { numerator: false, denominator: false },
              }))
            }
          >
            清空左侧步骤
          </button>
          <button className="btn btn-primary" type="button" onClick={onSubmitGuided}>
            提交左侧步骤
          </button>
        </div>
      </div>
    </div>
  );
}

function MeaningGuide({ problem, sessionPhase, localState }: GuideProps<MeaningProblem>) {
  const mapping = sideMap(problem.referenceAngle);
  return (
    <div className="modern-panel-stage">
      <span className="modern-panel-pill">{taskOrderLabel(problem.type)}</span>
      <h2>{problem.renderSchema.guide.title}</h2>
      <p className="text-muted">{problem.renderSchema.guide.body}</p>
      <div className="modern-fraction-card">
        <div className={`modern-fraction-slot ${localState.numeratorRole ? "filled" : "active"}`}>
          {localState.numeratorRole ? `${ROLE_LABELS[localState.numeratorRole]} (${mapping[localState.numeratorRole]})` : "分子边 ?"}
        </div>
        <div className="modern-fraction-bar" />
        <div className={`modern-fraction-slot ${localState.denominatorRole ? "filled" : ""}`}>
          {localState.denominatorRole ? `${ROLE_LABELS[localState.denominatorRole]} (${mapping[localState.denominatorRole]})` : "分母边 ?"}
        </div>
      </div>
      <GuideStepList problem={problem} sessionPhase={sessionPhase} />
    </div>
  );
}

function RatioGuide({ problem, sessionPhase }: GuideProps<RatioToSideProblem>) {
  return (
    <div className="modern-panel-stage">
      <span className="modern-panel-pill">{taskOrderLabel(problem.type)}</span>
      <h2>{problem.renderSchema.guide.title}</h2>
      <p className="text-muted">{problem.renderSchema.guide.body}</p>
      <GuideStepList problem={problem} sessionPhase={sessionPhase} />
    </div>
  );
}

function GuidedGuide({ problem, sessionPhase }: GuideProps<GuidedSolveProblem>) {
  return (
    <div className="modern-panel-stage">
      <span className="modern-panel-pill">{taskOrderLabel(problem.type)}</span>
      <h2>{problem.renderSchema.guide.title}</h2>
      <p className="text-muted">{problem.renderSchema.guide.body}</p>
      <GuideStepList problem={problem} sessionPhase={sessionPhase} />
    </div>
  );
}

function GuideStepList({
  problem,
  sessionPhase,
}: {
  problem: Problem;
  sessionPhase: "answering" | "correct_pause" | "wrong_feedback" | "group_finished";
}) {
  return (
    <div className="modern-step-list">
      {problem.renderSchema.guide.steps.map((step) => (
        <div
          key={step.id}
          className={`modern-step-card ${step.status === "done" ? "done" : step.status === "active" ? "active" : "pending"} ${sessionPhase === "wrong_feedback" && step.status === "active" ? "needs-attention" : ""}`}
        >
          <strong>{step.title}</strong>
          <span>{step.body}</span>
        </div>
      ))}
    </div>
  );
}

function TriangleBase({
  problem,
  hoveredSide,
  onHoverSide,
  children,
}: {
  problem: Problem;
  hoveredSide: Side | null;
  onHoverSide: (side: Side | null) => void;
  children: ReactNode;
}) {
  const workspace = problem.renderSchema.workspace;
  return (
    <svg viewBox={`0 0 ${workspace.stage.width} ${workspace.stage.height}`} width="100%" aria-label="直角三角形教具">
      <defs>
        <pattern id="practice-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#practice-grid)" />
      <polygon
        points={`${workspace.vertices.A.x},${workspace.vertices.A.y} ${workspace.vertices.B.x},${workspace.vertices.B.y} ${workspace.vertices.C.x},${workspace.vertices.C.y}`}
        fill="rgba(255,252,247,0.88)"
      />
      <path d={workspace.rightAnglePath} stroke="#94a3b8" strokeWidth="2" fill="none" />
      <path d={workspace.referenceAnglePath} stroke="var(--primary)" strokeWidth="3" fill="none" />
      {children}
      <circle cx={workspace.vertices.A.x} cy={workspace.vertices.A.y} r="9" className="practice-vertex-dot" />
      <circle cx={workspace.vertices.B.x} cy={workspace.vertices.B.y} r="9" className="practice-vertex-dot" />
      <circle cx={workspace.vertices.C.x} cy={workspace.vertices.C.y} r="9" className="practice-vertex-dot" />
      <text x={64} y={302} className="practice-vertex-label">A</text>
      <text x={332} y={302} className="practice-vertex-label">B</text>
      <text x={332} y={104} className="practice-vertex-label">C</text>
      {hoveredSide && (
        <text x={workspace.stage.width - 16} y={28} textAnchor="end" className="practice-hover-note">
          当前悬停：{hoveredSide}
        </text>
      )}
    </svg>
  );
}

function EdgeStroke({
  problem,
  schema,
  active,
  solved,
}: {
  problem: Problem;
  schema: TriangleWorkspaceSideSchema;
  active: boolean;
  solved: boolean;
}) {
  const vertices = problem.renderSchema.workspace.vertices;
  const [from, to] = schema.side.split("") as Array<"A" | "B" | "C">;
  return (
    <line
      x1={vertices[from].x}
      y1={vertices[from].y}
      x2={vertices[to].x}
      y2={vertices[to].y}
      stroke={active || solved ? sideColor(schema.role) : "#b8c2cf"}
      strokeWidth={active ? 9 : solved ? 7 : 6}
      strokeLinecap="round"
      className={`practice-edge-line ${active ? "is-emphasized" : ""} ${solved ? "is-solved" : ""}`}
    />
  );
}

export const TASK_RENDERERS: Record<TaskId, TaskRenderer> = {
  meaning: {
    Workspace: MeaningWorkspace,
    Guide: MeaningGuide,
  },
  ratioToSide: {
    Workspace: RatioWorkspace,
    Guide: RatioGuide,
  },
  guidedSolve: {
    Workspace: GuidedWorkspace,
    Guide: GuidedGuide,
  },
};

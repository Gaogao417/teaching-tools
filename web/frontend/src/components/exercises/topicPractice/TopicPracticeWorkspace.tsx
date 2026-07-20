import type { ChangeEvent } from "react";
import type { TopicGeometryModel, TopicGeometryPoint, TopicGeometrySegment } from "../../../../../shared/topicPractice";
import { MathText } from "../../math/MathText";
import { currentStep } from "../../../pages/practice/runtime/sceneUtils";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";

function pointById(geometry: TopicGeometryModel, id: string): TopicGeometryPoint | undefined {
  return geometry.points.find((point) => point.id === id);
}

function parseLabels(value: string): Record<string, string> {
  return Object.fromEntries(value.split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return index < 0 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
  }));
}

function serializeLabels(labels: Record<string, string>) {
  return Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)).map(([segment, value]) => `${segment}=${value}`).join(";");
}

function GeometryCanvas({
  geometry,
  image,
  selectedPoints,
  selectedSegments,
  allowPoints,
  allowSegments,
  onPoint,
  onSegment,
}: {
  geometry?: TopicGeometryModel;
  image?: string;
  selectedPoints: string[];
  selectedSegments: string[];
  allowPoints: boolean;
  allowSegments: boolean;
  onPoint: (id: string) => void;
  onSegment: (id: string) => void;
}) {
  if (!image) return <div className="artifact-equation-focus">题图解析中</div>;
  if (!geometry) return <img src={image} alt="题图" />;
  return (
    <div className="topic-geometry-canvas" style={{ aspectRatio: `${geometry.viewBox.width} / ${geometry.viewBox.height}` }}>
      <img src={image} alt="题图" />
      <svg viewBox={`0 0 ${geometry.viewBox.width} ${geometry.viewBox.height}`} aria-label="可交互题图">
        {[...geometry.segments].sort((left, right) => Number(selectedSegments.includes(left.id)) - Number(selectedSegments.includes(right.id))).map((segment: TopicGeometrySegment) => {
          const from = pointById(geometry, segment.from);
          const to = pointById(geometry, segment.to);
          if (!from || !to) return null;
          const selected = selectedSegments.includes(segment.id);
          return (
            <line
              key={segment.id}
              className={`topic-hit-segment ${selected ? "is-selected" : ""}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              vectorEffect="non-scaling-stroke"
              onClick={() => allowSegments && onSegment(segment.id)}
              aria-label={`线段 ${segment.id}`}
            />
          );
        })}
        {geometry.points.map((point) => (
          <g key={point.id} className={`topic-hit-point ${selectedPoints.includes(point.id) ? "is-selected" : ""}`}>
            <circle role="button" aria-label={`点 ${point.id}`} cx={point.x} cy={point.y} r="4.5" onClick={() => allowPoints && onPoint(point.id)} />
            {selectedPoints.includes(point.id) ? <text x={point.x + 8} y={point.y - 8}>{point.id}</text> : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function TopicPracticeWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  readOnly,
}: WorkspaceRendererProps) {
  const model = runtime.instance.scene.topicWorkspace;
  const runtimeStep = currentStep(runtime);
  const inputAction = runtimeStep.allowedActions.find((action) => action.type === "input");
  if (!model || inputAction?.type !== "input") return <div className="practice-canvas-zone" />;

  const contract = model.contracts[runtime.runtimeState.currentStepId] || model.contracts[model.activeStepId];
  if (!contract) return <div className="practice-canvas-zone" />;
  const ordered = Object.values(model.contracts);
  const completed = ordered.filter((item) => model.completedStepIds.includes(item.id));
  const visibleDiagram = [...completed].reverse().find((item) => item.diagramAsset)?.diagramAsset || model.promptDiagramAsset;
  const geometry = contract.interaction?.geometry || model.promptGeometry;
  const selected = draft.inputs[inputAction.target] || "";
  const setValue = (value: string) => setDraft((current) => ({
    ...current,
    inputs: { ...current.inputs, [inputAction.target]: value },
  }));

  const labels = contract.primitive === "mark-segments" ? parseLabels(selected) : {};
  const ratioSegments = contract.primitive === "mark-ratio" ? selected.split(",").filter(Boolean) : [];
  const equationParts = contract.primitive === "equation" ? selected.split("|") : [];
  const equationPrefix = equationParts[0]?.split("=")[1] || "";
  const equationSegments = equationPrefix.split("*").filter(Boolean);
  const equationResult = equationParts[1] || "";
  const constructParts = Object.fromEntries(selected.split("|").filter(Boolean).map((part) => {
    const index = part.indexOf(":");
    return [part.slice(0, index), part.slice(index + 1)];
  }));
  const carrierPoints = constructParts.carrier?.split(",").filter(Boolean) || [];

  const handleSegment = (segmentId: string) => {
    if (readOnly) return;
    if (contract.primitive === "mark-segments") {
      const next = { ...labels };
      if (segmentId in next) delete next[segmentId];
      else next[segmentId] = "";
      setValue(serializeLabels(next));
      return;
    }
    if (contract.primitive === "mark-ratio") {
      if (ratioSegments.includes(segmentId)) {
        setValue(ratioSegments.filter((item) => item !== segmentId).join(","));
        return;
      }
      if (ratioSegments.length >= 4) return;
      setValue([...ratioSegments, segmentId].join(","));
      return;
    }
    if (contract.primitive === "equation") {
      if (equationSegments.length >= 3) return;
      const target = contract.interaction?.equation?.targetLatex || "未知";
      setValue(`${[...target].sort().join("")}=${[...equationSegments, segmentId].join("*")}|${equationResult}`);
      return;
    }
    if (contract.primitive === "construct-parallel" && constructParts.point && !constructParts.parallel) {
      setValue(`point:${constructParts.point}|parallel:${segmentId}`);
    }
  };

  const handlePoint = (pointId: string) => {
    if (readOnly || contract.primitive !== "construct-parallel") return;
    if (!constructParts.point) {
      setValue(`point:${pointId}`);
      return;
    }
    if (!constructParts.parallel || pointId === constructParts.point || carrierPoints.includes(pointId) || carrierPoints.length >= 2) return;
    const nextCarrier = [...carrierPoints, pointId];
    setValue(`point:${constructParts.point}|parallel:${constructParts.parallel}|carrier:${nextCarrier.join(",")}`);
  };

  const selectedSegments = contract.primitive === "mark-segments"
    ? Object.keys(labels)
    : contract.primitive === "mark-ratio"
      ? ratioSegments
      : contract.primitive === "equation"
        ? equationSegments
        : constructParts.parallel ? [constructParts.parallel] : [];
  const selectedPoints = contract.primitive === "construct-parallel"
    ? [constructParts.point, ...carrierPoints].filter(Boolean)
    : [];

  return (
    <div className="practice-canvas-zone topic-practice-canvas artifact-topic-canvas">
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage">
          <GeometryCanvas
            geometry={geometry}
            image={visibleDiagram}
            selectedPoints={selectedPoints}
            selectedSegments={selectedSegments}
            allowPoints={contract.primitive === "construct-parallel"}
            allowSegments={["construct-parallel", "mark-segments", "mark-ratio", "equation"].includes(contract.primitive)}
            onPoint={handlePoint}
            onSegment={handleSegment}
          />
        </section>
      </div>

      <section className="topic-answer-panel artifact-action-workbench">
        <div className="topic-answer-copy">
          <h3>{contract.title}</h3>
          <MathText value={contract.promptLatex} block />
        </div>

        {contract.primitive === "construct-parallel" ? (
          <div className="topic-action-slots">
            <span className={constructParts.point ? "is-filled" : ""}>① 顶点 {constructParts.point || "—"}</span>
            <span className={constructParts.parallel ? "is-filled" : ""}>② 平行于 {constructParts.parallel || "—"}</span>
            <span className={carrierPoints[0] ? "is-filled" : ""}>③ 外点 {carrierPoints[0] || "—"}</span>
            <span className={carrierPoints[1] ? "is-filled" : ""}>④ 外点 {carrierPoints[1] || "—"}</span>
          </div>
        ) : null}

        {contract.primitive === "mark-segments" ? (
          <div className="topic-label-editor">
            {Object.entries(labels).map(([segment, value]) => (
              <div className="topic-label-item" key={segment}>
                <strong>{segment}</strong>
                <input aria-label={`${segment} 的标注`} value={value} onChange={(event) => setValue(serializeLabels({ ...labels, [segment]: event.target.value }))} placeholder="填数字" />
                <button type="button" aria-label={`取消选择 ${segment}`} title={`取消选择 ${segment}`} onClick={() => {
                  const next = { ...labels };
                  delete next[segment];
                  setValue(serializeLabels(next));
                }}>×</button>
              </div>
            ))}
          </div>
        ) : null}

        {contract.primitive === "mark-ratio" ? (
          <div className="topic-ratio-builder">
            <span>{ratioSegments[0] || "点线段"}</span><b>:</b><span>{ratioSegments[1] || "点线段"}</span>
            <b>=</b>
            <span>{ratioSegments[2] || "点线段"}</span><b>:</b><span>{ratioSegments[3] || "点线段"}</span>
          </div>
        ) : null}

        {contract.primitive === "equation" && contract.interaction?.equation ? (
          <div className="topic-equation-builder">
            <strong>{contract.interaction.equation.targetLatex}</strong><span>=</span>
            <button type="button" className={equationSegments[0] ? "is-filled" : ""} onClick={() => equationSegments[0] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.slice(1).join("*")}|${equationResult}`)}>{equationSegments[0] || "点已知边"}</button><span>×</span>
            <span className="topic-fraction">
              <button type="button" className={equationSegments[1] ? "is-filled" : ""} onClick={() => equationSegments[1] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.filter((_, index) => index !== 1).join("*")}|${equationResult}`)}>{equationSegments[1] || "点未知份数边"}</button>
              <button type="button" className={equationSegments[2] ? "is-filled" : ""} onClick={() => equationSegments[2] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.slice(0, 2).join("*")}|${equationResult}`)}>{equationSegments[2] || "点已知份数边"}</button>
            </span>
            <span>=</span>
            <input value={equationResult} onChange={(event) => {
              const target = [...contract.interaction!.equation!.targetLatex].sort().join("");
              setValue(`${target}=${equationSegments.join("*")}|${event.target.value}`);
            }} placeholder="结果" />
          </div>
        ) : null}

        {contract.primitive === "select" ? (
          <div className="topic-choice-grid">{contract.options?.map((option) => <button key={option.value} type="button" className={selected === option.value ? "is-selected" : ""} onClick={() => setValue(option.value)}><MathText value={option.labelLatex} block /></button>)}</div>
        ) : null}

        {contract.primitive === "input" ? (
          <label className="topic-free-input"><span className="sr-only">{contract.title}</span><input ref={(node) => { inputRefs.current[inputAction.target] = node; }} value={selected} onChange={(event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value)} placeholder="写出规范答案" autoComplete="off" /></label>
        ) : null}
      </section>
    </div>
  );
}

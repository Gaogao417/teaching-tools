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
  labels,
  ratioSegments,
  activeLabelId,
  wrongObjectIds,
  availableSegmentIds,
  availablePointIds,
  constructionPreview,
  allowPoints,
  allowSegments,
  onPoint,
  onSegment,
  onLabelChange,
}: {
  geometry?: TopicGeometryModel;
  image?: string;
  selectedPoints: string[];
  selectedSegments: string[];
  labels: Record<string, string>;
  ratioSegments: string[];
  activeLabelId?: string;
  wrongObjectIds: string[];
  availableSegmentIds?: string[];
  availablePointIds?: string[];
  constructionPreview?: { throughPoint?: string; parallelSegment?: string; carrierPoints: string[]; resultPoint?: string };
  allowPoints: boolean;
  allowSegments: boolean;
  onPoint: (id: string) => void;
  onSegment: (id: string) => void;
  onLabelChange: (id: string, value: string) => void;
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
          const interactive = allowSegments && (!availableSegmentIds || availableSegmentIds.includes(segment.id));
          return (
            <line
              key={segment.id}
              role="button"
              tabIndex={interactive ? 0 : -1}
              className={`topic-hit-segment ${selected ? "is-selected" : ""} ${wrongObjectIds.includes(segment.id) ? "is-wrong" : ""} ${interactive ? "is-available" : "is-idle"}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              vectorEffect="non-scaling-stroke"
              onClick={() => interactive && onSegment(segment.id)}
              onKeyDown={(event) => {
                if (interactive && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSegment(segment.id);
                }
              }}
              aria-label={`线段 ${segment.id}`}
            />
          );
        })}
        {constructionPreview?.throughPoint && constructionPreview.parallelSegment ? (() => {
          const through = pointById(geometry, constructionPreview.throughPoint!);
          const reference = geometry.segments.find((item) => item.id === constructionPreview.parallelSegment);
          const from = reference ? pointById(geometry, reference.from) : undefined;
          const to = reference ? pointById(geometry, reference.to) : undefined;
          if (!through || !from || !to) return null;
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const scale = Math.max(geometry.viewBox.width, geometry.viewBox.height) / Math.max(Math.hypot(dx, dy), 1);
          return <line className="topic-construction-preview is-parallel" x1={through.x - dx * scale} y1={through.y - dy * scale} x2={through.x + dx * scale} y2={through.y + dy * scale} />;
        })() : null}
        {constructionPreview?.carrierPoints.length === 2 ? (() => {
          const from = pointById(geometry, constructionPreview.carrierPoints[0]);
          const to = pointById(geometry, constructionPreview.carrierPoints[1]);
          return from && to ? <line className="topic-construction-preview is-carrier" x1={from.x} y1={from.y} x2={to.x} y2={to.y} /> : null;
        })() : null}
        {constructionPreview?.carrierPoints.length === 2 && constructionPreview.resultPoint ? (() => {
          const point = pointById(geometry, constructionPreview.resultPoint!);
          return point ? <circle className="topic-construction-intersection" cx={point.x} cy={point.y} r="3.5" /> : null;
        })() : null}
        {geometry.points.map((point) => {
          const interactive = allowPoints && (!availablePointIds || availablePointIds.includes(point.id));
          return (
          <g key={point.id} className={`topic-hit-point ${selectedPoints.includes(point.id) ? "is-selected" : ""} ${wrongObjectIds.includes(point.id) ? "is-wrong" : ""} ${interactive ? "is-available" : "is-idle"}`}>
            <circle role="button" tabIndex={interactive ? 0 : -1} aria-label={`点 ${point.id}`} cx={point.x} cy={point.y} r="8" onClick={() => interactive && onPoint(point.id)} onKeyDown={(event) => {
              if (interactive && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onPoint(point.id);
              }
            }} />
            {selectedPoints.includes(point.id) ? <text x={point.x + 8} y={point.y - 8}>{point.id}</text> : null}
          </g>
        )})}
        {Object.entries(labels).map(([segmentId, value]) => {
          const segment = geometry.segments.find((item) => item.id === segmentId);
          const from = segment ? pointById(geometry, segment.from) : undefined;
          const to = segment ? pointById(geometry, segment.to) : undefined;
          if (!from || !to) return null;
          const x = (from.x + to.x) / 2;
          const y = (from.y + to.y) / 2;
          return activeLabelId === segmentId ? (
            <foreignObject key={`label-${segmentId}`} x={x - 9} y={y - 5} width="18" height="10" className="topic-inline-label-input">
              <input aria-label={`${segmentId} 的标注`} inputMode="decimal" autoFocus value={value} onChange={(event) => onLabelChange(segmentId, event.target.value)} />
            </foreignObject>
          ) : (
            <g key={`label-${segmentId}`} className="topic-inline-label"><rect x={x - 8} y={y - 4} width="16" height="8" rx="2.5" /><text x={x} y={y + 1.6}>{value || segmentId}</text></g>
          );
        })}
        {ratioSegments.map((segmentId, index) => {
          const segment = geometry.segments.find((item) => item.id === segmentId);
          const from = segment ? pointById(geometry, segment.from) : undefined;
          const to = segment ? pointById(geometry, segment.to) : undefined;
          if (!from || !to) return null;
          const x = (from.x + to.x) / 2;
          const y = (from.y + to.y) / 2;
          return <g key={`ratio-${segmentId}-${index}`} className={`topic-ratio-badge group-${Math.floor(index / 2) + 1}`}><circle cx={x} cy={y} r="5" /><text x={x} y={y + 1.7}>{index < 2 ? "①" : "②"}</text></g>;
        })}
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
  const retainedLabels = Object.values(model.contracts)
    .filter((item) => model.completedStepIds.includes(item.id) && item.primitive === "mark-segments")
    .reduce((all, item) => ({ ...all, ...parseLabels(item.acceptedAnswers[0] || "") }), {} as Record<string, string>);
  const retainedRatioSegments = Object.values(model.contracts)
    .filter((item) => model.completedStepIds.includes(item.id) && item.primitive === "mark-ratio")
    .flatMap((item) => (item.acceptedAnswers[0] || "").split(",").filter(Boolean));

  const handleSegment = (segmentId: string) => {
    if (readOnly) return;
    if (contract.primitive === "mark-segments") {
      const next = { ...labels };
      if (segmentId in next) delete next[segmentId];
      else next[segmentId] = "";
      setValue(serializeLabels(next));
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
      return;
    }
    if (contract.primitive === "mark-ratio") {
      if (ratioSegments.includes(segmentId)) {
        setValue(ratioSegments.filter((item) => item !== segmentId).join(","));
        return;
      }
      if (ratioSegments.length >= 4) return;
      setValue([...ratioSegments, segmentId].join(","));
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
      return;
    }
    if (contract.primitive === "equation") {
      if (equationSegments.length >= 3) return;
      const target = contract.interaction?.equation?.targetLatex || "未知";
      setValue(`${[...target].sort().join("")}=${[...equationSegments, segmentId].join("*")}|${equationResult}`);
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
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
      setDraft((current) => ({ ...current, focusTarget: pointId }));
      return;
    }
    if (!constructParts.parallel || pointId === constructParts.point || carrierPoints.includes(pointId) || carrierPoints.length >= 2) return;
    const nextCarrier = [...carrierPoints, pointId];
    setValue(`point:${constructParts.point}|parallel:${constructParts.parallel}|carrier:${nextCarrier.join(",")}`);
    setDraft((current) => ({ ...current, focusTarget: pointId }));
  };

  const undoLast = () => {
    if (readOnly) return;
    if (contract.primitive === "mark-segments") {
      const ids = Object.keys(labels);
      const target = draft.focusTarget && labels[draft.focusTarget] !== undefined ? draft.focusTarget : ids[ids.length - 1];
      if (!target) return;
      const next = { ...labels };
      delete next[target];
      setValue(serializeLabels(next));
    } else if (contract.primitive === "mark-ratio") {
      setValue(ratioSegments.slice(0, -1).join(","));
    } else if (contract.primitive === "equation") {
      setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.slice(0, -1).join("*")}|${equationResult}`);
    } else if (contract.primitive === "construct-parallel") {
      if (carrierPoints.length) setValue(`point:${constructParts.point}|parallel:${constructParts.parallel}|carrier:${carrierPoints.slice(0, -1).join(",")}`);
      else if (constructParts.parallel) setValue(`point:${constructParts.point}`);
      else setValue("");
    } else {
      setValue("");
    }
    setDraft((current) => ({ ...current, focusTarget: undefined }));
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
  const construction = contract.interaction?.construction;
  const availablePointIds = contract.primitive === "construct-parallel"
    ? !constructParts.point
      ? construction ? [construction.throughPoint] : undefined
      : constructParts.parallel
        ? construction?.carrierPoints
        : []
    : undefined;
  const availableSegmentIds = contract.primitive === "construct-parallel" && constructParts.point && !constructParts.parallel
    ? construction ? [construction.parallelSegment] : contract.interaction?.availableSegments
    : contract.interaction?.availableSegments;
  const wrongObjectIds = runtime.runtimeState.problemStatus === "wrong" ? [...selectedSegments, ...selectedPoints] : [];
  const constructionPrompt = !constructParts.point
    ? "点过线点"
    : !constructParts.parallel
      ? "点平行参照边"
      : carrierPoints.length === 0
        ? "点第一个外点"
        : carrierPoints.length === 1
          ? "点第二个外点"
          : "辅助线构造完成，可以提交";

  return (
    <div className="practice-canvas-zone topic-practice-canvas artifact-topic-canvas">
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage">
          <GeometryCanvas
            geometry={geometry}
            image={visibleDiagram}
            selectedPoints={selectedPoints}
            selectedSegments={selectedSegments}
            labels={{ ...retainedLabels, ...labels }}
            ratioSegments={[...retainedRatioSegments, ...ratioSegments]}
            activeLabelId={contract.primitive === "mark-segments" ? draft.focusTarget : undefined}
            wrongObjectIds={wrongObjectIds}
            availableSegmentIds={availableSegmentIds}
            availablePointIds={availablePointIds}
            constructionPreview={contract.primitive === "construct-parallel" ? {
              throughPoint: constructParts.point,
              parallelSegment: constructParts.parallel,
              carrierPoints,
              resultPoint: construction?.resultPoint,
            } : undefined}
            allowPoints={contract.primitive === "construct-parallel"}
            allowSegments={["construct-parallel", "mark-segments", "mark-ratio", "equation"].includes(contract.primitive)}
            onPoint={handlePoint}
            onSegment={handleSegment}
            onLabelChange={(segmentId, value) => setValue(serializeLabels({ ...labels, [segmentId]: value }))}
          />
        </section>
      </div>

      <section className="topic-answer-panel artifact-action-workbench">
        <div className="topic-answer-copy">
          <h3>{contract.title}</h3>
          <MathText value={contract.promptLatex} block />
        </div>

        {contract.primitive === "construct-parallel" ? (
          <p className="topic-next-object"><span className="material-symbols-outlined">ads_click</span>{constructionPrompt}</p>
        ) : null}

        {contract.primitive === "mark-segments" ? <p className="topic-next-object"><span className="material-symbols-outlined">edit_location_alt</span>点线段后，直接在线段旁输入数值</p> : null}

        {contract.primitive === "mark-ratio" ? (
          <p className="topic-next-object"><span className="material-symbols-outlined">link</span>{ratioSegments.length % 2 === 0 ? "先点第一条边" : "现在点它的对应边"} · 已完成 {Math.floor(ratioSegments.length / 2)}/2 组</p>
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
        <button type="button" className="topic-local-undo" disabled={!selected} onClick={undoLast}><span className="material-symbols-outlined">undo</span>撤销刚才</button>
      </section>
    </div>
  );
}

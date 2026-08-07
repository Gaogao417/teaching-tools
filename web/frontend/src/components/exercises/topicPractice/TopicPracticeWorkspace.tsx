import { useEffect, type ChangeEvent } from "react";
import type { TopicGeometryModel, TopicGeometryPoint, TopicGeometrySegment } from "../../../../../shared/topicPractice";
import { MathText } from "../../math/MathText";
import { currentStep } from "../../../pages/practice/runtime/sceneUtils";
import type { WorkspaceRendererProps } from "../../../pages/practice/runtime/workspaceRenderers";

function playErrorBeep() {
  const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = 170;
  gain.gain.setValueAtTime(0.035, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);
  oscillator.addEventListener("ended", () => void context.close(), { once: true });
}

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
  return Object.entries(labels)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([segment, value]) => `${segment}=${value}`)
    .join(";");
}

function labelPosition(geometry: TopicGeometryModel, from: TopicGeometryPoint, to: TopicGeometryPoint) {
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const nx = -dy / length;
  const ny = dx / length;
  const candidates = [1, -1].map((direction) => ({
    x: midpoint.x + nx * 9 * direction,
    y: midpoint.y + ny * 9 * direction,
  }));
  const distanceToSegment = (point: { x: number; y: number }, segmentFrom: TopicGeometryPoint, segmentTo: TopicGeometryPoint) => {
    const segmentX = segmentTo.x - segmentFrom.x;
    const segmentY = segmentTo.y - segmentFrom.y;
    const denominator = segmentX * segmentX + segmentY * segmentY || 1;
    const progress = Math.max(0, Math.min(1, ((point.x - segmentFrom.x) * segmentX + (point.y - segmentFrom.y) * segmentY) / denominator));
    return Math.hypot(point.x - (segmentFrom.x + progress * segmentX), point.y - (segmentFrom.y + progress * segmentY));
  };
  const clearance = (candidate: { x: number; y: number }) => Math.min(
    ...geometry.segments.flatMap((segment) => {
      const segmentFrom = pointById(geometry, segment.from);
      const segmentTo = pointById(geometry, segment.to);
      if (!segmentFrom || !segmentTo || (segmentFrom === from && segmentTo === to) || (segmentFrom === to && segmentTo === from)) return [];
      return [distanceToSegment(candidate, segmentFrom, segmentTo)];
    }),
    ...geometry.points.filter((point) => point !== from && point !== to).map((point) => Math.hypot(candidate.x - point.x, candidate.y - point.y)),
  );
  const chosen = clearance(candidates[1]) > clearance(candidates[0]) ? candidates[1] : candidates[0];
  return { midpoint, ...chosen };
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
  onLabelBlur,
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
  onLabelBlur: (id: string, value: string) => void;
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
            <g
              key={segment.id}
              className={`topic-segment-control ${selected ? "is-selected" : ""} ${wrongObjectIds.includes(segment.id) ? "is-wrong" : ""} ${interactive ? "is-available" : "is-idle"}`}
              onClick={() => interactive && onSegment(segment.id)}
            >
              <line className="topic-segment-state" x1={from.x} y1={from.y} x2={to.x} y2={to.y} vectorEffect="non-scaling-stroke" />
              <line
                className="topic-hit-segment"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                vectorEffect="non-scaling-stroke"
              />
            </g>
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
            <circle cx={point.x} cy={point.y} r="8" onClick={() => interactive && onPoint(point.id)} />
            {selectedPoints.includes(point.id) ? <text x={point.x + 8} y={point.y - 8}>{point.id}</text> : null}
          </g>
        )})}
        {Object.entries(labels).map(([segmentId, value]) => {
          const segment = geometry.segments.find((item) => item.id === segmentId);
          const from = segment ? pointById(geometry, segment.from) : undefined;
          const to = segment ? pointById(geometry, segment.to) : undefined;
          if (!from || !to) return null;
          const { midpoint, x, y } = labelPosition(geometry, from, to);
          return activeLabelId === segmentId ? (
            <g key={`label-${segmentId}`}>
              <line className="topic-inline-label-leader" x1={midpoint.x} y1={midpoint.y} x2={x} y2={y} />
              <foreignObject x={x - 8} y={y - 4} width="16" height="8" className="topic-inline-label-input">
                <input aria-label={`${segmentId} 的标注`} inputMode="decimal" autoFocus value={value} onChange={(event) => onLabelChange(segmentId, event.target.value)} onBlur={() => onLabelBlur(segmentId, value)} />
              </foreignObject>
            </g>
          ) : (
            <g key={`label-${segmentId}`} className="topic-inline-label"><line className="topic-inline-label-leader" x1={midpoint.x} y1={midpoint.y} x2={x} y2={y} /><rect x={x - 7} y={y - 3.5} width="14" height="7" rx="2" /><text x={x} y={y + 1.4}>{value || segmentId}</text></g>
          );
        })}
        {ratioSegments.map((segmentId, index) => {
          const segment = geometry.segments.find((item) => item.id === segmentId);
          const from = segment ? pointById(geometry, segment.from) : undefined;
          const to = segment ? pointById(geometry, segment.to) : undefined;
          if (!from || !to) return null;
          const x = (from.x + to.x) / 2;
          const y = (from.y + to.y) / 2;
          const duplicateCount = ratioSegments.filter((item) => item === segmentId).length;
          const occurrence = ratioSegments.slice(0, index).filter((item) => item === segmentId).length;
          const offset = (occurrence - (duplicateCount - 1) / 2) * 11;
          return <g key={`ratio-${segmentId}-${index}`} className={`topic-ratio-badge group-${Math.floor(index / 2) + 1}`}><circle cx={x} cy={y + offset} r="5" /><text x={x} y={y + offset + 1.7}>{index < 2 ? "①" : "②"}</text></g>;
        })}
      </svg>
      <div className="topic-geometry-control-layer">
        {geometry.segments.map((segment) => {
          const from = pointById(geometry, segment.from);
          const to = pointById(geometry, segment.to);
          if (!from || !to) return null;
          const interactive = allowSegments && (!availableSegmentIds || availableSegmentIds.includes(segment.id));
          return (
            <button
              key={`control-${segment.id}`}
              type="button"
              aria-label={`线段 ${segment.id}`}
              disabled={!interactive}
              style={{ left: `${((from.x + to.x) / 2 / geometry.viewBox.width) * 100}%`, top: `${((from.y + to.y) / 2 / geometry.viewBox.height) * 100}%` }}
              onClick={() => onSegment(segment.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSegment(segment.id);
                }
              }}
            />
          );
        })}
        {geometry.points.map((point) => {
          const interactive = allowPoints && (!availablePointIds || availablePointIds.includes(point.id));
          return (
            <button
              key={`control-point-${point.id}`}
              type="button"
              aria-label={`点 ${point.id}`}
              disabled={!interactive}
              style={{ left: `${(point.x / geometry.viewBox.width) * 100}%`, top: `${(point.y / geometry.viewBox.height) * 100}%` }}
              onClick={() => onPoint(point.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onPoint(point.id);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function TopicPracticeWorkspaceRenderer({
  runtime,
  draft,
  setDraft,
  inputRefs,
  readOnly,
  onSubmit,
}: WorkspaceRendererProps) {
  const model = runtime.instance.scene.topicWorkspace;
  const runtimeStep = currentStep(runtime);
  const inputAction = runtimeStep.allowedActions.find((action) => action.type === "input");
  const contract = model?.contracts[runtime.runtimeState.currentStepId] || (model ? model.contracts[model.activeStepId] : undefined);

  useEffect(() => {
    if (!model?.guidedMode || !contract || inputAction?.type !== "input") return;
    setDraft((current) => {
      const currentValue = current.inputs[inputAction.target] || "";
      if (currentValue) return current;
      if (contract.primitive === "mark-segments" && contract.presentation?.autoFocusSequence) {
        const first = contract.interaction?.expectedLabels?.[0];
        if (!first) return current;
        return {
          ...current,
          focusTarget: first.segmentId,
          inputs: { ...current.inputs, [inputAction.target]: serializeLabels({ [first.segmentId]: "" }) },
        };
      }
      if (contract.primitive === "equation" && contract.presentation?.prefillKnownFactor) {
        const target = [...(contract.interaction?.equation?.targetLatex || "")].sort().join("");
        const known = contract.interaction?.expectedOrder?.[0] || "";
        return {
          ...current,
          focusTarget: undefined,
          inputs: { ...current.inputs, [inputAction.target]: `${target}=${known}**|` },
        };
      }
      return current;
    });
  }, [runtime.runtimeState.currentStepId]);

  if (!model || inputAction?.type !== "input") return <div className="practice-canvas-zone" />;
  if (!contract) return <div className="practice-canvas-zone" />;
  const ordered = Object.values(model.contracts);
  const completed = ordered.filter((item) => model.completedStepIds.includes(item.id));
  const visibleDiagram = [...completed].reverse().find((item) => item.diagramAsset)?.diagramAsset || model.promptDiagramAsset;
  const geometry = contract.interaction?.geometry || model.promptGeometry;
  const selected = draft.inputs[inputAction.target] || "";
  const wrongObjectIds = runtime.runtimeState.wrongObjectIds || [];
  const setValue = (value: string) => setDraft((current) => ({
    ...current,
    inputs: { ...current.inputs, [inputAction.target]: value },
  }));

  const labels = contract.primitive === "mark-segments" ? parseLabels(selected) : {};
  const ratioSegments = contract.primitive === "mark-ratio" ? selected.split(",").filter(Boolean) : [];
  const ratioScratchParts = contract.primitive === "ratio-scratch" ? selected.split("|") : [];
  const ratioScratchSegments = ratioScratchParts[0]?.split(",").filter(Boolean) || [];
  const ratioScratchValues = ratioScratchParts[1]?.split(",") || [];
  const collinearSegments = contract.primitive === "convert-collinear" ? selected.split(",").filter(Boolean) : [];
  const equationParts = contract.primitive === "equation" ? selected.split("|") : [];
  const equationPrefix = equationParts[0]?.split("=")[1] || "";
  const equationRawSegments = equationPrefix.split("*");
  const equationSegments = contract.interaction?.equation?.shareValues
    ? [equationRawSegments[0] || "", equationRawSegments[1] || "", equationRawSegments[2] || ""]
    : equationRawSegments.filter(Boolean);
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

  const updateCoach = (messageLatex: string, tone: "prompt" | "correct" | "wrong" | "explain", options?: { highlightedObjectIds?: string[]; activeSlotId?: string; incrementInvalid?: boolean; displayMode?: "task" | "explanation" }) => {
    setDraft((current) => ({
      ...current,
      topicCoach: {
        ...current.topicCoach,
        messageLatex,
        tone,
        highlightedObjectIds: options?.highlightedObjectIds || [],
        activeSlotId: options?.activeSlotId,
        invalidObjectCount: options?.incrementInvalid ? (current.topicCoach?.invalidObjectCount || 0) + 1 : current.topicCoach?.invalidObjectCount || 0,
        feedbackNonce: (current.topicCoach?.feedbackNonce || 0) + 1,
        displayMode: options?.displayMode || current.topicCoach?.displayMode || "task",
      },
    }));
  };

  const rejectObject = (objectId: string) => {
    if (draft.topicCoach?.soundEnabled !== false) playErrorBeep();
    const nextCount = (draft.topicCoach?.invalidObjectCount || 0) + 1;
    const exactTarget = contract.interaction?.expectedLabels?.find((item) => !(item.segmentId in labels))?.segmentId
      || contract.interaction?.expectedOrder?.[ratioScratchSegments.length]
      || contract.interaction?.expectedOrder?.[equationSegments.filter(Boolean).length];
    const message = nextCount >= 3 && exactTarget
      ? contract.coach?.targetHintsLatex?.[exactTarget] || `请点线段 ${exactTarget}。`
      : nextCount >= 2
        ? contract.coach?.objectCategoryHintLatex || contract.coach?.invalidObjectLatex || "这个对象不属于当前一步。"
        : contract.coach?.invalidObjectLatex || "这条线段不是当前要找的对象。";
    updateCoach(message, "wrong", { highlightedObjectIds: [objectId], incrementInvalid: true });
    window.setTimeout(() => setDraft((current) => ({
      ...current,
      topicCoach: current.topicCoach ? { ...current.topicCoach, highlightedObjectIds: [] } : undefined,
    })), 650);
  };

  const rejectSlot = (slotId: string, messageLatex: string) => {
    if (draft.topicCoach?.soundEnabled !== false) playErrorBeep();
    window.setTimeout(() => updateCoach(messageLatex, "wrong", { activeSlotId: slotId }), 0);
  };

  const handleSegment = (segmentId: string) => {
    if (readOnly) return;
    if (contract.primitive === "mark-segments") {
      if (model.guidedMode && contract.presentation?.autoFocusSequence) return;
      const expected = contract.interaction?.expectedLabels?.map((item) => item.segmentId) || [];
      if (!expected.includes(segmentId)) {
        rejectObject(segmentId);
        return;
      }
      const next = { ...labels };
      if (segmentId in next) {
        if (wrongObjectIds.includes(segmentId)) {
          setDraft((current) => ({ ...current, focusTarget: segmentId }));
          return;
        }
        delete next[segmentId];
      } else next[segmentId] = "";
      setValue(serializeLabels(next));
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
      updateCoach(contract.coach?.targetHintsLatex?.[segmentId] || "这条线段找对了，把题干中的边长填进去。", "correct", { activeSlotId: segmentId });
      return;
    }
    if (contract.primitive === "mark-ratio") {
      if (ratioSegments.length >= 4) return;
      setValue([...ratioSegments, segmentId].join(","));
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
      return;
    }
    if (contract.primitive === "ratio-scratch") {
      const expected = contract.interaction?.expectedOrder || [];
      const expectedNow = expected[ratioScratchSegments.length];
      if (segmentId !== expectedNow) {
        rejectObject(segmentId);
        return;
      }
      const nextSegments = [...ratioScratchSegments, segmentId];
      setValue(`${nextSegments.join(",")}|${ratioScratchValues.join(",")}`);
      const nextTarget = expected[nextSegments.length];
      updateCoach(
        nextTarget
          ? contract.coach?.targetHintsLatex?.[nextTarget] || `这条边找对了，接着点 ${nextTarget}。`
          : contract.coach?.nextActionLatex || "对应边找对了，现在在草稿区约分。",
        "correct",
        { activeSlotId: nextTarget ? undefined : "ratio-first" },
      );
      return;
    }
    if (contract.primitive === "convert-collinear") {
      if (collinearSegments.includes(segmentId)) {
        setValue(collinearSegments.filter((item) => item !== segmentId).join(","));
        return;
      }
      if (collinearSegments.length >= 3) return;
      setValue([...collinearSegments, segmentId].join(","));
      setDraft((current) => ({ ...current, focusTarget: segmentId }));
      return;
    }
    if (contract.primitive === "equation") {
      if (contract.interaction?.equation?.shareValues) {
        const expectedKnown = contract.interaction.expectedOrder?.[0];
        if (equationSegments[0] || segmentId !== expectedKnown) {
          rejectObject(segmentId);
          return;
        }
        const target = [...contract.interaction.equation.targetLatex].sort().join("");
        setValue(`${target}=${segmentId}**|${equationResult}`);
        updateCoach(contract.coach?.slotHints?.known?.correctLatex || "已知边正确，现在填未知边的份数。", "correct", { activeSlotId: "numerator" });
        return;
      }
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
    } else if (contract.primitive === "ratio-scratch") {
      if (ratioScratchValues.some(Boolean)) setValue(`${ratioScratchSegments.join(",")}|`);
      else setValue(`${ratioScratchSegments.slice(0, -1).join(",")}|`);
    } else if (contract.primitive === "convert-collinear") {
      setValue(collinearSegments.slice(0, -1).join(","));
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
      : contract.primitive === "ratio-scratch"
        ? ratioScratchSegments
      : contract.primitive === "convert-collinear"
        ? collinearSegments
      : contract.primitive === "equation"
        ? equationSegments.filter(Boolean)
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
    <div className={`practice-canvas-zone topic-practice-canvas artifact-topic-canvas ${model.guidedMode && contract.primitive === "mark-segments" && contract.presentation?.autoFocusSequence ? "is-guided-auto-label" : ""}`}>
      <div className="artifact-math-object has-diagram">
        <section className="artifact-diagram-stage">
          <GeometryCanvas
            geometry={geometry}
            image={visibleDiagram}
            selectedPoints={selectedPoints}
            selectedSegments={selectedSegments}
            labels={{ ...retainedLabels, ...labels }}
            ratioSegments={[...retainedRatioSegments, ...ratioSegments, ...ratioScratchSegments]}
            activeLabelId={contract.primitive === "mark-segments" ? draft.focusTarget : undefined}
            wrongObjectIds={[...new Set([...wrongObjectIds, ...(draft.topicCoach?.highlightedObjectIds || [])])]}
            availableSegmentIds={availableSegmentIds}
            availablePointIds={availablePointIds}
            constructionPreview={contract.primitive === "construct-parallel" ? {
              throughPoint: constructParts.point,
              parallelSegment: constructParts.parallel,
              carrierPoints,
              resultPoint: construction?.resultPoint,
            } : undefined}
            allowPoints={contract.primitive === "construct-parallel"}
            allowSegments={["construct-parallel", "mark-segments", "mark-ratio", "ratio-scratch", "convert-collinear", "equation"].includes(contract.primitive)
              && !(model.guidedMode && contract.primitive === "mark-segments" && contract.presentation?.autoFocusSequence)
              && !(model.guidedMode && contract.primitive === "equation" && contract.presentation?.prefillKnownFactor)}
            onPoint={handlePoint}
            onSegment={handleSegment}
            onLabelChange={(segmentId, value) => {
              const nextLabels = { ...labels, [segmentId]: value };
              const serialized = serializeLabels(nextLabels);
              setValue(serialized);
              const expected = contract.interaction?.expectedLabels?.find((item) => item.segmentId === segmentId);
              if (expected && value === expected.valueLatex) {
                const sequence = contract.interaction?.expectedLabels || [];
                const next = sequence[sequence.findIndex((item) => item.segmentId === segmentId) + 1];
                if (model.guidedMode && contract.presentation?.autoFocusSequence && next) {
                  const withNext = { ...nextLabels, [next.segmentId]: nextLabels[next.segmentId] || "" };
                  setDraft((current) => ({
                    ...current,
                    focusTarget: next.segmentId,
                    inputs: { ...current.inputs, [inputAction.target]: serializeLabels(withNext) },
                    topicCoach: {
                      ...current.topicCoach,
                      messageLatex: `对，${expected.displayName}=${expected.valueLatex}。现在填写 ${next.displayName}。`,
                      tone: "correct",
                      displayMode: "task",
                      activeSlotId: next.segmentId,
                      feedbackNonce: (current.topicCoach?.feedbackNonce || 0) + 1,
                    },
                  }));
                } else if (model.guidedMode && contract.presentation?.autoSubmitOnComplete) {
                  setDraft((current) => ({ ...current, focusTarget: undefined }));
                  updateCoach(`对，${expected.displayName}=${expected.valueLatex}。三条小段都标好了。`, "correct", { displayMode: "task" });
                  window.setTimeout(() => onSubmit({
                    stepId: contract.id,
                    value: JSON.stringify({ inputs: { ...draft.inputs, [inputAction.target]: serialized } }),
                  }), 220);
                } else {
                  updateCoach(`对，${expected.displayName}=${expected.valueLatex}。${contract.coach?.nextActionLatex || "继续下一条。"}`, "correct");
                  setDraft((current) => ({ ...current, focusTarget: undefined }));
                }
              }
            }}
            onLabelBlur={(segmentId, value) => {
              const expected = contract.interaction?.expectedLabels?.find((item) => item.segmentId === segmentId);
              if (expected && value && value !== expected.valueLatex) {
                rejectSlot(segmentId, `${expected.displayName} 的边长还没有对上。${contract.coach?.targetHintsLatex?.[segmentId] || `再核对 ${expected.displayName}。`}`);
              }
            }}
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

        {contract.primitive === "mark-ratio" ? (
          <p className="topic-next-object"><span className="material-symbols-outlined">link</span>{ratioSegments.length % 2 === 0 ? "先点第一条边" : "现在点它的对应边"} · 已完成 {Math.floor(ratioSegments.length / 2)}/2 组</p>
        ) : null}

        {contract.primitive === "ratio-scratch" && contract.interaction?.ratioScratch ? (
          <div className="topic-scratch-work" aria-label="草稿纸对应边比">
            <div className="topic-scratch-heading"><span className="material-symbols-outlined">edit_note</span>草稿纸</div>
            <div className="topic-ratio-scratch-builder">
              <strong>{ratioScratchSegments[0] ? contract.interaction.ratioScratch.firstDisplayName : "先点第一条边"}</strong>
              <span>:</span>
              <strong>{ratioScratchSegments[1] ? contract.interaction.ratioScratch.secondDisplayName : "再点对应边"}</strong>
              {ratioScratchSegments.length === 2 ? <>
                <span>=</span>
                <strong>{contract.interaction.ratioScratch.firstValueLatex}</strong><span>:</span><strong>{contract.interaction.ratioScratch.secondValueLatex}</strong>
                <span>=</span>
                <input aria-label="最简比前项" inputMode="decimal" value={ratioScratchValues[0] || ""}
                  onFocus={() => updateCoach(contract.coach?.slotHints?.["ratio-first"]?.hintLatex || "填写最简比前项。", "prompt", { activeSlotId: "ratio-first" })}
                  onBlur={(event) => {
                    if (event.currentTarget.value && event.currentTarget.value !== contract.interaction!.ratioScratch!.simplifiedFirstLatex) {
                      rejectSlot("ratio-first", contract.coach?.slotHints?.["ratio-first"]?.errorLatex || "前项还没有约到最简。");
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValue(`${ratioScratchSegments.join(",")}|${value},${ratioScratchValues[1] || ""}`);
                    if (value === contract.interaction!.ratioScratch!.simplifiedFirstLatex) updateCoach(contract.coach?.slotHints?.["ratio-first"]?.correctLatex || "前项正确。", "correct", { activeSlotId: "ratio-second" });
                  }} />
                <span>:</span>
                <input aria-label="最简比后项" inputMode="decimal" value={ratioScratchValues[1] || ""}
                  onFocus={() => updateCoach(contract.coach?.slotHints?.["ratio-second"]?.hintLatex || "填写最简比后项。", "prompt", { activeSlotId: "ratio-second" })}
                  onBlur={(event) => {
                    if (event.currentTarget.value && event.currentTarget.value !== contract.interaction!.ratioScratch!.simplifiedSecondLatex) {
                      rejectSlot("ratio-second", contract.coach?.slotHints?.["ratio-second"]?.errorLatex || "后项要和前项除以同一个数。");
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    setValue(`${ratioScratchSegments.join(",")}|${ratioScratchValues[0] || ""},${value}`);
                    if (value === contract.interaction!.ratioScratch!.simplifiedSecondLatex) updateCoach(contract.coach?.slotHints?.["ratio-second"]?.correctLatex || "最简比正确，可以提交。", "correct");
                  }} />
              </> : null}
            </div>
          </div>
        ) : null}

        {contract.primitive === "convert-collinear" && contract.interaction?.collinear ? (
          <div className="topic-collinear-builder">
            <span>整段</span><strong>{collinearSegments[0] || "点整段"}</strong>
            <b>=</b>
            <span>目标分段</span><strong>{collinearSegments[1] || "点目标分段"}</strong>
            <b>+</b>
            <span>已知分段</span><strong>{collinearSegments[2] || "点已知分段"}</strong>
          </div>
        ) : null}

        {contract.primitive === "equation" && contract.interaction?.equation ? (
          <div className="topic-equation-builder">
            <strong>{contract.interaction.equation.targetLatex}</strong><span>=</span>
            {model.guidedMode && contract.presentation?.prefillKnownFactor
              ? <strong className="topic-equation-known">{equationSegments[0]}</strong>
              : <button type="button" className={equationSegments[0] ? "is-filled" : ""} onClick={() => equationSegments[0] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.slice(1).join("*")}|${equationResult}`)}>{equationSegments[0] || "点已知边"}</button>}<span>×</span>
            <span className="topic-fraction">
              {contract.interaction.equation.shareValues ? <>
                <input aria-label="未知边份数" inputMode="decimal" value={equationSegments[1] || ""} placeholder="未知边份数"
                  onFocus={() => updateCoach(contract.coach?.slotHints?.numerator?.hintLatex || "填写未知边份数。", "prompt", { activeSlotId: "numerator", displayMode: "task" })}
                  onBlur={(event) => {
                    if (event.currentTarget.value && event.currentTarget.value !== contract.interaction!.equation!.shareValues?.[0]) {
                      rejectSlot("numerator", contract.coach?.slotHints?.numerator?.errorLatex || "分子表示未知边的份数。");
                    }
                  }}
                  onChange={(event) => {
                    const parts = [equationSegments[0] || "", event.target.value, equationSegments[2] || ""];
                    setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${parts.join("*")}|${equationResult}`);
                    if (event.target.value === contract.interaction!.equation!.shareValues?.[0]) updateCoach(contract.coach?.slotHints?.numerator?.correctLatex || "分子正确。", "correct", { activeSlotId: "denominator" });
                  }} />
                <input aria-label="已知边份数" inputMode="decimal" value={equationSegments[2] || ""} placeholder="已知边份数"
                  onFocus={() => updateCoach(contract.coach?.slotHints?.denominator?.hintLatex || "填写已知边份数。", "prompt", { activeSlotId: "denominator", displayMode: "task" })}
                  onBlur={(event) => {
                    if (event.currentTarget.value && event.currentTarget.value !== contract.interaction!.equation!.shareValues?.[1]) {
                      rejectSlot("denominator", contract.coach?.slotHints?.denominator?.errorLatex || "分母表示已知边的份数。");
                    }
                  }}
                  onChange={(event) => {
                    const parts = [equationSegments[0] || "", equationSegments[1] || "", event.target.value];
                    setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${parts.join("*")}|${equationResult}`);
                    if (event.target.value === contract.interaction!.equation!.shareValues?.[1]) updateCoach(contract.coach?.slotHints?.denominator?.correctLatex || "分母正确。", "correct", { activeSlotId: "result" });
                  }} />
              </> : <>
                <button type="button" className={equationSegments[1] ? "is-filled" : ""} onClick={() => equationSegments[1] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.filter((_, index) => index !== 1).join("*")}|${equationResult}`)}>{equationSegments[1] || "点未知份数边"}</button>
                <button type="button" className={equationSegments[2] ? "is-filled" : ""} onClick={() => equationSegments[2] && setValue(`${[...contract.interaction!.equation!.targetLatex].sort().join("")}=${equationSegments.slice(0, 2).join("*")}|${equationResult}`)}>{equationSegments[2] || "点已知份数边"}</button>
              </>}
            </span>
            <span>=</span>
            <input aria-label="计算结果" value={equationResult} onFocus={() => updateCoach(contract.coach?.slotHints?.result?.hintLatex || "计算最后结果。", "prompt", { activeSlotId: "result", displayMode: "task" })} onBlur={(event) => {
              const expectedResult = contract.acceptedAnswers[0]?.split("|")[1];
              if (event.currentTarget.value && event.currentTarget.value !== expectedResult) {
                rejectSlot("result", contract.coach?.slotHints?.result?.errorLatex || "只检查最后的乘除计算。");
              }
            }} onChange={(event) => {
              const target = [...contract.interaction!.equation!.targetLatex].sort().join("");
              setValue(`${target}=${equationSegments.join("*")}|${event.target.value}`);
              const expectedResult = contract.acceptedAnswers[0]?.split("|")[1];
              if (event.target.value === expectedResult) updateCoach(contract.coach?.slotHints?.result?.correctLatex || "结果正确，可以提交。", "correct");
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

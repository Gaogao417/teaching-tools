import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { LearningMapNode, LearningMapResponse } from "../../../shared/similarityLearningMap";
import { CAPABILITY_LABELS } from "../../../shared/similarityLearningMap";
import { api } from "../api/client";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";
import { MathText } from "../components/math/MathText";

const STATE_COPY: Record<LearningMapNode["state"], string> = {
  unopened: "未开启",
  open: "开启",
  passed: "通关",
};

const NODE_EDGE_POINTS: Record<string, { x: number; y: number }> = {
  "parallel-line-ratios": { x: 34, y: 9 },
  "auxiliary-two-ratios": { x: 30, y: 28 },
  "reverse-a-similarity": { x: 72, y: 28 },
  "challenge-auxiliary-comprehensive": { x: 29, y: 49 },
  "challenge-crossed-configuration": { x: 72, y: 49 },
  "nested-similarity": { x: 56, y: 72 },
  "butterfly-similarity": { x: 74, y: 90 },
};

function nodeIcon(node: LearningMapNode) {
  if (node.state === "passed") return "check_circle";
  if (node.state === "open") return "play_circle";
  return "radio_button_unchecked";
}

export function SimilarityLearningMapPage() {
  const navigate = useNavigate();
  const { studentName, requestAuth, setFocusedTaskId } = useOutletContext<WorkspaceOutletContext>();
  const [map, setMap] = useState<LearningMapResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!studentName) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.getSimilarityLearningMap(studentName)
      .then((response) => {
        if (cancelled) return;
        setMap(response);
        setSelectedId((current) => current && response.nodes.some((node) => node.id === current) ? current : undefined);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [studentName]);

  const selected = useMemo(() => map?.nodes.find((node) => node.id === selectedId), [map, selectedId]);
  const nodeById = useMemo(() => new Map(map?.nodes.map((node) => [node.id, node]) || []), [map]);
  const recommended = map?.nodes.find((node) => node.id === map.recommendedNodeId);

  const openTask = (node: LearningMapNode, mode: "learn" | "practice" | "review") => {
    if (!node.taskId) return;
    setFocusedTaskId(node.taskId);
    const sessionQuery = mode === "practice" && node.activeSessionId ? `?sessionId=${node.activeSessionId}` : "";
    navigate(`/${mode}/${node.taskId}${sessionQuery}`);
  };

  const startChallenge = async (node: LearningMapNode) => {
    if (!studentName) {
      requestAuth();
      return;
    }
    if (node.activeSessionId) {
      const restored = await api.restorePractice(node.activeSessionId);
      setFocusedTaskId(restored.taskId);
      navigate(`/practice/${restored.taskId}?sessionId=${restored.sessionId}`);
      return;
    }
    setStarting(true);
    try {
      const session = await api.startChallenge(node.id, studentName);
      setFocusedTaskId(session.taskId);
      navigate(`/practice/${session.taskId}?sessionId=${session.sessionId}`);
    } finally {
      setStarting(false);
    }
  };

  if (!studentName) {
    return (
      <section className="similarity-map-page similarity-map-empty">
        <div className="similarity-map-hero"><span className="eyebrow">相似专题</span><h1>登录学生身份后查看学习图谱</h1><p>图谱会从服务端恢复真实进度、开启条件和未完成任务。</p></div>
        <button className="btn btn-primary" type="button" onClick={requestAuth}>设置学生姓名</button>
      </section>
    );
  }

  if (loading || !map) return <section className="similarity-map-page similarity-map-empty">正在读取学习图谱…</section>;

  return (
    <section className="similarity-map-page">
      <header className="similarity-map-hero">
        <div><span className="eyebrow">相似专题 · 学习图谱</span><h1>{recommended ? `下一步：${recommended.title}` : "五个构型都已完成"}</h1><p>先看清结构关系，再进入原有的学习、训练或复盘。</p></div>
        <div className="similarity-map-legend" aria-label="节点状态图例"><span>○ 未开启</span><span>◐ 开启</span><span>● 通关</span></div>
      </header>

      <div className="similarity-map-layout">
        <div className="similarity-map-canvas" aria-label="相似专题学习路径">
          <svg className="similarity-map-edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {map.edges.map((edge) => {
              const from = NODE_EDGE_POINTS[edge.from];
              const to = NODE_EDGE_POINTS[edge.to];
              return from && to ? <line key={`${edge.from}:${edge.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`edge-${edge.kind}`} /> : null;
            })}
          </svg>
          <div className="similarity-map-lane"><span>01</span><small>比例原型</small></div>
          <div className="similarity-map-node-slot slot-parallel"><MapNode node={nodeById.get("parallel-line-ratios")} selected={selectedId === "parallel-line-ratios"} focused={map.focusedNodeId === "parallel-line-ratios"} onSelect={setSelectedId} /></div>
          <div className="similarity-map-lane lane-two"><span>02</span><small>组合建模</small></div>
          <div className="similarity-map-node-slot slot-auxiliary"><MapNode node={nodeById.get("auxiliary-two-ratios")} selected={selectedId === "auxiliary-two-ratios"} focused={map.focusedNodeId === "auxiliary-two-ratios"} onSelect={setSelectedId} /></div>
          <div className="similarity-map-node-slot slot-reverse"><MapNode node={nodeById.get("reverse-a-similarity")} selected={selectedId === "reverse-a-similarity"} focused={map.focusedNodeId === "reverse-a-similarity"} onSelect={setSelectedId} /></div>
          <div className="similarity-map-lane lane-three"><span>03</span><small>构型迁移</small></div>
          <div className="similarity-map-node-slot slot-nested"><MapNode node={nodeById.get("nested-similarity")} selected={selectedId === "nested-similarity"} focused={map.focusedNodeId === "nested-similarity"} onSelect={setSelectedId} /></div>
          <div className="similarity-map-node-slot slot-butterfly"><MapNode node={nodeById.get("butterfly-similarity")} selected={selectedId === "butterfly-similarity"} focused={map.focusedNodeId === "butterfly-similarity"} onSelect={setSelectedId} /></div>
          <div className="similarity-map-challenges">
            {map.nodes.filter((node) => node.kind === "challenge").map((node) => <MapNode key={node.id} node={node} selected={selectedId === node.id} focused={map.focusedNodeId === node.id} onSelect={setSelectedId} />)}
          </div>
        </div>

        <aside className="similarity-map-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="similarity-detail-head"><span className={`similarity-state state-${selected.state}`}>{STATE_COPY[selected.state]}</span><h2>{selected.title}</h2><p>{selected.actionLabel}</p></div>
              {selected.capabilityLabel ? <div className="similarity-detail-block"><small>本专题新增能力</small><strong>{selected.capabilityLabel}</strong></div> : null}
              {selected.missingPrerequisiteIds.length ? (
                <div className="similarity-detail-block is-warning"><small>{selected.kind === "challenge" ? "建议先具备" : "尚缺开启条件"}</small><ul>{selected.missingPrerequisiteIds.map((id) => <li key={id}>{CAPABILITY_LABELS[id]}</li>)}</ul></div>
              ) : <div className="similarity-detail-block is-ready"><small>前置状态</small><strong>已具备开启条件</strong></div>}
              <div className="similarity-detail-actions">
                {selected.kind === "challenge" ? (
                  <>
                    <button className="btn btn-primary" type="button" disabled={starting} onClick={() => void startChallenge(selected)}>{selected.activeSessionId ? "继续挑战" : "直接挑战"}</button>
                    {selected.missingPrerequisiteIds.length && recommended?.kind === "topic" ? <button className="btn btn-ghost" type="button" onClick={() => setSelectedId(recommended.id)}>先补前置</button> : null}
                  </>
                ) : selected.state === "unopened" ? (
                  <button className="btn btn-primary" type="button" disabled={!recommended} onClick={() => recommended && setSelectedId(recommended.id)}>学习缺失前置</button>
                ) : selected.state === "passed" ? (
                  <><button className="btn btn-primary" type="button" onClick={() => openTask(selected, "practice")}>再练一组</button><button className="btn btn-ghost" type="button" onClick={() => openTask(selected, "review")}>查看复盘</button></>
                ) : (
                  <><button className="btn btn-primary" type="button" onClick={() => openTask(selected, selected.activeSessionId ? "practice" : "learn")}>{selected.activeSessionId ? "继续学习" : "开始学习"}</button><button className="btn btn-ghost" type="button" onClick={() => openTask(selected, "practice")}>{selected.activeSessionId ? "继续训练" : "直接训练"}</button></>
                )}
              </div>
            </>
          ) : <p>选择一个节点查看详情。</p>}
        </aside>
      </div>
    </section>
  );
}

function MapNode({ node, selected, focused, onSelect }: { node?: LearningMapNode; selected: boolean; focused: boolean; onSelect: (id: string) => void }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const nodeRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!previewOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!nodeRef.current?.contains(event.target as Node)) setPreviewOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [previewOpen]);

  if (!node) return null;
  const previewId = `question-preview-${node.id}`;
  return (
    <div ref={nodeRef} className={`similarity-map-node kind-${node.kind} state-${node.state} ${node.recommended ? "is-recommended" : ""} ${focused ? "is-focused" : ""} ${selected ? "is-selected" : ""}`} onMouseLeave={() => setPreviewOpen(false)}>
      <button
        type="button"
        className="similarity-map-preview-trigger"
        aria-label={`预览${node.title}题目（${STATE_COPY[node.state]}）`}
        aria-expanded={previewOpen}
        aria-describedby={previewOpen ? previewId : undefined}
        onMouseEnter={() => setPreviewOpen(true)}
        onPointerDown={(event) => {
          pointerTypeRef.current = event.pointerType;
        }}
        onFocus={() => {
          if (pointerTypeRef.current !== "touch" && pointerTypeRef.current !== "pen") setPreviewOpen(true);
        }}
        onBlur={() => {
          pointerTypeRef.current = null;
          setPreviewOpen(false);
        }}
        onClick={() => {
          if (pointerTypeRef.current === "touch" || pointerTypeRef.current === "pen") {
            setPreviewOpen((current) => !current);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setPreviewOpen(false);
            event.currentTarget.focus();
          }
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">{nodeIcon(node)}</span>
      </button>
      <button type="button" className="similarity-map-node-main" onClick={() => onSelect(node.id)} aria-pressed={selected}>
        <strong>{node.title}</strong>
        <small>{STATE_COPY[node.state]}</small>
      </button>
      {previewOpen ? (
        <div id={previewId} className="similarity-map-question-preview" role="tooltip">
          <span className="similarity-map-question-preview-label">题目预览</span>
          {node.previewQuestion ? (
            <>
              <MathText value={node.previewQuestion.stemLatex} block />
              {node.previewQuestion.diagramAssetUrl ? <img src={node.previewQuestion.diagramAssetUrl} alt={node.previewQuestion.diagramAlt || `${node.title}代表题题图`} /> : null}
            </>
          ) : <p>题目预览暂不可用</p>}
        </div>
      ) : null}
    </div>
  );
}

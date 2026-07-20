import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import type { LearningMapNode, LearningMapResponse } from "../../../shared/similarityLearningMap";
import { CAPABILITY_LABELS } from "../../../shared/similarityLearningMap";
import { api } from "../api/client";
import type { WorkspaceOutletContext } from "../components/layout/workspaceContext";

const STATE_COPY: Record<LearningMapNode["state"], string> = {
  locked: "尚未解锁",
  available: "可以开始",
  in_progress: "正在进行",
  mastered: "已经掌握",
};

function nodeIcon(node: LearningMapNode) {
  if (node.kind === "challenge") return "trophy";
  if (node.state === "locked") return "lock";
  if (node.state === "mastered") return "check_circle";
  if (node.state === "in_progress") return "play_circle";
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
        setSelectedId((current) => current || response.focusedNodeId || response.recommendedNodeId);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [studentName]);

  const selected = useMemo(() => map?.nodes.find((node) => node.id === selectedId), [map, selectedId]);
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
        <div className="similarity-map-hero"><span className="eyebrow">相似专题</span><h1>登录学生身份后查看学习图谱</h1><p>图谱会从服务端恢复真实进度、解锁原因和未完成任务。</p></div>
        <button className="btn btn-primary" type="button" onClick={requestAuth}>设置学生姓名</button>
      </section>
    );
  }

  if (loading || !map) return <section className="similarity-map-page similarity-map-empty">正在读取学习图谱…</section>;

  return (
    <section className="similarity-map-page">
      <header className="similarity-map-hero">
        <div><span className="eyebrow">相似专题 · 学习图谱</span><h1>{recommended ? `下一步：${recommended.title}` : "五个构型都已完成"}</h1><p>先看清结构关系，再进入原有的学习、训练或复盘。</p></div>
        <div className="similarity-map-legend" aria-label="节点状态图例"><span>○ 可学习</span><span>◐ 进行中</span><span>● 已掌握</span><span>◇ 综合挑战</span></div>
      </header>

      <div className="similarity-map-layout">
        <div className="similarity-map-canvas" aria-label="相似专题学习路径">
          <div className="similarity-map-lane"><span>01</span><small>比例原型</small></div>
          <div className="similarity-map-node-slot slot-parallel"><MapNode node={map.nodes[0]} selected={selectedId === map.nodes[0]?.id} onSelect={setSelectedId} /></div>
          <div className="similarity-map-connector connector-one" aria-hidden="true" />
          <div className="similarity-map-lane lane-two"><span>02</span><small>组合建模</small></div>
          <div className="similarity-map-node-slot slot-auxiliary"><MapNode node={map.nodes[1]} selected={selectedId === map.nodes[1]?.id} onSelect={setSelectedId} /></div>
          <div className="similarity-map-node-slot slot-reverse"><MapNode node={map.nodes[2]} selected={selectedId === map.nodes[2]?.id} onSelect={setSelectedId} /></div>
          <div className="similarity-map-connector connector-two" aria-hidden="true" />
          <div className="similarity-map-lane lane-three"><span>03</span><small>构型迁移</small></div>
          <div className="similarity-map-node-slot slot-nested"><MapNode node={map.nodes[3]} selected={selectedId === map.nodes[3]?.id} onSelect={setSelectedId} /></div>
          <div className="similarity-map-node-slot slot-butterfly"><MapNode node={map.nodes[4]} selected={selectedId === map.nodes[4]?.id} onSelect={setSelectedId} /></div>
          <div className="similarity-map-challenges">
            {map.nodes.filter((node) => node.kind === "challenge").map((node) => <MapNode key={node.id} node={node} selected={selectedId === node.id} onSelect={setSelectedId} />)}
          </div>
        </div>

        <aside className="similarity-map-detail" aria-live="polite">
          {selected ? (
            <>
              <div className="similarity-detail-head"><span className={`similarity-state state-${selected.state}`}>{selected.kind === "challenge" ? "综合挑战" : STATE_COPY[selected.state]}</span><h2>{selected.title}</h2><p>{selected.actionLabel}</p></div>
              {selected.capabilityLabel ? <div className="similarity-detail-block"><small>本专题新增能力</small><strong>{selected.capabilityLabel}</strong></div> : null}
              {selected.missingPrerequisiteIds.length ? (
                <div className="similarity-detail-block is-warning"><small>还建议先具备</small><ul>{selected.missingPrerequisiteIds.map((id) => <li key={id}>{CAPABILITY_LABELS[id]}</li>)}</ul></div>
              ) : <div className="similarity-detail-block is-ready"><small>前置状态</small><strong>已具备开始条件</strong></div>}
              <div className="similarity-detail-actions">
                {selected.kind === "challenge" ? (
                  <>
                    <button className="btn btn-primary" type="button" disabled={starting} onClick={() => void startChallenge(selected)}>{selected.activeSessionId ? "继续挑战" : "直接挑战"}</button>
                    {selected.missingPrerequisiteIds.length && recommended?.kind === "topic" ? <button className="btn btn-ghost" type="button" onClick={() => setSelectedId(recommended.id)}>先补前置</button> : null}
                  </>
                ) : selected.state === "locked" ? (
                  <button className="btn btn-primary" type="button" onClick={() => recommended && setSelectedId(recommended.id)}>回到缺失前置</button>
                ) : selected.state === "mastered" ? (
                  <><button className="btn btn-primary" type="button" onClick={() => openTask(selected, "practice")}>再练一组</button><button className="btn btn-ghost" type="button" onClick={() => openTask(selected, "review")}>查看复盘</button></>
                ) : (
                  <><button className="btn btn-primary" type="button" onClick={() => openTask(selected, selected.state === "in_progress" && selected.activeSessionId ? "practice" : "learn")}>{selected.state === "in_progress" ? "继续学习" : "开始学习"}</button><button className="btn btn-ghost" type="button" onClick={() => openTask(selected, "practice")}>{selected.state === "in_progress" ? "继续训练" : "直接训练"}</button></>
                )}
              </div>
            </>
          ) : <p>选择一个节点查看详情。</p>}
        </aside>
      </div>
    </section>
  );
}

function MapNode({ node, selected, onSelect }: { node?: LearningMapNode; selected: boolean; onSelect: (id: string) => void }) {
  if (!node) return null;
  return (
    <button type="button" className={`similarity-map-node kind-${node.kind} state-${node.state} ${node.recommended ? "is-recommended" : ""} ${selected ? "is-selected" : ""}`} onClick={() => onSelect(node.id)} aria-pressed={selected}>
      <span className="material-symbols-outlined">{nodeIcon(node)}</span>
      <span><strong>{node.title}</strong><small>{node.recommended ? "建议下一步" : node.actionLabel}</small></span>
    </button>
  );
}

import { useState } from "react";
import type { ExerciseRuntimeSpec, SessionPhase } from "../../../../../shared/contracts";

export function GuideHUD({
  runtime,
  sessionPhase,
}: {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: SessionPhase;
}) {
  const [expanded, setExpanded] = useState(false);
  const currentIndex = runtime.instance.guide.stepItems.findIndex(
    (step) => step.stepId === runtime.runtimeState.currentStepId,
  );
  const current = runtime.instance.guide.stepItems[currentIndex];

  return (
    <aside className={`ks-guide-hud ${expanded ? "is-expanded" : ""}`}>
      <button className="ks-guide-hud-toggle" type="button" onClick={() => setExpanded((value) => !value)}>
        <span className="material-symbols-outlined">lightbulb</span>
        <span>
          <small>步骤 {currentIndex + 1} / {runtime.instance.guide.stepItems.length}</small>
          <strong>{current?.title || "当前步骤"}</strong>
        </span>
        <span className="material-symbols-outlined">{expanded ? "chevron_right" : "chevron_left"}</span>
      </button>

      {expanded && (
        <div className="ks-guide-hud-body">
          <p className={`ks-guide-status-copy ${sessionPhase}`}>{runtime.instance.guide.statusCopy}</p>
          <ol>
            {runtime.instance.guide.stepItems.map((step, index) => (
              <li key={step.stepId} className={`${step.status} ${index === currentIndex ? "current" : ""}`}>
                <span>{step.status === "done" ? "✓" : index + 1}</span>
                <div><strong>{step.title}</strong>{index === currentIndex && step.summary ? <p>{step.summary}</p> : null}</div>
              </li>
            ))}
          </ol>
          <div className="ks-guide-hint">
            <span>提示</span>
            <p>{runtime.instance.guide.hint || "先观察对象结构，再决定当前动作。"}</p>
          </div>
        </div>
      )}
    </aside>
  );
}

import { useState } from "react";
import type { ExerciseRuntimeSpec, SessionPhase } from "../../../../../shared/contracts";

export function GuideHUD({
  runtime,
  sessionPhase,
  defaultExpanded = false,
  staticMode = false,
}: {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: SessionPhase;
  defaultExpanded?: boolean;
  staticMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const currentIndex = runtime.instance.guide.stepItems.findIndex(
    (step) => step.stepId === runtime.runtimeState.currentStepId,
  );
  const current = runtime.instance.guide.stepItems[currentIndex];

  return (
    <aside className={`ks-guide-hud ${expanded ? "is-expanded" : ""} ${staticMode ? "is-static" : ""}`}>
      <button className="ks-guide-hud-toggle" type="button" disabled={staticMode} onClick={() => !staticMode && setExpanded((value) => !value)}>
        <span className="material-symbols-outlined">lightbulb</span>
        <span>
          <small>解题流程</small>
          <strong>{currentIndex + 1} / {runtime.instance.guide.stepItems.length}</strong>
        </span>
        {!staticMode ? <span className="material-symbols-outlined">{expanded ? "chevron_right" : "chevron_left"}</span> : null}
      </button>

      {expanded && (
        <div className="ks-guide-hud-body">
          <ol>
            {runtime.instance.guide.stepItems.map((step, index) => (
              <li key={step.stepId} className={`${step.status} ${index === currentIndex ? "current" : ""}`}>
                <span>{step.status === "done" ? "✓" : index + 1}</span>
                <div><strong>{step.title}</strong></div>
              </li>
            ))}
          </ol>
          <div className={`ks-guide-hint ${sessionPhase}`}>
            <span>提示</span>
            <p>{runtime.instance.guide.hint || "先观察对象结构，再决定当前动作。"}</p>
          </div>
        </div>
      )}
    </aside>
  );
}

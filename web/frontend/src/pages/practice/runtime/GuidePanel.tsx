import type { ExerciseRuntimeSpec, SessionPhase } from "../../../../../shared/contracts";

type GuidePanelProps = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: SessionPhase;
  taskGroup?: string;
  taskLabel?: string;
};

export function GuidePanel({ runtime, sessionPhase, taskGroup, taskLabel }: GuidePanelProps) {
  return (
    <aside className="ks-guide-panel">
      <div className="ks-guide-card">
        <div className="ks-guide-header">
          <div className="ks-guide-icon">
            <span className="material-symbols-outlined filled">lightbulb</span>
          </div>
          <div className="ks-guide-header-copy">
            <div>
              <h3>Solution Guide</h3>
              <p>{taskGroup || taskLabel || `${runtime.instance.engineKind} guide`}</p>
            </div>
            <span className="ks-guide-status-pill">Active</span>
          </div>
        </div>

        <div className="ks-guide-timeline">
          {runtime.instance.guide.stepItems.map((step, index) => {
            const isCurrent = runtime.runtimeState.currentStepId === step.stepId;
            return (
              <div key={step.stepId} className={`ks-guide-step ${step.status} ${isCurrent ? "current" : ""}`}>
                <div className="ks-guide-step-dot">
                  {step.status === "done" ? <span className="material-symbols-outlined">check</span> : <span>{index + 1}</span>}
                </div>
                <div className="ks-guide-step-copy">
                  <h4>{step.title}</h4>
                  <p>
                    {(isCurrent || step.status === "active" || step.status === "done") && step.summary
                      ? step.summary
                      : "Complete the active workspace action to unlock this step."}
                  </p>
                  {isCurrent ? (
                    <div className={`ks-guide-inline-note ${sessionPhase}`}>
                      {runtime.instance.guide.statusCopy}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="ks-pro-tip-card">
          <p className="ks-pro-tip-label">Pro Tip</p>
          <p className="ks-pro-tip-body">
            {runtime.instance.guide.hint || "Recognizing structure early makes the runtime steps faster to complete."}
          </p>
        </div>
      </div>
    </aside>
  );
}

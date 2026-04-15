import type { ExerciseRuntimeSpec, SessionPhase } from "../../../../../shared/contracts";

type GuidePanelProps = {
  runtime: ExerciseRuntimeSpec;
  sessionPhase: SessionPhase;
  taskGroup?: string;
};

export function GuidePanel({ runtime, sessionPhase, taskGroup }: GuidePanelProps) {
  return (
    <aside className="practice-guide-zone">
      <div className="practice-guide-timeline">
        <div className="timeline-header">
          {taskGroup ? <span className="task-group-tag">{taskGroup}</span> : null}
          <div className="task-banner-text">{runtime.instance.guide.banner}</div>
          <h2 className="guide-prompt">{runtime.instance.prompt}</h2>
          {runtime.instance.guide.hint ? <p className="guide-support-copy">{runtime.instance.guide.hint}</p> : null}
        </div>

        <div className="timeline-flow">
          {runtime.instance.guide.stepItems.map((step) => {
            const isCurrent = runtime.runtimeState.currentStepId === step.stepId;
            return (
              <div key={step.stepId} className={`step-flow-item ${step.status} ${isCurrent ? "current" : ""}`}>
                <div className="step-indicator" />
                <div className="step-content">
                  <strong>{step.title}</strong>
                  {(isCurrent || step.status === "active" || step.status === "done") && step.summary ? (
                    <p>{step.summary}</p>
                  ) : (
                    <p>请在左侧区域作答。</p>
                  )}
                  {isCurrent ? (
                    <div className={`step-inline-feedback ${sessionPhase}`}>
                      {runtime.instance.guide.statusCopy}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

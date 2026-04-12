import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { TaskNode } from "../../../../shared/contracts";

type Props = {
  task: TaskNode | null;
  anchorRect: DOMRect | null;
  contentRect: DOMRect | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

function buildPosition(anchorRect: DOMRect, contentRect: DOMRect): CSSProperties {
  const left = Math.max(contentRect.left + 24, anchorRect.right + 24);
  const top = Math.max(contentRect.top + 24, Math.min(anchorRect.top - 12, contentRect.bottom - 320));
  const maxWidth = Math.max(280, Math.min(380, window.innerWidth - left - 24));

  return {
    left,
    top,
    width: maxWidth,
  };
}

export function TaskPreviewPopover({ task, anchorRect, contentRect, onMouseEnter, onMouseLeave }: Props) {
  if (!task || !anchorRect || !contentRect) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="workspace-preview-popover panel"
      style={buildPosition(anchorRect, contentRect)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="dialog"
      aria-label={`${task.title} 预览`}
    >
      <div className="workspace-preview-head">
        <div className="eyebrow">{task.difficulty}</div>
        <h3>{task.title}</h3>
        <p className="text-muted">{task.summary}</p>
      </div>
      <article className="info-card">
        <h3>样题预览</h3>
        <p>{task.sample.prompt}</p>
      </article>
      <article className="info-card">
        <h3>解题步骤</h3>
        <ol className="steps-list">
          {task.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </article>
    </div>,
    document.body,
  );
}

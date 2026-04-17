import type { ChangeEvent } from "react";
import type { AngleEquationStepKey } from "../../../../../shared/angleEquation";

interface StepInputAreaProps {
  stepId: AngleEquationStepKey;
  selections: Record<string, string[]>;
  inputs: Record<string, string>;
  onToggleSelection: (key: string, value: string) => void;
  onInputChange: (key: string, value: string) => void;
  candidateAngles?: string[];
  filteredAngles?: string[];
  solutionCount?: number;
}

export function StepInputArea({
  stepId,
  selections,
  inputs,
  onToggleSelection,
  onInputChange,
  candidateAngles,
  filteredAngles,
}: StepInputAreaProps) {
  if (stepId === "find-angles") {
    // Find-angles uses the unit circle directly — no separate input area needed
    return (
      <div className="ae-step-area">
        <div className="ae-step-title">在单位圆上点击选择满足条件的角</div>
        <div className="ae-chip-list">
          {(selections["find-angles"] || []).map((angle) => (
            <span key={angle} className="ae-angle-chip is-selected">
              {angle}
            </span>
          ))}
          {(selections["find-angles"] || []).length === 0 && (
            <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
              未选择任何角
            </span>
          )}
        </div>
      </div>
    );
  }

  if (stepId === "transform-range") {
    return (
      <div className="ae-step-area">
        <div className="ae-step-title">输入变换后的范围端点</div>
        <div className="ae-range-input-row">
          <span className="ae-range-separator">[</span>
          <input
            placeholder="下界 (如 0, pi/6)"
            value={inputs["range-low"] || ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onInputChange("range-low", e.target.value)
            }
          />
          <span className="ae-range-separator">,</span>
          <input
            placeholder="上界 (如 4*pi, 13*pi/6)"
            value={inputs["range-high"] || ""}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              onInputChange("range-high", e.target.value)
            }
          />
          <span className="ae-range-separator">]</span>
        </div>
      </div>
    );
  }

  if (stepId === "filter-angles") {
    const candidates = candidateAngles || [];
    const selected = new Set(selections["filter-angles"] || []);

    return (
      <div className="ae-step-area">
        <div className="ae-step-title">从候选角中选出范围内的角</div>
        <div className="ae-chip-list">
          {candidates.map((angle) => (
            <span
              key={angle}
              className={`ae-angle-chip ${selected.has(angle) ? "is-selected" : ""}`}
              onClick={() => onToggleSelection("filter-angles", angle)}
            >
              {angle}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (stepId === "solve-target") {
    const angles = filteredAngles || [];
    return (
      <div className="ae-step-area">
        <div className="ae-step-title">对每个合法角输入解</div>
        <div className="ae-solution-inputs">
          {angles.map((angle, idx) => (
            <div key={angle} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", minWidth: "80px" }}>
                theta = {angle} →
              </span>
              <input
                placeholder={`解 ${idx + 1}`}
                value={inputs[`solution-${idx}`] || ""}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  onInputChange(`solution-${idx}`, e.target.value)
                }
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

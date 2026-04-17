import type { ChangeEvent } from "react";
import type { CoordIsoscelesStepKey, OptionItem } from "../../../../../shared/coordinateIsoscelesRight";

interface StepInputAreaProps {
  stepId: CoordIsoscelesStepKey;
  selections: Record<string, string[]>;
  inputs: Record<string, string>;
  onToggleSelection: (key: string, value: string) => void;
  onInputChange: (key: string, value: string) => void;
  constructionOptions: OptionItem[];
  congruenceOptions: OptionItem[];
  inputRefs: React.MutableRefObject<Record<string, HTMLInputElement | null>>;
}

export function StepInputArea({
  stepId,
  selections,
  inputs,
  onToggleSelection,
  onInputChange,
  constructionOptions,
  congruenceOptions,
  inputRefs,
}: StepInputAreaProps) {
  switch (stepId) {
    case "construct-lines":
      return (
        <div className="ir-option-list">
          <p className="ir-option-prompt">选择正确的辅助线构造方式：</p>
          {constructionOptions.map((opt) => {
            const selected = selections["construct-lines"]?.includes(opt.id);
            return (
              <button
                key={opt.id}
                className={`ir-option-item ${selected ? "is-selected" : ""}`}
                type="button"
                onClick={() => onToggleSelection("construct-lines", opt.id)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );

    case "identify-congruent":
      return (
        <div className="ir-option-list">
          <p className="ir-option-prompt">识别全等三角形与对应边：</p>
          {congruenceOptions.map((opt) => {
            const selected = selections["identify-congruent"]?.includes(opt.id);
            return (
              <button
                key={opt.id}
                className={`ir-option-item ${selected ? "is-selected" : ""}`}
                type="button"
                onClick={() => onToggleSelection("identify-congruent", opt.id)}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );

    case "setup-equations":
      return (
        <div className="ir-equation-inputs">
          <p className="ir-option-prompt">设 A(a, b)，列方程组：</p>
          <label className="ir-input-label">
            <span>方程 ①</span>
            <input
              ref={(node) => { inputRefs.current["equation-1"] = node; }}
              className="ir-input-field"
              placeholder="如：|0 - b| = |4 - a|"
              value={inputs["equation-1"] || ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onInputChange("equation-1", e.target.value)}
            />
          </label>
          <label className="ir-input-label">
            <span>方程 ②</span>
            <input
              ref={(node) => { inputRefs.current["equation-2"] = node; }}
              className="ir-input-field"
              placeholder="如：|0 - a| = |0 - b|"
              value={inputs["equation-2"] || ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onInputChange("equation-2", e.target.value)}
            />
          </label>
        </div>
      );

    case "solve-coordinates":
      return (
        <div className="ir-coordinate-inputs">
          <p className="ir-option-prompt">解方程组，求出 A 的坐标：</p>
          <label className="ir-input-label">
            <span>A 的横坐标 a</span>
            <input
              ref={(node) => { inputRefs.current["coord-a"] = node; }}
              className="ir-input-field"
              placeholder="整数"
              value={inputs["coord-a"] || ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onInputChange("coord-a", e.target.value)}
            />
          </label>
          <label className="ir-input-label">
            <span>A 的纵坐标 b</span>
            <input
              ref={(node) => { inputRefs.current["coord-b"] = node; }}
              className="ir-input-field"
              placeholder="整数"
              value={inputs["coord-b"] || ""}
              onChange={(e: ChangeEvent<HTMLInputElement>) => onInputChange("coord-b", e.target.value)}
            />
          </label>
        </div>
      );
  }
}

import {
  UNIT_CIRCLE_CX,
  UNIT_CIRCLE_CY,
  UNIT_CIRCLE_POINTS,
  UNIT_CIRCLE_R,
} from "../../../../../shared/angleEquation";

interface UnitCircleSVGProps {
  selectedAngles: string[];
  selectable: boolean;
  onToggleAngle: (angleId: string) => void;
}

export function UnitCircleSVG({
  selectedAngles,
  selectable,
  onToggleAngle,
}: UnitCircleSVGProps) {
  const selectedSet = new Set(selectedAngles);

  return (
    <div className="ae-unit-circle">
      <svg viewBox="0 0 280 280" width="100%" height="100%">
        {/* Axes */}
        <line className="ae-axis-line" x1={10} y1={UNIT_CIRCLE_CY} x2={270} y2={UNIT_CIRCLE_CY} />
        <line className="ae-axis-line" x1={UNIT_CIRCLE_CX} y1={10} x2={UNIT_CIRCLE_CX} y2={270} />

        {/* Unit circle */}
        <circle className="ae-circle-bg" cx={UNIT_CIRCLE_CX} cy={UNIT_CIRCLE_CY} r={UNIT_CIRCLE_R} />

        {/* Angle points */}
        {UNIT_CIRCLE_POINTS.map((pt) => {
          const isSelected = selectedSet.has(pt.id);
          return (
            <g key={pt.id}>
              {/* Larger hit target */}
              {selectable && (
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r={12}
                  fill="transparent"
                  onClick={() => onToggleAngle(pt.id)}
                  style={{ cursor: "pointer" }}
                />
              )}
              {/* Visible dot */}
              <circle
                className={`ae-angle-dot ${selectable ? "ae-selectable" : ""} ${isSelected ? "ae-selected" : ""}`}
                cx={pt.x}
                cy={pt.y}
                r={4}
                onClick={selectable ? () => onToggleAngle(pt.id) : undefined}
              />
              {/* Label */}
              <text
                className={`ae-angle-label ${isSelected ? "ae-selected" : ""}`}
                x={pt.labelX}
                y={pt.labelY}
              >
                {pt.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

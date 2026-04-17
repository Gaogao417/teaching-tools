import type { AngleEquationTrigFn } from "../../../../../shared/angleEquation";

// Standard angles and their SVG coordinates on a unit circle
// Circle center: (140, 140), radius: 110
const CX = 140;
const CY = 140;
const R = 110;

interface AnglePoint {
  id: string;
  label: string;
  x: number;
  y: number;
  labelX: number;
  labelY: number;
}

const STANDARD_ANGLES: AnglePoint[] = [
  { id: "0", label: "0", x: CX + R, y: CY, labelX: CX + R + 14, labelY: CY + 4 },
  { id: "pi/6", label: "pi/6", x: CX + R * Math.cos(Math.PI / 6), y: CY - R * Math.sin(Math.PI / 6), labelX: CX + R * Math.cos(Math.PI / 6) + 6, labelY: CY - R * Math.sin(Math.PI / 6) + 16 },
  { id: "pi/4", label: "pi/4", x: CX + R * Math.cos(Math.PI / 4), y: CY - R * Math.sin(Math.PI / 4), labelX: CX + R * Math.cos(Math.PI / 4) + 8, labelY: CY - R * Math.sin(Math.PI / 4) + 16 },
  { id: "pi/3", label: "pi/3", x: CX + R * Math.cos(Math.PI / 3), y: CY - R * Math.sin(Math.PI / 3), labelX: CX + R * Math.cos(Math.PI / 3) + 10, labelY: CY - R * Math.sin(Math.PI / 3) + 8 },
  { id: "pi/2", label: "pi/2", x: CX, y: CY - R, labelX: CX + 4, labelY: CY - R - 8 },
  { id: "2*pi/3", label: "2pi/3", x: CX - R * Math.cos(Math.PI / 3), y: CY - R * Math.sin(Math.PI / 3), labelX: CX - R * Math.cos(Math.PI / 3) - 28, labelY: CY - R * Math.sin(Math.PI / 3) + 8 },
  { id: "3*pi/4", label: "3pi/4", x: CX - R * Math.cos(Math.PI / 4), y: CY - R * Math.sin(Math.PI / 4), labelX: CX - R * Math.cos(Math.PI / 4) - 24, labelY: CY - R * Math.sin(Math.PI / 4) + 16 },
  { id: "5*pi/6", label: "5pi/6", x: CX - R * Math.cos(Math.PI / 6), y: CY - R * Math.sin(Math.PI / 6), labelX: CX - R * Math.cos(Math.PI / 6) - 22, labelY: CY - R * Math.sin(Math.PI / 6) + 16 },
  { id: "pi", label: "pi", x: CX - R, y: CY, labelX: CX - R - 14, labelY: CY + 4 },
  { id: "7*pi/6", label: "7pi/6", x: CX - R * Math.cos(Math.PI / 6), y: CY + R * Math.sin(Math.PI / 6), labelX: CX - R * Math.cos(Math.PI / 6) - 22, labelY: CY + R * Math.sin(Math.PI / 6) - 4 },
  { id: "5*pi/4", label: "5pi/4", x: CX - R * Math.cos(Math.PI / 4), y: CY + R * Math.sin(Math.PI / 4), labelX: CX - R * Math.cos(Math.PI / 4) - 24, labelY: CY + R * Math.sin(Math.PI / 4) - 4 },
  { id: "4*pi/3", label: "4pi/3", x: CX - R * Math.cos(Math.PI / 3), y: CY + R * Math.sin(Math.PI / 3), labelX: CX - R * Math.cos(Math.PI / 3) - 28, labelY: CY + R * Math.sin(Math.PI / 3) - 4 },
  { id: "3*pi/2", label: "3pi/2", x: CX, y: CY + R, labelX: CX + 4, labelY: CY + R + 14 },
  { id: "5*pi/3", label: "5pi/3", x: CX + R * Math.cos(Math.PI / 3), y: CY + R * Math.sin(Math.PI / 3), labelX: CX + R * Math.cos(Math.PI / 3) + 10, labelY: CY + R * Math.sin(Math.PI / 3) - 4 },
  { id: "7*pi/4", label: "7pi/4", x: CX + R * Math.cos(Math.PI / 4), y: CY + R * Math.sin(Math.PI / 4), labelX: CX + R * Math.cos(Math.PI / 4) + 8, labelY: CY + R * Math.sin(Math.PI / 4) - 4 },
  { id: "11*pi/6", label: "11pi/6", x: CX + R * Math.cos(Math.PI / 6), y: CY + R * Math.sin(Math.PI / 6), labelX: CX + R * Math.cos(Math.PI / 6) + 6, labelY: CY + R * Math.sin(Math.PI / 6) - 4 },
];

interface UnitCircleSVGProps {
  trigFn: AngleEquationTrigFn;
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
        <line className="ae-axis-line" x1={10} y1={CY} x2={270} y2={CY} />
        <line className="ae-axis-line" x1={CX} y1={10} x2={CX} y2={270} />

        {/* Unit circle */}
        <circle className="ae-circle-bg" cx={CX} cy={CY} r={R} />

        {/* Angle points */}
        {STANDARD_ANGLES.map((pt) => {
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

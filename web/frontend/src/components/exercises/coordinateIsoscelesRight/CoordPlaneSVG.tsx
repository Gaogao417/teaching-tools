import type { CoordPoint } from "../../../../../shared/coordinateIsoscelesRight";

interface CoordPlaneSVGProps {
  gridBounds: { xMin: number; xMax: number; yMin: number; yMax: number };
  B: CoordPoint;
  C: CoordPoint;
  solvedA?: CoordPoint | null;
  showAuxiliaryLines: boolean;
  highlightCongruent: boolean;
  svgSize?: number;
}

export function CoordPlaneSVG({
  gridBounds,
  B,
  C,
  solvedA,
  showAuxiliaryLines,
  highlightCongruent,
  svgSize = 340,
}: CoordPlaneSVGProps) {
  const { xMin, xMax, yMin, yMax } = gridBounds;
  const xRange = xMax - xMin;
  const yRange = yMax - yMin;
  const padding = 30;
  const plotW = svgSize - padding * 2;
  const plotH = svgSize - padding * 2;

  const toSvgX = (x: number) => padding + ((x - xMin) / xRange) * plotW;
  const toSvgY = (y: number) => svgSize - padding - ((y - yMin) / yRange) * plotH;

  // A is unknown until step 4 — use midpoint of solutions as placeholder for visual
  const aPlaceholder: CoordPoint = {
    x: (B.x + C.x) / 2 + (B.y - C.y) / 2,
    y: (C.x - B.x) / 2 + (B.y + C.y) / 2,
  };

  // Foot points for auxiliary lines
  const E: CoordPoint = { x: B.x, y: aPlaceholder.y }; // B → horizontal through A
  const F: CoordPoint = { x: aPlaceholder.x, y: C.y }; // C → vertical through A

  // Grid lines at integer coordinates
  const gridLinesX: number[] = [];
  const gridLinesY: number[] = [];
  for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x++) gridLinesX.push(x);
  for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y++) gridLinesY.push(y);

  return (
    <svg
      className="ir-coord-plane"
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      width={svgSize}
      height={svgSize}
    >
      {/* Grid lines */}
      {gridLinesX.map((x) => (
        <line
          key={`gx-${x}`}
          x1={toSvgX(x)}
          y1={padding}
          x2={toSvgX(x)}
          y2={svgSize - padding}
          stroke="var(--border-subtle)"
          strokeWidth={x === 0 ? 1.5 : 0.5}
        />
      ))}
      {gridLinesY.map((y) => (
        <line
          key={`gy-${y}`}
          x1={padding}
          y1={toSvgY(y)}
          x2={svgSize - padding}
          y2={toSvgY(y)}
          stroke="var(--border-subtle)"
          strokeWidth={y === 0 ? 1.5 : 0.5}
        />
      ))}

      {/* Axis labels */}
      {gridLinesX.map((x) => (
        <text
          key={`lx-${x}`}
          x={toSvgX(x)}
          y={svgSize - padding + 16}
          textAnchor="middle"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {x}
        </text>
      ))}
      {gridLinesY.map((y) => (
        <text
          key={`ly-${y}`}
          x={padding - 8}
          y={toSvgY(y) + 4}
          textAnchor="end"
          fontSize={10}
          fill="var(--text-muted)"
        >
          {y}
        </text>
      ))}

      {/* Auxiliary lines (after step 1) */}
      {showAuxiliaryLines && (
        <g className="ir-auxiliary-lines">
          {/* Horizontal line through A */}
          <line
            x1={padding}
            y1={toSvgY(aPlaceholder.y)}
            x2={svgSize - padding}
            y2={toSvgY(aPlaceholder.y)}
            stroke="var(--color-primary)"
            strokeWidth={1}
            strokeDasharray="4,3"
            opacity={0.6}
          />
          {/* Vertical line through A */}
          <line
            x1={toSvgX(aPlaceholder.x)}
            y1={padding}
            x2={toSvgX(aPlaceholder.x)}
            y2={svgSize - padding}
            stroke="var(--color-primary)"
            strokeWidth={1}
            strokeDasharray="4,3"
            opacity={0.6}
          />
          {/* Perpendicular B → E */}
          <line
            x1={toSvgX(B.x)}
            y1={toSvgY(B.y)}
            x2={toSvgX(E.x)}
            y2={toSvgY(E.y)}
            stroke="var(--color-warning)"
            strokeWidth={1.5}
            strokeDasharray="3,2"
          />
          {/* Perpendicular C → F */}
          <line
            x1={toSvgX(C.x)}
            y1={toSvgY(C.y)}
            x2={toSvgX(F.x)}
            y2={toSvgY(F.y)}
            stroke="var(--color-success)"
            strokeWidth={1.5}
            strokeDasharray="3,2"
          />
          {/* Foot points E, F */}
          <circle cx={toSvgX(E.x)} cy={toSvgY(E.y)} r={3} fill="var(--color-warning)" />
          <text x={toSvgX(E.x) + 6} y={toSvgY(E.y) - 4} fontSize={10} fill="var(--color-warning)">E</text>
          <circle cx={toSvgX(F.x)} cy={toSvgY(F.y)} r={3} fill="var(--color-success)" />
          <text x={toSvgX(F.x) + 6} y={toSvgY(F.y) - 4} fontSize={10} fill="var(--color-success)">F</text>
        </g>
      )}

      {/* Congruent triangle highlights (after step 2) */}
      {highlightCongruent && (
        <g className="ir-congruent-highlights" opacity={0.15}>
          {/* △ABE — blue */}
          <polygon
            points={`${toSvgX(aPlaceholder.x)},${toSvgY(aPlaceholder.y)} ${toSvgX(B.x)},${toSvgY(B.y)} ${toSvgX(E.x)},${toSvgY(E.y)}`}
            fill="var(--color-info)"
          />
          {/* △CAF — green */}
          <polygon
            points={`${toSvgX(aPlaceholder.x)},${toSvgY(aPlaceholder.y)} ${toSvgX(C.x)},${toSvgY(C.y)} ${toSvgX(F.x)},${toSvgY(F.y)}`}
            fill="var(--color-success)"
          />
        </g>
      )}

      {/* Triangle edges: A—B, A—C, B—C */}
      <line x1={toSvgX(B.x)} y1={toSvgY(B.y)} x2={toSvgX(C.x)} y2={toSvgY(C.y)} stroke="var(--text-primary)" strokeWidth={1.5} />
      <line x1={toSvgX(B.x)} y1={toSvgY(B.y)} x2={toSvgX(aPlaceholder.x)} y2={toSvgY(aPlaceholder.y)} stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="6,3" />
      <line x1={toSvgX(C.x)} y1={toSvgY(C.y)} x2={toSvgX(aPlaceholder.x)} y2={toSvgY(aPlaceholder.y)} stroke="var(--text-primary)" strokeWidth={1.5} strokeDasharray="6,3" />

      {/* Point B */}
      <circle cx={toSvgX(B.x)} cy={toSvgY(B.y)} r={5} fill="var(--color-primary)" />
      <text x={toSvgX(B.x) - 12} y={toSvgY(B.y) + 16} fontSize={12} fontWeight="bold" fill="var(--color-primary)">
        B({B.x},{B.y})
      </text>

      {/* Point C */}
      <circle cx={toSvgX(C.x)} cy={toSvgY(C.y)} r={5} fill="var(--color-primary)" />
      <text x={toSvgX(C.x) + 8} y={toSvgY(C.y) + 16} fontSize={12} fontWeight="bold" fill="var(--color-primary)">
        C({C.x},{C.y})
      </text>

      {/* Point A */}
      <circle cx={toSvgX(aPlaceholder.x)} cy={toSvgY(aPlaceholder.y)} r={5} fill="var(--color-warning)" stroke="var(--color-warning)" strokeWidth={2} />
      {solvedA ? (
        <text x={toSvgX(aPlaceholder.x) + 8} y={toSvgY(aPlaceholder.y) - 6} fontSize={12} fontWeight="bold" fill="var(--color-success)">
          A({solvedA.x},{solvedA.y})
        </text>
      ) : (
        <text x={toSvgX(aPlaceholder.x) + 8} y={toSvgY(aPlaceholder.y) - 6} fontSize={12} fontWeight="bold" fill="var(--color-warning)">
          A(?,?)
        </text>
      )}
    </svg>
  );
}

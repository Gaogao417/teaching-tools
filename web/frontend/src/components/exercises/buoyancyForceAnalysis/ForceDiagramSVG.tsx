import type { BuoyancyWorkspaceModel } from "../../../../../shared/buoyancyForceAnalysis";

interface ForceDiagramSVGProps {
  model: BuoyancyWorkspaceModel;
}

/**
 * SVG force diagram showing:
 * - Spring scale at top
 * - Object hanging from spring, partially submerged
 * - Cup on table with water
 * - 5 force arrows with labels (known = value, unknown = "?")
 */
export function ForceDiagramSVG({ model }: ForceDiagramSVGProps) {
  const { variables } = model;

  // Map variable data for easy lookup
  const varMap = new Map(variables.map((v) => [v.key, v]));

  return (
    <svg viewBox="0 0 320 380" className="bfa-diagram" aria-label="受力示意图">
      {/* Background */}
      <rect x="0" y="0" width="320" height="380" fill="none" />

      {/* ─── Table surface ─────────────────────────────────── */}
      <rect x="30" y="300" width="260" height="12" rx="2" className="bfa-table" />
      <text x="160" y="326" textAnchor="middle" className="bfa-label-muted">桌面</text>

      {/* ─── Cup (trapezoid) ───────────────────────────────── */}
      <path
        d="M 110 298 L 100 210 L 220 210 L 210 298 Z"
        className="bfa-cup"
      />

      {/* ─── Water fill ───────────────────────────────────── */}
      <path
        d="M 108 245 L 100 210 L 220 210 L 212 245 Z"
        className="bfa-water"
      />
      {/* Water surface line */}
      <line x1="108" y1="245" x2="212" y2="245" className="bfa-water-line" />

      {/* ─── Object (hanging from spring, partially submerged) ── */}
      <rect x="140" y="200" width="40" height="60" rx="3" className="bfa-object" />
      <text x="160" y="235" textAnchor="middle" className="bfa-label-object">物块</text>

      {/* ─── Spring scale ──────────────────────────────────── */}
      {/* Top mount */}
      <rect x="130" y="30" width="60" height="20" rx="4" className="bfa-scale" />
      <text x="160" y="44" textAnchor="middle" className="bfa-label-scale">测力计</text>

      {/* Spring (zigzag line) */}
      <path
        d="M 160 50 L 160 58 L 152 66 L 168 74 L 152 82 L 168 90 L 152 98 L 168 106 L 152 114 L 168 122 L 160 130"
        className="bfa-spring"
        fill="none"
      />

      {/* String from spring to object */}
      <line x1="160" y1="130" x2="160" y2="200" className="bfa-string" />

      {/* ─── Force arrows ──────────────────────────────────── */}

      {/* F (spring pull, upward on object) */}
      <line x1="170" y1="195" x2="170" y2="135" className="bfa-arrow-up" />
      <polygon points="170,130 165,140 175,140" className="bfa-arrow-up" />
      {renderForceLabel(175, 165, varMap.get("F")!, "F")}

      {/* Fb (buoyancy, upward on object from water) */}
      <line x1="190" y1="255" x2="190" y2="215" className="bfa-arrow-up" />
      <polygon points="190,210 185,220 195,220" className="bfa-arrow-up" />
      {renderForceLabel(195, 238, varMap.get("Fb")!, "F浮")}

      {/* Gobj (object weight, downward) */}
      <line x1="140" y1="260" x2="140" y2="305" className="bfa-arrow-down" />
      <polygon points="140,310 135,300 145,300" className="bfa-arrow-down" />
      {renderForceLabel(100, 288, varMap.get("Gobj")!, "G物")}

      {/* Gwater (water weight, downward on cup) */}
      <line x1="220" y1="230" x2="220" y2="275" className="bfa-arrow-down" />
      <polygon points="220,280 215,270 225,270" className="bfa-arrow-down" />
      {renderForceLabel(225, 258, varMap.get("Gwater")!, "G水")}

      {/* Ftable (table normal, upward on cup) */}
      <line x1="160" y1="295" x2="160" y2="340" className="bfa-arrow-up" />
      <polygon points="160,345 155,335 165,335" className="bfa-arrow-up" />
      {renderForceLabel(165, 322, varMap.get("Ftable")!, "F桌")}
    </svg>
  );
}

function renderForceLabel(
  x: number,
  y: number,
  variable: { value: number | null; unit: string; isKnown: boolean; label: string } | undefined,
  symbol: string,
) {
  if (!variable) return null;

  const displayValue = variable.isKnown
    ? `${variable.value} ${variable.unit}`
    : "?";

  return (
    <g>
      <text x={x} y={y} className={`bfa-force-label ${variable.isKnown ? "bfa-known" : "bfa-unknown"}`}>
        {symbol}
      </text>
      <text x={x} y={y + 13} className={`bfa-force-value ${variable.isKnown ? "bfa-known" : "bfa-unknown"}`}>
        {displayValue}
      </text>
    </g>
  );
}

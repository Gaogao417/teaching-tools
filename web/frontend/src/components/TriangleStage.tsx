import { Problem, Role, Side } from "../../../shared/contracts";

function sideMap(angle: "A" | "C"): Record<Role, Side> {
  if (angle === "C") {
    return { opposite: "AB", adjacent: "BC", hypotenuse: "AC" };
  }
  return { opposite: "BC", adjacent: "AB", hypotenuse: "AC" };
}

const roleColor: Record<Role, string> = {
  opposite: "var(--role-opposite)",
  adjacent: "var(--role-adjacent)",
  hypotenuse: "var(--role-hypotenuse)",
};

export function TriangleStage({
  problem,
  onRoleClick,
}: {
  problem: Problem;
  onRoleClick?: (role: Role) => void;
}) {
  const map = sideMap(problem.referenceAngle);
  const sideLabel = (side: Side) => {
    if (problem.type === "ratioToSide") {
      return side;
    }
    if (problem.type === "guidedSolve") {
      const given = problem.given.find((item) => item.edge === side);
      return given ? `${side} ${given.value}` : side;
    }
    return side;
  };

  const renderClickArea = (role: Role, x1: number, y1: number, x2: number, y2: number) => {
    if (!onRoleClick || problem.type !== "meaning") return null;
    return (
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth="24"
        onClick={() => onRoleClick(role)}
        style={{ cursor: "pointer" }}
      />
    );
  };

  return (
    <div className="triangle-stage">
      <svg viewBox="0 0 360 300" width="100%" height="100%" aria-label="直角三角形教具">
        <polygon points="52,224 284,224 284,64" fill="rgba(255,252,247,0.8)" />
        {renderClickArea("adjacent", 52, 224, 284, 224)}
        {renderClickArea("opposite", 284, 224, 284, 64)}
        {renderClickArea("hypotenuse", 52, 224, 284, 64)}
        <line x1="52" y1="224" x2="284" y2="224" stroke={roleColor.adjacent} strokeWidth="7" strokeLinecap="round" />
        <line x1="284" y1="224" x2="284" y2="64" stroke={roleColor.opposite} strokeWidth="7" strokeLinecap="round" />
        <line x1="52" y1="224" x2="284" y2="64" stroke={roleColor.hypotenuse} strokeWidth="7" strokeLinecap="round" />
        <path d="M252 224 L252 192 L284 192" stroke="#72808a" strokeWidth="4" fill="none" />
        <text x="47" y="230" className="vertex-label">A</text>
        <text x="279" y="230" className="vertex-label">B</text>
        <text x="279" y="70" className="vertex-label">C</text>
        <text x="170" y="248" textAnchor="middle" className="edge-label">{sideLabel(map.adjacent)}</text>
        <text x="304" y="150" textAnchor="middle" className="edge-label">{sideLabel(map.opposite)}</text>
        <text x="160" y="90" textAnchor="middle" className="edge-label">{sideLabel(map.hypotenuse)}</text>
      </svg>
    </div>
  );
}

interface EquationCardProps {
  equation: string;
  rangeText: string;
}

export function EquationCard({ equation, rangeText }: EquationCardProps) {
  return (
    <div className="ae-equation-card">
      <div className="ae-eq-line">{equation}</div>
      <div className="ae-range-line">{rangeText}</div>
    </div>
  );
}

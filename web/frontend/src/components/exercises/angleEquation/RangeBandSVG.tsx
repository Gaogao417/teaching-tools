interface RangeBandProps {
  unknownLabel: string;
  rangeLow: string;
  rangeHigh: string;
  transformedRange?: [string, string];
  markedAngles?: string[];
}

// Simple range band visualization.
// Shows a horizontal bar representing the range, with optional transformed range and angle markers.

export function RangeBandSVG({
  unknownLabel,
  rangeLow,
  rangeHigh,
}: RangeBandProps) {
  return (
    <div className="ae-range-band" title={`${unknownLabel} in [${rangeLow}, ${rangeHigh}]`}>
      <div className="ae-band-track" />
      <div
        className="ae-band-label"
        style={{ left: "8px", bottom: "2px" }}
      >
        {rangeLow}
      </div>
      <div
        className="ae-band-label"
        style={{ right: "8px", bottom: "2px" }}
      >
        {rangeHigh}
      </div>
    </div>
  );
}

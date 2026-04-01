type ChartPoint = {
  elapsedMs: number;
  clearedAt: string;
};

function formatSeconds(ms: number | null | undefined) {
  if (!Number.isFinite(ms)) return "--";
  return `${((ms || 0) / 1000).toFixed(1)}s`;
}

export function Chart({ points, color }: { points: ChartPoint[]; color: string }) {
  if (!points.length) {
    return <div className="chart-empty">暂无练习记录。</div>;
  }
  const width = 320;
  const height = 160;
  const left = 24;
  const bottom = 22;
  const top = 12;
  const values = points.map((point) => point.elapsedMs);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const innerWidth = width - left - 12;
  const innerHeight = height - top - bottom;
  const polyline = points
    .map((point, index) => {
      const x = left + (innerWidth * index) / Math.max(1, points.length - 1);
      const ratio = max === min ? 0.5 : (point.elapsedMs - min) / (max - min);
      const y = top + innerHeight - ratio * innerHeight;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="耗时折线">
        <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="rgba(97,91,76,0.28)" />
        <line x1={left} y1={height - bottom} x2={width - 10} y2={height - bottom} stroke="rgba(97,91,76,0.28)" />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="chart-caption">
        最快 {formatSeconds(min)} · 最慢 {formatSeconds(max)}
      </div>
    </div>
  );
}

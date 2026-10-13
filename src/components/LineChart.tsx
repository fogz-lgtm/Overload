import { useMemo, useRef, useState } from 'react';

export interface Point {
  x: number;
  y: number;
}

const W = 320;
const PAD = { top: 12, right: 8, bottom: 22, left: 40 };

function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = span / count / step;
  const nice = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * step;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice) ticks.push(v);
  return ticks;
}

/**
 * Single-series line chart: 2px line, ringed markers, recessive grid, and a
 * crosshair tooltip on hover/touch. The title outside the chart names the series.
 */
export function LineChart({
  points,
  height = 160,
  formatY,
  formatX = (x) => new Date(x).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  label,
}: {
  points: Point[];
  height?: number;
  formatY: (y: number) => string;
  formatX?: (x: number) => string;
  label: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const pad = (Math.max(...ys) - Math.min(...ys)) * 0.15 || Math.max(1, Math.max(...ys) * 0.1);
    const yMin = Math.max(0, Math.min(...ys) - pad);
    const yMax = Math.max(...ys) + pad;
    const innerW = W - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
    const sy = (y: number) => PAD.top + innerH - ((y - yMin) / (yMax - yMin || 1)) * innerH;
    return { sx, sy, ticks: niceTicks(yMin, yMax), innerH };
  }, [points, height]);

  if (points.length === 0) return null;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${geo.sx(p.x).toFixed(1)},${geo.sy(p.y).toFixed(1)}`).join('');

  const onMove = (clientX: number) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(geo.sx(points[i]!.x) - x) < Math.abs(geo.sx(points[best]!.x) - x)) best = i;
    }
    setHover(best);
  };

  const h = hover !== null ? points[hover] : undefined;
  const showEvery = Math.max(1, Math.ceil(points.length / 12));

  return (
    <div className="chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-label={label}
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerDown={(e) => onMove(e.clientX)}
        onPointerLeave={() => setHover(null)}
        style={{ touchAction: 'pan-y' }}
      >
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 6} y={geo.sy(t) + 4} textAnchor="end" fontSize={10} fill="var(--text-3)">
              {formatY(t)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={height - 4} fontSize={10} fill="var(--text-3)">
          {formatX(points[0]!.x)}
        </text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={height - 4} fontSize={10} fill="var(--text-3)" textAnchor="end">
            {formatX(points[points.length - 1]!.x)}
          </text>
        )}
        {h && (
          <line
            x1={geo.sx(h.x)}
            x2={geo.sx(h.x)}
            y1={PAD.top}
            y2={PAD.top + geo.innerH}
            stroke="var(--text-3)"
            strokeDasharray="3 3"
            strokeWidth={1}
          />
        )}
        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          i % showEvery === 0 || i === points.length - 1 || i === hover ? (
            <circle
              key={i}
              cx={geo.sx(p.x)}
              cy={geo.sy(p.y)}
              r={i === hover ? 5 : 4}
              fill="var(--series-1)"
              stroke="var(--surface-1)"
              strokeWidth={2}
            />
          ) : null,
        )}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(geo.sx(h.x) / W) * 100}%` }}>
          <strong className="num">{formatY(h.y)}</strong> <span className="faint">{formatX(h.x)}</span>
        </div>
      )}
    </div>
  );
}

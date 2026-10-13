import { useId, useMemo, useRef, useState } from 'react';

export interface Point {
  x: number;
  y: number;
}

const W = 340;
const PAD = { top: 14, right: 10, bottom: 24, left: 38 };

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
 * Single-series area chart: 2px volt line over a fading fill, recessive grid,
 * crosshair + tooltip on hover/touch. The card title names the series.
 */
export function LineChart({
  points,
  height = 170,
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
  const gid = `area${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const pad = (Math.max(...ys) - Math.min(...ys)) * 0.2 || Math.max(1, Math.max(...ys) * 0.1);
    const yMin = Math.max(0, Math.min(...ys) - pad);
    const yMax = Math.max(...ys) + pad;
    const innerW = W - PAD.left - PAD.right;
    const innerH = height - PAD.top - PAD.bottom;
    const sx = (x: number) => PAD.left + (xMax === xMin ? innerW / 2 : ((x - xMin) / (xMax - xMin)) * innerW);
    const sy = (y: number) => PAD.top + innerH - ((y - yMin) / (yMax - yMin || 1)) * innerH;
    return { sx, sy, ticks: niceTicks(yMin, yMax), innerH, base: PAD.top + innerH };
  }, [points, height]);

  if (points.length === 0) return null;
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${geo.sx(p.x).toFixed(1)},${geo.sy(p.y).toFixed(1)}`).join('');
  const area = `${line}L${geo.sx(points.at(-1)!.x).toFixed(1)},${geo.base}L${geo.sx(points[0]!.x).toFixed(1)},${geo.base}Z`;

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
  const last = points.at(-1)!;

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
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={geo.sy(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-3)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatY(t)}
            </text>
          </g>
        ))}
        <text x={PAD.left} y={height - 6} fontSize={10} fill="var(--text-3)">
          {formatX(points[0]!.x)}
        </text>
        {points.length > 1 && (
          <text x={W - PAD.right} y={height - 6} fontSize={10} fill="var(--text-3)" textAnchor="end">
            {formatX(last.x)}
          </text>
        )}
        {points.length > 1 && <path d={area} fill={`url(#${gid})`} />}
        <path d={line} fill="none" stroke="var(--chart)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <line x1={geo.sx(h.x)} x2={geo.sx(h.x)} y1={PAD.top} y2={geo.base} stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth={1} />
        )}
        {(h ? [h] : [last]).map((p) => (
          <circle key={p.x} cx={geo.sx(p.x)} cy={geo.sy(p.y)} r={5} fill="var(--chart)" stroke="var(--surface-1)" strokeWidth={2.5} />
        ))}
      </svg>
      {h && (
        <div className="tooltip" style={{ left: `${(geo.sx(h.x) / W) * 100}%`, top: `${(geo.sy(h.y) / height) * 100}%` }}>
          <strong className="num">{formatY(h.y)}</strong> <span className="faint">{formatX(h.x)}</span>
        </div>
      )}
    </div>
  );
}

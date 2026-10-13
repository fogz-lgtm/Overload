import { MUSCLES } from '../engine/muscles';
import type { MuscleId, RecoveryMap } from '../engine/types';

type Shape =
  | { m: MuscleId; d: string }
  | { m: MuscleId; e: [number, number, number, number] }
  | { m: MuscleId; r: [number, number, number, number] };

// Left-side shapes on a 120×252 canvas; the right side is mirrored around x=60.
const FRONT: Shape[] = [
  { m: 'traps', d: 'M53,39 L43,47 L54,47 Z' },
  { m: 'chest', d: 'M45,48 Q57,45 59.5,50 L59.5,70 Q50,75 44,68 Q41.5,58 45,48 Z' },
  { m: 'side_delts', e: [30, 58, 5, 9] },
  { m: 'front_delts', e: [38, 55, 7, 9] },
  { m: 'biceps', e: [30, 79, 6, 12] },
  { m: 'forearms', e: [27, 104, 5.5, 13] },
  { m: 'obliques', d: 'M44,75 Q49,74 50,77 L50,117 Q45,112 43,100 Z' },
  { m: 'abs', r: [51.5, 75, 8, 13] },
  { m: 'abs', r: [51.5, 90, 8, 13] },
  { m: 'abs', r: [51.5, 105, 8, 14] },
  { m: 'quads', d: 'M41,128 Q48,123 56,128 L55,176 Q48,186 43,178 Q37,152 41,128 Z' },
  { m: 'adductors', d: 'M55.5,129 L59.5,129 L59.5,162 Q55,150 55.5,129 Z' },
  { m: 'calves', e: [47, 211, 5.5, 18] },
];

const BACK: Shape[] = [
  { m: 'traps', d: 'M60,35 L60,79 L47,49 Z' },
  { m: 'side_delts', e: [30, 58, 5, 9] },
  { m: 'rear_delts', e: [38, 55, 7, 8] },
  { m: 'upper_back', d: 'M44,52 L55,62 L52,80 L43,72 Z' },
  { m: 'lats', d: 'M42,75 L52,82 L58,98 L52,117 Q44,104 41,88 Z' },
  { m: 'triceps', e: [30, 79, 6, 12] },
  { m: 'forearms', e: [27, 104, 5.5, 13] },
  { m: 'lower_back', r: [53.5, 99, 6.5, 23] },
  { m: 'glutes', d: 'M43,125 Q52,120 59.5,126 L59.5,148 Q50,154 43,146 Q40,134 43,125 Z' },
  { m: 'hamstrings', d: 'M43,153 Q50,157 58,153 L57,185 Q50,191 45,185 Q41,168 43,153 Z' },
  { m: 'calves', e: [48, 210, 7, 18] },
];

function Silhouette() {
  return (
    <g className="silhouette">
      <circle cx={60} cy={20} r={13} />
      <rect x={54} y={31} width={12} height={9} rx={3} />
      <circle cx={26} cy={122} r={4} />
      <circle cx={94} cy={122} r={4} />
      <ellipse cx={47} cy={240} rx={6} ry={4} />
      <ellipse cx={73} cy={240} rx={6} ry={4} />
    </g>
  );
}

export function fatigueFill(recovery: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, 1 - recovery)) * 100);
  return `color-mix(in oklab, var(--fatigue) ${pct}%, var(--muscle-fresh))`;
}

function ShapeEl({ s, recovery, selected, onSelect }: { s: Shape; recovery: RecoveryMap; selected?: MuscleId; onSelect?: (m: MuscleId) => void }) {
  const props = {
    className: `muscle${selected === s.m ? ' sel' : ''}`,
    style: { fill: fatigueFill(recovery[s.m]) },
    onClick: onSelect ? () => onSelect(s.m) : undefined,
  };
  const title = <title>{`${MUSCLES[s.m].name}: ${Math.round(recovery[s.m] * 100)}% recovered`}</title>;
  if ('d' in s) return <path d={s.d} {...props}>{title}</path>;
  if ('e' in s) return <ellipse cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} {...props}>{title}</ellipse>;
  return <rect x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={3} {...props}>{title}</rect>;
}

function Figure({ shapes, label, ...rest }: { shapes: Shape[]; label: string; recovery: RecoveryMap; selected?: MuscleId; onSelect?: (m: MuscleId) => void }) {
  // Shapes drawn on the midline (x reaching 60) still get mirrored; overlap is invisible.
  return (
    <svg viewBox="0 0 120 252" role="group" aria-label={label}>
      <Silhouette />
      {shapes.map((s, i) => (
        <ShapeEl key={`l${i}`} s={s} {...rest} />
      ))}
      <g transform="matrix(-1 0 0 1 120 0)">
        {shapes.map((s, i) => (
          <ShapeEl key={`r${i}`} s={s} {...rest} />
        ))}
      </g>
    </svg>
  );
}

export function BodyMap(props: { recovery: RecoveryMap; selected?: MuscleId; onSelect?: (m: MuscleId) => void }) {
  return (
    <div className="stack">
      <div className="bodymap">
        <Figure shapes={FRONT} label="Front muscles" {...props} />
        <Figure shapes={BACK} label="Back muscles" {...props} />
      </div>
      <div className="row small faint" aria-hidden="true">
        <span>Fresh</span>
        <span className="legend-ramp" />
        <span>Fatigued</span>
      </div>
    </div>
  );
}

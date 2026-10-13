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

const FRONT_SET = new Set(FRONT.map((s) => s.m));
const BACK_SET = new Set(BACK.map((s) => s.m));
const UPPER = new Set<MuscleId>(['chest', 'front_delts', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'forearms', 'traps', 'lats', 'upper_back', 'abs', 'obliques', 'lower_back']);

/** Body outline behind the muscles so the figure reads as one shape. */
function Silhouette() {
  return (
    <g className="silhouette">
      <circle cx={60} cy={20} r={12.5} />
      <rect x={54} y={30} width={12} height={10} rx={3} />
      <path d="M41,44 Q60,37 79,44 L82,121 Q60,129 38,121 Z" />
      <rect x={22.5} y={50} width={14} height={70} rx={7} />
      <rect x={83.5} y={50} width={14} height={70} rx={7} />
      <circle cx={26} cy={122} r={4} />
      <circle cx={94} cy={122} r={4} />
      <rect x={38.5} y={122} width={21} height={108} rx={9} />
      <rect x={60.5} y={122} width={21} height={108} rx={9} />
      <ellipse cx={47} cy={238} rx={6.5} ry={4} />
      <ellipse cx={73} cy={238} rx={6.5} ry={4} />
    </g>
  );
}

function ShapeEl({
  s,
  fill,
  title,
  selected,
  onSelect,
}: {
  s: Shape;
  fill: string;
  title?: string;
  selected?: boolean;
  onSelect?: (m: MuscleId) => void;
}) {
  const props = {
    className: `muscle${selected ? ' sel' : ''}`,
    style: { fill },
    onClick: onSelect ? () => onSelect(s.m) : undefined,
  };
  const t = title ? <title>{title}</title> : null;
  if ('d' in s) return <path d={s.d} {...props}>{t}</path>;
  if ('e' in s) return <ellipse cx={s.e[0]} cy={s.e[1]} rx={s.e[2]} ry={s.e[3]} {...props}>{t}</ellipse>;
  return <rect x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={3} {...props}>{t}</rect>;
}

interface FigureProps {
  view: 'front' | 'back';
  fill: (m: MuscleId) => string;
  title?: (m: MuscleId) => string;
  selected?: MuscleId;
  onSelect?: (m: MuscleId) => void;
  viewBox?: string;
  label: string;
  className?: string;
}

export function Figure({ view, fill, title, selected, onSelect, viewBox = '0 0 120 252', label, className }: FigureProps) {
  const shapes = view === 'front' ? FRONT : BACK;
  const draw = (s: Shape, i: number, side: string) => (
    <ShapeEl key={`${side}${i}`} s={s} fill={fill(s.m)} title={title?.(s.m)} selected={selected === s.m} onSelect={onSelect} />
  );
  return (
    <svg viewBox={viewBox} role="img" aria-label={label} className={className}>
      <Silhouette />
      {shapes.map((s, i) => draw(s, i, 'l'))}
      <g transform="matrix(-1 0 0 1 120 0)">{shapes.map((s, i) => draw(s, i, 'r'))}</g>
    </svg>
  );
}

export function fatigueFill(recovery: number): string {
  const pct = Math.round(Math.min(1, Math.max(0, 1 - recovery)) * 100);
  return `color-mix(in oklab, var(--fatigue) ${pct}%, var(--muscle-fresh))`;
}

/** Front + back recovery map, shaded on a single-hue fatigue ramp. */
export function BodyMap({ recovery, selected, onSelect, legend = true }: { recovery: RecoveryMap; selected?: MuscleId; onSelect?: (m: MuscleId) => void; legend?: boolean }) {
  const fill = (m: MuscleId) => fatigueFill(recovery[m]);
  const title = (m: MuscleId) => `${MUSCLES[m].name}: ${Math.round(recovery[m] * 100)}% recovered`;
  return (
    <div className="stack">
      <div className="bodymap">
        <Figure view="front" fill={fill} title={title} selected={selected} onSelect={onSelect} label="Front muscles" />
        <Figure view="back" fill={fill} title={title} selected={selected} onSelect={onSelect} label="Back muscles" />
      </div>
      {legend && (
        <div className="row small faint" aria-hidden="true">
          <span>Fresh</span>
          <span className="legend-ramp" />
          <span>Fatigued</span>
        </div>
      )}
    </div>
  );
}

/** Fill for a muscle in a "what does this train" diagram. */
export function targetFill(m: MuscleId, primary: MuscleId[], secondary: MuscleId[]): string {
  if (primary.includes(m)) return 'var(--muscle-hit)';
  if (secondary.includes(m)) return 'color-mix(in oklab, var(--muscle-hit) 34%, var(--muscle-base))';
  return 'var(--muscle-base)';
}

/**
 * Compact anatomy thumbnail lighting up the muscles an exercise (or workout)
 * trains. Picks the side and crop that shows them best.
 */
export function MuscleThumb({ primary, secondary = [], size = 48, label }: { primary: MuscleId[]; secondary?: MuscleId[]; size?: number; label?: string }) {
  const front = primary.filter((m) => FRONT_SET.has(m)).length;
  const back = primary.filter((m) => BACK_SET.has(m) && !FRONT_SET.has(m)).length;
  const view = back > front ? 'back' : 'front';
  const upper = primary.every((m) => UPPER.has(m));
  const lower = primary.every((m) => !UPPER.has(m));
  // Tight crops so a 40px tile still reads: shoulders→hips, or hips→feet.
  const viewBox = upper ? '19 30 82 92' : lower ? '31 118 58 118' : '6 6 108 240';
  return (
    <span
      className="muscle-thumb"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'var(--surface-2)',
        border: '1px solid var(--line)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <Figure
        view={view}
        viewBox={viewBox}
        fill={(m) => targetFill(m, primary, secondary)}
        label={label ?? `Works ${primary.map((m) => MUSCLES[m].name).join(', ')}`}
        className="thumb-figure"
      />
    </span>
  );
}

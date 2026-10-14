import { platesFor, type Kit } from '../engine/kit';
import type { Units } from '../engine/types';

// Competition plate colours by size (kg), with pound plates mapped to their nearest kg sibling.
const KG_COLOR: Record<number, string> = { 25: '#d6342c', 20: '#2f6fd6', 15: '#e7b416', 10: '#2f9e4f', 5: '#e9e9e4', 2.5: '#26282c', 1.25: '#a9adb3' };
const LB_AS_KG: Record<number, number> = { 45: 20, 35: 15, 25: 10, 10: 5, 5: 2.5, 2.5: 1.25 };

/** One side of a loaded bar, drawn to scale-ish, with the plate list underneath. Uses the gym's own plates. */
export function PlateStack({ totalKg, kit, units }: { totalKg: number; kit: Kit; units: Units }) {
  const { plates, remainder } = platesFor(totalKg, kit, units);
  const asKg = (p: number) => (units === 'kg' ? p : (LB_AS_KG[p] ?? p / 2.2));
  let x = 26;
  return (
    <div className="plate-stack">
      <svg width={168} height={44} viewBox="0 0 168 44" aria-hidden="true">
        <rect x={0} y={19} width={24} height={6} rx={2} fill="var(--text-3)" />
        <rect x={22} y={13} width={5} height={18} rx={1.5} fill="var(--text-2)" />
        <rect x={26} y={19.5} width={140} height={5} rx={2} fill="var(--surface-3)" />
        {plates.map((p, i) => {
          const kg = asKg(p);
          const h = 14 + Math.min(1, kg / 25) * 28;
          const w = kg >= 10 ? 9 : kg >= 2.5 ? 6 : 4.5;
          const el = <rect key={i} x={x + 1} y={22 - h / 2} width={w} height={h} rx={2} fill={KG_COLOR[kg] ?? '#888'} stroke="rgba(0,0,0,.25)" strokeWidth={0.6} />;
          x += w + 1.5;
          return el;
        })}
      </svg>
      <span className="small faint num">
        {plates.length ? `${plates.join(' + ')} ${units} per side` : 'Empty bar'}
        {remainder > 0 ? ` (+${remainder} unmatched)` : ''}
      </span>
    </div>
  );
}

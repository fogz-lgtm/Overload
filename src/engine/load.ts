import type { Kit } from './kit';
import type { Loading, Units } from './types';

export const LB_PER_KG = 2.20462262;

export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;
export const toDisplay = (kg: number, units: Units) => (units === 'kg' ? kg : kgToLb(kg));
export const fromDisplay = (value: number, units: Units) => (units === 'kg' ? value : lbToKg(value));

/** Formats a kg value in the user's units, trimming needless decimals. */
export function formatWeight(kg: number, units: Units, withUnit = true): string {
  const v = toDisplay(kg, units);
  const rounded = Math.round(v * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return withUnit ? `${text} ${units}` : text;
}

/** Whole display units, for estimates and bodyweight where a decimal is false precision. */
export function formatWeightWhole(kg: number, units: Units, withUnit = true): string {
  const v = Math.round(toDisplay(kg, units));
  return withUnit ? `${v} ${units}` : String(v);
}

/** Epley estimated one-rep max. `reps` should already include reps in reserve. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + Math.min(reps, 20) / 30);
}

/** Inverse Epley: the load you could lift for `reps` (to failure) at a given e1RM. */
export function weightForReps(e1rm: number, reps: number): number {
  if (reps <= 1) return e1rm;
  return e1rm / (1 + Math.min(reps, 20) / 30);
}

/** Smallest load change that's practical for this kind of equipment, in display units. */
export function loadIncrement(loading: Loading, units: Units): number {
  switch (loading) {
    case 'barbell':
      return units === 'kg' ? 2.5 : 5;
    case 'dumbbell':
      return units === 'kg' ? 2 : 5;
    case 'kettlebell':
      return units === 'kg' ? 4 : 10;
    case 'machine':
    case 'cable':
      return units === 'kg' ? 2.5 : 5;
    case 'bodyweight':
      return units === 'kg' ? 2.5 : 5;
    case 'band':
      return 0;
  }
}

/** Rounds a kg load to what's actually loadable, returning kg. */
export function roundLoad(kg: number, loading: Loading, units: Units): number {
  const step = loadIncrement(loading, units);
  if (step === 0 || kg <= 0) return Math.max(0, kg);
  const display = toDisplay(kg, units);
  const rounded = Math.max(step, Math.round(display / step) * step);
  return fromDisplay(rounded, units);
}

export const BAR_KG: Record<Units, number> = { kg: 20, lb: lbToKg(45) };
const PLATES: Record<Units, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};

/** Plates per side (display units) to reach a barbell load. Remainder is what couldn't be matched. */
export function platesPerSide(totalKg: number, units: Units): { plates: number[]; remainder: number } {
  const total = toDisplay(totalKg, units);
  const bar = toDisplay(BAR_KG[units], units);
  let perSide = Math.max(0, (total - bar) / 2);
  const plates: number[] = [];
  for (const p of PLATES[units]) {
    while (perSide + 1e-6 >= p) {
      plates.push(p);
      perSide -= p;
    }
  }
  return { plates, remainder: Math.round(perSide * 100) / 100 };
}

/** Ramp-up sets before the first heavy working set of a lift, on the loads `kit` allows. */
export function warmupSets(
  workingKg: number,
  loading: Loading,
  units: Units,
  heavy: boolean,
  emptyKg = loading === 'barbell' ? BAR_KG[units] : 0,
  kit?: Kit,
): { weightKg: number; reps: number }[] {
  const snap = kit ? kit.snap : (kg: number) => roundLoad(kg, loading, units);
  if (loading === 'bodyweight' || loading === 'band' || workingKg <= 0) return [];
  const scheme = heavy
    ? [
        [0.4, 8],
        [0.6, 5],
        [0.75, 3],
        [0.85, 1],
      ]
    : [
        [0.5, 8],
        [0.7, 4],
      ];
  const out: { weightKg: number; reps: number }[] = [];
  const floor = emptyKg;
  if (emptyKg > 0 && workingKg > emptyKg * 1.6) out.push({ weightKg: emptyKg, reps: 10 });
  for (const [pct, reps] of scheme) {
    const w = snap(Math.max(floor, workingKg * pct!));
    const last = out[out.length - 1];
    if (w >= workingKg - 1e-6) continue;
    if (last && w <= last.weightKg + 1e-6) continue;
    out.push({ weightKg: w, reps: reps! });
  }
  return out;
}

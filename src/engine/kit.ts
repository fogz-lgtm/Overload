import { BAR_KG, fromDisplay, toDisplay } from './load';
import type { Exercise, GymWeights, PlatePair, Units } from './types';

/** How an exercise is loaded, which decides the weights that are actually possible. */
export type Implement = 'barbell' | 'ez_bar' | 'trap_bar' | 'smith' | 'dumbbell' | 'kettlebell' | 'stack' | 'bodyweight' | 'band';

/** Standard plate sizes, heaviest first, in display units. */
export const PLATE_SIZES: Record<Units, number[]> = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25],
  lb: [45, 35, 25, 10, 5, 2.5],
};
/** More pairs than any lift will need: a commercial gym's plate tree. */
export const PLENTY = 99;

/** Default empty weight of each bar, in display units. */
export const DEFAULT_BARS: Record<Units, { barbell: number; ez_bar: number; trap_bar: number; smith: number }> = {
  kg: { barbell: 20, ez_bar: 10, trap_bar: 25, smith: 0 },
  lb: { barbell: 45, ez_bar: 25, trap_bar: 55, smith: 0 },
};

/** Default jumps where nothing is configured, in display units. */
const DEFAULT_STEP: Record<Units, { dumbbell: number; kettlebell: number; stack: number; bodyweight: number }> = {
  kg: { dumbbell: 2, kettlebell: 4, stack: 2.5, bodyweight: 2.5 },
  lb: { dumbbell: 5, kettlebell: 10, stack: 5, bodyweight: 5 },
};

const EPS = 0.01;
const MAX_PER_SIDE_KG = 300;

/**
 * The loads you can actually set up for one exercise at one gym, in kg.
 * The engine rounds every prescription through this.
 */
export interface Kit {
  implement: Implement;
  /** Lightest possible load: the empty bar, the smallest dumbbell. */
  min: number;
  /** Heaviest possible load, when the equipment caps it. */
  max?: number;
  /** The achievable load nearest to `kg`. */
  snap(kg: number): number;
  /** The next achievable load above `kg`, if there is one. */
  up(kg: number): number | undefined;
  /** The next achievable load below `kg`, if there is one. */
  down(kg: number): number | undefined;
  /** Plate-loaded implements: the bar and the plates there are to load it with. */
  bar?: number;
  plates?: PlatePair[];
}

export function implementOf(ex: Pick<Exercise, 'loading' | 'equipment'>): Implement {
  switch (ex.loading) {
    case 'barbell':
      if (ex.equipment.includes('trap_bar')) return 'trap_bar';
      if (ex.equipment.includes('ez_bar')) return 'ez_bar';
      if (ex.equipment.includes('smith_machine')) return 'smith';
      return 'barbell';
    case 'dumbbell':
      return 'dumbbell';
    case 'kettlebell':
      return 'kettlebell';
    case 'machine':
    case 'cable':
      return 'stack';
    case 'bodyweight':
      return 'bodyweight';
    case 'band':
      return 'band';
  }
}

/** What to call one unit of this equipment in a sentence: "the heaviest dumbbell". */
export function implementNoun(implement: Implement): string {
  switch (implement) {
    case 'dumbbell':
      return 'dumbbell';
    case 'kettlebell':
      return 'kettlebell';
    case 'stack':
      return 'stack setting';
    default:
      return 'load';
  }
}

export function defaultPlates(units: Units): PlatePair[] {
  return PLATE_SIZES[units].map((p) => ({ kg: fromDisplay(p, units), pairs: PLENTY }));
}

const cache = new Map<string, Kit>();

/** Everything that's loadable for `ex` given a gym's weights (or a well-stocked gym when absent). */
export function kitFor(ex: Pick<Exercise, 'loading' | 'equipment'>, weights: GymWeights | undefined, units: Units): Kit {
  const implement = implementOf(ex);
  const key = `${implement}|${units}|${JSON.stringify(weights ?? null)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const kit = buildKit(implement, weights, units);
  if (cache.size > 200) cache.clear();
  cache.set(key, kit);
  return kit;
}

function buildKit(implement: Implement, w: GymWeights | undefined, units: Units): Kit {
  const bars = DEFAULT_BARS[units];
  const plates = w?.plates?.length ? w.plates : defaultPlates(units);
  const steps = DEFAULT_STEP[units];
  switch (implement) {
    case 'barbell':
      return plateKit(implement, w?.barKg ?? BAR_KG[units], plates);
    case 'ez_bar':
      return plateKit(implement, w?.ezBarKg ?? fromDisplay(bars.ez_bar, units), plates);
    case 'trap_bar':
      return plateKit(implement, w?.trapBarKg ?? fromDisplay(bars.trap_bar, units), plates);
    case 'smith':
      return plateKit(implement, w?.smithBarKg ?? fromDisplay(bars.smith, units), plates);
    case 'dumbbell':
      return w?.dumbbells?.length ? listKit(implement, w.dumbbells) : stepKit(implement, fromDisplay(steps.dumbbell, units));
    case 'kettlebell':
      return w?.kettlebells?.length ? listKit(implement, w.kettlebells) : stepKit(implement, fromDisplay(steps.kettlebell, units));
    case 'stack':
      return stepKit(implement, w?.stackStepKg && w.stackStepKg > 0 ? w.stackStepKg : fromDisplay(steps.stack, units));
    case 'bodyweight':
      return stepKit(implement, fromDisplay(steps.bodyweight, units));
    case 'band':
      return { implement, min: 0, snap: (kg) => Math.max(0, kg), up: () => undefined, down: () => undefined };
  }
}

const key = (kg: number) => Math.round(kg * 1000);

/** A bar plus any combination of the plates on hand, loaded evenly on both sides. */
function plateKit(implement: Implement, bar: number, plates: PlatePair[]): Kit {
  let sides = new Map<number, number>([[0, 0]]);
  for (const p of plates) {
    if (!(p.kg > 0) || !(p.pairs > 0)) continue;
    const count = Math.min(p.pairs, Math.floor(MAX_PER_SIDE_KG / p.kg));
    const next = new Map(sides);
    for (const sum of sides.values()) {
      for (let n = 1; n <= count; n++) {
        const v = sum + n * p.kg;
        if (v > MAX_PER_SIDE_KG) break;
        next.set(key(v), v);
      }
    }
    sides = next;
  }
  const totals = [...sides.values()].map((s) => bar + 2 * s).filter((t) => t > 0);
  return { ...listKit(implement, totals.length ? totals : [Math.max(bar, EPS)]), bar, plates };
}

/** A fixed set of loads, like a dumbbell rack. */
function listKit(implement: Implement, values: number[]): Kit {
  const unique = new Map<number, number>();
  for (const v of values) if (v > 0) unique.set(key(v), v);
  const v = [...unique.values()].sort((a, b) => a - b);
  if (!v.length) return stepKit(implement, 1);
  // Index of the first load heavier than kg (+ tolerance).
  const above = (kg: number) => {
    let lo = 0;
    let hi = v.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (v[mid]! > kg + EPS) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  return {
    implement,
    min: v[0]!,
    max: v[v.length - 1]!,
    snap(kg) {
      if (kg <= 0) return 0;
      const i = above(kg);
      const lower = v[i - 1];
      const upper = v[i];
      if (lower === undefined) return upper!;
      if (upper === undefined) return lower;
      return kg - lower <= upper - kg ? lower : upper;
    },
    up: (kg) => v[above(kg)],
    down(kg) {
      for (let i = above(kg) - 1; i >= 0; i--) if (v[i]! < kg - EPS) return v[i];
      return undefined;
    },
  };
}

/** Any multiple of a step: pin-loaded stacks, or a gym with every dumbbell. */
function stepKit(implement: Implement, step: number): Kit {
  const n = (kg: number) => Math.round(kg / step);
  return {
    implement,
    min: step,
    snap: (kg) => (kg <= 0 ? 0 : Math.max(1, n(kg)) * step),
    up: (kg) => Math.max(1, Math.floor(kg / step + EPS) + 1) * step,
    down(kg) {
      const i = Math.ceil(kg / step - EPS) - 1;
      return i >= 1 ? i * step : undefined;
    },
  };
}

/** Plates per side (display units) for a plate-loaded total, using only the plates on hand. */
export function platesFor(totalKg: number, kit: Kit, units: Units): { plates: number[]; remainder: number } {
  const bar = kit.bar ?? 0;
  let perSide = Math.max(0, (totalKg - bar) / 2);
  const out: number[] = [];
  const sizes = [...(kit.plates ?? [])].filter((p) => p.kg > 0 && p.pairs > 0).sort((a, b) => b.kg - a.kg);
  for (const p of sizes) {
    let used = 0;
    while (used < p.pairs && perSide + EPS >= p.kg) {
      out.push(Math.round(toDisplay(p.kg, units) * 100) / 100);
      perSide -= p.kg;
      used++;
    }
  }
  return { plates: out, remainder: Math.max(0, Math.round(toDisplay(perSide, units) * 100) / 100) };
}

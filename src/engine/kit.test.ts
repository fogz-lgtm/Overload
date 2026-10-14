import { describe, expect, it } from 'vitest';
import { bench, dbBench, squat } from './__fixtures__/exercises';
import { kitFor, platesFor, PLENTY } from './kit';
import { lbToKg, toDisplay, warmupSets } from './load';
import { autoregulate, prescribe } from './progression';
import type { Exercise, GymWeights, PerformedSet, Profile, SetEntry } from './types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);
const lbProfile: Pick<Profile, 'goal' | 'experience' | 'units' | 'bodyweightKg'> = {
  goal: 'hypertrophy',
  experience: 'intermediate',
  units: 'lb',
  bodyweightKg: 80,
};
const lb = (...xs: number[]) => xs.map(lbToKg);
const asLb = (kg: number | undefined) => (kg === undefined ? undefined : Math.round(toDisplay(kg, 'lb') * 10) / 10);

function session(exerciseId: string, daysAgo: number, weightKg: number, reps: number[], rir = 2): PerformedSet[] {
  return reps.map((r, i) => ({ workoutId: `w${daysAgo}`, exerciseId, at: NOW - daysAgo * DAY + i * 60_000, weightKg, reps: r, rir, kind: 'working' as const }));
}

const homeRack: GymWeights = { dumbbells: lb(5, 10, 15, 20, 25, 30, 35, 40, 45, 50) };
const sparseRack: GymWeights = { dumbbells: lb(15, 25, 40) };
const homePlates: GymWeights = {
  barKg: lbToKg(45),
  plates: [
    { kg: lbToKg(45), pairs: 2 },
    { kg: lbToKg(25), pairs: 1 },
    { kg: lbToKg(10), pairs: 1 },
    { kg: lbToKg(5), pairs: 1 },
    { kg: lbToKg(2.5), pairs: 1 },
  ],
};

describe('kit', () => {
  it('only offers the dumbbells on the rack', () => {
    const kit = kitFor(dbBench, sparseRack, 'lb');
    expect(asLb(kit.min)).toBe(15);
    expect(asLb(kit.max)).toBe(40);
    expect(asLb(kit.snap(lbToKg(30)))).toBe(25);
    expect(asLb(kit.snap(lbToKg(36)))).toBe(40);
    expect(asLb(kit.snap(lbToKg(80)))).toBe(40);
    expect(asLb(kit.up(lbToKg(25)))).toBe(40);
    expect(asLb(kit.down(lbToKg(25)))).toBe(15);
    expect(kit.up(lbToKg(40))).toBeUndefined();
  });

  it('builds barbell loads from the plates on hand, both sides even', () => {
    const kit = kitFor(bench, homePlates, 'lb');
    expect(asLb(kit.min)).toBe(45);
    expect(asLb(kit.max)).toBe(310);
    expect(asLb(kit.snap(lbToKg(137)))).toBe(135);
    expect(asLb(kit.up(lbToKg(305)))).toBe(310);
    expect(kit.up(lbToKg(310))).toBeUndefined();
    expect(platesFor(lbToKg(310), kit, 'lb')).toEqual({ plates: [45, 45, 25, 10, 5, 2.5], remainder: 0 });
    expect(platesFor(lbToKg(185), kit, 'lb').plates).toEqual([45, 25]);
  });

  it('falls back to a well-stocked gym', () => {
    const kit = kitFor(squat, undefined, 'kg');
    expect(kit.min).toBe(20);
    expect(kit.max).toBeGreaterThan(500);
    expect(kit.snap(61.2)).toBe(60);
    expect(kitFor(dbBench, undefined, 'kg').snap(13)).toBe(14);
    expect(kitFor(squat, { plates: [{ kg: 20, pairs: PLENTY }] }, 'kg').up(60)).toBe(100);
  });

  it('rounds machines to the stack', () => {
    const machine: Exercise = { ...bench, id: 'machine-chest-press', equipment: ['machines'], loading: 'machine' };
    expect(asLb(kitFor(machine, { stackStepKg: lbToKg(10) }, 'lb').snap(lbToKg(52)))).toBe(50);
  });

  it('warms up on loads the plates can make', () => {
    const kit = kitFor(squat, { plates: [{ kg: 20, pairs: 1 }, { kg: 10, pairs: 1 }] }, 'kg');
    const sets = warmupSets(80, 'barbell', 'kg', true, kit.bar, kit);
    expect(sets.length).toBeGreaterThan(1);
    for (const s of sets) expect([20, 40, 60]).toContain(s.weightKg);
  });
});

describe('progression on real equipment', () => {
  it('adds reps once you are on the heaviest dumbbell', () => {
    const kit = kitFor(dbBench, homeRack, 'lb');
    const rx = prescribe({ exercise: dbBench, history: session(dbBench.id, 3, lbToKg(50), [10, 10, 10]), profile: lbProfile, sets: 3, now: NOW, kit });
    expect(asLb(rx.weightKg)).toBe(50);
    expect(rx.reps).toBe(11);
    expect(rx.rationale).toMatch(/heaviest dumbbell/);
  });

  it('builds reps before a big jump, then makes it', () => {
    const kit = kitFor(dbBench, { dumbbells: lb(15, 25, 30) }, 'lb');
    const hold = prescribe({ exercise: dbBench, history: session(dbBench.id, 3, lbToKg(25), [10, 10, 10]), profile: lbProfile, sets: 3, now: NOW, kit: kitFor(dbBench, sparseRack, 'lb') });
    expect(asLb(hold.weightKg)).toBe(25);
    expect(hold.reps).toBe(11);
    expect(hold.rationale).toMatch(/big jump/);

    // 25 → 30 lb is a normal step once the reps are there.
    const jump = prescribe({ exercise: dbBench, history: session(dbBench.id, 3, lbToKg(25), [10, 10, 10]), profile: lbProfile, sets: 3, now: NOW, kit });
    expect(asLb(jump.weightKg)).toBe(30);
  });

  it('adds a set when even maxed-out reps cannot bridge the gap', () => {
    const kit = kitFor(dbBench, sparseRack, 'lb');
    const rx = prescribe({ exercise: dbBench, history: session(dbBench.id, 3, lbToKg(25), [15, 15, 15]), profile: lbProfile, sets: 3, now: NOW, kit });
    expect(asLb(rx.weightKg)).toBe(25);
    expect(rx.sets).toBe(4);
  });

  it('caps a first session at the heaviest dumbbell, with more reps', () => {
    const kit = kitFor(dbBench, { dumbbells: lb(5, 10, 15) }, 'lb');
    const rx = prescribe({ exercise: dbBench, history: [], profile: { ...lbProfile, bodyweightKg: 100 }, sets: 3, now: NOW, kit });
    expect(asLb(rx.weightKg)).toBe(15);
    expect(rx.reps).toBeGreaterThan(8);
    expect(rx.rationale).toMatch(/heaviest dumbbell here/);
  });

  it('adapts when you train at a gym with lighter dumbbells', () => {
    const kit = kitFor(dbBench, homeRack, 'lb');
    const rx = prescribe({ exercise: dbBench, history: session(dbBench.id, 3, lbToKg(70), [8, 8, 8]), profile: lbProfile, sets: 3, now: NOW, kit });
    expect(asLb(rx.weightKg)).toBe(50);
    expect(rx.reps).toBeGreaterThan(9);
    expect(rx.rationale).toMatch(/heaviest dumbbell here/);
  });

  it('chases reps mid-workout when there is nothing heavier', () => {
    const kit = kitFor(dbBench, homeRack, 'lb');
    const w = lbToKg(50);
    const sets: SetEntry[] = [
      { id: 'a', kind: 'working', targetWeightKg: w, targetReps: 8, targetRir: 2, weightKg: w, reps: 13, rir: 4, done: true },
      { id: 'b', kind: 'working', targetWeightKg: w, targetReps: 8, targetRir: 2, done: false },
    ];
    const r = autoregulate(sets, 0, dbBench, 'lb', kit);
    expect(r.sets[1]!.targetWeightKg).toBe(w);
    expect(r.sets[1]!.targetReps).toBe(10);
    expect(r.note).toMatch(/heaviest dumbbell/);
  });

  it('jumps by the plates you have', () => {
    const kit = kitFor(bench, { plates: [{ kg: 5, pairs: PLENTY }] }, 'kg');
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 60, [10, 10, 10]), profile: { ...lbProfile, units: 'kg' }, sets: 3, now: NOW, kit });
    expect(rx.weightKg).toBe(70);
  });
});

describe('rounding to the rack', () => {
  it('rounds down rather than knock the reps out of range', () => {
    // A light lateral raise lands between the 5s and 10s: 10 would cost too many reps.
    const raise: Exercise = { ...dbBench, id: 'lateral-raise', mechanic: 'isolation', pattern: 'shoulder_isolation', primary: ['side_delts'], bwRatio: 0.045 };
    const kit = kitFor(raise, homeRack, 'lb');
    const rx = prescribe({ exercise: raise, history: [], profile: { ...lbProfile, experience: 'beginner' }, sets: 3, now: NOW, kit });
    expect(rx.reps).toBeGreaterThanOrEqual(rx.repRange[0]);
    expect(rx.reps).toBeLessThanOrEqual(rx.repRange[1] + 5);
  });
});

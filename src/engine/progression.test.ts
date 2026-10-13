import { describe, expect, it } from 'vitest';
import { bench, curl, dbBench, plank, pullUp, squat } from './__fixtures__/exercises';
import { autoregulate, prescribe } from './progression';
import type { PerformedSet, Profile } from './types';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 1);
const profile: Pick<Profile, 'goal' | 'experience' | 'units' | 'bodyweightKg'> = {
  goal: 'hypertrophy',
  experience: 'intermediate',
  units: 'kg',
  bodyweightKg: 80,
};

function session(
  exerciseId: string,
  daysAgo: number,
  weightKg: number,
  reps: number[],
  rir?: number,
  workoutId = `w-${exerciseId}-${daysAgo}`,
): PerformedSet[] {
  return reps.map((r, i) => ({
    workoutId,
    exerciseId,
    at: NOW - daysAgo * DAY + i * 60_000,
    weightKg,
    reps: r,
    rir,
    kind: 'working' as const,
  }));
}

describe('prescribe', () => {
  it('seeds a conservative first session from bodyweight', () => {
    const rx = prescribe({ exercise: bench, history: [], profile, sets: 3, now: NOW });
    expect(rx.calibrating).toBe(true);
    expect(rx.weightKg).toBeGreaterThan(20);
    expect(rx.weightKg).toBeLessThan(60);
    expect(rx.weightKg % 2.5).toBe(0);
  });

  it('seeds from a related exercise when available', () => {
    const history = session('barbell-bench-press', 3, 80, [10, 10, 10], 2);
    const rx = prescribe({
      exercise: dbBench,
      history: [],
      profile,
      sets: 3,
      now: NOW,
      related: [{ exercise: bench, history }],
    });
    expect(rx.rationale).toContain('Barbell Bench Press');
    // ~80 kg barbell ≈ 30–34 kg dumbbells per hand
    expect(rx.weightKg).toBeGreaterThanOrEqual(26);
    expect(rx.weightKg).toBeLessThanOrEqual(36);
  });

  it('adds load when every set hit the top of the range', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 80, [10, 10, 10], 1), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(82.5);
    expect(rx.reps).toBe(6);
  });

  it('uses bigger jumps on heavy squats and hinges', () => {
    const rx = prescribe({ exercise: squat, history: session(squat.id, 3, 100, [10, 10, 10], 1), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(105);
  });

  it('asks for one more rep when inside the range', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 80, [8, 7, 7], 1), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(80);
    expect(rx.reps).toBe(8);
  });

  it('holds reps when the last session was a grind', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 80, [8, 8, 8], 0), profile: { ...profile, experience: 'beginner' }, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(80);
    expect(rx.reps).toBe(8);
    expect(rx.rationale).toMatch(/close to failure/);
  });

  it('does not add load when reps were hit at failure', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 80, [10, 10, 10], 0), profile: { ...profile, experience: 'beginner' }, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(80);
  });

  it('drops the load when it was far too heavy', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 3, 100, [3, 2, 2], 0), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBeLessThan(100);
    expect(rx.reps).toBe(6);
  });

  it('deloads after three sessions without progress', () => {
    const history = [
      ...session(bench.id, 12, 90, [6, 6, 5]),
      ...session(bench.id, 9, 90, [5, 5, 5]),
      ...session(bench.id, 6, 90, [5, 5, 4]),
      ...session(bench.id, 3, 90, [5, 4, 4]),
    ];
    const rx = prescribe({ exercise: bench, history, profile, sets: 3, now: NOW });
    expect(rx.deload).toBe(true);
    expect(rx.weightKg).toBe(80);
    expect(rx.sets).toBe(2);
  });

  it('eases back in after a layoff', () => {
    const rx = prescribe({ exercise: bench, history: session(bench.id, 50, 100, [8, 8, 8]), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(80);
    expect(rx.rationale).toMatch(/weeks/);
  });

  it('progresses bodyweight work by reps', () => {
    const rx = prescribe({ exercise: pullUp, history: session(pullUp.id, 3, 0, [8, 7, 6]), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(0);
    expect(rx.reps).toBe(7);
  });

  it('prescribes holds in seconds', () => {
    const rx = prescribe({ exercise: plank, history: session(plank.id, 3, 0, [45, 45, 40]), profile, sets: 3, now: NOW });
    expect(rx.repRange).toEqual([20, 60]);
    expect(rx.reps).toBe(45);
  });

  it('uses dumbbell increments for dumbbell work', () => {
    const rx = prescribe({ exercise: curl, history: session(curl.id, 3, 12, [15, 15, 15], 2), profile, sets: 3, now: NOW });
    expect(rx.weightKg).toBe(14);
  });
});

describe('autoregulate', () => {
  const mk = (over: Partial<import('./types').SetEntry>[]): import('./types').SetEntry[] =>
    over.map((o, i) => ({ id: String(i), kind: 'working', targetWeightKg: 80, targetReps: 8, targetRir: 2, done: false, ...o }));

  it('bumps the remaining sets after an easy set', () => {
    const sets = mk([{ done: true, weightKg: 80, reps: 12 }, {}, {}]);
    const r = autoregulate(sets, 0, bench, 'kg');
    expect(r.sets[1]!.targetWeightKg).toBe(82.5);
    expect(r.sets[2]!.targetWeightKg).toBe(82.5);
    expect(r.note).toMatch(/bumped/);
  });

  it('drops the remaining sets after a grinder', () => {
    const sets = mk([{ done: true, weightKg: 80, reps: 4, rir: 0 }, {}]);
    const r = autoregulate(sets, 0, bench, 'kg');
    expect(r.sets[1]!.targetWeightKg).toBe(75);
  });

  it('leaves on-target sets and manually entered weights alone', () => {
    expect(autoregulate(mk([{ done: true, weightKg: 80, reps: 8 }, {}]), 0, bench, 'kg').note).toBeUndefined();
    const r = autoregulate(mk([{ done: true, weightKg: 80, reps: 12 }, { weightKg: 80 }]), 0, bench, 'kg');
    expect(r.sets[1]!.targetWeightKg).toBe(80);
  });

  it('ignores bodyweight work', () => {
    const sets = mk([{ done: true, weightKg: 0, reps: 20, targetWeightKg: 0 }, { targetWeightKg: 0 }]);
    expect(autoregulate(sets, 0, pullUp, 'kg').note).toBeUndefined();
  });
});

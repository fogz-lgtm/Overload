import { describe, expect, it } from 'vitest';
import { FIXTURE } from './__fixtures__/exercises';
import { computeRecovery, hoursUntilRecovered, muscleFatigue } from './recovery';
import type { PerformedSet } from './types';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 5, 1, 12);

const benchSets = (hoursAgo: number, n = 5): PerformedSet[] =>
  Array.from({ length: n }, () => ({
    workoutId: 'w',
    exerciseId: 'barbell-bench-press',
    at: NOW - hoursAgo * HOUR,
    weightKg: 80,
    reps: 8,
    rir: 2,
    kind: 'working' as const,
  })).map((s, i) => ({ ...s, at: s.at - i }));

describe('recovery', () => {
  it('is fully fresh with no training', () => {
    const r = computeRecovery([], [], FIXTURE, NOW);
    expect(Object.values(r).every((v) => v === 1)).toBe(true);
  });

  it('drains trained muscles and recovers them over time', () => {
    const just = computeRecovery(benchSets(0), [], FIXTURE, NOW);
    const dayLater = computeRecovery(benchSets(24), [], FIXTURE, NOW);
    const threeDays = computeRecovery(benchSets(72), [], FIXTURE, NOW);
    expect(just.chest).toBeCloseTo(0.5, 2);
    expect(dayLater.chest).toBeGreaterThan(just.chest);
    expect(threeDays.chest).toBeGreaterThan(0.9);
    // secondaries take a smaller hit
    expect(just.triceps).toBeGreaterThan(just.chest);
    expect(just.quads).toBe(1);
  });

  it('ignores warm-up sets', () => {
    const warm = benchSets(0).map((s) => ({ ...s, kind: 'warmup' as const }));
    expect(computeRecovery(warm, [], FIXTURE, NOW).chest).toBe(1);
  });

  it('counts a hard run against the legs', () => {
    const r = computeRecovery([], [{ id: 'a', kind: 'run', at: NOW - HOUR, minutes: 60, intensity: 'hard' }], FIXTURE, NOW);
    expect(r.calves).toBeLessThan(0.85);
    expect(r.chest).toBe(1);
  });

  it('estimates time until recovered', () => {
    const f = muscleFatigue(benchSets(0), [], FIXTURE, NOW);
    const h = hoursUntilRecovered('chest', f.chest);
    expect(h).toBeGreaterThan(24);
    expect(h).toBeLessThan(72);
    expect(hoursUntilRecovered('chest', 0)).toBe(0);
  });
});

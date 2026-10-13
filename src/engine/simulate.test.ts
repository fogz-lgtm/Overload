import { describe, expect, it } from 'vitest';
import { exerciseTrend, strengthScore } from './analytics';
import { EXERCISES } from './exercises';
import { flattenSets } from './history';
import { simulateHistory } from './simulate';
import type { Equipment, Profile } from './types';

const ALL: Equipment[] = ['barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar'];
const profile: Profile = {
  id: 'me', name: 'Alex', units: 'kg', bodyweightKg: 80, sex: 'male', experience: 'intermediate', goal: 'hypertrophy',
  daysPerWeek: 4, sessionMinutes: 60, activeGymId: 'g', onboarded: true, createdAt: 0,
};
const NOW = new Date(2026, 9, 13, 9).getTime();

describe('simulateHistory', () => {
  const { workouts, activities } = simulateHistory({ profile, gymId: 'g', equipment: ALL, exercises: EXERCISES, weeks: 8, now: NOW });
  const sets = flattenSets(workouts);

  it('produces a believable 8-week log', () => {
    expect(workouts.length).toBeGreaterThanOrEqual(26);
    expect(workouts.length).toBeLessThanOrEqual(32);
    expect(activities.length).toBeGreaterThan(5);
    expect(workouts.every((w) => w.finishedAt! < NOW && w.finishedAt! > w.startedAt!)).toBe(true);
    for (const s of sets) {
      expect(Number.isFinite(s.weightKg)).toBe(true);
      expect(s.reps).toBeGreaterThan(0);
    }
  });

  it('shows the engine driving real progress on repeated lifts', () => {
    const counts = new Map<string, number>();
    for (const w of workouts) for (const e of w.exercises) counts.set(e.exerciseId, (counts.get(e.exerciseId) ?? 0) + 1);
    const [topId, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    expect(n).toBeGreaterThanOrEqual(5);
    const trend = exerciseTrend(sets.filter((s) => s.exerciseId === topId));
    const first = trend[0]!;
    const last = trend[trend.length - 1]!;
    const metric = (p: typeof first) => (p.e1rmKg > 0 ? p.e1rmKg : p.bestReps);
    expect(metric(last)).toBeGreaterThan(metric(first));
    expect(strengthScore(sets, 80, 'male', NOW).lifts.length).toBeGreaterThan(0);
  });
});

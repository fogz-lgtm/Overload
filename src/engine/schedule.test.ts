import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { projectWorkouts, startOfWeek, trainingDays, trainingDaysText, weekday, addDays, type ProjectionInput } from './schedule';
import type { Equipment, Profile } from './types';

const ALL: Equipment[] = ['barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar'];
// Monday 1 June 2026, 7am local.
const MONDAY = new Date(2026, 5, 1, 7).getTime();

const profile: Profile = {
  id: 'me',
  name: 'Test',
  units: 'kg',
  bodyweightKg: 80,
  sex: 'unspecified',
  experience: 'intermediate',
  goal: 'hypertrophy',
  daysPerWeek: 3,
  sessionMinutes: 60,
  activeGymId: 'g',
  onboarded: true,
  createdAt: 0,
};

const input = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({
  profile,
  equipment: ALL,
  exercises: EXERCISES,
  history: [],
  prefs: {},
  activities: [],
  now: MONDAY,
  trainedToday: false,
  ...over,
});

describe('training days', () => {
  it('spreads a default week and honours a chosen one', () => {
    expect(trainingDays({ daysPerWeek: 3 })).toEqual([0, 2, 4]);
    expect(trainingDays({ daysPerWeek: 4 })).toEqual([0, 1, 3, 4]);
    expect(trainingDays({ daysPerWeek: 3, trainingDays: [5, 1, 3] })).toEqual([1, 3, 5]);
    expect(trainingDaysText([1, 3, 5])).toBe('Tue, Thu, Sat');
    expect(trainingDaysText([0, 1, 2, 3, 4])).toBe('Mon–Fri');
    expect(trainingDaysText([0, 1, 3, 4, 5])).toBe('Mon, Tue, Thu–Sat');
    expect(trainingDaysText([0, 1, 2, 3, 4, 5, 6])).toBe('Every day');
  });

  it('works in Monday-first weeks', () => {
    expect(weekday(MONDAY)).toBe(0);
    expect(weekday(addDays(MONDAY, 6))).toBe(6);
    expect(startOfWeek(addDays(MONDAY, 3))).toBe(new Date(2026, 5, 1).getTime());
  });
});

describe('projectWorkouts', () => {
  const ppl: Profile = { ...profile, split: { days: ['push', 'pull', 'legs'], order: 'rotate' }, trainingDays: [0, 2, 4] };

  it('lays the split over the training days', () => {
    const days = projectWorkouts(input({ profile: ppl }), addDays(startOfWeek(MONDAY), 6));
    expect(days.map((d) => weekday(d.day))).toEqual([0, 2, 4]);
    expect(days.map((d) => d.workout.focusKind)).toEqual(['push', 'pull', 'legs']);
    for (const d of days) expect(d.workout.exercises.length).toBeGreaterThan(2);
  });

  it('uses the waiting plan first, then carries the rotation on', () => {
    const plan = { name: 'Pull · Lats', focus: [], summary: '', estimatedMinutes: 50, exercises: [{ id: 'x', exerciseId: 'lat-pulldown', sets: [], restSec: 90, repRange: [8, 12] as [number, number], rationale: '' }], dayType: 'pull' as const };
    const days = projectWorkouts(input({ profile: ppl, plan, recentDays: ['push'] }), addDays(MONDAY, 6));
    expect(days[0]!.isPlan).toBe(true);
    expect(days.map((d) => d.workout.focusKind)).toEqual(['pull', 'legs', 'push']);
  });

  it('skips today once you have trained', () => {
    const days = projectWorkouts(input({ profile: ppl, trainedToday: true }), addDays(MONDAY, 6));
    expect(days.map((d) => weekday(d.day))).toEqual([2, 4]);
  });

  it('carries progression into later weeks', () => {
    const full: Profile = { ...profile, split: { days: ['full'], order: 'rotate' } };
    const days = projectWorkouts(input({ profile: full }), addDays(MONDAY, 13));
    expect(days.length).toBe(6);
    const first = days[0]!.workout.exercises[0]!;
    const later = days.slice(1).flatMap((d) => d.workout.exercises).find((we) => we.exerciseId === first.exerciseId);
    expect(later).toBeDefined();
    const top = (we: typeof first) => we.sets.find((s) => s.kind === 'working')!;
    const a = top(first);
    const b = top(later!);
    expect(b.targetWeightKg * (1 + (b.targetReps + b.targetRir) / 30)).toBeGreaterThanOrEqual(a.targetWeightKg * (1 + (a.targetReps + a.targetRir) / 30) - 0.01);
  });

  it('is quick enough to run on every render of the week view', () => {
    const t = performance.now();
    projectWorkouts(input({ profile: { ...ppl, trainingDays: [0, 1, 2, 3, 4, 5] } }), addDays(MONDAY, 27));
    expect(performance.now() - t).toBeLessThan(1500);
  });
});

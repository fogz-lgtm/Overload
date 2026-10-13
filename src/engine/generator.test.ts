import { describe, expect, it } from 'vitest';
import { EXERCISES, EXERCISE_BY_ID } from './exercises';
import { generateWorkout, isAvailable, swapOptions, type GenerateInput } from './generator';
import { MUSCLE_IDS } from './muscles';
import type { Equipment, MuscleId, PerformedSet, Profile, RecoveryMap } from './types';

const NOW = new Date(2026, 5, 3, 18).getTime();
const DAY = 86_400_000;
const ALL: Equipment[] = [
  'barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press',
  'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar',
];

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

const fresh = (): RecoveryMap => Object.fromEntries(MUSCLE_IDS.map((m) => [m, 1])) as RecoveryMap;
const zero = () => Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<MuscleId, number>;

function input(over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    profile,
    equipment: ALL,
    exercises: EXERCISES,
    history: [],
    recovery: fresh(),
    weekly: zero(),
    prefs: {},
    now: NOW,
    ...over,
  };
}

const exOf = (id: string) => EXERCISE_BY_ID[id]!;

describe('exercise library', () => {
  it('has unique ids, valid aliases, and covers every muscle', () => {
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length);
    for (const e of EXERCISES) for (const a of e.aliases ?? []) expect(EXERCISE_BY_ID[a], `${e.id} → ${a}`).toBeDefined();
    for (const m of MUSCLE_IDS) expect(EXERCISES.some((e) => e.primary.includes(m)), m).toBe(true);
  });
});

describe('generateWorkout', () => {
  it('builds a sensible full-body session for a fresh lifter', () => {
    const w = generateWorkout(input());
    expect(w.focusKind).toBe('full');
    expect(w.exercises.length).toBeGreaterThanOrEqual(4);
    expect(w.exercises.length).toBeLessThanOrEqual(9);
    expect(Math.abs(w.estimatedMinutes - 60)).toBeLessThanOrEqual(15);
    // compounds lead
    expect(exOf(w.exercises[0]!.exerciseId).mechanic).toBe('compound');
    // heavy lifts get warm-up sets
    expect(w.exercises.some((e) => e.sets.some((s) => s.kind === 'warmup'))).toBe(true);
    // every exercise has a reason
    for (const we of w.exercises) expect(we.rationale.length).toBeGreaterThan(10);
  });

  it('only uses equipment the gym has', () => {
    for (const equipment of [['pullup_bar'], ['dumbbells', 'bench'], []] as Equipment[][]) {
      const w = generateWorkout(input({ equipment }));
      expect(w.exercises.length).toBeGreaterThan(2);
      for (const we of w.exercises) expect(isAvailable(exOf(we.exerciseId), equipment), we.exerciseId).toBe(true);
    }
  });

  it('skips muscles that are still recovering', () => {
    const recovery = { ...fresh(), chest: 0.3 };
    const w = generateWorkout(input({ recovery, focus: 'push' }));
    for (const we of w.exercises) expect(exOf(we.exerciseId).primary).not.toContain('chest');
    expect(w.summary).toMatch(/chest/i);
  });

  it('picks the fresher half of an upper/lower split', () => {
    const recovery = { ...fresh(), chest: 0.4, lats: 0.4, upper_back: 0.45, side_delts: 0.5, biceps: 0.5, triceps: 0.5 };
    const w = generateWorkout(input({ recovery, profile: { ...profile, daysPerWeek: 4 } }));
    expect(w.focusKind).toBe('lower');
  });

  it('respects avoided muscles and excluded exercises', () => {
    const w = generateWorkout(input({ avoidMuscles: ['lower_back'], prefs: { 'barbell-back-squat': { exerciseId: 'barbell-back-squat', excluded: true } } }));
    for (const we of w.exercises) {
      expect(exOf(we.exerciseId).primary).not.toContain('lower_back');
      expect(we.exerciseId).not.toBe('barbell-back-squat');
    }
  });

  it('prefers exercises you have been progressing on', () => {
    const history: PerformedSet[] = [7, 14, 21].flatMap((d) =>
      [0, 1, 2].map((i) => ({ workoutId: `w${d}`, exerciseId: 'incline-dumbbell-press', at: NOW - d * DAY + i, weightKg: 26, reps: 9, kind: 'working' as const })),
    );
    const w = generateWorkout(input({ history, focus: 'push' }));
    expect(w.exercises.map((e) => e.exerciseId)).toContain('incline-dumbbell-press');
    const incline = w.exercises.find((e) => e.exerciseId === 'incline-dumbbell-press')!;
    expect(incline.sets.find((s) => s.kind === 'working')!.targetWeightKg).toBe(26);
  });

  it('is deterministic for a seed', () => {
    const a = generateWorkout(input({ seed: 42 }));
    const b = generateWorkout(input({ seed: 42 }));
    expect(a.exercises.map((e) => e.exerciseId)).toEqual(b.exercises.map((e) => e.exerciseId));
  });

  it('fits shorter sessions', () => {
    const w = generateWorkout(input({ minutes: 25 }));
    expect(w.exercises.length).toBeLessThanOrEqual(4);
    expect(w.estimatedMinutes).toBeLessThanOrEqual(35);
  });

  it('suggests swaps that hit the same muscles', () => {
    const opts = swapOptions(exOf('barbell-bench-press'), input(), ['barbell-bench-press']);
    expect(opts.length).toBeGreaterThan(2);
    for (const o of opts) expect(o.primary).toContain('chest');
    expect(opts[0]!.pattern).toBe('horizontal_push');
  });
});

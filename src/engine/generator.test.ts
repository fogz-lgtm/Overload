import { describe, expect, it } from 'vitest';
import { EXERCISES, EXERCISE_BY_ID } from './exercises';
import { dayTypeOf, generateWorkout, isAvailable, muscleFrequency, nextRotationIndex, SPLIT_PRESETS, swapOptions, type GenerateInput } from './generator';
import { MUSCLE_IDS } from './muscles';
import type { DayType, Equipment, MuscleId, PerformedSet, Profile, RecoveryMap } from './types';

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

  it('fills the session length it is given', () => {
    for (const minutes of [30, 45, 60]) {
      const w = generateWorkout(input({ focus: 'push', minutes, equipment: ['dumbbells', 'bench'] }));
      expect(w.estimatedMinutes, `${minutes} min`).toBeGreaterThanOrEqual(minutes - 8);
      expect(w.estimatedMinutes, `${minutes} min`).toBeLessThanOrEqual(minutes + 5);
    }
  });

  it('gives arms and delts their own work on the days built for them', () => {
    const push = generateWorkout(input({ focus: 'push', minutes: 50, equipment: ['dumbbells', 'bench'] }));
    expect(push.exercises.some((we) => exOf(we.exerciseId).primary.includes('triceps'))).toBe(true);
    expect(push.exercises.some((we) => exOf(we.exerciseId).primary.includes('side_delts') && exOf(we.exerciseId).mechanic === 'isolation')).toBe(true);
    const pull = generateWorkout(input({ focus: 'pull', minutes: 50 }));
    expect(pull.exercises.some((we) => exOf(we.exerciseId).primary.includes('biceps'))).toBe(true);
  });

  it('leads leg day with a squat that trains quads first', () => {
    for (let seed = 0; seed < 20; seed++) {
      const w = generateWorkout(input({ focus: 'legs', seed }));
      expect(exOf(w.exercises[0]!.exerciseId).primary[0], `seed ${seed}`).toBe('quads');
    }
  });

  it('suggests swaps that hit the same muscles', () => {
    const opts = swapOptions(exOf('barbell-bench-press'), input(), ['barbell-bench-press']);
    expect(opts.length).toBeGreaterThan(2);
    for (const o of opts) expect(o.primary).toContain('chest');
    expect(opts[0]!.pattern).toBe('horizontal_push');
  });
});

describe('splits', () => {
  const rotate = (days: DayType[]): Profile => ({ ...profile, daysPerWeek: 3, split: { days, order: 'rotate' } });

  it('runs a chosen split in order', () => {
    const p = rotate(['push', 'pull', 'core']);
    expect(generateWorkout(input({ profile: p, recentDays: [] })).focusKind).toBe('push');
    expect(generateWorkout(input({ profile: p, recentDays: ['push'] })).focusKind).toBe('pull');
    expect(generateWorkout(input({ profile: p, recentDays: ['pull', 'push'] })).focusKind).toBe('core');
    expect(generateWorkout(input({ profile: p, recentDays: ['core', 'pull'] })).focusKind).toBe('push');
  });

  it('keeps its place when a split repeats day types', () => {
    const ppl6: DayType[] = ['push', 'pull', 'legs', 'push', 'pull', 'legs'];
    expect(ppl6[nextRotationIndex(ppl6, ['push', 'legs'])]).toBe('pull');
    expect(ppl6[nextRotationIndex(ppl6, ['legs', 'pull'])]).toBe('push');
    // Push appears twice; what came before it says which one this was.
    const uneven: DayType[] = ['push', 'pull', 'push', 'legs'];
    expect(nextRotationIndex(uneven, ['push', 'pull'])).toBe(3);
    expect(nextRotationIndex(uneven, ['push', 'legs'])).toBe(1);
    // Days outside the split (a one-off arms day) don't break the rotation.
    expect(nextRotationIndex(['upper', 'lower'], ['arms', 'upper'])).toBe(1);
  });

  it('picks the freshest day when asked to', () => {
    const p: Profile = { ...profile, split: { days: ['push', 'pull', 'core'], order: 'smart' } };
    const recovery = { ...fresh(), chest: 0.3, triceps: 0.4, side_delts: 0.5, lats: 0.4, upper_back: 0.4, biceps: 0.5 };
    expect(generateWorkout(input({ profile: p, recovery })).focusKind).toBe('core');
  });

  it('a chosen split overrides the days-per-week default', () => {
    const p: Profile = { ...profile, daysPerWeek: 4, split: { days: ['full'], order: 'rotate' } };
    expect(generateWorkout(input({ profile: p })).focusKind).toBe('full');
  });

  it('builds focused body-part days', () => {
    const core = generateWorkout(input({ focus: 'core' }));
    expect(core.exercises.length).toBeGreaterThanOrEqual(2);
    for (const we of core.exercises) expect(exOf(we.exerciseId).primary.some((m) => ['abs', 'obliques', 'lower_back'].includes(m))).toBe(true);

    const chest = generateWorkout(input({ focus: 'chest' }));
    expect(exOf(chest.exercises[0]!.exerciseId).pattern).toBe('horizontal_push');
    expect(chest.name.startsWith('Chest')).toBe(true);

    const back = generateWorkout(input({ focus: 'back' }));
    expect(back.exercises.some((we) => exOf(we.exerciseId).pattern === 'vertical_pull')).toBe(true);
    expect(back.exercises.some((we) => exOf(we.exerciseId).pattern === 'horizontal_pull')).toBe(true);
  });

  it('sizes per-session volume by how often the split hits each muscle', () => {
    const ppc = rotate(['push', 'pull', 'core']);
    expect(muscleFrequency('chest', ppc)).toBe(1);
    expect(muscleFrequency('quads', ppc)).toBe(1); // never trained: neutral
    const ppl6: Profile = { ...profile, daysPerWeek: 6, split: { days: ['push', 'pull', 'legs'], order: 'rotate' } };
    expect(muscleFrequency('chest', ppl6)).toBe(2);
    expect(muscleFrequency('chest', { daysPerWeek: 4 })).toBe(2); // upper/lower default
  });

  it('reads the day type of older workouts from their name', () => {
    expect(dayTypeOf({ name: 'Push · Chest & Triceps' })).toBe('push');
    expect(dayTypeOf({ name: 'Arms & shoulders · Biceps' })).toBe('arms');
    expect(dayTypeOf({ name: 'Freestyle workout' })).toBeUndefined();
    expect(dayTypeOf({ name: 'Upper body · x', dayType: 'lower' })).toBe('lower');
  });

  it('every preset generates a workout for every one of its days', () => {
    for (const preset of SPLIT_PRESETS) {
      for (const day of preset.days) {
        const w = generateWorkout(input({ focus: day }));
        expect(w.exercises.length, `${preset.id}/${day}`).toBeGreaterThanOrEqual(2);
        expect(w.focusKind).toBe(day);
      }
    }
  });
});

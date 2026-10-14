import { describe, expect, it } from 'vitest';
import { EXERCISES } from './exercises';
import { applyDayEdit, exerciseIds, generateWorkout, recordSwap, swapOptions, withDayEdit, type GenerateInput } from './generator';
import { MUSCLE_IDS } from './muscles';
import { planDay, projectWorkouts, addDays, type ProjectionInput } from './schedule';
import type { Equipment, MuscleId, PerformedSet, Profile, RecoveryMap } from './types';
import { dayKey } from './util';

const ALL: Equipment[] = ['barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar'];
// Monday 1 June 2026, 7am local.
const MONDAY = new Date(2026, 5, 1, 7).getTime();
const DAY = 86_400_000;

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

const fresh = () => Object.fromEntries(MUSCLE_IDS.map((m) => [m, 1])) as RecoveryMap;
const zero = () => Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<MuscleId, number>;
const input = (over: Partial<GenerateInput> = {}): GenerateInput => ({
  profile,
  equipment: ALL,
  exercises: EXERCISES,
  history: [],
  recovery: fresh(),
  weekly: zero(),
  prefs: {},
  now: MONDAY,
  ...over,
});

/** A week ago, every exercise in `ids` done for 3×10. */
function doneBefore(ids: string[]): PerformedSet[] {
  return ids.flatMap((exerciseId) =>
    [0, 1, 2].map((i) => ({ workoutId: 'w', exerciseId, at: MONDAY - 7 * DAY + i * 60_000, weightKg: 40, reps: 10, rir: 2, kind: 'working' as const })),
  );
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

describe('re-rolling a session', () => {
  it('sticks with familiar lifts by default, but a re-roll changes most of them', () => {
    const first = exerciseIds(generateWorkout(input()).exercises);
    const history = doneBefore(first);
    const same = exerciseIds(generateWorkout(input({ history, seed: 99 })).exercises);
    // Continuity is what makes overload work: a new seed alone barely moves it.
    expect(overlap(same, first)).toBeGreaterThanOrEqual(first.length - 1);
    const rerolled = exerciseIds(generateWorkout(withDayEdit(input({ history }), { seed: 99, avoid: first })).exercises);
    expect(rerolled.length).toBeGreaterThanOrEqual(4);
    expect(overlap(rerolled, first)).toBeLessThanOrEqual(Math.floor(first.length / 3));
  });

  it('still builds a full session when there is little to swap to', () => {
    const dumbbells = input({ equipment: ['dumbbells', 'bench'] });
    const first = exerciseIds(generateWorkout(dumbbells).exercises);
    const rerolled = generateWorkout(withDayEdit(dumbbells, { seed: 5, avoid: first }));
    expect(rerolled.exercises.length).toBeGreaterThanOrEqual(first.length - 1);
  });
});

describe('swaps', () => {
  it('records, chains and cancels', () => {
    let edit = recordSwap(undefined, 'a', 'b');
    expect(edit.swaps).toEqual([{ from: 'a', to: 'b' }]);
    edit = recordSwap(edit, 'b', 'c');
    expect(edit.swaps).toEqual([{ from: 'a', to: 'c' }]);
    edit = recordSwap(edit, 'c', 'a');
    expect(edit.swaps).toEqual([]);
    edit = recordSwap({ seed: 3, avoid: ['x'] }, 'd', null);
    expect(edit).toEqual({ seed: 3, avoid: ['x'], swaps: [{ from: 'd', to: null }] });
  });

  it('applies to a rebuilt session, keeping sets and warm-up', () => {
    const base = input();
    const gen = generateWorkout(base);
    const lead = gen.exercises[0]!;
    const alt = swapOptions(EXERCISES.find((e) => e.id === lead.exerciseId)!, base, exerciseIds(gen.exercises), 1)[0]!;
    const last = gen.exercises.at(-1)!;
    const edited = applyDayEdit(gen, { swaps: [{ from: lead.exerciseId, to: alt.id }, { from: last.exerciseId, to: null }] }, base);
    expect(edited.exercises[0]!.exerciseId).toBe(alt.id);
    expect(edited.exercises.some((we) => we.exerciseId === last.exerciseId)).toBe(false);
    const working = (we: typeof lead) => we.sets.filter((s) => s.kind === 'working' && !s.drop).length;
    expect(working(edited.exercises[0]!)).toBe(working(lead));
    expect(edited.exercises[0]!.sets.some((s) => s.kind === 'warmup')).toBe(lead.sets.some((s) => s.kind === 'warmup') && alt.mechanic === 'compound');
    expect(edited.estimatedMinutes).not.toBe(0);
  });

  it('skips swaps that no longer fit', () => {
    const base = input();
    const gen = generateWorkout(base);
    const ids = exerciseIds(gen.exercises);
    // Not in the session; already in the session; not at this gym.
    const edited = applyDayEdit(
      gen,
      { swaps: [{ from: 'not-here', to: 'goblet-squat' }, { from: ids[1]!, to: ids[2]! }, { from: ids[0]!, to: 'nonexistent' }] },
      base,
    );
    expect(edited).toBe(gen);
  });
});

describe('edits in the forecast', () => {
  const proj = (over: Partial<ProjectionInput> = {}): ProjectionInput => ({ profile, equipment: ALL, exercises: EXERCISES, history: [], prefs: {}, activities: [], now: MONDAY, trainedToday: false, ...over });

  it('re-rolls and swaps one upcoming day', () => {
    const until = addDays(MONDAY, 6);
    const before = projectWorkouts(proj(), until);
    const wed = before.find((p) => new Date(p.day).getDay() === 3)!;
    const wedIds = exerciseIds(wed.workout.exercises);
    const target = wedIds[1]!;
    const edits = { [dayKey(wed.day)]: { seed: 42, avoid: wedIds, swaps: [] } };
    const after = projectWorkouts(proj({ profile: { ...profile, dayEdits: edits } }), until);
    const wed2 = after.find((p) => p.day === wed.day)!;
    expect(overlap(exerciseIds(wed2.workout.exercises), wedIds)).toBeLessThan(wedIds.length / 2);
    // Monday is untouched.
    expect(exerciseIds(after[0]!.workout.exercises)).toEqual(exerciseIds(before[0]!.workout.exercises));

    const swapped = projectWorkouts(proj({ profile: { ...profile, dayEdits: { [dayKey(wed.day)]: { swaps: [{ from: target, to: null }] } } } }), until);
    expect(exerciseIds(swapped.find((p) => p.day === wed.day)!.workout.exercises)).not.toContain(target);
  });

  it('knows which day the waiting plan is for', () => {
    expect(planDay(profile, MONDAY, false)).toBe(new Date(2026, 5, 1).getTime());
    // Trained Monday: the plan is for Wednesday. Tuesday is a rest day: also Wednesday.
    expect(planDay(profile, MONDAY, true)).toBe(new Date(2026, 5, 3).getTime());
    expect(planDay(profile, MONDAY + DAY, false)).toBe(new Date(2026, 5, 3).getTime());
  });
});

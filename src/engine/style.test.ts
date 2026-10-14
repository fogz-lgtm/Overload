import { describe, expect, it } from 'vitest';
import { detectPRs } from './analytics';
import { EXERCISES, EXERCISE_BY_ID } from './exercises';
import { estimateMinutes, generateWorkout, planExercise, type GenerateInput } from './generator';
import { MUSCLE_IDS } from './muscles';
import { autoregulate, schemeFor, takesDropSet } from './progression';
import type { Equipment, MuscleId, PerformedSet, Profile, RecoveryMap, SetEntry, TrainingStyle } from './types';

const NOW = new Date(2026, 5, 3, 18).getTime();
const ALL: Equipment[] = ['barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar'];
const base: Profile = {
  id: 'me', name: 'T', units: 'kg', bodyweightKg: 80, sex: 'unspecified', experience: 'intermediate', goal: 'hypertrophy',
  daysPerWeek: 4, sessionMinutes: 60, activeGymId: 'g', onboarded: true, createdAt: 0,
};
const ex = (id: string) => EXERCISE_BY_ID[id]!;
const input = (style?: TrainingStyle, over: Partial<GenerateInput> = {}): GenerateInput => ({
  profile: { ...base, style },
  equipment: ALL,
  exercises: EXERCISES,
  history: [],
  recovery: Object.fromEntries(MUSCLE_IDS.map((m) => [m, 1])) as RecoveryMap,
  weekly: Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<MuscleId, number>,
  prefs: {},
  now: NOW,
  seed: 3,
  ...over,
});

describe('workout style', () => {
  it('uses the lifter’s rest times and effort over the goal defaults', () => {
    const auto = schemeFor(base);
    expect(auto.restCompound).toBe(120);
    const mine = schemeFor({ ...base, style: { restCompoundSec: 90, restIsolationSec: 45, effort: -1 } });
    expect(mine.restCompound).toBe(90);
    expect(mine.restIsolation).toBe(45);
    expect(mine.rir).toBe(auto.rir - 1);
    expect(mine.heavyRestBonus).toBe(0);
    expect(schemeFor({ ...base, style: { effort: -1 } }).rir).toBeGreaterThanOrEqual(0);

    const w = generateWorkout(input({ restCompoundSec: 90, restIsolationSec: 45 }));
    for (const we of w.exercises) expect([90, 45]).toContain(we.restSec);
  });

  it('puts warm-ups where the lifter wants them', () => {
    const count = (style: TrainingStyle) => generateWorkout(input(style, { focus: 'full' })).exercises.filter((we) => we.sets.some((s) => s.kind === 'warmup')).length;
    expect(count({ warmups: 'off' })).toBe(0);
    expect(count({ warmups: 'first' })).toBe(1);
    expect(count({ warmups: 'main' })).toBe(2);
    expect(count({ warmups: 'all' })).toBeGreaterThan(2);
  });

  it('adds drop sets to the lifts the policy covers, never to barbells', () => {
    expect(takesDropSet(ex('lateral-raise'), 'isolation')).toBe(true);
    expect(takesDropSet(ex('machine-chest-press'), 'isolation')).toBe(false);
    expect(takesDropSet(ex('machine-chest-press'), 'most')).toBe(true);
    expect(takesDropSet(ex('barbell-back-squat'), 'most')).toBe(false);
    expect(takesDropSet(ex('pull-up'), 'most')).toBe(false);
    expect(takesDropSet(ex('lateral-raise'), 'off')).toBe(false);

    const we = planExercise(ex('lateral-raise'), input({ dropSets: 'isolation' }), 3, false);
    const working = we.sets.filter((s) => s.kind === 'working' && !s.drop);
    const drop = we.sets.at(-1)!;
    expect(working).toHaveLength(3);
    expect(drop.drop).toBe(true);
    expect(drop.targetWeightKg).toBeLessThan(working[0]!.targetWeightKg);
    expect(drop.targetRir).toBe(0);
    expect(we.rationale).toMatch(/drop set/);
  });

  it('counts a drop set as about 45 seconds, not a full set and rest', () => {
    const we = planExercise(ex('lateral-raise'), input({ dropSets: 'isolation' }), 3, false);
    const without = { ...we, sets: we.sets.filter((s) => !s.drop) };
    const diff = estimateMinutes([we]) * 60 - estimateMinutes([without]) * 60;
    expect(diff).toBeLessThanOrEqual(60);
  });

  it('keeps drop sets out of records and progression', () => {
    const set = (weightKg: number, reps: number, drop?: boolean): PerformedSet => ({ workoutId: 'a', exerciseId: 'lateral-raise', at: NOW, weightKg, reps, kind: 'working', ...(drop && { drop }) });
    const prior = [set(10, 12), set(10, 12)];
    expect(detectPRs([set(10, 12), set(7.5, 15, true)], prior)).toEqual([]);

    // A light drop set last session doesn't drag the next prescription down.
    const history = [set(10, 15), set(10, 15), set(10, 15), set(7.5, 20, true)].map((s, i) => ({ ...s, at: NOW - 3 * 86_400_000 + i }));
    const we = planExercise(ex('lateral-raise'), input(undefined, { history }), 3, false);
    expect(we.sets.find((s) => s.kind === 'working')!.targetWeightKg).toBeGreaterThanOrEqual(10);
  });

  it('retargets the drop set from the weight actually used, and leaves it alone otherwise', () => {
    const lateral = ex('lateral-raise');
    const sets: SetEntry[] = [
      { id: 'a', kind: 'working', targetWeightKg: 10, targetReps: 12, targetRir: 1, done: false },
      { id: 'b', kind: 'working', targetWeightKg: 10, targetReps: 12, targetRir: 1, done: false },
      { id: 'd', kind: 'working', drop: true, targetWeightKg: 8, targetReps: 12, targetRir: 0, done: false },
    ];
    // An easy first set bumps the second working set, not the drop.
    const first = autoregulate(sets.map((s, i) => (i === 0 ? { ...s, weightKg: 10, reps: 18, rir: 4, done: true } : s)), 0, lateral, 'kg');
    expect(first.sets[1]!.targetWeightKg).toBeGreaterThan(10);
    expect(first.sets[2]!.targetWeightKg).toBe(8);
    // The last working set done at 14 kg: the drop follows it down from there.
    const last = autoregulate(first.sets.map((s, i) => (i === 1 ? { ...s, weightKg: 14, reps: 12, rir: 1, done: true } : s)), 1, lateral, 'kg');
    expect(last.sets[2]!.targetWeightKg).toBeLessThan(14);
    expect(last.sets[2]!.targetWeightKg).toBeGreaterThan(8);
  });
});

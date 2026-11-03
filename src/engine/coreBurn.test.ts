import { describe, expect, it } from 'vitest';
import { buildCoreBurn, burnFor, coreRole, currentExercise, nextAfter, ROUND_REST_SEC, setOrder, TRANSITION_SEC, withCoreBurn } from './coreBurn';
import { EXERCISES, EXERCISE_BY_ID } from './exercises';
import type { GenerateInput } from './generator';
import { projectWorkouts } from './schedule';
import type { Equipment, PerformedSet, Profile, WorkoutExercise } from './types';
import { dayKey } from './util';

const NOW = new Date(2026, 10, 3, 18).getTime();
const profile: Profile = {
  id: 'me',
  name: 'Test',
  units: 'lb',
  bodyweightKg: 80,
  sex: 'male',
  experience: 'intermediate',
  goal: 'hypertrophy',
  daysPerWeek: 4,
  sessionMinutes: 45,
  activeGymId: 'g',
  onboarded: true,
  createdAt: 0,
};
const ALL: Equipment[] = ['barbell', 'squat_rack', 'bench', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine', 'pullup_bar', 'dip_station', 'bands', 'ez_bar', 'trap_bar'];
const input = (over: Partial<GenerateInput> = {}) => ({ profile, exercises: EXERCISES, equipment: ['dumbbells', 'bench'] as Equipment[], prefs: {}, history: [], now: NOW, ...over });
const role = (we: WorkoutExercise) => coreRole(EXERCISE_BY_ID[we.exerciseId]!);

describe('coreRole', () => {
  it('sorts core moves by what they ask of the trunk', () => {
    expect(coreRole(EXERCISE_BY_ID['crunch']!)).toBe('flex');
    expect(coreRole(EXERCISE_BY_ID['russian-twist']!)).toBe('rotate');
    expect(coreRole(EXERCISE_BY_ID['side-plank']!)).toBe('lateral');
    expect(coreRole(EXERCISE_BY_ID['plank']!)).toBe('brace');
    expect(coreRole(EXERCISE_BY_ID['turkish-get-up']!)).toBeNull();
    expect(coreRole(EXERCISE_BY_ID['suitcase-carry']!)).toBeNull();
    expect(coreRole(EXERCISE_BY_ID['barbell-back-squat']!)).toBeNull();
  });
});

describe('buildCoreBurn', () => {
  it.each([5, 8, 10])('fills about %i minutes with moves that each work the trunk differently', (minutes) => {
    const burn = buildCoreBurn(input(), minutes, { seed: 7 });
    expect(Math.abs(burn.estimate - minutes)).toBeLessThanOrEqual(1.5);
    expect(burn.exercises.length).toBeGreaterThanOrEqual(3);
    const ids = burn.exercises.map((e) => e.exerciseId);
    expect(new Set(ids).size).toBe(ids.length);
    const roles = burn.exercises.map(role);
    // One of each role before doubling up, finishing on a hold.
    expect(new Set(roles).size).toBe(Math.min(4, roles.length));
    expect(roles.at(-1)).toBe('brace');
    for (const we of burn.exercises) {
      expect(we.circuit).toBe('core-burn');
      expect(we.restSec).toBe(TRANSITION_SEC);
      expect(we.sets).toHaveLength(burn.rounds);
      expect(we.sets.every((s) => s.kind === 'working' && !s.drop && s.targetRir === 1)).toBe(true);
    }
  });

  it('only uses what the gym has and leaves out what the workout already does', () => {
    const burn = buildCoreBurn(input({ equipment: [] }), 8, { seed: 3, exclude: ['plank', 'crunch'] });
    for (const we of burn.exercises) {
      expect(EXERCISE_BY_ID[we.exerciseId]!.equipment).toEqual([]);
      expect(['plank', 'crunch']).not.toContain(we.exerciseId);
    }
  });

  it('honours favourites and exclusions', () => {
    const burn = buildCoreBurn(input({ prefs: { 'v-up': { exerciseId: 'v-up', favorite: true }, 'dead-bug': { exerciseId: 'dead-bug', excluded: true } } }), 5, { seed: 11 });
    const ids = burn.exercises.map((e) => e.exerciseId);
    expect(ids).toContain('v-up');
    expect(ids).not.toContain('dead-bug');
  });

  it('rebuilds a burn exactly as picked, and shuffles with a new seed', () => {
    for (const seed of [1, 2, 3, 4]) {
      const a = buildCoreBurn(input(), 8, { seed });
      const kept = buildCoreBurn(input(), 8, { seed: 99, moves: a.exercises.map((e) => e.exerciseId), rounds: a.rounds });
      expect(kept.exercises.map((e) => e.exerciseId)).toEqual(a.exercises.map((e) => e.exerciseId));
      expect(kept.rounds).toBe(a.rounds);
    }
    const seeds = new Set(Array.from({ length: 8 }, (_, i) => buildCoreBurn(input(), 8, { seed: i + 1 }).exercises.map((e) => e.exerciseId).join()));
    expect(seeds.size).toBeGreaterThan(1);
  });

  it('builds on last time', () => {
    const history: PerformedSet[] = [20, 18].map((reps, i) => ({ workoutId: 'w', exerciseId: 'crunch', at: NOW - 3 * 86_400_000 + i * 60_000, weightKg: 0, reps, kind: 'working' }));
    const burn = buildCoreBurn(input({ history }), 5, { moves: ['crunch'], seed: 2 });
    expect(burn.exercises.find((e) => e.exerciseId === 'crunch')!.sets[0]!.targetReps).toBe(22);
  });

  it('prefers floor moves to the cable stack in a full gym', () => {
    const counts = { bodyweight: 0, other: 0 };
    for (let seed = 1; seed <= 20; seed++)
      for (const we of buildCoreBurn(input({ equipment: ALL }), 8, { seed }).exercises) counts[EXERCISE_BY_ID[we.exerciseId]!.loading === 'bodyweight' ? 'bodyweight' : 'other']++;
    expect(counts.bodyweight).toBeGreaterThan(counts.other);
  });
});

describe('running a circuit', () => {
  const set = (done = false) => ({ id: Math.random().toString(36), kind: 'working' as const, targetWeightKg: 0, targetReps: 10, targetRir: 1, done });
  const we = (id: string, n: number, circuit?: string): WorkoutExercise => ({ id, exerciseId: id, sets: Array.from({ length: n }, () => set()), restSec: circuit ? TRANSITION_SEC : 90, repRange: [8, 12], rationale: '', circuit });
  const workout = () => [we('bench', 2), we('crunch', 2, 'core-burn'), we('twist', 2, 'core-burn'), we('plank', 2, 'core-burn')];
  const order = (ws: WorkoutExercise[]) => setOrder(ws).map((o) => `${o.we.id}${o.index + 1}`).join(' ');

  it('goes round by round through a circuit', () => {
    expect(order(workout())).toBe('bench1 bench2 crunch1 twist1 plank1 crunch2 twist2 plank2');
  });

  it('switches moves quickly and breathes between rounds', () => {
    const ws = workout();
    expect(nextAfter(ws, 'bench', 1)).toMatchObject({ we: { id: 'crunch' }, index: 0 });
    expect(nextAfter(ws, 'bench', 1)!.pause).toBeUndefined();
    expect(nextAfter(ws, 'crunch', 0)).toMatchObject({ we: { id: 'twist' }, index: 0, pause: TRANSITION_SEC });
    expect(nextAfter(ws, 'plank', 0)).toMatchObject({ we: { id: 'crunch' }, index: 1, pause: ROUND_REST_SEC });
    ws.forEach((w) => w.sets.forEach((s) => (s.done = true)));
    expect(nextAfter(ws, 'plank', 1)).toBeNull();
  });

  it('knows which exercise is up', () => {
    const ws = workout();
    ws[0]!.sets.forEach((s) => (s.done = true));
    ws[1]!.sets[0]!.done = true;
    expect(currentExercise(ws)!.id).toBe('twist');
  });
});

describe('the everyday core burn', () => {
  const withSetting = (minutes?: number): Profile => ({ ...profile, style: minutes ? { coreBurn: minutes } : undefined });
  const gen = () => ({ exercises: [] as WorkoutExercise[], estimatedMinutes: 40 });
  const est = (ws: WorkoutExercise[]) => ws.length;

  it('finishes every workout when it is on, with the same moves all day', () => {
    const morning = withCoreBurn(gen(), undefined, input({ profile: withSetting(8), now: new Date(2026, 10, 3, 7).getTime() }), est);
    const evening = withCoreBurn(gen(), undefined, input({ profile: withSetting(8), now: new Date(2026, 10, 3, 19).getTime() }), est);
    expect(morning.exercises.length).toBeGreaterThanOrEqual(3);
    expect(morning.exercises.every((e) => e.circuit === 'core-burn')).toBe(true);
    expect(evening.exercises.map((e) => e.exerciseId)).toEqual(morning.exercises.map((e) => e.exerciseId));
    expect(withCoreBurn(gen(), undefined, input({ profile: withSetting() }), est).exercises).toEqual([]);
  });

  it('stays off a day the lifter took it off, and follows their own pick', () => {
    expect(withCoreBurn(gen(), null, input({ profile: withSetting(8) }), est).exercises).toEqual([]);
    const own = withCoreBurn(gen(), { minutes: 5, moves: ['crunch', 'plank', 'russian-twist'], rounds: 2 }, input({ profile: withSetting() }), est);
    expect(own.exercises.map((e) => e.exerciseId)).toEqual(['crunch', 'russian-twist', 'plank']);
  });

  it('drops a reshaped everyday burn once the setting is off', () => {
    const reshaped = { minutes: 8, moves: ['crunch', 'plank', 'russian-twist'], rounds: 2, auto: true };
    expect(burnFor(reshaped, withSetting(8))).toBe(reshaped);
    expect(burnFor(reshaped, withSetting())).toBeUndefined();
  });

  it('shows in the forecast for every training day', () => {
    const until = new Date(2026, 10, 15).getTime();
    const base = { equipment: ['dumbbells', 'bench'] as Equipment[], exercises: EXERCISES, history: [], prefs: {}, activities: [], now: NOW, trainedToday: false };
    const days = projectWorkouts({ ...base, profile: withSetting(5) }, until);
    expect(days.length).toBeGreaterThan(2);
    for (const d of days) expect(d.workout.exercises.some((e) => e.circuit)).toBe(true);
    const skip = dayKey(days[1]!.day);
    const skipped = projectWorkouts({ ...base, profile: { ...withSetting(5), dayEdits: { [skip]: { coreBurn: null } } } }, until);
    expect(skipped.find((d) => dayKey(d.day) === skip)!.workout.exercises.some((e) => e.circuit)).toBe(false);
  });
});

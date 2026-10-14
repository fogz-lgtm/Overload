import { detectPRs, type PR } from '../engine/analytics';
import { EXERCISES } from '../engine/exercises';
import { dayTypeOf, generateWorkout, type Focus, type GenerateInput, type GeneratedWorkout } from '../engine/generator';
import { computeRecovery } from '../engine/recovery';
import { flattenSets } from '../engine/history';
import type { DayType, Exercise, ExercisePref, MuscleId, Split, Workout } from '../engine/types';
import { uid } from '../engine/util';
import { weeklySets } from '../engine/volume';
import { db } from './db';

export { flattenSets };

export async function allExercises(): Promise<Exercise[]> {
  const custom = await db.customExercises.toArray();
  return [...EXERCISES, ...custom];
}

export function exerciseMap(list: Exercise[]): Record<string, Exercise> {
  return Object.fromEntries(list.map((e) => [e.id, e]));
}

export async function prefsMap(): Promise<Record<string, ExercisePref>> {
  const prefs = await db.prefs.toArray();
  return Object.fromEntries(prefs.map((p) => [p.exerciseId, p]));
}

/** Everything the generator needs, loaded from the local database. */
export async function loadGenerateInput(
  opts: { focus?: Focus; minutes?: number; avoidMuscles?: MuscleId[]; seed?: number; gymId?: string } = {},
): Promise<GenerateInput> {
  const profile = await db.profile.get('me');
  if (!profile) throw new Error('Profile not set up');
  const gym = (await db.gyms.get(opts.gymId ?? profile.activeGymId)) ?? (await db.gyms.toCollection().first());
  const [workouts, activities, exercises, prefs] = await Promise.all([
    db.workouts.where('status').equals('done').toArray(),
    db.activities.toArray(),
    allExercises(),
    prefsMap(),
  ]);
  const now = Date.now();
  const history = flattenSets(workouts);
  const byId = exerciseMap(exercises);
  return {
    profile,
    equipment: gym?.equipment ?? [],
    exercises,
    history,
    recentDays: recentDayTypes(workouts),
    recovery: computeRecovery(history, activities, byId, now),
    weekly: weeklySets(history, byId, now),
    prefs,
    now,
    ...opts,
  };
}

/** Day types of finished workouts, newest first. */
export function recentDayTypes(workouts: Workout[]): DayType[] {
  return [...workouts]
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .map(dayTypeOf)
    .filter((d): d is DayType => !!d);
}

/** Saves a generated plan as a planned workout, replacing any previous unstarted plan. */
export async function savePlan(gen: GeneratedWorkout, gymId: string): Promise<string> {
  const id = uid();
  await db.transaction('rw', db.workouts, async () => {
    await db.workouts.where('status').equals('planned').delete();
    await db.workouts.add({
      id,
      name: gen.name,
      status: 'planned',
      createdAt: Date.now(),
      gymId,
      dayType: gen.focusKind,
      focus: gen.focus,
      summary: gen.summary,
      estimatedMinutes: gen.estimatedMinutes,
      exercises: gen.exercises,
    });
  });
  return id;
}

export async function generateAndSave(opts: Parameters<typeof loadGenerateInput>[0] = {}): Promise<string> {
  const input = await loadGenerateInput(opts);
  const gen = generateWorkout(input);
  const gymId = opts.gymId ?? input.profile.activeGymId;
  return savePlan(gen, gymId);
}

/** Saves the lifter's split (undefined: automatic) and rebuilds the waiting plan to follow it. */
export async function saveSplit(split: Split | undefined): Promise<void> {
  await db.profile.update('me', { split });
  if (!(await db.workouts.where('status').equals('active').count())) await generateAndSave();
}

export async function startWorkout(id: string): Promise<void> {
  // Only one active session at a time; an abandoned one is discarded.
  const active = await db.workouts.where('status').equals('active').toArray();
  for (const w of active) if (w.id !== id) await db.workouts.delete(w.id);
  await db.workouts.update(id, { status: 'active', startedAt: Date.now() });
}

export async function startEmptyWorkout(): Promise<string> {
  const profile = await db.profile.get('me');
  const id = uid();
  await db.workouts.add({
    id,
    name: 'Freestyle workout',
    status: 'planned',
    createdAt: Date.now(),
    gymId: profile?.activeGymId ?? '',
    focus: [],
    summary: 'Build it as you go.',
    estimatedMinutes: 0,
    exercises: [],
  });
  await startWorkout(id);
  return id;
}

export async function finishWorkout(id: string): Promise<PR[]> {
  const w = await db.workouts.get(id);
  if (!w) return [];
  // Drop exercises with nothing logged so they don't pollute history.
  const exercises = w.exercises.filter((we) => we.sets.some((s) => s.done));
  const finished: Workout = { ...w, exercises, status: 'done', finishedAt: Date.now() };
  const prior = flattenSets(await db.workouts.where('status').equals('done').toArray());
  await db.workouts.put(finished);
  return detectPRs(flattenSets([finished]), prior);
}

export async function discardWorkout(id: string): Promise<void> {
  await db.workouts.delete(id);
}

export async function setPref(exerciseId: string, patch: Partial<ExercisePref>): Promise<void> {
  const cur = (await db.prefs.get(exerciseId)) ?? { exerciseId };
  await db.prefs.put({ ...cur, ...patch });
}

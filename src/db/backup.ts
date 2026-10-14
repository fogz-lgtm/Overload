import { addedLoad, matchExercise, parseCsv, parseWorkoutCsv, type ImportedWorkout } from '../engine/importers';
import { isStravaCsv, parseStravaCsv } from '../engine/strava';
import type { Exercise, Loading, MovementPattern, MuscleId, Workout } from '../engine/types';
import { uid } from '../engine/util';
import { db } from './db';
import { allExercises, refreshPlan } from './repo';

const BACKUP_VERSION = 1;

export async function exportBackup(): Promise<string> {
  const [profile, gyms, workouts, activities, customExercises, prefs] = await Promise.all([
    db.profile.toArray(),
    db.gyms.toArray(),
    db.workouts.toArray(),
    db.activities.toArray(),
    db.customExercises.toArray(),
    db.prefs.toArray(),
  ]);
  // Never put the API key or Strava secrets in a file that might get shared.
  const safeProfile = profile.map(({ ai, strava: _strava, ...rest }) => (ai ? { ...rest, ai: { ...ai, apiKey: '' } } : rest));
  return JSON.stringify(
    {
      app: 'overload',
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      profile: safeProfile,
      gyms,
      workouts,
      activities,
      customExercises,
      prefs,
    },
    null,
    2,
  );
}

export async function restoreBackup(json: string): Promise<{ workouts: number }> {
  const data = JSON.parse(json);
  if (data?.app !== 'overload' || typeof data.version !== 'number') throw new Error('Not an Overload backup file');
  if (data.version > BACKUP_VERSION) throw new Error('Backup is from a newer version of Overload');
  const current = await db.profile.get('me');
  const existingKey = current?.ai?.apiKey;
  await db.transaction('rw', [db.profile, db.gyms, db.workouts, db.activities, db.customExercises, db.prefs], async () => {
    await Promise.all([
      db.profile.clear(),
      db.gyms.clear(),
      db.workouts.clear(),
      db.activities.clear(),
      db.customExercises.clear(),
      db.prefs.clear(),
    ]);
    // The device's own AI key and Strava connection stay.
    const profile = (data.profile ?? []).map((p: { ai?: { apiKey: string; model: string } }) => ({
      ...(p.ai && !p.ai.apiKey && existingKey ? { ...p, ai: { ...p.ai, apiKey: existingKey } } : p),
      ...(current?.strava ? { strava: current.strava } : {}),
    }));
    await db.profile.bulkPut(profile);
    await db.gyms.bulkPut(data.gyms ?? []);
    await db.workouts.bulkPut(data.workouts ?? []);
    await db.activities.bulkPut(data.activities ?? []);
    await db.customExercises.bulkPut(data.customExercises ?? []);
    await db.prefs.bulkPut(data.prefs ?? []);
  });
  return { workouts: (data.workouts ?? []).length };
}

/** One row per logged set — handy for spreadsheets. */
export async function exportCsv(): Promise<string> {
  const [workouts, exercises] = await Promise.all([db.workouts.where('status').equals('done').toArray(), allExercises()]);
  const names = Object.fromEntries(exercises.map((e) => [e.id, e.name]));
  const rows = [['date', 'workout', 'exercise', 'set', 'kind', 'weight_kg', 'reps', 'rir']];
  for (const w of workouts.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))) {
    const date = new Date(w.startedAt ?? w.createdAt).toISOString();
    for (const we of w.exercises) {
      we.sets
        .filter((s) => s.done)
        .forEach((s, i) => {
          rows.push([
            date,
            w.name,
            names[we.exerciseId] ?? we.exerciseId,
            String(i + 1),
            s.kind,
            String(Math.round((s.weightKg ?? 0) * 100) / 100),
            String(s.reps ?? ''),
            s.rir === undefined ? '' : String(s.rir),
          ]);
        });
    }
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Best-effort muscle/pattern guess for exercises we couldn't match to the library. */
export function guessExercise(name: string): Omit<Exercise, 'id' | 'name'> {
  const n = name.toLowerCase();
  const rules: [RegExp, MuscleId[], MovementPattern, 'compound' | 'isolation'][] = [
    [/leg extension/, ['quads'], 'knee_extension', 'isolation'],
    [/leg curl|hamstring curl/, ['hamstrings'], 'knee_flexion', 'isolation'],
    [/curl/, ['biceps'], 'elbow_flexion', 'isolation'],
    [/tricep|pushdown|skull|kickback/, ['triceps'], 'elbow_extension', 'isolation'],
    [/calf/, ['calves'], 'calf_raise', 'isolation'],
    [/upright row/, ['side_delts', 'traps'], 'shoulder_isolation', 'compound'],
    [/lateral raise|side raise/, ['side_delts'], 'shoulder_isolation', 'isolation'],
    [/rear delt|face pull|reverse fly/, ['rear_delts'], 'shoulder_isolation', 'isolation'],
    [/fly|flye|pec deck/, ['chest'], 'chest_isolation', 'isolation'],
    [/shrug/, ['traps'], 'shrug', 'isolation'],
    [/crunch|sit.?up|ab |abs|leg raise|plank/, ['abs'], 'core', 'isolation'],
    [/deadlift|rdl|good morning/, ['hamstrings', 'glutes'], 'hinge', 'compound'],
    [/hip thrust|glute bridge/, ['glutes'], 'hip_isolation', 'isolation'],
    [/lunge|split squat|step.?up/, ['quads', 'glutes'], 'lunge', 'compound'],
    [/squat|leg press|hack/, ['quads', 'glutes'], 'squat', 'compound'],
    [/pull.?down|pull.?up|chin.?up/, ['lats'], 'vertical_pull', 'compound'],
    [/row/, ['upper_back', 'lats'], 'horizontal_pull', 'compound'],
    [/overhead press|shoulder press|military|ohp/, ['front_delts', 'side_delts'], 'vertical_push', 'compound'],
    [/bench|chest press|push.?up|dip/, ['chest'], 'horizontal_push', 'compound'],
  ];
  const hit = rules.find(([re]) => re.test(n));
  const loading: Loading = /dumbbell|\bdb\b|renegade|arnold|hammer|spider|waiter|zottman|concentration/.test(n)
    ? 'dumbbell'
    : /cable/.test(n)
      ? 'cable'
      : /machine|press \(machine\)|smith|leg press/.test(n)
        ? 'machine'
        : /barbell|\bbb\b|ez/.test(n)
          ? 'barbell'
          : /kettlebell/.test(n)
            ? 'kettlebell'
            : /band/.test(n)
              ? 'band'
              : /pull.?up|chin.?up|push.?up|dip|plank|bodyweight/.test(n)
                ? 'bodyweight'
                : // Curls, raises and flies with no equipment named are usually dumbbell work.
                  hit && ['elbow_flexion', 'shoulder_isolation', 'chest_isolation'].includes(hit[2]) && !/leg curl|machine|cable/.test(n)
                  ? 'dumbbell'
                  : 'machine';
  return {
    primary: hit?.[1] ?? [],
    secondary: [],
    equipment: [],
    pattern: hit?.[2] ?? 'core',
    mechanic: hit?.[3] ?? 'isolation',
    loading,
    skill: 1,
    fatigue: hit?.[3] === 'compound' ? 2 : 1,
    cues: [],
    custom: true,
  };
}

export interface CsvImportSummary {
  format: string;
  imported: number;
  skipped: number;
  newExercises: string[];
  warnings: string[];
}

/**
 * Imports a Gravl, Strong or Hevy CSV export as completed workouts, or a
 * Strava activities.csv as cardio. Re-importing is safe.
 */
export async function importWorkoutCsv(text: string, strongUnit: 'kg' | 'lb'): Promise<CsvImportSummary> {
  const header = parseCsv(text.slice(0, text.search(/\r?\n/) >>> 0))[0];
  if (header && isStravaCsv(header)) return importStravaCsv(text);
  const result = parseWorkoutCsv(text, { strongUnit });
  const library = await allExercises();
  const profile = await db.profile.get('me');
  const existingStarts = new Set(
    (await db.workouts.toArray()).map((w) => w.startedAt).filter((t): t is number => t !== undefined),
  );
  const custom = new Map<string, Exercise>();
  const newExercises: string[] = [];

  // Never loaded in the whole file: a bodyweight move, whatever the name suggests ("Crunches" isn't a cable crunch).
  const loaded = new Set<string>();
  for (const w of result.workouts) for (const e of w.exercises) if (e.sets.some((s) => s.weightKg > 0)) loaded.add(e.name);
  const isFree = (ex: Pick<Exercise, 'loading'>) => ex.loading === 'bodyweight' || ex.loading === 'band';

  const resolve = (name: string): Exercise => {
    const unloaded = !loaded.has(name);
    const pool = [...library, ...custom.values()];
    // Same name first: a custom from this or an earlier import that fuzzy matching would skip ("Curl to Press").
    const lower = name.toLowerCase();
    const named = pool.find((e) => e.name.toLowerCase() === lower);
    const hit = named?.id ?? matchExercise(name, pool);
    const found = hit && pool.find((e) => e.id === hit);
    if (found && (!unloaded || isFree(found))) return found;
    const guess = guessExercise(name);
    const ex: Exercise = { id: `custom-${uid()}`, name, ...guess, ...(unloaded && !isFree(guess) ? { loading: 'bodyweight' as const } : {}) };
    custom.set(name.toLowerCase(), ex);
    newExercises.push(name);
    return ex;
  };
  const load = (ex: Exercise, kg: number) =>
    result.bodyweightIncluded && ex.loading === 'bodyweight' ? addedLoad(kg, profile?.bodyweightKg) : kg;

  const workouts: Workout[] = [];
  let skipped = 0;
  for (const iw of result.workouts) {
    if (existingStarts.has(iw.startedAt)) {
      skipped++;
      continue;
    }
    workouts.push(toWorkout(iw, resolve, load, profile?.activeGymId ?? ''));
  }
  await db.transaction('rw', db.workouts, db.customExercises, async () => {
    await db.customExercises.bulkPut([...custom.values()]);
    await db.workouts.bulkPut(workouts);
  });
  return { format: result.format, imported: workouts.length, skipped, newExercises, warnings: result.warnings };
}

async function importStravaCsv(text: string): Promise<CsvImportSummary> {
  const { activities, skipped: sessions, warnings } = parseStravaCsv(text);
  const existing = new Set((await db.activities.bulkGet(activities.map((a) => a.id))).filter(Boolean).map((a) => a!.id));
  const fresh = activities.filter((a) => !existing.has(a.id));
  await db.activities.bulkPut(fresh);
  if (fresh.some((a) => a.at > Date.now() - 2 * 86_400_000)) await refreshPlan();
  if (sessions > 0) warnings.push(`${sessions} weight training, yoga or very short session(s) were left out. Log lifting here instead.`);
  return { format: 'strava', imported: fresh.length, skipped: existing.size, newExercises: [], warnings };
}

function toWorkout(
  iw: ImportedWorkout,
  resolve: (name: string) => Exercise,
  load: (ex: Exercise, kg: number) => number,
  gymId: string,
): Workout {
  const end = iw.finishedAt ?? iw.startedAt + 60 * 60_000;
  return {
    id: uid(),
    name: iw.name || 'Imported workout',
    status: 'done',
    createdAt: iw.startedAt,
    startedAt: iw.startedAt,
    finishedAt: end,
    gymId,
    focus: [],
    summary: 'Imported',
    estimatedMinutes: Math.round((end - iw.startedAt) / 60_000),
    notes: iw.notes,
    exercises: iw.exercises.map((ie) => {
      const ex = resolve(ie.name);
      const reps = ie.sets.filter((s) => s.kind === 'working' && !s.drop).map((s) => s.reps);
      return {
        id: uid(),
        exerciseId: ex.id,
        restSec: 90,
        repRange: [Math.min(...reps, 8), Math.max(...reps, 12)] as [number, number],
        rationale: 'Imported',
        sets: ie.sets.map((s) => {
          const kg = load(ex, s.weightKg);
          return {
            id: uid(),
            kind: s.kind,
            targetWeightKg: kg,
            targetReps: s.reps,
            targetRir: s.rir ?? 2,
            weightKg: kg,
            reps: s.reps,
            rir: s.rir,
            done: true,
            completedAt: iw.startedAt,
            ...(s.drop ? { drop: true } : {}),
          };
        }),
      };
    }),
  };
}


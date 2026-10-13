import { matchExercise, parseWorkoutCsv, type ImportedWorkout } from '../engine/importers';
import type { Exercise, Loading, MovementPattern, MuscleId, Workout } from '../engine/types';
import { uid } from '../engine/util';
import { db } from './db';
import { allExercises } from './repo';

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
  // Never put the API key in a file that might get shared.
  const safeProfile = profile.map(({ ai, ...rest }) => (ai ? { ...rest, ai: { ...ai, apiKey: '' } } : rest));
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
  const existingKey = (await db.profile.get('me'))?.ai?.apiKey;
  await db.transaction('rw', [db.profile, db.gyms, db.workouts, db.activities, db.customExercises, db.prefs], async () => {
    await Promise.all([
      db.profile.clear(),
      db.gyms.clear(),
      db.workouts.clear(),
      db.activities.clear(),
      db.customExercises.clear(),
      db.prefs.clear(),
    ]);
    const profile = (data.profile ?? []).map((p: { ai?: { apiKey: string; model: string } }) =>
      p.ai && !p.ai.apiKey && existingKey ? { ...p, ai: { ...p.ai, apiKey: existingKey } } : p,
    );
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
  const loading: Loading = /dumbbell|\bdb\b/.test(n)
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

/** Imports a Strong or Hevy CSV export as completed workouts. Re-importing is safe. */
export async function importWorkoutCsv(text: string, strongUnit: 'kg' | 'lb'): Promise<CsvImportSummary> {
  const result = parseWorkoutCsv(text, { strongUnit });
  const library = await allExercises();
  const profile = await db.profile.get('me');
  const existingStarts = new Set(
    (await db.workouts.toArray()).map((w) => w.startedAt).filter((t): t is number => t !== undefined),
  );
  const custom = new Map<string, Exercise>();
  const newExercises: string[] = [];

  const resolve = (name: string): string => {
    const hit = matchExercise(name, [...library, ...custom.values()]);
    if (hit) return hit;
    const ex: Exercise = { id: `custom-${uid()}`, name, ...guessExercise(name) };
    custom.set(name.toLowerCase(), ex);
    newExercises.push(name);
    return ex.id;
  };

  const workouts: Workout[] = [];
  let skipped = 0;
  for (const iw of result.workouts) {
    if (existingStarts.has(iw.startedAt)) {
      skipped++;
      continue;
    }
    workouts.push(toWorkout(iw, resolve, profile?.activeGymId ?? ''));
  }
  await db.transaction('rw', db.workouts, db.customExercises, async () => {
    await db.customExercises.bulkPut([...custom.values()]);
    await db.workouts.bulkPut(workouts);
  });
  return { format: result.format, imported: workouts.length, skipped, newExercises, warnings: result.warnings };
}

function toWorkout(iw: ImportedWorkout, resolve: (name: string) => string, gymId: string): Workout {
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
      const reps = ie.sets.filter((s) => s.kind === 'working').map((s) => s.reps);
      return {
        id: uid(),
        exerciseId: resolve(ie.name),
        restSec: 90,
        repRange: [Math.min(...reps, 8), Math.max(...reps, 12)] as [number, number],
        rationale: 'Imported',
        sets: ie.sets.map((s) => ({
          id: uid(),
          kind: s.kind,
          targetWeightKg: s.weightKg,
          targetReps: s.reps,
          targetRir: s.rir ?? 2,
          weightKg: s.weightKg,
          reps: s.reps,
          rir: s.rir,
          done: true,
          completedAt: iw.startedAt,
        })),
      };
    }),
  };
}


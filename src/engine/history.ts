import type { PerformedSet, Workout } from './types';

/** Flattens completed sets from finished (and the active) workouts into one log. */
export function flattenSets(workouts: Workout[]): PerformedSet[] {
  const out: PerformedSet[] = [];
  for (const w of workouts) {
    if (w.status === 'planned') continue;
    for (const we of w.exercises) {
      for (const s of we.sets) {
        if (!s.done || s.reps === undefined) continue;
        out.push({
          workoutId: w.id,
          exerciseId: we.exerciseId,
          at: s.completedAt ?? w.finishedAt ?? w.startedAt ?? w.createdAt,
          weightKg: s.weightKg ?? 0,
          reps: s.reps,
          rir: s.rir,
          kind: s.kind,
          targetReps: s.targetReps,
          repRange: we.repRange,
        });
      }
    }
  }
  return out;
}

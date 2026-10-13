import { MUSCLE_IDS, weeklySetTarget } from './muscles';
import type { Exercise, Goal, MuscleId, PerformedSet } from './types';

const WEEK = 7 * 86_400_000;

/**
 * Hard sets per muscle over the trailing 7 days. A set counts fully toward its
 * primary muscles and half toward secondaries.
 */
export function weeklySets(
  sets: PerformedSet[],
  exercises: Record<string, Exercise>,
  now: number,
): Record<MuscleId, number> {
  const out = Object.fromEntries(MUSCLE_IDS.map((m) => [m, 0])) as Record<MuscleId, number>;
  for (const s of sets) {
    if (s.kind !== 'working' || s.reps <= 0 || now - s.at > WEEK || s.at > now) continue;
    const ex = exercises[s.exerciseId];
    if (!ex) continue;
    for (const m of ex.primary) out[m] += 1;
    for (const m of ex.secondary) out[m] += 0.5;
  }
  return out;
}

export type VolumeStatus = 'under' | 'on-track' | 'high';

export function volumeStatus(muscle: MuscleId, sets: number, goal: Goal): VolumeStatus {
  const { min, max } = weeklySetTarget(muscle, goal);
  if (sets < min) return 'under';
  if (sets > max) return 'high';
  return 'on-track';
}

/** 0 = target met, 1 = nothing done yet. Muscles with no minimum use half the max. */
export function volumeDeficit(muscle: MuscleId, sets: number, goal: Goal): number {
  const { min, max } = weeklySetTarget(muscle, goal);
  const target = min > 0 ? min : max / 2;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(1, (target - sets) / target));
}

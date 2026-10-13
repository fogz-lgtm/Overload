import { MUSCLES, MUSCLE_IDS } from './muscles';
import type { Activity, ActivityKind, Exercise, MuscleId, PerformedSet, RecoveryMap } from './types';

const HOUR = 3_600_000;
const LOOKBACK_MS = 8 * 24 * HOUR;

/**
 * Closer to failure = more fatigue per set. Unlogged RIR is treated as a
 * typical working set (~2 RIR).
 */
export function effortMultiplier(rir: number | undefined): number {
  if (rir === undefined) return 1;
  if (rir <= 0) return 1.2;
  if (rir === 1) return 1.1;
  if (rir === 2) return 1;
  if (rir === 3) return 0.85;
  return 0.7;
}

/** Muscle load per 30 minutes of moderate non-lifting activity. */
const ACTIVITY_LOAD: Record<ActivityKind, Partial<Record<MuscleId, number>>> = {
  run: { quads: 0.6, hamstrings: 0.5, calves: 0.8, glutes: 0.5 },
  ride: { quads: 0.8, glutes: 0.4, calves: 0.2, hamstrings: 0.2 },
  hike: { quads: 0.5, glutes: 0.5, calves: 0.5, hamstrings: 0.3, lower_back: 0.2 },
  swim: { lats: 0.5, side_delts: 0.3, front_delts: 0.3, triceps: 0.2, upper_back: 0.2 },
  sport: { quads: 0.4, hamstrings: 0.4, calves: 0.4, glutes: 0.3, abs: 0.2, obliques: 0.2 },
  other: { quads: 0.2, glutes: 0.2, abs: 0.1 },
};
const INTENSITY = { easy: 0.6, moderate: 1, hard: 1.5 } as const;

function emptyMap(value: number): Record<MuscleId, number> {
  return Object.fromEntries(MUSCLE_IDS.map((m) => [m, value])) as Record<MuscleId, number>;
}

/**
 * Residual fatigue per muscle in "hard set" units. Each set adds 1 unit to its
 * primary muscles and 0.5 to secondaries (scaled by effort), and fatigue decays
 * exponentially with a per-muscle half-life.
 */
export function muscleFatigue(
  sets: PerformedSet[],
  activities: Activity[],
  exercises: Record<string, Exercise>,
  now: number,
): Record<MuscleId, number> {
  const fatigue = emptyMap(0);
  const add = (muscle: MuscleId, amount: number, at: number) => {
    const age = now - at;
    if (age < 0 || age > LOOKBACK_MS) return;
    fatigue[muscle] += amount * Math.pow(0.5, age / HOUR / MUSCLES[muscle].halfLifeHours);
  };

  for (const s of sets) {
    if (s.kind !== 'working' || s.reps <= 0) continue;
    const ex = exercises[s.exerciseId];
    if (!ex) continue;
    const effort = effortMultiplier(s.rir);
    for (const m of ex.primary) add(m, effort, s.at);
    for (const m of ex.secondary) add(m, 0.5 * effort, s.at);
  }

  for (const a of activities) {
    const scale = (a.minutes / 30) * INTENSITY[a.intensity];
    for (const [m, load] of Object.entries(ACTIVITY_LOAD[a.kind]) as [MuscleId, number][]) {
      add(m, load * scale, a.at);
    }
  }
  return fatigue;
}

export function computeRecovery(
  sets: PerformedSet[],
  activities: Activity[],
  exercises: Record<string, Exercise>,
  now: number,
): RecoveryMap {
  const fatigue = muscleFatigue(sets, activities, exercises, now);
  const out = emptyMap(1);
  for (const m of MUSCLE_IDS) {
    out[m] = Math.min(1, Math.max(0, 1 - fatigue[m] / MUSCLES[m].capacity));
  }
  return out;
}

/** Hours until a muscle with this much residual fatigue is ≥ `target` fresh. */
export function hoursUntilRecovered(muscle: MuscleId, fatigue: number, target = 0.9): number {
  const { capacity, halfLifeHours } = MUSCLES[muscle];
  const allowed = (1 - target) * capacity;
  if (fatigue <= allowed) return 0;
  return halfLifeHours * Math.log2(fatigue / allowed);
}

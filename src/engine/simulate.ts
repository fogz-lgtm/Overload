import { generateWorkout } from './generator';
import { flattenSets } from './history';
import { estimate1RM } from './load';
import { autoregulate, isTimed } from './progression';
import { computeRecovery } from './recovery';
import type { Activity, ActivityKind, Equipment, Exercise, Intensity, Profile, SetEntry, Workout } from './types';
import { mulberry32, uid } from './util';
import { weeklySets } from './volume';

/** Weekdays (0 = Sunday) a lifter with this schedule typically trains. */
const SCHEDULES: Record<number, number[]> = {
  2: [1, 4],
  3: [1, 3, 5],
  4: [1, 2, 4, 5],
  5: [1, 2, 3, 5, 6],
  6: [1, 2, 3, 4, 5, 6],
};

interface Strength {
  e1rm: number;
  maxReps: number;
}

/**
 * Plays a virtual lifter through the real engine: every session is generated
 * from the history so far, then "performed" by a lifter whose hidden strength
 * grows a little each time. Produces a believable log for demos and testing.
 */
export function simulateHistory(opts: {
  profile: Profile;
  gymId: string;
  equipment: Equipment[];
  exercises: Exercise[];
  weeks: number;
  now: number;
  seed?: number;
  cardio?: boolean;
}): { workouts: Workout[]; activities: Activity[] } {
  const rand = mulberry32(opts.seed ?? 7);
  const byId = Object.fromEntries(opts.exercises.map((e) => [e.id, e]));
  const days = SCHEDULES[Math.min(6, Math.max(2, opts.profile.daysPerWeek))]!;
  const workouts: Workout[] = [];
  const activities: Activity[] = [];
  const strength = new Map<string, Strength>();

  const start = new Date(opts.now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - opts.weeks * 7);

  for (let d = new Date(start); d.getTime() < new Date(opts.now).setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (opts.cardio !== false && (dow === 3 || dow === 6) && !days.includes(dow) && rand() < 0.8) {
      const at = new Date(d);
      at.setHours(7, Math.floor(rand() * 50), 0, 0);
      const kinds: ActivityKind[] = ['run', 'run', 'ride', 'hike'];
      const intensities: Intensity[] = ['easy', 'moderate', 'moderate', 'hard'];
      activities.push({
        id: uid(),
        kind: kinds[Math.floor(rand() * kinds.length)]!,
        minutes: 30 + Math.round(rand() * 8) * 5,
        intensity: intensities[Math.floor(rand() * intensities.length)]!,
        at: at.getTime(),
      });
    }
    if (!days.includes(dow) || rand() < 0.08) continue;

    const t = new Date(d);
    t.setHours(17, 15 + Math.floor(rand() * 90), 0, 0);
    const at = t.getTime();
    const history = flattenSets(workouts);
    const gen = generateWorkout({
      profile: opts.profile,
      equipment: opts.equipment,
      exercises: opts.exercises,
      history,
      recovery: computeRecovery(history, activities, byId, at),
      weekly: weeklySets(history, byId, at),
      prefs: {},
      now: at,
      seed: Math.floor(rand() * 1e9),
    });
    if (!gen.exercises.length) continue;

    let clock = at + 5 * 60_000;
    const exercises = gen.exercises.map((we) => {
      const ex = byId[we.exerciseId]!;
      let sets: SetEntry[] = we.sets.map((s) => ({ ...s }));
      const firstWorking = sets.find((s) => s.kind === 'working');
      let st = strength.get(ex.id);
      if (!st && firstWorking) {
        // Real strength sits a bit above the engine's deliberately cautious first guess.
        const boost = 1.04 + rand() * 0.18;
        st = {
          e1rm: estimate1RM(firstWorking.targetWeightKg, firstWorking.targetReps + firstWorking.targetRir) * boost,
          maxReps: firstWorking.targetReps + firstWorking.targetRir + 1 + Math.round(rand() * 4),
        };
        strength.set(ex.id, st);
      }
      if (st) {
        st.e1rm *= 1.004 + rand() * 0.007;
        if (rand() < 0.35) st.maxReps += 1;
      }

      let working = 0;
      for (let i = 0; i < sets.length; i++) {
        const s = sets[i]!;
        clock += (s.kind === 'warmup' ? 60 : 40 + we.restSec) * 1000;
        let reps = s.targetReps;
        let rir: number | undefined;
        if (s.kind === 'working' && st) {
          const fatigue = working * 0.7;
          working++;
          let capacity: number;
          if (isTimed(ex)) capacity = s.targetReps + 5 - fatigue * 2;
          else if (s.targetWeightKg > 0) capacity = 30 * (st.e1rm / s.targetWeightKg - 1) - fatigue;
          else capacity = st.maxReps - fatigue;
          const room = Math.floor(capacity) - s.targetRir;
          reps = room >= s.targetReps ? s.targetReps + (rand() < 0.3 ? 1 : 0) + (room - s.targetReps >= 4 && rand() < 0.5 ? 2 : 0) : Math.max(1, room + (rand() < 0.5 ? 1 : 0));
          if (!isTimed(ex) && rand() < 0.75) rir = Math.max(0, Math.min(5, Math.round(capacity - reps)));
        }
        sets[i] = { ...s, weightKg: s.targetWeightKg, reps, rir, done: true, completedAt: clock };
        if (s.kind === 'working') sets = autoregulate(sets, i, ex, opts.profile.units).sets;
      }
      return { ...we, sets };
    });

    workouts.push({
      id: uid(),
      name: gen.name,
      status: 'done',
      createdAt: at - 30 * 60_000,
      startedAt: at,
      finishedAt: clock + 2 * 60_000,
      gymId: opts.gymId,
      focus: gen.focus,
      summary: gen.summary,
      estimatedMinutes: gen.estimatedMinutes,
      exercises,
    });
  }
  return { workouts, activities };
}

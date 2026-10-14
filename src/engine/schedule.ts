import { dayTypeOf, generateWorkout, type GenerateInput, type GeneratedWorkout } from './generator';
import { computeRecovery } from './recovery';
import type { Activity, DayType, MuscleId, PerformedSet, Profile, Workout } from './types';
import { weeklySets } from './volume';

/** Training weekdays (0 = Monday) for a number of days a week, spread so rest days fall between sessions. */
export const DEFAULT_WEEK: Record<number, number[]> = {
  1: [0],
  2: [0, 3],
  3: [0, 2, 4],
  4: [0, 1, 3, 4],
  5: [0, 1, 2, 4, 5],
  6: [0, 1, 2, 3, 4, 5],
  7: [0, 1, 2, 3, 4, 5, 6],
};

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** The lifter's training weekdays: chosen ones, or the default spread for their days per week. */
export function trainingDays(profile: Pick<Profile, 'daysPerWeek' | 'trainingDays'>): number[] {
  if (profile.trainingDays?.length) return [...profile.trainingDays].sort((a, b) => a - b);
  return DEFAULT_WEEK[Math.min(7, Math.max(1, profile.daysPerWeek))]!;
}

/** "Mon, Wed, Fri", "Mon–Fri", or "Every day". Runs of three or more days collapse to a range. */
export function trainingDaysText(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Every day';
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    if (j - i >= 2) parts.push(`${WEEKDAY_SHORT[sorted[i]!]}–${WEEKDAY_SHORT[sorted[j]!]}`);
    else for (let k = i; k <= j; k++) parts.push(WEEKDAY_SHORT[sorted[k]!]!);
    i = j + 1;
  }
  return parts.join(', ');
}

/** Monday-first weekday index. */
export const weekday = (t: number) => (new Date(t).getDay() + 6) % 7;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Midnight at the start of the Monday of t's week. */
export function startOfWeek(t: number): number {
  return addDays(startOfDay(t), -weekday(t));
}

/** Calendar days later, safe across daylight-saving changes. */
export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function isTrainingDay(t: number, profile: Pick<Profile, 'daysPerWeek' | 'trainingDays'>): boolean {
  return trainingDays(profile).includes(weekday(t));
}

export interface ProjectedDay {
  /** Midnight at the start of the day. */
  day: number;
  workout: GeneratedWorkout;
  /** True for the plan that's already waiting, rather than a forecast. */
  isPlan: boolean;
}

export interface ProjectionInput extends Omit<GenerateInput, 'recovery' | 'weekly' | 'now' | 'seed' | 'focus' | 'minutes' | 'avoidMuscles'> {
  activities: Activity[];
  now: number;
  /** The plan already waiting; it becomes the first upcoming session. */
  plan?: Pick<Workout, 'name' | 'focus' | 'summary' | 'estimatedMinutes' | 'exercises' | 'dayType'>;
  /** A session is done (or under way) today, so today is spoken for. */
  trainedToday: boolean;
}

/** The working sets of a session, as if done exactly as prescribed. */
function asDone(workout: GeneratedWorkout, at: number, id: string): PerformedSet[] {
  const out: PerformedSet[] = [];
  let t = at;
  for (const we of workout.exercises) {
    for (const s of we.sets) {
      t += 2 * 60_000;
      if (s.kind !== 'working') continue;
      out.push({ workoutId: id, exerciseId: we.exerciseId, at: t, weightKg: s.targetWeightKg, reps: s.targetReps, rir: s.targetRir, kind: 'working', targetReps: s.targetReps, repRange: we.repRange });
    }
  }
  return out;
}

/**
 * Plays the plan forward: each upcoming training day up to `until` gets the
 * session the engine would build that day, assuming every earlier session is
 * done as prescribed. Recovery, weekly volume, progression and the split's
 * rotation all carry through, so later days are honest forecasts that will
 * shift as real training lands.
 */
export function projectWorkouts(input: ProjectionInput, until: number): ProjectedDay[] {
  const byId = Object.fromEntries(input.exercises.map((e) => [e.id, e]));
  const today = startOfDay(input.now);
  let history = input.history;
  const recent: DayType[] = [...(input.recentDays ?? [])];
  const out: ProjectedDay[] = [];
  let plan = input.plan;

  for (let day = today; day <= until; day = addDays(day, 1)) {
    if (!isTrainingDay(day, input.profile) || (day === today && input.trainedToday)) continue;
    // Evening sessions; today's starts now.
    const at = day === today ? Math.max(input.now, day + 6 * 3600_000) : day + 17.5 * 3600_000;
    let workout: GeneratedWorkout;
    const isPlan = !!plan;
    if (plan) {
      const focusKind = plan.dayType ?? dayTypeOf({ name: plan.name, dayType: plan.dayType }) ?? 'full';
      workout = { name: plan.name, focus: plan.focus as MuscleId[], focusKind, summary: plan.summary ?? '', estimatedMinutes: plan.estimatedMinutes, exercises: plan.exercises };
      plan = undefined;
    } else {
      workout = generateWorkout({
        ...input,
        history,
        recovery: computeRecovery(history, input.activities, byId, at),
        weekly: weeklySets(history, byId, at),
        now: at,
        recentDays: recent,
      });
    }
    if (!workout.exercises.length) continue;
    out.push({ day, workout, isPlan });
    history = history.concat(asDone(workout, at, `forecast-${day}`));
    recent.unshift(workout.focusKind);
  }
  return out;
}

/** Days per week implied by a training-day choice, kept in step with `trainingDays`. */
export const daysPerWeekFor = (days: number[]) => Math.max(1, Math.min(7, days.length));


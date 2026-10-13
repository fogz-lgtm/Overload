import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from './db/db';
import { allExercises, exerciseMap, flattenSets } from './db/repo';
import { computeRecovery, muscleFatigue } from './engine/recovery';
import type { Exercise, PerformedSet, Profile, Workout } from './engine/types';
import { weeklySets } from './engine/volume';

export function useProfile(): Profile | undefined | null {
  // null = loaded and absent; undefined = still loading
  return useLiveQuery(async () => (await db.profile.get('me')) ?? null);
}

export function useExercises(): { list: Exercise[]; byId: Record<string, Exercise> } | undefined {
  const list = useLiveQuery(allExercises);
  return useMemo(() => (list ? { list, byId: exerciseMap(list) } : undefined), [list]);
}

export function useDoneWorkouts(): Workout[] | undefined {
  return useLiveQuery(async () => {
    const ws = await db.workouts.where('status').equals('done').toArray();
    return ws.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
  });
}

/** Re-renders every `ms` so time-based values (recovery, timers) stay fresh. */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export interface TrainingState {
  workouts: Workout[];
  sets: PerformedSet[];
  recovery: ReturnType<typeof computeRecovery>;
  fatigue: ReturnType<typeof muscleFatigue>;
  weekly: ReturnType<typeof weeklySets>;
}

/** Derived training state (history, recovery, weekly volume) for the UI. */
export function useTrainingState(): TrainingState | undefined {
  const workouts = useDoneWorkouts();
  const activities = useLiveQuery(() => db.activities.toArray());
  const ex = useExercises();
  const now = useNow();
  return useMemo(() => {
    if (!workouts || !activities || !ex) return undefined;
    const sets = flattenSets(workouts);
    return {
      workouts,
      sets,
      recovery: computeRecovery(sets, activities, ex.byId, now),
      fatigue: muscleFatigue(sets, activities, ex.byId, now),
      weekly: weeklySets(sets, ex.byId, now),
    };
  }, [workouts, activities, ex, now]);
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export function formatDate(ts: number, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return new Date(ts).toLocaleDateString(undefined, opts);
}

export function relativeDay(ts: number, now = Date.now()): string {
  const start = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((start(now) - start(ts)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return formatDate(ts);
}

export function download(filename: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

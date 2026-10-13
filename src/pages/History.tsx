import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { db } from '../db/db';
import { toDisplay } from '../engine/load';
import type { Activity, ActivityKind, Units, Workout } from '../engine/types';
import { formatDate, formatDuration, relativeDay, useDoneWorkouts, useProfile } from '../hooks';

const ACTIVITY: Record<ActivityKind, { label: string; icon: IconName }> = {
  run: { label: 'Run', icon: 'run' },
  ride: { label: 'Ride', icon: 'run' },
  hike: { label: 'Hike', icon: 'run' },
  swim: { label: 'Swim', icon: 'run' },
  sport: { label: 'Sport', icon: 'flame' },
  other: { label: 'Activity', icon: 'flame' },
};

const lead: CSSProperties = { width: 28, display: 'flex', justifyContent: 'center', flexShrink: 0 };
const ellipsis: CSSProperties = { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

type Entry = { kind: 'workout'; at: number; workout: Workout } | { kind: 'activity'; at: number; activity: Activity };

interface MonthGroup {
  key: number;
  label: string;
  entries: Entry[];
}

const workoutAt = (w: Workout) => w.finishedAt ?? w.startedAt ?? w.createdAt;

function workoutDuration(w: Workout): number {
  return w.finishedAt !== undefined && w.startedAt !== undefined ? Math.max(0, w.finishedAt - w.startedAt) : 0;
}

/** Exercise count, done working sets and their tonnage (kg). */
function workoutStats(w: Workout): { exercises: number; sets: number; volumeKg: number } {
  let exercises = 0;
  let sets = 0;
  let volumeKg = 0;
  for (const we of w.exercises) {
    if (we.sets.some((s) => s.done)) exercises++;
    for (const s of we.sets) {
      if (!s.done || s.kind !== 'working') continue;
      sets++;
      volumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
    }
  }
  return { exercises, sets, volumeKg };
}

function formatVolume(kg: number, units: Units): string {
  return `${Math.round(toDisplay(kg, units)).toLocaleString()} ${units}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function History() {
  const profile = useProfile();
  const workouts = useDoneWorkouts();
  const activities = useLiveQuery(() => db.activities.toArray());

  const groups = useMemo((): MonthGroup[] | undefined => {
    if (!workouts || !activities) return undefined;
    const entries: Entry[] = [
      ...workouts.map((w): Entry => ({ kind: 'workout', at: workoutAt(w), workout: w })),
      ...activities.map((a): Entry => ({ kind: 'activity', at: a.at, activity: a })),
    ].sort((a, b) => b.at - a.at);
    const out: MonthGroup[] = [];
    for (const e of entries) {
      const d = new Date(e.at);
      const key = d.getFullYear() * 12 + d.getMonth();
      let group = out[out.length - 1];
      if (!group || group.key !== key) {
        group = { key, label: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), entries: [] };
        out.push(group);
      }
      group.entries.push(e);
    }
    return out;
  }, [workouts, activities]);

  if (!profile || !workouts || !groups) return null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthMs = workouts.filter((w) => workoutAt(w) >= monthStart).reduce((a, w) => a + workoutDuration(w), 0);

  return (
    <div className="page">
      <header className="page-header">
        <div className="grow">
          <h1>History</h1>
          <div className="sub">
            {workouts.length ? `${plural(workouts.length, 'workout')} · ${formatDuration(monthMs)} this month` : 'Nothing logged yet'}
          </div>
        </div>
      </header>

      {groups.length === 0 ? (
        <div className="card empty stack" style={{ alignItems: 'center' }}>
          <Icon name="history" size={32} />
          <p className="muted">No workouts yet.</p>
          <p className="small">Finished sessions and logged activities will show up here.</p>
          <Link to="/" className="btn primary" style={{ marginTop: 8 }}>
            Start training
          </Link>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="stack lg" aria-label={g.label}>
            <h2 className="section-title">{g.label}</h2>
            <div className="card list" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {g.entries.map((e) =>
                e.kind === 'workout' ? (
                  <WorkoutRow key={e.workout.id} workout={e.workout} units={profile.units} />
                ) : (
                  <ActivityRow key={e.activity.id} activity={e.activity} />
                ),
              )}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function WorkoutRow({ workout, units }: { workout: Workout; units: Units }) {
  const { exercises, sets, volumeKg } = workoutStats(workout);
  const duration = workoutDuration(workout);
  const when = [relativeDay(workoutAt(workout)), duration > 0 ? formatDuration(duration) : null].filter(Boolean).join(' · ');
  const details = [plural(exercises, 'exercise'), plural(sets, 'set'), volumeKg > 0 ? formatVolume(volumeKg, units) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Link to={`/history/${workout.id}`} className="list-item">
      <span style={{ ...lead, color: 'var(--accent)' }}>
        <Icon name="dumbbell" size={20} />
      </span>
      <span className="grow">
        <strong style={ellipsis}>{workout.name}</strong>
        <span className="muted small" style={{ display: 'block' }}>
          {when}
        </span>
        <span className="faint small num" style={{ display: 'block' }}>
          {details}
        </span>
      </span>
      <span className="faint" style={{ display: 'flex' }}>
        <Icon name="chevron" size={18} />
      </span>
    </Link>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const meta = ACTIVITY[activity.kind] ?? ACTIVITY.other;
  const remove = async () => {
    if (!confirm(`Delete this ${meta.label.toLowerCase()} from ${formatDate(activity.at)}?`)) return;
    await db.activities.delete(activity.id);
  };
  return (
    <div className="list-item" style={{ cursor: 'default', paddingTop: 8, paddingBottom: 8 }}>
      <span className="faint" style={lead}>
        <Icon name={meta.icon} size={18} />
      </span>
      <span className="grow">
        <span className="muted small" style={ellipsis}>
          {meta.label} · {activity.minutes} min · {activity.intensity}
        </span>
        <span className="faint small" style={ellipsis}>
          {relativeDay(activity.at)}
          {activity.note ? ` · ${activity.note}` : ''}
        </span>
      </span>
      <button
        type="button"
        className="icon-btn sm"
        aria-label={`Delete ${meta.label.toLowerCase()} from ${formatDate(activity.at)}`}
        onClick={remove}
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

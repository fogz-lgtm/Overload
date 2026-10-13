import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, type CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { flattenSets } from '../db/repo';
import { detectPRs, type PR } from '../engine/analytics';
import { formatWeight, toDisplay } from '../engine/load';
import type { Loading, SetEntry, Units, Workout, WorkoutExercise } from '../engine/types';
import { formatDate, formatDuration, useDoneWorkouts, useExercises, useProfile } from '../hooks';

const table: CSSProperties = { width: '100%', borderCollapse: 'collapse' };
const th: CSSProperties = { textAlign: 'left', fontWeight: 600, padding: '0 0 6px' };
const td: CSSProperties = { padding: '8px 0', borderTop: '1px solid var(--border)' };
const right: CSSProperties = { textAlign: 'right' };

const workoutAt = (w: Workout) => w.finishedAt ?? w.startedAt ?? w.createdAt;

function formatVolume(kg: number, units: Units): string {
  return Math.round(toDisplay(kg, units)).toLocaleString();
}

function setVolume(sets: SetEntry[]): number {
  return sets.filter((s) => s.done && s.kind === 'working').reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
}

function loadText(kg: number, loading: Loading | undefined, units: Units): string {
  if (loading === 'bodyweight') return kg > 0 ? `BW + ${formatWeight(kg, units)}` : 'Bodyweight';
  return formatWeight(kg, units);
}

function prText(pr: PR, name: string, units: Units): string {
  switch (pr.kind) {
    case 'e1rm':
      return `${name} — new e1RM ${formatWeight(pr.value, units)}`;
    case 'weight':
      return `${name} — heaviest set ${formatWeight(pr.value, units)}`;
    case 'reps':
      return pr.weightKg
        ? `${name} — rep PR ${formatWeight(pr.weightKg, units)} × ${pr.value}`
        : `${name} — rep PR ${pr.value} reps`;
  }
}

function prPrevious(pr: PR, units: Units): string {
  return pr.kind === 'reps' ? `Previous best: ${pr.previous} reps` : `Previous best: ${formatWeight(pr.previous, units)}`;
}

export function WorkoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const profile = useProfile();
  const ex = useExercises();
  const done = useDoneWorkouts();
  const workout = useLiveQuery(async () => (id ? ((await db.workouts.get(id)) ?? null) : null), [id]);

  const prs = useMemo(() => {
    if (!workout || !done) return [];
    const at = workoutAt(workout);
    const prior = done.filter((w) => w.id !== workout.id && (w.finishedAt ?? 0) < at);
    return detectPRs(flattenSets([workout]), flattenSets(prior));
  }, [workout, done]);

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (idx) navigate(-1);
    else navigate('/history');
  };

  if (workout === undefined || !profile || !ex || !done) return null;

  const header = (title: string, sub?: string) => (
    <header className="page-header">
      <button type="button" className="icon-btn" aria-label="Back" onClick={goBack}>
        <Icon name="back" />
      </button>
      <div className="grow">
        <h1 style={{ overflowWrap: 'anywhere' }}>{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
    </header>
  );

  if (workout === null) {
    return (
      <div className="page">
        {header('Workout')}
        <div className="card empty stack" style={{ alignItems: 'center' }}>
          <p className="muted">This workout doesn't exist — it may have been deleted.</p>
          <Link to="/history" className="btn">
            Back to history
          </Link>
        </div>
      </div>
    );
  }

  const units = profile.units;
  const started = workout.startedAt ?? workoutAt(workout);
  const sameYear = new Date(started).getFullYear() === new Date().getFullYear();
  const dateText = formatDate(started, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const duration =
    workout.finishedAt !== undefined && workout.startedAt !== undefined ? Math.max(0, workout.finishedAt - workout.startedAt) : 0;
  const performed = workout.exercises.filter((we) => we.sets.some((s) => s.done));
  const volumeKg = performed.reduce((a, we) => a + setVolume(we.sets), 0);
  const workingSets = performed.reduce((a, we) => a + we.sets.filter((s) => s.done && s.kind === 'working').length, 0);
  const nameOf = (exerciseId: string) => ex.byId[exerciseId]?.name ?? exerciseId;

  const remove = async () => {
    if (!confirm(`Delete “${workout.name}”? This can't be undone.`)) return;
    await db.workouts.delete(workout.id);
    navigate('/history', { replace: true });
  };

  return (
    <div className="page">
      {header(workout.name, dateText)}

      <section className="card stack" aria-label="Summary">
        <div className="stats">
          <div className="stat">
            <span className="value">{duration > 0 ? formatDuration(duration) : '—'}</span>
            <span className="label">Duration</span>
          </div>
          <div className="stat">
            <span className="value">{formatVolume(volumeKg, units)}</span>
            <span className="label">Volume ({units})</span>
          </div>
          <div className="stat">
            <span className="value">{workingSets}</span>
            <span className="label">Working sets</span>
          </div>
        </div>
        {workout.summary && workout.summary !== 'Imported' && <p className="faint small">{workout.summary}</p>}
      </section>

      {prs.length > 0 && (
        <section className="card" aria-labelledby="prs-title">
          <div className="card-title">
            <h3 id="prs-title">Personal records</h3>
            <span className="faint small">{prs.length}</span>
          </div>
          <ul className="row wrap" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {prs.map((pr) => (
              <li key={`${pr.exerciseId}-${pr.kind}`} className="badge accent" title={prPrevious(pr, units)}>
                <Icon name="trophy" size={14} />
                {prText(pr, nameOf(pr.exerciseId), units)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {performed.length === 0 && <div className="card empty">No sets were logged in this workout.</div>}

      {performed.map((we) => (
        <ExerciseCard
          key={we.id}
          we={we}
          name={nameOf(we.exerciseId)}
          known={we.exerciseId in ex.byId}
          loading={ex.byId[we.exerciseId]?.loading}
          units={units}
        />
      ))}

      {workout.notes && (
        <section className="card stack" aria-label="Notes">
          <h3>Notes</h3>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
            {workout.notes}
          </p>
        </section>
      )}

      <button type="button" className="btn danger block" onClick={remove}>
        <Icon name="trash" size={18} />
        Delete workout
      </button>
    </div>
  );
}

function ExerciseCard({
  we,
  name,
  known,
  loading,
  units,
}: {
  we: WorkoutExercise;
  name: string;
  known: boolean;
  loading: Loading | undefined;
  units: Units;
}) {
  const sets = we.sets.filter((s) => s.done);
  const hasRir = sets.some((s) => s.rir !== undefined);
  let working = 0;
  const labels = sets.map((s) => (s.kind === 'warmup' ? 'W' : String(++working)));
  const volumeKg = setVolume(sets);

  return (
    <section className="card" aria-label={name}>
      <div className="card-title">
        {known ? (
          <Link to={`/library/${we.exerciseId}`} className="row grow" style={{ color: 'inherit', textDecoration: 'none', gap: 4 }}>
            <h3 style={{ overflowWrap: 'anywhere' }}>{name}</h3>
            <span className="faint" style={{ display: 'flex' }}>
              <Icon name="chevron" size={16} />
            </span>
          </Link>
        ) : (
          <h3 className="grow" style={{ overflowWrap: 'anywhere' }}>
            {name}
          </h3>
        )}
        <span className="faint small num" style={{ whiteSpace: 'nowrap' }}>
          {working} {working === 1 ? 'set' : 'sets'}
          {volumeKg > 0 ? ` · ${formatVolume(volumeKg, units)} ${units}` : ''}
        </span>
      </div>

      <table style={table}>
        <thead>
          <tr className="tiny faint">
            <th scope="col" style={{ ...th, width: 44 }}>
              Set
            </th>
            <th scope="col" style={th}>
              Weight × reps
            </th>
            {hasRir && (
              <th scope="col" style={{ ...th, ...right }}>
                RIR
              </th>
            )}
          </tr>
        </thead>
        <tbody className="num">
          {sets.map((s, i) => {
            const warm = s.kind === 'warmup';
            return (
              <tr key={s.id} className={warm ? 'muted' : undefined}>
                <td style={{ ...td, fontWeight: 700, color: warm ? 'var(--warning)' : 'var(--text-3)' }}>
                  {warm ? (
                    <abbr title="Warm-up set" style={{ textDecoration: 'none' }}>
                      W
                    </abbr>
                  ) : (
                    labels[i]
                  )}
                </td>
                <td style={td}>
                  {loadText(s.weightKg ?? 0, loading, units)} × {s.reps ?? 0}
                </td>
                {hasRir && <td style={{ ...td, ...right }}>{s.rir ?? '—'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      {we.notes && (
        <p className="faint small" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
          {we.notes}
        </p>
      )}
    </section>
  );
}

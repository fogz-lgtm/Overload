import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LineChart } from '../components/LineChart';
import { EQUIPMENT_LABEL, db } from '../db/db';
import { setPref } from '../db/repo';
import { exerciseTrend } from '../engine/analytics';
import { formatWeight, toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { bestE1RM, groupSessions, isTimed } from '../engine/progression';
import type { Loading, PerformedSet, Units } from '../engine/types';
import { formatDate, useExercises, useProfile, useTrainingState } from '../hooks';

const CARD_TITLE = { fontSize: 17 } as const;
const RECENT_SESSIONS = 10;

const LOADING_LABEL: Record<Loading, string> = {
  barbell: 'Barbell (total weight)',
  dumbbell: 'Dumbbell (per hand)',
  kettlebell: 'Kettlebell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight (+ optional load)',
  band: 'Band',
};

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "80 kg × 8, 8, 7 · 75 kg × 10" — consecutive sets at the same load are grouped. */
function describeSets(sets: PerformedSet[], units: Units, timed: boolean): string {
  const groups: { weightKg: number; reps: number[] }[] = [];
  for (const s of sets) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.weightKg - s.weightKg) < 0.01) last.reps.push(s.reps);
    else groups.push({ weightKg: s.weightKg, reps: [s.reps] });
  }
  return groups
    .map((g) => {
      const reps = g.reps.map((r) => (timed ? `${r}s` : String(r))).join(', ');
      if (g.weightKg > 0) return `${formatWeight(g.weightKg, units)} × ${reps}`;
      return timed ? reps : `${reps} reps`;
    })
    .join(' · ');
}

function sessionDate(at: number): string {
  const sameYear = new Date(at).getFullYear() === new Date().getFullYear();
  return formatDate(at, { weekday: 'short', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <span className="value">
        {value}
        {unit && <span className="small faint"> {unit}</span>}
      </span>
      <span className="label">{label}</span>
    </div>
  );
}

export function ExerciseDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const exercises = useExercises();
  const profile = useProfile();
  const state = useTrainingState();
  // null = no preference saved yet; undefined = still loading.
  const pref = useLiveQuery(async () => (await db.prefs.get(id)) ?? null, [id]);

  const goBack = () => {
    // Deep links have no in-app history to return to; fall back to the library.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/library', { replace: true });
  };

  if (!exercises || !profile || !state || pref === undefined) return null;

  const backButton = (
    <button type="button" className="icon-btn" onClick={goBack} aria-label="Back">
      <Icon name="back" />
    </button>
  );

  const ex = exercises.byId[id];
  if (!ex) {
    return (
      <div className="page">
        <header className="row">{backButton}</header>
        <div className="card empty">
          <p style={{ fontWeight: 600, color: 'var(--text-1)' }}>Exercise not found</p>
          <p className="small" style={{ marginTop: 4 }}>
            It may have been deleted, or the link is out of date.
          </p>
          <Link to="/library" className="btn sm" style={{ marginTop: 16 }}>
            Browse the library
          </Link>
        </div>
      </div>
    );
  }

  const { units } = profile;
  const timed = isTimed(ex);
  const history = state.sets.filter((s) => s.exerciseId === id && s.kind === 'working' && s.reps > 0);
  const hasHistory = history.length > 0;
  // Timed work and sets with no added load (bodyweight, bands) are tracked by reps/seconds, not e1RM.
  const repsMode = timed || history.every((s) => s.weightKg <= 0);
  const trend = hasHistory ? exerciseTrend(history) : [];
  const sessions = hasHistory ? groupSessions(history) : [];
  const heaviestKg = hasHistory ? Math.max(...history.map((s) => s.weightKg)) : 0;
  const bestReps = hasHistory ? Math.max(...history.map((s) => s.reps)) : 0;
  const bestE1rmKg = trend.reduce((a, p) => Math.max(a, p.e1rmKg), 0);

  const chartTitle = repsMode ? (timed ? 'Best hold (s)' : 'Best reps') : 'Estimated 1RM';
  const points = trend.map((p) => ({ x: p.at, y: repsMode ? p.bestReps : toDisplay(p.e1rmKg, units) }));

  const favorite = !!pref?.favorite;
  const excluded = !!pref?.excluded;

  const remove = async () => {
    if (!window.confirm(`Delete “${ex.name}”? Sets you've already logged stay in your history.`)) return;
    await db.transaction('rw', db.customExercises, db.prefs, async () => {
      await db.customExercises.delete(id);
      await db.prefs.delete(id);
    });
    goBack();
  };

  const meta = [capitalize(ex.mechanic), capitalize(ex.pattern.replace(/_/g, ' '))];
  if (ex.unilateral) meta.push('Unilateral');
  if (ex.custom) meta.push('Custom');

  return (
    <div className="page">
      <header className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
        {backButton}
        <div className="grow" style={{ paddingTop: 4 }}>
          <h1 style={{ fontSize: 24, overflowWrap: 'anywhere' }}>{ex.name}</h1>
          <div className="small faint" style={{ marginTop: 2 }}>
            {meta.join(' · ')}
          </div>
        </div>
      </header>

      <section className="card stack" style={{ gap: 14 }} aria-label="About this exercise">
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny faint">Primary</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {ex.primary.map((m) => (
              <span key={m} className="badge accent">
                {MUSCLES[m].name}
              </span>
            ))}
          </div>
        </div>
        {ex.secondary.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="tiny faint">Secondary</span>
            <div className="row wrap" style={{ gap: 6 }}>
              {ex.secondary.map((m) => (
                <span key={m} className="badge">
                  {MUSCLES[m].name}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="stack" style={{ gap: 2 }}>
          <span className="tiny faint">Equipment</span>
          <span>{ex.equipment.length ? ex.equipment.map((e) => EQUIPMENT_LABEL[e]).join(', ') : 'Bodyweight'}</span>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          <span className="tiny faint">Loading</span>
          <span>{LOADING_LABEL[ex.loading]}</span>
        </div>
      </section>

      <section className="card" style={{ paddingTop: 4, paddingBottom: 4 }} aria-label="Preferences">
        <label className="toggle" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <span className="stack" style={{ gap: 0 }}>
            <span style={{ fontWeight: 600 }}>Favorite</span>
            <span className="small faint">Picked more often in generated workouts</span>
          </span>
          <input type="checkbox" checked={favorite} onChange={(e) => void setPref(id, { favorite: e.target.checked })} />
        </label>
        <label className="toggle" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, paddingBottom: 8 }}>
          <span className="stack" style={{ gap: 0 }}>
            <span style={{ fontWeight: 600 }}>Hide from generated workouts</span>
            <span className="small faint">You can still add it to a workout yourself</span>
          </span>
          <input type="checkbox" checked={excluded} onChange={(e) => void setPref(id, { excluded: e.target.checked })} />
        </label>
      </section>

      {ex.cues.length > 0 && (
        <section className="card" aria-labelledby="cues-title">
          <div className="card-title">
            <h2 id="cues-title" style={CARD_TITLE}>
              Form cues
            </h2>
          </div>
          <ol className="stack muted" style={{ margin: 0, paddingLeft: 20 }}>
            {ex.cues.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
        </section>
      )}

      {hasHistory ? (
        <>
          <section className="card" aria-label="Personal bests">
            <div className="stats">
              {repsMode ? (
                <Stat label={timed ? 'Best hold' : 'Best reps'} value={String(bestReps)} unit={timed ? 's' : undefined} />
              ) : (
                <Stat label="Best e1RM" value={formatWeight(bestE1rmKg, units, false)} unit={units} />
              )}
              {heaviestKg > 0 ? (
                <Stat label="Heaviest" value={formatWeight(heaviestKg, units, false)} unit={units} />
              ) : (
                <Stat label="Total sets" value={String(history.length)} />
              )}
              <Stat label="Sessions" value={String(sessions.length)} />
            </div>
          </section>

          <section className="card" aria-labelledby="trend-title">
            <div className="card-title">
              <h2 id="trend-title" style={CARD_TITLE}>
                {chartTitle}
              </h2>
              {!repsMode && <span className="small faint">{units}</span>}
            </div>
            <LineChart points={points} label={`${chartTitle} per session`} formatY={fmtNum} />
            {points.length < 2 && (
              <p className="small faint" style={{ marginTop: 8 }}>
                Log another session to see your trend.
              </p>
            )}
          </section>

          <h2 className="section-title">Recent sessions</h2>
          <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            <div className="list">
              {sessions.slice(0, RECENT_SESSIONS).map((s) => (
                <Link key={s.workoutId} to={`/history/${encodeURIComponent(s.workoutId)}`} className="list-item">
                  <div className="grow">
                    <div className="row between" style={{ alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600 }}>{sessionDate(s.at)}</span>
                      {!repsMode && (
                        <span className="small faint num">e1RM {formatWeight(bestE1RM(s.sets), units)}</span>
                      )}
                    </div>
                    <div className="small muted num" style={{ overflowWrap: 'anywhere' }}>
                      {describeSets(s.sets, units, timed)}
                    </div>
                  </div>
                  <span className="faint" style={{ display: 'inline-flex' }}>
                    <Icon name="chevron" size={18} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
          {sessions.length > RECENT_SESSIONS && (
            <p className="small faint center">
              Showing the last {RECENT_SESSIONS} of {sessions.length} sessions.
            </p>
          )}
        </>
      ) : (
        <div className="card empty small">No sets logged yet. Your progress chart appears after your first session.</div>
      )}

      {ex.custom && (
        <button type="button" className="btn danger block" onClick={() => void remove()}>
          <Icon name="trash" size={18} />
          Delete exercise
        </button>
      )}
    </div>
  );
}

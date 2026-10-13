import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Figure, targetFill } from '../components/BodyMap';
import { Icon, type IconName } from '../components/Icon';
import { LineChart } from '../components/LineChart';
import { Sheet } from '../components/Sheet';
import { EQUIPMENT_LABEL, db } from '../db/db';
import { setPref } from '../db/repo';
import { exerciseTrend } from '../engine/analytics';
import { estimate1RM, formatWeight, toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { bestE1RM, groupSessions, isTimed } from '../engine/progression';
import type { ExercisePref, Loading, MuscleId, PerformedSet, Units } from '../engine/types';
import { formatDate, useExercises, useProfile, useTrainingState } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { EmptyState } from '../ui/EmptyState';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import './ExerciseDetail.css';

const RECENT_SESSIONS = 6;

const LOADING_TAG: Partial<Record<Loading, string>> = {
  barbell: 'Total bar weight',
  dumbbell: 'Weight per hand',
  kettlebell: 'Weight per bell',
  bodyweight: 'Bodyweight',
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const names = (ms: MuscleId[]) => ms.map((m) => MUSCLES[m].name).join(', ');

function fmtNum(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function fmtDelta(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return '±0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
}

function shortDate(at: number): string {
  const sameYear = new Date(at).getFullYear() === new Date().getFullYear();
  return formatDate(at, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
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

/** The first set that beats every other on `score`, ties broken by heavier load. */
function bestBy(sets: PerformedSet[], score: (s: PerformedSet) => number): PerformedSet | undefined {
  let best: PerformedSet | undefined;
  for (const s of sets) {
    if (!best || score(s) > score(best) || (score(s) === score(best) && s.weightKg > best.weightKg)) best = s;
  }
  return best;
}

interface PersonalRecord {
  label: string;
  value: ReactNode;
  detail: string;
  set: PerformedSet;
}

function WeightValue({ kg, units, reps, timed }: { kg: number; units: Units; reps?: number; timed?: boolean }) {
  return (
    <>
      {formatWeight(kg, units, false)}
      <small>{units}</small>
      {reps !== undefined && (
        <>
          <span className="exd-times">×</span>
          {reps}
          {timed && <small>s</small>}
        </>
      )}
    </>
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [allSessions, setAllSessions] = useState(false);

  if (!exercises || !profile || !state || pref === undefined) return null;

  const ex = exercises.byId[id];
  const history = state.sets.filter((s) => s.exerciseId === id && s.kind === 'working' && s.reps > 0);
  const hasHistory = history.length > 0;

  const goBack = () => {
    // Deep links have no in-app history to return to; fall back to the library.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/library', { replace: true });
  };

  const backButton = (
    <button type="button" className="icon-btn" onClick={goBack} aria-label="Back">
      <Icon name="back" />
    </button>
  );

  if (!ex) {
    return (
      <div className="page">
        <header className="exd-top">{backButton}</header>
        <div className="card">
          <EmptyState
            icon="search"
            title="Exercise not found"
            action={
              <Link to="/library" className="btn sm">
                Browse exercises
              </Link>
            }
          >
            It may have been deleted, or the link is out of date.
          </EmptyState>
        </div>
      </div>
    );
  }

  const { units } = profile;
  const timed = isTimed(ex);
  // Timed work and sets with no added load (bodyweight, bands) are tracked by reps/seconds, not e1RM.
  const repsMode = timed || history.every((s) => s.weightKg <= 0);
  const trend = exerciseTrend(history);
  const sessions = groupSessions(history);
  const series = trend.map((p) => (repsMode ? p.bestReps : p.e1rmKg));
  const first = series[0] ?? 0;
  const last = series[series.length - 1] ?? 0;
  const delta = series.length >= 2 && first > 0 ? (last / first - 1) * 100 : null;

  const bestSet = bestBy(history, (s) => (repsMode ? s.reps : estimate1RM(s.weightKg, s.reps)));
  const bestE1rmKg = Math.max(0, ...trend.map((p) => p.e1rmKg));
  const repLabel = timed ? 'Longest hold' : 'Most reps';

  const records: PersonalRecord[] = [];
  if (!repsMode) {
    const e1 = bestBy(history, (s) => estimate1RM(s.weightKg, s.reps + (s.rir ?? 0)));
    if (e1) {
      records.push({
        label: 'Best estimated 1RM',
        value: <WeightValue kg={estimate1RM(e1.weightKg, e1.reps + (e1.rir ?? 0))} units={units} />,
        detail: `${formatWeight(e1.weightKg, units)} × ${e1.reps}${e1.rir ? ` @ ${e1.rir} RIR` : ''}`,
        set: e1,
      });
    }
  }
  const heaviest = bestBy(history, (s) => s.weightKg);
  if (heaviest && heaviest.weightKg > 0) {
    records.push({
      label: repsMode ? 'Heaviest added load' : 'Heaviest weight',
      value: <WeightValue kg={heaviest.weightKg} units={units} reps={heaviest.reps} timed={timed} />,
      detail: '',
      set: heaviest,
    });
  }
  const mostReps = bestBy(history, (s) => s.reps);
  if (mostReps) {
    records.push({
      label: repLabel,
      value:
        mostReps.weightKg > 0 ? (
          <WeightValue kg={mostReps.weightKg} units={units} reps={mostReps.reps} timed={timed} />
        ) : (
          <>
            {mostReps.reps}
            <small>{timed ? 's' : 'reps'}</small>
          </>
        ),
      detail: '',
      set: mostReps,
    });
  }

  // Sessions (oldest → newest) whose best beat everything before them.
  const prSessions = new Set<string>();
  let runningBest = 0;
  for (const s of [...sessions].reverse()) {
    const v = repsMode ? Math.max(...s.sets.map((x) => x.reps)) : bestE1RM(s.sets);
    if (runningBest > 0 && v > runningBest) prSessions.add(s.workoutId);
    runningBest = Math.max(runningBest, v);
  }

  const chartTitle = repsMode ? (timed ? 'Longest hold' : 'Best reps') : 'Estimated 1RM';
  const chartUnit = repsMode ? (timed ? 'seconds' : 'reps') : units;
  const points = trend.map((p) => ({ x: p.at, y: repsMode ? p.bestReps : toDisplay(p.e1rmKg, units) }));

  const favorite = !!pref?.favorite;
  const excluded = !!pref?.excluded;
  const updatePref = (patch: Partial<ExercisePref>, message: string, icon: IconName, accent = false) => {
    haptics.tap();
    void setPref(id, patch).then(() => toast(message, { icon, tone: accent ? 'accent' : 'default' }));
  };

  const remove = async () => {
    setConfirmDelete(false);
    // Leave first so the page doesn't flash "not found" when the live query drops the exercise.
    navigate('/library', { replace: true });
    await db.transaction('rw', db.customExercises, db.prefs, async () => {
      await db.customExercises.delete(id);
      await db.prefs.delete(id);
    });
    haptics.success();
    toast(`Deleted ${ex.name}`, { icon: 'trash' });
  };

  const tags = ex.equipment.length ? ex.equipment.map((e) => EQUIPMENT_LABEL[e]) : ['No equipment'];
  const loadingTag = LOADING_TAG[ex.loading];
  if (loadingTag) tags.push(loadingTag);
  if (ex.unilateral) tags.push('Unilateral');
  const fill = (m: MuscleId) => targetFill(m, ex.primary, ex.secondary);
  const title = (m: MuscleId) =>
    `${MUSCLES[m].name}${ex.primary.includes(m) ? ' · primary' : ex.secondary.includes(m) ? ' · secondary' : ''}`;
  const shownSessions = allSessions ? sessions : sessions.slice(0, RECENT_SESSIONS);

  return (
    <div className="page exd-page">
      <header className="exd-top">{backButton}</header>

      <section className="card hero exd-hero" aria-labelledby="exd-title">
        <p className="eyebrow">
          {capitalize(ex.mechanic)} · {capitalize(ex.pattern.replace(/_/g, ' '))}
        </p>
        <h1 id="exd-title" className="exd-title">
          {ex.name}
        </h1>
        <div className="exd-tags">
          {ex.custom && <span className="badge accent">Custom</span>}
          {tags.map((t) => (
            <span key={t} className="badge">
              {t}
            </span>
          ))}
        </div>
        <div className="exd-figures">
          <figure>
            <Figure view="front" fill={fill} title={title} label={`Front view. Works ${names(ex.primary)}`} />
            <figcaption>Front</figcaption>
          </figure>
          <figure>
            <Figure view="back" fill={fill} title={title} label={`Back view. Works ${names(ex.primary)}`} />
            <figcaption>Back</figcaption>
          </figure>
        </div>
        <dl className="exd-legend">
          <div>
            <dt>
              <span className="exd-swatch primary" />
              Primary
            </dt>
            <dd>{names(ex.primary)}</dd>
          </div>
          {ex.secondary.length > 0 && (
            <div>
              <dt>
                <span className="exd-swatch secondary" />
                Secondary
              </dt>
              <dd>{names(ex.secondary)}</dd>
            </div>
          )}
        </dl>
      </section>

      {hasHistory && bestSet ? (
        <>
          <section className="card exd-stats" aria-label="Your bests">
            <div className="stats">
              {repsMode ? (
                <div className="stat">
                  <span className="value">
                    <CountUp value={bestSet.reps} />
                    <small>{timed ? 's' : 'reps'}</small>
                  </span>
                  <span className="label">{timed ? 'Longest hold' : 'Best reps'}</span>
                </div>
              ) : (
                <div className="stat">
                  <span className="value">
                    <CountUp value={toDisplay(bestE1rmKg, units)} format={fmtNum} />
                    <small>{units}</small>
                  </span>
                  <span className="label">Best e1RM</span>
                </div>
              )}
              <div className="stat">
                <span className="value">
                  {bestSet.weightKg > 0 ? (
                    <>
                      {formatWeight(bestSet.weightKg, units, false)}
                      <span className="exd-times">×</span>
                      {bestSet.reps}
                    </>
                  ) : (
                    history.length
                  )}
                </span>
                <span className="label">{bestSet.weightKg > 0 ? `Best set, ${units}` : 'Total sets'}</span>
              </div>
              <div className="stat">
                <span className="value">
                  <CountUp value={sessions.length} />
                </span>
                <span className="label">Sessions</span>
              </div>
            </div>
          </section>

          <section className="card" aria-labelledby="exd-trend-title">
            <div className="card-title exd-card-title">
              <div>
                <h2 id="exd-trend-title">{chartTitle}</h2>
                <p className="small faint">
                  {chartUnit} · best set each session
                </p>
              </div>
              {delta !== null && (
                <span className={`badge num${Math.round(delta) > 0 ? ' accent' : ''}`} aria-label={`${fmtDelta(delta)} since your first session`}>
                  {fmtDelta(delta)}
                </span>
              )}
            </div>
            <LineChart points={points} height={180} label={`${chartTitle} per session`} formatY={fmtNum} />
            {points.length < 2 && <p className="small faint exd-chart-hint">Log another session to see your trend.</p>}
          </section>

          <section className="stack exd-section" aria-labelledby="exd-pr-title">
            <h2 id="exd-pr-title" className="section-title">
              Personal records
            </h2>
            <div className="card exd-list-card">
              <div className="list">
                {records.map((r) => (
                  <Link key={r.label} to={`/history/${encodeURIComponent(r.set.workoutId)}`} className="list-item exd-pr">
                    <span className="exd-pr-icon">
                      <Icon name="trophy" size={18} />
                    </span>
                    <span className="grow">
                      <span className="exd-row-title">{r.label}</span>
                      <span className="exd-row-meta">{[r.detail, shortDate(r.set.at)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="display exd-pr-value">{r.value}</span>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section className="stack exd-section" aria-labelledby="exd-sessions-title">
            <h2 id="exd-sessions-title" className="section-title">
              Recent sessions
            </h2>
            <div className="card exd-list-card">
              <div className="list">
                {shownSessions.map((s) => {
                  const d = new Date(s.at);
                  const best = repsMode ? Math.max(...s.sets.map((x) => x.reps)) : toDisplay(bestE1RM(s.sets), units);
                  const pr = prSessions.has(s.workoutId);
                  return (
                    <Link key={s.workoutId} to={`/history/${encodeURIComponent(s.workoutId)}`} className="list-item exd-session">
                      <span className="exd-date" aria-hidden="true">
                        <span className="exd-date-m">{d.toLocaleDateString(undefined, { month: 'short' })}</span>
                        <span className="display exd-date-d">{d.getDate()}</span>
                      </span>
                      <span className="grow">
                        <span className="exd-row-title num">{describeSets(s.sets, units, timed)}</span>
                        <span className="exd-row-meta">
                          {formatDate(s.at, { weekday: 'long', month: 'short', day: 'numeric' })}
                          {pr && (
                            <span className="exd-pr-tag">
                              <Icon name="trophy" size={12} /> PR
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="exd-session-best">
                        <span className="display">{fmtNum(best)}</span>
                        <span>{repsMode ? (timed ? 'sec' : 'reps') : 'e1RM'}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
              {sessions.length > RECENT_SESSIONS && (
                <button type="button" className="btn ghost sm block exd-more" aria-expanded={allSessions} onClick={() => setAllSessions((v) => !v)}>
                  {allSessions ? 'Show less' : `Show all ${sessions.length} sessions`}
                  <Icon name={allSessions ? 'chevronUp' : 'chevronDown'} size={16} />
                </button>
              )}
            </div>
          </section>
        </>
      ) : (
        <div className="card exd-empty">
          <EmptyState icon="progress" title="No sets logged yet">
            Add {ex.name} to a workout and your estimated 1RM, records and sessions will build up here.
          </EmptyState>
        </div>
      )}

      {ex.cues.length > 0 && (
        <section className="card" aria-labelledby="exd-cues-title">
          <div className="card-title exd-card-title">
            <h2 id="exd-cues-title">Technique</h2>
          </div>
          <ol className="exd-cues">
            {ex.cues.map((c, i) => (
              <li key={c}>
                <span className="display exd-cue-n" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="stack exd-section" aria-labelledby="exd-prefs-title">
        <h2 id="exd-prefs-title" className="section-title">
          Preferences
        </h2>
        <div className="group">
          <label className="group-row toggle exd-toggle">
            <span className={`row-icon${favorite ? ' exd-on' : ''}`}>
              <Icon name="star" size={17} />
            </span>
            <span className="grow">
              <span className="exd-row-title">Favorite</span>
              <span className="exd-row-meta">Picked more often in generated workouts</span>
            </span>
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) =>
                updatePref(
                  { favorite: e.target.checked },
                  e.target.checked ? 'Added to favorites' : 'Removed from favorites',
                  'star',
                  e.target.checked,
                )
              }
            />
          </label>
          <label className="group-row toggle exd-toggle">
            <span className="row-icon">
              <Icon name="eyeOff" size={17} />
            </span>
            <span className="grow">
              <span className="exd-row-title">Hide from generated workouts</span>
              <span className="exd-row-meta">You can still add it to a workout yourself</span>
            </span>
            <input
              type="checkbox"
              checked={excluded}
              onChange={(e) =>
                updatePref(
                  { excluded: e.target.checked },
                  e.target.checked ? 'Hidden from generated workouts' : 'Back in generated workouts',
                  e.target.checked ? 'eyeOff' : 'eye',
                )
              }
            />
          </label>
        </div>
      </section>

      {ex.custom && (
        <button type="button" className="btn quiet danger block exd-delete" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={18} />
          Delete exercise
        </button>
      )}

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete exercise?" subtitle={ex.name}>
        <div className="stack lg">
          <p className="muted">It disappears from the library and from generated workouts. Sets you've already logged stay in your history.</p>
          <div className="stack">
            <button type="button" className="btn danger block lg" onClick={() => void remove()}>
              <Icon name="trash" size={18} />
              Delete {ex.name}
            </button>
            <button type="button" className="btn ghost block" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

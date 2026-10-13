import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Figure, MuscleThumb } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { flattenSets, loadGenerateInput, savePlan } from '../db/repo';
import { detectPRs, type PR } from '../engine/analytics';
import { estimateMinutes, planExercise, type Focus } from '../engine/generator';
import { estimate1RM, formatWeight, formatWeightWhole, toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import type { Exercise, MuscleId, SetEntry, Units, WorkoutExercise } from '../engine/types';
import { formatDate, useDoneWorkouts, useExercises, useProfile } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { EmptyState } from '../ui/EmptyState';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import { ConfirmSheet, plural, sessionOf, tagStyle, workoutAt, workoutDuration, workoutTotals } from './History';
import './WorkoutDetail.css';

const FOCUS_BY_TYPE: Record<string, Exclude<Focus, 'auto'>> = {
  push: 'push',
  pull: 'pull',
  legs: 'legs',
  'lower body': 'lower',
  'upper body': 'upper',
  'arms & shoulders': 'arms',
  core: 'core',
};

const PR_RANK: Record<PR['kind'], number> = { e1rm: 0, weight: 1, reps: 2 };
const PR_NAME: Record<PR['kind'], string> = { e1rm: 'e1RM', weight: 'heaviest set', reps: 'rep record' };

interface ExercisePRs {
  exerciseId: string;
  main: PR;
  others: PR[];
}

const doneSets = (we: WorkoutExercise) => we.sets.filter((s) => s.done && s.reps !== undefined);

/** Sets per muscle in this session: full credit to primaries, half to secondaries. */
function muscleSets(exercises: WorkoutExercise[], byId: Record<string, Exercise>): Map<MuscleId, number> {
  const out = new Map<MuscleId, number>();
  for (const we of exercises) {
    const ex = byId[we.exerciseId];
    const n = doneSets(we).filter((s) => s.kind === 'working').length;
    if (!ex || !n) continue;
    for (const m of ex.primary) out.set(m, (out.get(m) ?? 0) + n);
    for (const m of ex.secondary) out.set(m, (out.get(m) ?? 0) + n / 2);
  }
  return out;
}

export function WorkoutDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const profile = useProfile();
  const ex = useExercises();
  const done = useDoneWorkouts();
  const workout = useLiveQuery(async () => (id ? ((await db.workouts.get(id)) ?? null) : null), [id]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const prs = useMemo((): ExercisePRs[] => {
    if (!workout || !done) return [];
    const at = workoutAt(workout);
    const prior = done.filter((w) => w.id !== workout.id && workoutAt(w) < at);
    const by = new Map<string, PR[]>();
    for (const pr of detectPRs(flattenSets([workout]), flattenSets(prior))) by.set(pr.exerciseId, [...(by.get(pr.exerciseId) ?? []), pr]);
    return [...by].map(([exerciseId, list]) => {
      const [main, ...others] = list.sort((a, b) => PR_RANK[a.kind] - PR_RANK[b.kind]);
      return { exerciseId, main: main!, others };
    });
  }, [workout, done]);

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (idx) navigate(-1);
    else navigate('/history');
  };

  if (workout === undefined || !profile || !ex || !done) return null;

  const back = (
    <div className="wd-top">
      <button type="button" className="icon-btn" aria-label="Back" onClick={goBack}>
        <Icon name="back" />
      </button>
    </div>
  );

  if (workout === null) {
    return (
      <div className="page">
        {back}
        <div className="card">
          <EmptyState
            icon="history"
            title="Workout not found"
            action={
              <Link to="/history" className="btn" style={{ marginTop: 6 }}>
                Back to history
              </Link>
            }
          >
            It may have been deleted, or it was logged on another device.
          </EmptyState>
        </div>
      </div>
    );
  }

  const units = profile.units;
  const session = sessionOf(workout, ex.byId);
  const performed = workout.exercises.filter((we) => doneSets(we).length > 0);
  const { sets, volumeKg } = workoutTotals(workout);
  const duration = workoutDuration(workout);
  const start = workout.startedAt ?? workoutAt(workout);
  const sameYear = new Date(start).getFullYear() === new Date().getFullYear();
  const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const when = [
    formatDate(start, { weekday: 'long', month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' }),
    workout.startedAt !== undefined && workout.finishedAt !== undefined ? `${time(workout.startedAt)} – ${time(workout.finishedAt)}` : time(start),
  ].join(' · ');
  const summary = workout.summary && workout.summary !== 'Imported' && workout.summary !== 'Build it as you go.' ? workout.summary : '';
  const nameOf = (exerciseId: string) => ex.byId[exerciseId]?.name ?? exerciseId;

  const repeat = async () => {
    setBusy(true);
    try {
      const input = await loadGenerateInput();
      const exercises = performed.flatMap((we) => {
        const def = ex.byId[we.exerciseId];
        if (!def) return [];
        const working = Math.max(1, doneSets(we).filter((s) => s.kind === 'working').length);
        return [planExercise(def, input, working, we.sets.some((s) => s.kind === 'warmup'))];
      });
      if (!exercises.length) {
        toast('Nothing in this workout to repeat', { icon: 'info' });
        return;
      }
      await savePlan(
        {
          name: workout.name,
          focus: session.primary,
          focusKind: FOCUS_BY_TYPE[session.type.toLowerCase()] ?? 'full',
          summary: `A repeat of your ${formatDate(start, { month: 'short', day: 'numeric' })} session, with loads updated from your latest sets.`,
          estimatedMinutes: estimateMinutes(exercises),
          exercises,
        },
        input.profile.activeGymId,
      );
      haptics.success();
      toast('Workout ready on Today', { icon: 'repeat', tone: 'accent' });
      navigate('/');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirming(false);
    await db.workouts.delete(workout.id);
    haptics.tap();
    navigate('/history', { replace: true });
    toast('Workout deleted', { icon: 'trash' });
  };

  return (
    <div className="page">
      {back}

      <header className="wd-hero">
        <span className="tag" style={tagStyle(session.tag)}>
          {session.type}
        </span>
        <h1 className="wd-title">{session.title}</h1>
        <p className="wd-when num">{when}</p>
      </header>

      <section className="card wd-summary" aria-label="Summary">
        <div className="wd-stats">
          <Stat label="Duration">{duration > 0 ? <DurationValue ms={duration} /> : '—'}</Stat>
          <Stat label="Volume">
            <CountUp value={toDisplay(volumeKg, units)} />
            <small>{units}</small>
          </Stat>
          <Stat label={sets === 1 ? 'Working set' : 'Working sets'}>
            <CountUp value={sets} />
          </Stat>
          <Stat label={prs.length === 1 ? 'PR' : 'PRs'} gold={prs.length > 0}>
            <CountUp value={prs.length} />
          </Stat>
        </div>
        <MuscleBreakdown exercises={performed} byId={ex.byId} />
        {summary && (
          <div className="wd-why">
            <Icon name="sparkle" size={16} />
            <div>
              <div className="eyebrow">Why this session</div>
              <p>{summary}</p>
            </div>
          </div>
        )}
      </section>

      {prs.length > 0 && (
        <section className="card wd-prs" aria-labelledby="wd-prs">
          <div className="wd-prs-head">
            <span className="wd-prs-icon">
              <Icon name="trophy" size={20} />
            </span>
            <div>
              <h2 id="wd-prs">{prs.length === 1 ? 'New personal record' : `${prs.length} personal records`}</h2>
              <p>{prs.length === 1 ? 'Your best ever on this lift.' : 'Your best ever on these lifts.'}</p>
            </div>
          </div>
          <ul>
            {prs.map((p) => (
              <PRRow key={p.exerciseId} pr={p} name={nameOf(p.exerciseId)} units={units} />
            ))}
          </ul>
        </section>
      )}

      <section className="stack" aria-labelledby="wd-exercises">
        <h2 className="section-title" id="wd-exercises">
          <span>Exercises</span>
          <span className="wd-count num">{performed.length}</span>
        </h2>
        {performed.length === 0 ? (
          <div className="card">
            <EmptyState icon="dumbbell" title="No sets logged">
              This session was finished before any sets were completed.
            </EmptyState>
          </div>
        ) : (
          performed.map((we) => <ExerciseCard key={we.id} we={we} exercise={ex.byId[we.exerciseId]} units={units} />)
        )}
      </section>

      {workout.notes && (
        <section className="card wd-notes" aria-labelledby="wd-notes">
          <h3 id="wd-notes">Notes</h3>
          <p>{workout.notes}</p>
        </section>
      )}

      <div className="wd-actions">
        <button type="button" className="btn primary lg block" onClick={() => void repeat()} disabled={busy || performed.length === 0}>
          <Icon name="repeat" size={20} />
          Repeat this workout
        </button>
        <p className="wd-hint">Same exercises, with up-to-date loads.</p>
        <button type="button" className="btn ghost danger block" onClick={() => setConfirming(true)}>
          <Icon name="trash" size={18} />
          Delete workout
        </button>
      </div>

      <ConfirmSheet
        open={confirming}
        title="Delete this workout?"
        subtitle={`${session.type} · ${formatDate(start)}`}
        confirmLabel="Delete workout"
        onConfirm={() => void remove()}
        onClose={() => setConfirming(false)}
      >
        Its sets, and any records it set, will be removed from your history. This can't be undone.
      </ConfirmSheet>
    </div>
  );
}

function Stat({ label, gold, children }: { label: string; gold?: boolean; children: ReactNode }) {
  return (
    <div className={`stat${gold ? ' gold' : ''}`}>
      <span className="value">{children}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function DurationValue({ ms }: { ms: number }) {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  if (!h) {
    return (
      <>
        {min}
        <small>min</small>
      </>
    );
  }
  return (
    <>
      {h}
      <small>h</small> {String(min % 60).padStart(2, '0')}
      <small>m</small>
    </>
  );
}

const trim = (n: number) => String(Math.round(n * 10) / 10);
// The figure's own bounds, so it fills its column.
const BODY_CROP = '18 4 84 242';

function MuscleBreakdown({ exercises, byId }: { exercises: WorkoutExercise[]; byId: Record<string, Exercise> }) {
  const counts = muscleSets(exercises, byId);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const max = ranked[0]?.[1] ?? 0;
  if (!max) return null;
  const level = (m: MuscleId) => (counts.get(m) ?? 0) / max;
  const fill = (m: MuscleId) => {
    const l = level(m);
    return l > 0 ? `color-mix(in oklab, var(--muscle-hit) ${Math.round(22 + 78 * l)}%, var(--muscle-base))` : 'var(--muscle-base)';
  };
  const title = (m: MuscleId) => `${MUSCLES[m].name}: ${trim(counts.get(m) ?? 0)} sets`;
  const top = ranked.slice(0, 6);
  return (
    <div className="wd-muscles">
      <div className="wd-figures">
        <Figure view="front" viewBox={BODY_CROP} fill={fill} title={title} label="Front muscles, shaded by sets this session" />
        <Figure view="back" viewBox={BODY_CROP} fill={fill} title={title} label="Back muscles, shaded by sets this session" />
      </div>
      <div className="wd-muscle-list">
        <div className="eyebrow">Sets by muscle</div>
        <ol>
          {top.map(([m, n]) => (
            <li key={m}>
              <span className="wd-muscle-name">{MUSCLES[m].name}</span>
              <span className="wd-muscle-n num">{trim(n)}</span>
              <span className="wd-muscle-bar" aria-hidden="true">
                <i style={{ width: `${(n / max) * 100}%`, background: fill(m) }} />
              </span>
            </li>
          ))}
        </ol>
        <p className="wd-muscle-note">Secondary muscles count as half a set.</p>
      </div>
    </div>
  );
}

function prValue(pr: PR, units: Units): string {
  if (pr.kind === 'reps') return `${formatWeight(pr.weightKg ?? 0, units)} × ${pr.value}`;
  return pr.kind === 'e1rm' ? formatWeightWhole(pr.value, units) : formatWeight(pr.value, units);
}

function PRRow({ pr, name, units }: { pr: ExercisePRs; name: string; units: Units }) {
  const { main } = pr;
  const gain = main.value - main.previous;
  const was = main.kind === 'reps' ? `${main.previous}` : main.kind === 'e1rm' ? formatWeightWhole(main.previous, units, false) : formatWeight(main.previous, units, false);
  return (
    <li className="wd-pr">
      <div className="grow">
        <h3>{name}</h3>
        <p className="num">
          New {PR_NAME[main.kind]} <strong>{prValue(main, units)}</strong> <span className="faint">(was {was})</span>
        </p>
        {pr.others.length > 0 && <p className="wd-pr-also">Also a new {pr.others.map((o) => PR_NAME[o.kind]).join(' and ')}</p>}
      </div>
      <span className="wd-pr-gain display num">
        +{main.kind === 'reps' ? gain : main.kind === 'e1rm' ? Math.max(1, Math.round(toDisplay(gain, units))) : formatWeight(gain, units, false)}
        <small>{main.kind === 'reps' ? (gain === 1 ? 'rep' : 'reps') : units}</small>
      </span>
    </li>
  );
}

function SetLoad({ set, exercise, units }: { set: SetEntry; exercise: Exercise | undefined; units: Units }) {
  const kg = set.weightKg ?? 0;
  const reps = set.reps ?? 0;
  const bodyweight = exercise?.loading === 'bodyweight';
  const weight =
    bodyweight && kg <= 0 ? (
      <span className="wd-bw">Bodyweight</span>
    ) : (
      <>
        {bodyweight && <span className="wd-bw">BW +</span>}
        {formatWeight(kg, units, false)}
        <small>{units}</small>
      </>
    );
  if (exercise && isTimed(exercise)) {
    return (
      <>
        {kg > 0 && (
          <>
            {weight}
            <span className="wd-x">·</span>
          </>
        )}
        {reps}
        <small>s</small>
      </>
    );
  }
  return (
    <>
      {weight}
      <span className="wd-x">×</span>
      {reps}
    </>
  );
}

function ExerciseCard({ we, exercise, units }: { we: WorkoutExercise; exercise: Exercise | undefined; units: Units }) {
  const sets = doneSets(we);
  const working = sets.filter((s) => s.kind === 'working');
  const volumeKg = working.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const hasRir = sets.some((s) => s.rir !== undefined);
  const timed = exercise ? isTimed(exercise) : false;
  const rated = !!exercise && !timed && exercise.pattern !== 'core';
  const e1 = rated ? working.map((s) => estimate1RM(s.weightKg ?? 0, s.reps ?? 0)) : [];
  const bestE1 = Math.max(0, ...e1);
  // Only single out a set that actually beat the others; ties show the e1RM in the header instead.
  const best = bestE1 > 0 && e1.filter((e) => e === bestE1).length === 1 ? working[e1.indexOf(bestE1)] : undefined;
  const name = exercise?.name ?? we.exerciseId;
  let n = 0;

  return (
    <section className="card wd-ex" aria-label={name}>
      <div className="wd-ex-head">
        {exercise && <MuscleThumb primary={exercise.primary} secondary={exercise.secondary} size={46} />}
        <div className="grow">
          {exercise ? (
            <Link to={`/library/${exercise.id}`} className="wd-ex-name">
              <h3>{name}</h3>
              <Icon name="chevron" size={16} />
            </Link>
          ) : (
            <h3 className="wd-ex-name">{name}</h3>
          )}
          <p className="wd-ex-meta num">
            {plural(working.length, 'set')}
            {volumeKg > 0 && ` · ${Math.round(toDisplay(volumeKg, units)).toLocaleString()} ${units}`}
            {bestE1 > 0 && !best && ` · e1RM ${formatWeightWhole(bestE1, units)}`}
          </p>
        </div>
      </div>

      <table className="wd-sets">
        <thead>
          <tr>
            <th scope="col">Set</th>
            <th scope="col">{timed ? 'Time' : 'Weight × reps'}</th>
            {hasRir && (
              <th scope="col" className="wd-rir">
                <abbr title="Reps in reserve">RIR</abbr>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => {
            const warm = s.kind === 'warmup';
            const isBest = s === best;
            return (
              <tr key={s.id} className={warm ? 'warm' : isBest ? 'best' : undefined}>
                <td className="wd-set-n num">{warm ? <abbr title="Warm-up set">W</abbr> : ++n}</td>
                <td>
                  <span className="wd-load num">
                    <SetLoad set={s} exercise={exercise} units={units} />
                  </span>
                  {isBest && (
                    <span className="wd-best num" title="Best set by estimated one-rep max">
                      e1RM {formatWeightWhole(bestE1, units)}
                    </span>
                  )}
                </td>
                {hasRir && <td className="wd-rir num">{s.rir ?? '–'}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      {we.notes && <p className="wd-ex-note">{we.notes}</p>}
    </section>
  );
}

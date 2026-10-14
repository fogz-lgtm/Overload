import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MuscleThumb } from '../components/BodyMap';
import { AddExerciseSheet, SwapSheet } from '../components/ExerciseSheets';
import { SwipeRow } from '../components/SwipeRow';
import { useExerciseVideo, VideoSheet } from '../components/ExerciseVideo';
import { Icon } from '../components/Icon';
import { NumField } from '../components/NumField';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import { discardWorkout, finishWorkout } from '../db/repo';
import type { PR } from '../engine/analytics';
import { estimateMinutes } from '../engine/generator';
import { kitFor } from '../engine/kit';
import { formatWeight, fromDisplay, toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { autoregulate, groupSessions, isTimed } from '../engine/progression';
import type { Exercise, GymWeights, PerformedSet, Profile, SetEntry, Workout, WorkoutExercise } from '../engine/types';
import { uid } from '../engine/util';
import { formatClock, useExercises, useNow, useProfile, useTrainingState } from '../hooks';
import { haptics } from '../ui/haptics';
import { PlateStack } from '../ui/PlateStack';
import { ask } from '../ui/ask';
import { toast } from '../ui/toast';
import { splitName } from './Today';
import { WorkoutSummary } from './WorkoutSummary';
import './WorkoutLogger.css';

interface Rest {
  endsAt: number;
  total: number;
  next?: string;
}

export function WorkoutLogger() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const profile = useProfile();
  const ex = useExercises();
  const training = useTrainingState();
  const stored = useLiveQuery(async () => (await db.workouts.get(id)) ?? null, [id]);
  const weights = useLiveQuery(async () => (stored ? (await db.gyms.get(stored.gymId))?.weights : undefined), [stored?.gymId]);
  const [w, setW] = useState<Workout | null>(null);
  const [rest, setRest] = useState<Rest | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [menuFor, setMenuFor] = useState<WorkoutExercise | null>(null);
  const [demoFor, setDemoFor] = useState<Exercise | null>(null);
  const [swapFor, setSwapFor] = useState<WorkoutExercise | null>(null);
  const [adding, setAdding] = useState(false);
  const [summary, setSummary] = useState<{ prs: PR[]; workout: Workout } | null>(null);
  const now = useNow(rest ? 250 : 1000);

  useEffect(() => {
    if (stored && !w) setW(stored);
  }, [stored, w]);

  const update = useCallback((fn: (w: Workout) => Workout) => {
    setW((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      void db.workouts.put(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      haptics.alarm();
      toast('Rest over — next set', { icon: 'timer', tone: 'accent', ms: 1800 });
      setRest(null);
    }
  }, [now, rest]);

  // Previous session of each exercise, for the "last time" line.
  const lastTime = useMemo(() => {
    const out: Record<string, PerformedSet[]> = {};
    if (!training || !w) return out;
    for (const we of w.exercises) {
      const prior = training.sets.filter((s) => s.exerciseId === we.exerciseId && s.workoutId !== w.id);
      const last = groupSessions(prior)[0];
      if (last) out[we.exerciseId] = last.sets;
    }
    return out;
  }, [training, w]);

  if (stored === null) {
    return (
      <div className="page">
        <p className="empty">This workout no longer exists.</p>
        <Link to="/" className="btn">
          Back
        </Link>
      </div>
    );
  }
  if (!w || !profile || !ex) return null;
  if (summary) {
    return <WorkoutSummary workout={summary.workout} prs={summary.prs} exercises={ex.byId} profile={profile} onDone={() => navigate('/')} />;
  }
  if (w.status === 'done') {
    return (
      <div className="page">
        <p className="empty">This workout is finished.</p>
        <Link to={`/history/${w.id}`} className="btn">
          View it in history
        </Link>
      </div>
    );
  }

  const units = profile.units;
  const allSets = w.exercises.flatMap((e) => e.sets);
  const doneCount = allSets.filter((s) => s.done).length;
  const progress = allSets.length ? doneCount / allSets.length : 0;
  const currentEx = w.exercises.find((e) => e.sets.some((s) => !s.done));
  const [kind] = splitName(w.name);

  function patchSet(weId: string, setId: string, patch: Partial<SetEntry>) {
    update((cur) => ({
      ...cur,
      exercises: cur.exercises.map((e) => (e.id !== weId ? e : { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) })),
    }));
  }

  function toggleSet(we: WorkoutExercise, idx: number) {
    const s = we.sets[idx]!;
    const exercise = ex!.byId[we.exerciseId];
    if (s.done) {
      patchSet(we.id, s.id, { done: false, completedAt: undefined });
      return;
    }
    haptics.tap();
    const doneSet: SetEntry = { ...s, weightKg: s.weightKg ?? s.targetWeightKg, reps: s.reps ?? s.targetReps, done: true, completedAt: Date.now() };
    let sets = we.sets.map((x, i) => (i === idx ? doneSet : x));
    if (exercise) {
      const r = autoregulate(sets, idx, exercise, units, kitFor(exercise, weights, units));
      sets = r.sets;
      if (r.note) setNotes((n) => ({ ...n, [we.id]: r.note! }));
    }
    update((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets } : e)) }));

    const nextInEx = sets.find((x, i) => i > idx && !x.done);
    const exIdx = w!.exercises.findIndex((e) => e.id === we.id);
    const nextEx = w!.exercises.slice(exIdx + 1).find((e) => e.sets.some((x) => !x.done));
    if (!nextInEx && !nextEx) {
      setRest(null);
      haptics.success();
      return;
    }
    if (!nextInEx) haptics.success();
    const nextSet = nextInEx ?? nextEx!.sets.find((x) => !x.done)!;
    const nextName = nextInEx ? undefined : ex!.byId[nextEx!.exerciseId]?.name;
    const load = nextSet.targetWeightKg > 0 ? `${formatWeight(nextSet.targetWeightKg, units)} × ` : '';
    if (nextInEx?.drop) {
      // Strip the weight and go: just long enough to change it.
      setRest({ endsAt: Date.now() + 10_000, total: 10, next: `Drop set · ${load}as many as you can` });
      return;
    }
    if (profile?.style?.autoRest === false) {
      setRest(null);
      return;
    }
    const secs = s.kind === 'warmup' ? 60 : we.restSec;
    setRest({ endsAt: Date.now() + secs * 1000, total: secs, next: `${nextName ? `${nextName} · ` : ''}${load}${nextSet.targetReps}` });
  }

  function addSet(we: WorkoutExercise) {
    const last = [...we.sets].reverse().find((s) => s.kind === 'working' && !s.drop) ?? we.sets.at(-1);
    const fresh: SetEntry = {
      id: uid(),
      kind: 'working',
      targetWeightKg: last?.weightKg ?? last?.targetWeightKg ?? 0,
      targetReps: last?.targetReps ?? we.repRange[0],
      targetRir: last?.targetRir ?? 2,
      done: false,
    };
    // A drop set stays last.
    const at = we.sets.findIndex((s) => s.drop && !s.done);
    const sets = at >= 0 ? [...we.sets.slice(0, at), fresh, ...we.sets.slice(at)] : [...we.sets, fresh];
    update((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets } : e)) }));
  }

  function removeSet(we: WorkoutExercise, setId: string) {
    update((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e)) }));
  }

  async function removeExercise(target: WorkoutExercise) {
    const logged = target.sets.filter((s) => s.done).length;
    if (
      logged > 0 &&
      !(await ask({
        title: `Remove ${ex?.byId[target.exerciseId]?.name ?? 'this exercise'}?`,
        body: `Its ${logged} logged ${logged === 1 ? 'set goes' : 'sets go'} too.`,
        confirm: 'Remove',
        tone: 'danger',
      }))
    )
      return;
    update((cur) => ({ ...cur, exercises: cur.exercises.filter((e) => e.id !== target.id) }));
    toast('Exercise removed', { icon: 'trash' });
  }

  function moveExercise(weId: string, dir: -1 | 1) {
    update((cur) => {
      const list = [...cur.exercises];
      const i = list.findIndex((e) => e.id === weId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return cur;
      [list[i], list[j]] = [list[j]!, list[i]!];
      return { ...cur, exercises: list };
    });
  }

  async function finish() {
    const pending = w!.exercises.flatMap((e) => e.sets).filter((s) => !s.done).length;
    if (doneCount === 0) {
      const discard = await ask({ title: 'Nothing logged yet', body: 'Discard this workout? It will not be saved.', confirm: 'Discard', tone: 'danger', icon: 'trash' });
      if (discard) {
        await discardWorkout(w!.id);
        navigate('/');
      }
      return;
    }
    if (
      pending > 0 &&
      !(await ask({
        title: 'Finish workout?',
        body: `${pending} set${pending === 1 ? ' is' : 's are'} not done yet. ${pending === 1 ? 'It' : 'They'} won't be saved.`,
        confirm: 'Finish',
        cancel: 'Keep going',
        icon: 'check',
      }))
    )
      return;
    const prs = await finishWorkout(w!.id);
    const workout = (await db.workouts.get(w!.id))!;
    setRest(null);
    haptics.success();
    window.scrollTo(0, 0);
    setSummary({ prs, workout });
  }

  return (
    <div className={`lg-page${rest ? ' resting' : ''}`}>
      <header className="lg-head">
        <div className="lg-head-row">
          <button type="button" className="icon-btn plain" onClick={() => navigate('/')} aria-label="Minimize (workout keeps running)">
            <Icon name="chevronDown" />
          </button>
          <div className="lg-head-title">
            <h1 className="sr-only">{w.name}</h1>
            <span className="eyebrow truncate" aria-hidden="true">{kind}</span>
            <span className="display lg-clock">{formatClock(now - (w.startedAt ?? now))}</span>
          </div>
          <button type="button" className="btn primary sm" onClick={finish}>
            Finish
          </button>
        </div>
        <div className="lg-progress" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={allSets.length} aria-label="Sets completed">
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      </header>

      <div className="lg-body">
        {w.exercises.map((we, i) => {
          const exercise = ex.byId[we.exerciseId];
          const complete = we.sets.length > 0 && we.sets.every((s) => s.done);
          const expanded = open[we.id] ?? !complete;
          return (
            <ExerciseCard
              key={we.id}
              we={we}
              index={i}
              count={w.exercises.length}
              exercise={exercise}
              units={units}
              note={notes[we.id]}
              last={lastTime[we.exerciseId]}
              current={currentEx?.id === we.id}
              expanded={expanded}
              onToggleExpand={() => setOpen((o) => ({ ...o, [we.id]: !expanded }))}
              onToggle={(idx) => toggleSet(we, idx)}
              onPatch={(setId, patch) => patchSet(we.id, setId, patch)}
              onAddSet={() => addSet(we)}
              onRemoveSet={(setId) => removeSet(we, setId)}
              onMenu={() => setMenuFor(we)}
              onSwap={() => setSwapFor(we)}
              onRemove={w.exercises.length > 1 ? () => removeExercise(we) : undefined}
              onDemo={() => exercise && setDemoFor(exercise)}
              weights={weights}
            />
          );
        })}

        {!currentEx && w.exercises.length > 0 && (
          <section className="card hero lg-alldone">
            <span className="lg-alldone-icon">
              <Icon name="check" size={28} />
            </span>
            <h2>Every set done</h2>
            <p className="small muted">Nice work. Wrap it up to save it and see your records.</p>
            <button type="button" className="btn primary lg block" onClick={finish}>
              Finish workout
            </button>
          </section>
        )}

        <button type="button" className="btn block" onClick={() => setAdding(true)}>
          <Icon name="plus" size={18} /> Add exercise
        </button>
        <button
          type="button"
          className="btn ghost danger block"
          onClick={async () => {
            if (!(await ask({ title: 'Discard workout?', body: 'Nothing from this session will be saved.', confirm: 'Discard', tone: 'danger', icon: 'trash' }))) return;
            await discardWorkout(w.id);
            navigate('/');
          }}
        >
          Discard workout
        </button>
      </div>

      {rest && <RestTimer rest={rest} now={now} onAdjust={(d) => setRest({ ...rest, endsAt: Math.max(Date.now() + 1000, rest.endsAt + d * 1000), total: Math.max(5, rest.total + d) })} onSkip={() => setRest(null)} />}

      {demoFor && <VideoSheet exercise={demoFor} onClose={() => setDemoFor(null)} />}

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? ex.byId[menuFor.exerciseId]?.name : ''}>
        {menuFor && (
          <div className="group">
            <button type="button" className="group-row" onClick={() => (setSwapFor(menuFor), setMenuFor(null))}>
              <span className="row-icon">
                <Icon name="swap" size={17} />
              </span>
              <span className="grow">Swap exercise</span>
              <Icon name="chevron" size={16} />
            </button>
            {ex.byId[menuFor.exerciseId] && (
              <button type="button" className="group-row" onClick={() => (setDemoFor(ex.byId[menuFor.exerciseId]!), setMenuFor(null))}>
                <span className="row-icon">
                  <Icon name="play" size={17} />
                </span>
                <span className="grow">Watch form demo</span>
                <Icon name="chevron" size={16} />
              </button>
            )}
            <Link to={`/library/${menuFor.exerciseId}`} className="group-row">
              <span className="row-icon">
                <Icon name="progress" size={17} />
              </span>
              <span className="grow">History & technique</span>
              <Icon name="chevron" size={16} />
            </Link>
            <button type="button" className="group-row" onClick={() => (moveExercise(menuFor.id, -1), setMenuFor(null))}>
              <span className="row-icon">
                <Icon name="chevronUp" size={17} />
              </span>
              <span className="grow">Move up</span>
            </button>
            <button type="button" className="group-row" onClick={() => (moveExercise(menuFor.id, 1), setMenuFor(null))}>
              <span className="row-icon">
                <Icon name="chevronDown" size={17} />
              </span>
              <span className="grow">Move down</span>
            </button>
            <button
              type="button"
              className="group-row"
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                const target = menuFor;
                setMenuFor(null);
                removeExercise(target);
              }}
            >
              <span className="row-icon" style={{ color: 'var(--danger)' }}>
                <Icon name="trash" size={17} />
              </span>
              <span className="grow">Remove from workout</span>
            </button>
          </div>
        )}
      </Sheet>

      <SwapSheet
        target={swapFor}
        exercises={ex.byId}
        inWorkout={w.exercises.map((e) => e.exerciseId)}
        onClose={() => setSwapFor(null)}
        onPick={(replacement) => {
          const target = swapFor!;
          setSwapFor(null);
          update((cur) => {
            const idx = cur.exercises.findIndex((e) => e.id === target.id);
            const kept = target.sets.filter((s) => s.done);
            const list = [...cur.exercises];
            if (kept.length) list.splice(idx, 1, { ...target, sets: kept }, replacement);
            else list.splice(idx, 1, replacement);
            return { ...cur, exercises: list, estimatedMinutes: estimateMinutes(list) };
          });
          toast(`Swapped in ${ex.byId[replacement.exerciseId]?.name ?? 'exercise'}`, { icon: 'swap' });
        }}
      />

      <AddExerciseSheet
        open={adding}
        exercises={ex.list}
        inWorkout={w.exercises.map((e) => e.exerciseId)}
        onClose={() => setAdding(false)}
        onPick={(we) => {
          setAdding(false);
          update((cur) => ({ ...cur, exercises: [...cur.exercises, we] }));
          toast(`${ex.byId[we.exerciseId]?.name ?? 'Exercise'} added`, { icon: 'plus' });
        }}
      />
    </div>
  );
}

function setsText(sets: PerformedSet[], units: Profile['units'], timed: boolean): string {
  const w = sets[0]?.weightKg ?? 0;
  const reps = sets.map((s) => `${s.reps}${timed ? 's' : ''}`).join(', ');
  return w > 0 ? `${formatWeight(w, units, false)} × ${reps}` : reps;
}

function ExerciseCard({
  we,
  index,
  count,
  exercise,
  units,
  note,
  last,
  current,
  expanded,
  onToggleExpand,
  onToggle,
  onPatch,
  onAddSet,
  onRemoveSet,
  onMenu,
  onSwap,
  onRemove,
  onDemo,
  weights,
}: {
  we: WorkoutExercise;
  index: number;
  count: number;
  exercise?: Exercise;
  units: Profile['units'];
  note?: string;
  last?: PerformedSet[];
  current: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggle: (i: number) => void;
  onPatch: (setId: string, patch: Partial<SetEntry>) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onMenu: () => void;
  onSwap: () => void;
  onRemove?: () => void;
  onDemo: () => void;
  weights?: GymWeights;
}) {
  const [why, setWhy] = useState(false);
  const video = useExerciseVideo(we.exerciseId);
  const kit = exercise ? kitFor(exercise, weights, units) : undefined;
  const timed = exercise ? isTimed(exercise) : false;
  const bodyweight = exercise?.loading === 'bodyweight' || exercise?.loading === 'band';
  const working = we.sets.filter((s) => s.kind === 'working' && !s.drop);
  const hasDrop = we.sets.some((s) => s.drop);
  const complete = we.sets.length > 0 && we.sets.every((s) => s.done);
  const firstOpen = we.sets.findIndex((s) => !s.done);
  const next = we.sets.find((s) => !s.done && s.kind === 'working');
  const top = working[0];
  const target = top ? `${working.length} × ${top.targetReps}${timed ? 's' : ''}${top.targetWeightKg > 0 ? ` · ${formatWeight(top.targetWeightKg, units)}` : ''}${hasDrop ? ' + drop' : ''}` : '';
  const best = working.filter((s) => s.done).sort((a, b) => (b.weightKg ?? 0) * (b.reps ?? 0) - (a.weightKg ?? 0) * (a.reps ?? 0))[0];
  let workingIdx = 0;

  return (
    <section className={`lg-ex card${current ? ' current' : ''}${complete ? ' complete' : ''}`} data-exercise={we.exerciseId}>
      <SwipeRow
        actions={[
          { label: 'Swap', icon: 'swap', tone: 'accent', onClick: onSwap },
          ...(onRemove ? [{ label: 'Remove', icon: 'trash' as const, tone: 'danger' as const, onClick: onRemove }] : []),
        ]}
        onSwipe={onSwap}
      >
      <div className="lg-ex-head">
        <button type="button" className="lg-ex-title" onClick={onToggleExpand} aria-expanded={expanded}>
          {exercise && <MuscleThumb primary={exercise.primary} secondary={exercise.secondary} size={44} />}
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="eyebrow">
              {index + 1} of {count}
              {exercise ? ` · ${exercise.primary.map((m) => MUSCLES[m].name).join(', ')}` : ''}
            </span>
            <span className="lg-ex-name">{exercise?.name ?? we.exerciseId}</span>
            <span className="small faint num">
              {complete && best ? `Done · best ${best.weightKg ? `${formatWeight(best.weightKg, units)} × ` : ''}${best.reps}` : `Target ${target}`}
            </span>
          </span>
          {complete && (
            <span className="lg-ex-check" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
          )}
        </button>
        {expanded && (
          <>
            <button type="button" className="icon-btn sm plain" onClick={() => setWhy(!why)} aria-label="Why this prescription?" aria-expanded={why}>
              <Icon name="info" size={19} />
            </button>
            <button type="button" className="icon-btn sm plain" onClick={onMenu} aria-label="Exercise options">
              <Icon name="more" size={19} />
            </button>
          </>
        )}
      </div>
      </SwipeRow>

      {expanded && (
        <>
          {why && (
            <div className="stack" style={{ marginTop: 12 }}>
              <p className="rationale">{we.rationale}</p>
              {exercise?.cues.length ? (
                <ul className="lg-cues">
                  {exercise.cues.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : null}
              {video?.id && (
                <button type="button" className="btn sm lg-demo" onClick={onDemo}>
                  <Icon name="play" size={14} /> Watch form demo
                </button>
              )}
            </div>
          )}

          {last && last.length > 0 && (
            <p className="lg-last small">
              <Icon name="history" size={14} /> Last time <strong className="num">{setsText(last, units, timed)}</strong>
            </p>
          )}

          {note && (
            <p className="lg-note small" role="status">
              <Icon name="bolt" size={14} /> {note}
            </p>
          )}

          <div className="lg-table">
            <div className="lg-row lg-row-head" aria-hidden="true">
              <span>Set</span>
              <span>{bodyweight ? `+${units}` : units}</span>
              <span>{timed ? 'Secs' : 'Reps'}</span>
              <span>RIR</span>
              <span />
            </div>
            {we.sets.map((s, i) => {
              const label = s.kind === 'warmup' ? 'W' : s.drop ? 'D' : String(++workingIdx);
              return (
                <div key={s.id} className={`lg-row ${s.kind}${s.drop ? ' drop' : ''}${s.done ? ' done' : ''}${i === firstOpen && current ? ' now' : ''}`}>
                  <button
                    type="button"
                    className="lg-idx"
                    aria-label={s.drop ? (s.done ? 'Drop set' : 'Remove drop set') : s.done ? `Set ${label}` : `Remove set ${label}`}
                    onClick={async () => !s.done && (await ask({ title: `Remove set ${label}?`, confirm: 'Remove', tone: 'danger' })) && onRemoveSet(s.id)}
                  >
                    {label}
                  </button>
                  <NumField
                    className="lg-input"
                    label={`Set ${label} weight`}
                    value={s.weightKg === undefined ? undefined : toDisplay(s.weightKg, units)}
                    placeholder={s.targetWeightKg > 0 ? formatWeight(s.targetWeightKg, units, false) : bodyweight ? 'BW' : '0'}
                    onChange={(v) => onPatch(s.id, { weightKg: v === undefined ? undefined : fromDisplay(v, units) })}
                  />
                  <NumField className="lg-input" label={`Set ${label} ${timed ? 'seconds' : 'reps'}`} decimals={0} value={s.reps} placeholder={String(s.targetReps)} onChange={(v) => onPatch(s.id, { reps: v })} />
                  {s.kind === 'working' && !timed ? (
                    <select
                      className={`lg-input lg-rir${s.rir === undefined ? ' unset' : ''}`}
                      aria-label={`Set ${label} reps in reserve`}
                      value={s.rir ?? ''}
                      onChange={(e) => onPatch(s.id, { rir: e.target.value === '' ? undefined : Number(e.target.value) })}
                    >
                      <option value="">{s.targetRir}</option>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="3">3</option>
                      <option value="4">4+</option>
                    </select>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className={`lg-check${s.done ? ' on' : ''}`}
                    aria-pressed={s.done}
                    aria-label={s.done ? `Undo set ${label}` : `Complete set ${label}`}
                    onClick={() => onToggle(i)}
                  >
                    <Icon name="check" size={20} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="lg-foot">
            <button type="button" className="btn ghost sm" onClick={onAddSet}>
              <Icon name="plus" size={16} /> Add set
            </button>
            {kit?.bar !== undefined && next && (next.weightKg ?? next.targetWeightKg) > 0 && <PlateStack totalKg={next.weightKg ?? next.targetWeightKg} kit={kit} units={units} />}
          </div>
        </>
      )}
    </section>
  );
}

function RestTimer({ rest, now, onAdjust, onSkip }: { rest: Rest; now: number; onAdjust: (deltaSec: number) => void; onSkip: () => void }) {
  const left = Math.max(0, rest.endsAt - now);
  const frac = Math.max(0, Math.min(1, left / (rest.total * 1000)));
  const size = 54;
  const r = 23;
  const c = 2 * Math.PI * r;
  return (
    <div className="lg-rest" role="timer" aria-label={`Rest ${formatClock(left)} remaining`}>
      <div className="lg-rest-inner">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={4} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent-fill)" strokeWidth={4} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
        </svg>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="display lg-rest-time">{formatClock(left + 999)}</div>
          {rest.next && <div className="small faint truncate">Next: {rest.next}</div>}
        </div>
        <button type="button" className="icon-btn sm" onClick={() => onAdjust(-15)} aria-label="15 seconds less">
          <span className="small" style={{ fontWeight: 700 }}>−15</span>
        </button>
        <button type="button" className="icon-btn sm" onClick={() => onAdjust(15)} aria-label="15 seconds more">
          <span className="small" style={{ fontWeight: 700 }}>+15</span>
        </button>
        <button type="button" className="icon-btn sm" onClick={onSkip} aria-label="Skip rest">
          <Icon name="x" size={18} />
        </button>
      </div>
    </div>
  );
}

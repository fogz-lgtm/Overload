import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { NumField } from '../components/NumField';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import { discardWorkout, finishWorkout, loadGenerateInput } from '../db/repo';
import { LIFT_NAMES, type PR } from '../engine/analytics';
import { estimateMinutes, isAvailable, planExercise, swapOptions, type GenerateInput } from '../engine/generator';
import { formatWeight, fromDisplay, platesPerSide, toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import { autoregulate, isTimed } from '../engine/progression';
import type { Exercise, Profile, SetEntry, Workout, WorkoutExercise } from '../engine/types';
import { uid } from '../engine/util';
import { formatDuration, useExercises, useNow, useProfile } from '../hooks';

interface Rest {
  endsAt: number;
  total: number;
}

export function WorkoutLogger() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const profile = useProfile();
  const ex = useExercises();
  const stored = useLiveQuery(async () => (await db.workouts.get(id)) ?? null, [id]);
  const [w, setW] = useState<Workout | null>(null);
  const [rest, setRest] = useState<Rest | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [menuFor, setMenuFor] = useState<WorkoutExercise | null>(null);
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

  // Rest timer finished: buzz once.
  useEffect(() => {
    if (rest && now >= rest.endsAt) {
      if ('vibrate' in navigator) navigator.vibrate?.([180, 80, 180]);
      setRest(null);
    }
  }, [now, rest]);

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
  if (w.status === 'done' && !summary) {
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
  const doneSets = w.exercises.flatMap((e) => e.sets).filter((s) => s.done);
  const totalSets = w.exercises.flatMap((e) => e.sets).length;

  function patchSet(weId: string, setId: string, patch: Partial<SetEntry>) {
    update((cur) => ({
      ...cur,
      exercises: cur.exercises.map((e) =>
        e.id !== weId ? e : { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) },
      ),
    }));
  }

  function toggleSet(we: WorkoutExercise, idx: number) {
    const s = we.sets[idx]!;
    const exercise = ex!.byId[we.exerciseId];
    if (s.done) {
      patchSet(we.id, s.id, { done: false, completedAt: undefined });
      return;
    }
    const doneSet: SetEntry = {
      ...s,
      weightKg: s.weightKg ?? s.targetWeightKg,
      reps: s.reps ?? s.targetReps,
      done: true,
      completedAt: Date.now(),
    };
    let sets = we.sets.map((x, i) => (i === idx ? doneSet : x));
    if (exercise) {
      const r = autoregulate(sets, idx, exercise, units);
      sets = r.sets;
      if (r.note) setNotes((n) => ({ ...n, [we.id]: r.note! }));
    }
    update((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets } : e)) }));
    const isLast = w!.exercises.at(-1)?.id === we.id && idx === we.sets.length - 1;
    if (!isLast) {
      const secs = s.kind === 'warmup' ? 60 : we.restSec;
      setRest({ endsAt: Date.now() + secs * 1000, total: secs });
    }
  }

  function addSet(we: WorkoutExercise) {
    const last = [...we.sets].reverse().find((s) => s.kind === 'working') ?? we.sets.at(-1);
    const fresh: SetEntry = {
      id: uid(),
      kind: 'working',
      targetWeightKg: last?.weightKg ?? last?.targetWeightKg ?? 0,
      targetReps: last?.targetReps ?? we.repRange[0],
      targetRir: last?.targetRir ?? 2,
      done: false,
    };
    update((cur) => ({ ...cur, exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets: [...e.sets, fresh] } : e)) }));
  }

  function removeSet(we: WorkoutExercise, setId: string) {
    update((cur) => ({
      ...cur,
      exercises: cur.exercises.map((e) => (e.id === we.id ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e)),
    }));
  }

  function removeExercise(weId: string) {
    update((cur) => ({ ...cur, exercises: cur.exercises.filter((e) => e.id !== weId) }));
  }

  async function finish() {
    const pending = w!.exercises.flatMap((e) => e.sets).filter((s) => !s.done).length;
    if (doneSets.length === 0) {
      if (confirm('Nothing logged yet. Discard this workout?')) {
        await discardWorkout(w!.id);
        navigate('/');
      }
      return;
    }
    if (pending > 0 && !confirm(`Finish with ${pending} set${pending === 1 ? '' : 's'} not done? Those won't be saved.`)) return;
    const prs = await finishWorkout(w!.id);
    const workout = (await db.workouts.get(w!.id))!;
    setRest(null);
    setSummary({ prs, workout });
  }

  return (
    <div className="page" style={{ paddingBottom: rest ? 88 : undefined }}>
      <header className="page-header">
        <button type="button" className="icon-btn" onClick={() => navigate('/')} aria-label="Back (workout keeps running)">
          <Icon name="back" />
        </button>
        <div className="grow">
          <h2 style={{ fontSize: 18 }}>{w.name}</h2>
          <div className="sub num">
            {formatDuration(now - (w.startedAt ?? now))} · {doneSets.length}/{totalSets} sets
          </div>
        </div>
        <button type="button" className="btn primary sm" onClick={finish}>
          Finish
        </button>
      </header>

      {w.exercises.map((we) => (
        <ExerciseCard
          key={we.id}
          we={we}
          exercise={ex.byId[we.exerciseId]}
          units={units}
          note={notes[we.id]}
          onToggle={(i) => toggleSet(we, i)}
          onPatch={(setId, patch) => patchSet(we.id, setId, patch)}
          onAddSet={() => addSet(we)}
          onRemoveSet={(setId) => removeSet(we, setId)}
          onMenu={() => setMenuFor(we)}
        />
      ))}

      <button type="button" className="btn block" onClick={() => setAdding(true)}>
        <Icon name="plus" size={18} /> Add exercise
      </button>
      <button
        type="button"
        className="btn ghost danger"
        onClick={async () => {
          if (!confirm('Discard this workout? Nothing from it will be saved.')) return;
          await discardWorkout(w.id);
          navigate('/');
        }}
      >
        Discard workout
      </button>

      {rest && (
        <div className="rest-bar" role="timer" aria-live="off">
          <div className="inner">
            <Icon name="timer" />
            <span className="time">{formatClock(Math.max(0, rest.endsAt - now))}</span>
            <div className="bar grow" aria-hidden="true">
              <div className="fill" style={{ width: `${Math.max(0, Math.min(100, ((rest.endsAt - now) / (rest.total * 1000)) * 100))}%` }} />
            </div>
            <button type="button" className="btn sm" onClick={() => setRest({ ...rest, endsAt: rest.endsAt + 15_000, total: rest.total + 15 })}>
              +15s
            </button>
            <button type="button" className="btn sm ghost" onClick={() => setRest(null)}>
              Skip
            </button>
          </div>
        </div>
      )}

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? ex.byId[menuFor.exerciseId]?.name : ''}>
        {menuFor && (
          <div className="stack">
            <button type="button" className="btn block" onClick={() => (setSwapFor(menuFor), setMenuFor(null))}>
              <Icon name="swap" size={18} /> Swap exercise
            </button>
            <Link to={`/library/${menuFor.exerciseId}`} className="btn block">
              <Icon name="progress" size={18} /> History & technique
            </Link>
            <button type="button" className="btn block danger" onClick={() => (removeExercise(menuFor.id), setMenuFor(null))}>
              <Icon name="trash" size={18} /> Remove from workout
            </button>
          </div>
        )}
      </Sheet>

      <SwapSheet
        target={swapFor}
        workout={w}
        exercises={ex.byId}
        profile={profile}
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
        }}
      />

      <AddSheet
        open={adding}
        workout={w}
        exercises={ex.list}
        onClose={() => setAdding(false)}
        onPick={(we) => {
          setAdding(false);
          update((cur) => ({ ...cur, exercises: [...cur.exercises, we] }));
        }}
      />

      <Sheet open={!!summary} onClose={() => navigate('/')} title="Workout complete">
        {summary && <Summary {...summary} names={ex.byId} units={units} onDone={() => navigate('/')} />}
      </Sheet>
    </div>
  );
}

function formatClock(ms: number) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ExerciseCard({
  we,
  exercise,
  units,
  note,
  onToggle,
  onPatch,
  onAddSet,
  onRemoveSet,
  onMenu,
}: {
  we: WorkoutExercise;
  exercise?: Exercise;
  units: Profile['units'];
  note?: string;
  onToggle: (i: number) => void;
  onPatch: (setId: string, patch: Partial<SetEntry>) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onMenu: () => void;
}) {
  const [why, setWhy] = useState(false);
  const timed = exercise ? isTimed(exercise) : false;
  const bodyweight = exercise?.loading === 'bodyweight' || exercise?.loading === 'band';
  const allDone = we.sets.length > 0 && we.sets.every((s) => s.done);
  const next = we.sets.find((s) => !s.done && s.kind === 'working');
  const plates = useMemo(() => {
    if (exercise?.loading !== 'barbell' || !next || next.targetWeightKg <= 0) return null;
    const p = platesPerSide(next.weightKg ?? next.targetWeightKg, units);
    return p.plates.length ? p.plates.join(' · ') : 'Empty bar';
  }, [exercise, next, units]);
  let workingIdx = 0;

  return (
    <section className="card" style={allDone ? { opacity: 0.75 } : undefined}>
      <div className="card-title" style={{ marginBottom: 8 }}>
        <div className="grow">
          <h3>{exercise?.name ?? we.exerciseId}</h3>
          <div className="small faint">
            {exercise?.primary.map((m) => MUSCLES[m].name).join(', ')}
            {we.repRange && ` · ${we.repRange[0]}–${we.repRange[1]}${timed ? 's' : ' reps'}`}
            {plates && ` · per side: ${plates}`}
          </div>
        </div>
        <button type="button" className="icon-btn sm" onClick={() => setWhy(!why)} aria-label="Why this prescription?" aria-expanded={why}>
          <Icon name="info" size={18} />
        </button>
        <button type="button" className="icon-btn sm" onClick={onMenu} aria-label="Exercise options">
          <Icon name="more" size={18} />
        </button>
      </div>
      {why && (
        <div className="stack" style={{ marginBottom: 8 }}>
          <p className="rationale">{we.rationale}</p>
          {exercise?.cues.length ? (
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              {exercise.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {note && (
        <p className="small" style={{ color: 'var(--accent)', marginBottom: 6 }} role="status">
          {note}
        </p>
      )}
      <div className="set-row header" aria-hidden="true">
        <span className="center">Set</span>
        <span className="center">{bodyweight ? `+${units}` : units}</span>
        <span className="center">{timed ? 'Sec' : 'Reps'}</span>
        <span className="center">RIR</span>
        <span />
      </div>
      {we.sets.map((s, i) => {
        const label = s.kind === 'warmup' ? 'W' : String(++workingIdx);
        return (
          <div key={s.id} className={`set-row ${s.kind}${s.done ? ' done' : ''}`}>
            <button
              type="button"
              className="idx"
              style={{ background: 'none', border: 0, cursor: s.done ? 'default' : 'pointer' }}
              aria-label={s.done ? `Set ${label}` : `Remove set ${label}`}
              onClick={() => !s.done && confirm('Remove this set?') && onRemoveSet(s.id)}
            >
              {label}
            </button>
            <NumField
              label={`Set ${label} weight`}
              value={s.weightKg === undefined ? undefined : toDisplay(s.weightKg, units)}
              placeholder={s.targetWeightKg > 0 ? formatWeight(s.targetWeightKg, units, false) : bodyweight ? 'BW' : '0'}
              onChange={(v) => onPatch(s.id, { weightKg: v === undefined ? undefined : fromDisplay(v, units) })}
            />
            <NumField
              label={`Set ${label} ${timed ? 'seconds' : 'reps'}`}
              decimals={0}
              value={s.reps}
              placeholder={String(s.targetReps)}
              onChange={(v) => onPatch(s.id, { reps: v })}
            />
            {s.kind === 'working' && !timed ? (
              <select
                className="num-input"
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
              className={`check-btn${s.done ? ' on' : ''}`}
              aria-pressed={s.done}
              aria-label={s.done ? `Undo set ${label}` : `Complete set ${label}`}
              onClick={() => onToggle(i)}
            >
              <Icon name="check" />
            </button>
          </div>
        );
      })}
      <button type="button" className="btn ghost sm" onClick={onAddSet} style={{ marginTop: 4 }}>
        <Icon name="plus" size={16} /> Add set
      </button>
    </section>
  );
}

function useGenerateInput(open: boolean) {
  const [input, setInput] = useState<GenerateInput | null>(null);
  useEffect(() => {
    if (open) void loadGenerateInput().then(setInput);
  }, [open]);
  return input;
}

function SwapSheet({
  target,
  workout,
  exercises,
  profile,
  onClose,
  onPick,
}: {
  target: WorkoutExercise | null;
  workout: Workout;
  exercises: Record<string, Exercise>;
  profile: Profile;
  onClose: () => void;
  onPick: (we: WorkoutExercise) => void;
}) {
  const input = useGenerateInput(!!target);
  const current = target ? exercises[target.exerciseId] : undefined;
  const options = useMemo(
    () => (input && current ? swapOptions(current, input, workout.exercises.map((e) => e.exerciseId)) : []),
    [input, current, workout.exercises],
  );
  return (
    <Sheet open={!!target} onClose={onClose} title={current ? `Swap ${current.name}` : 'Swap'}>
      {!input ? (
        <p className="faint">Finding alternatives…</p>
      ) : options.length === 0 ? (
        <p className="faint">No alternatives available with your current equipment.</p>
      ) : (
        <div className="list">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="list-item"
              onClick={() => {
                const remaining = target!.sets.filter((s) => s.kind === 'working' && !s.done).length || 3;
                onPick(planExercise(o, { ...input, profile }, remaining, false));
              }}
            >
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{o.name}</div>
                <div className="small faint">{o.primary.map((m) => MUSCLES[m].name).join(', ')}</div>
              </div>
              <Icon name="chevron" size={18} />
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function AddSheet({
  open,
  workout,
  exercises,
  onClose,
  onPick,
}: {
  open: boolean;
  workout: Workout;
  exercises: Exercise[];
  onClose: () => void;
  onPick: (we: WorkoutExercise) => void;
}) {
  const input = useGenerateInput(open);
  const [q, setQ] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const used = new Set(workout.exercises.map((e) => e.exerciseId));
  const list = exercises
    .filter((e) => !used.has(e.id))
    .filter((e) => !onlyAvailable || !input || isAvailable(e, input.equipment))
    .filter((e) => e.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 60);
  return (
    <Sheet open={open} onClose={onClose} title="Add exercise">
      <div className="stack">
        <input className="input" placeholder="Search exercises" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search exercises" />
        <label className="toggle small">
          <span>Only what's at this gym</span>
          <input type="checkbox" checked={onlyAvailable} onChange={(e) => setOnlyAvailable(e.target.checked)} />
        </label>
        <div className="list">
          {list.map((e) => (
            <button
              key={e.id}
              type="button"
              className="list-item"
              disabled={!input}
              onClick={() => input && onPick(planExercise(e, input, e.mechanic === 'compound' ? 3 : 2, false))}
            >
              <div className="grow">
                <div style={{ fontWeight: 600 }}>{e.name}</div>
                <div className="small faint">{e.primary.map((m) => MUSCLES[m].name).join(', ')}</div>
              </div>
              <Icon name="plus" size={18} />
            </button>
          ))}
          {list.length === 0 && <p className="faint small">No matches.</p>}
        </div>
      </div>
    </Sheet>
  );
}

function Summary({
  workout,
  prs,
  names,
  units,
  onDone,
}: {
  workout: Workout;
  prs: PR[];
  names: Record<string, Exercise>;
  units: Profile['units'];
  onDone: () => void;
}) {
  const sets = workout.exercises.flatMap((e) => e.sets).filter((s) => s.done && s.kind === 'working');
  const volume = sets.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const prText = (p: PR) => {
    const name = names[p.exerciseId]?.name ?? p.exerciseId;
    if (p.kind === 'e1rm') return `${name}: new estimated 1RM ${formatWeight(p.value, units)} (was ${formatWeight(p.previous, units)})`;
    if (p.kind === 'weight') return `${name}: heaviest ever ${formatWeight(p.value, units)}`;
    return `${name}: ${p.value} reps at ${formatWeight(p.weightKg ?? 0, units)} (best was ${p.previous})`;
  };
  return (
    <div className="stack lg">
      <div className="stats">
        <div className="stat">
          <span className="value">{formatDuration((workout.finishedAt ?? 0) - (workout.startedAt ?? 0))}</span>
          <span className="label">Duration</span>
        </div>
        <div className="stat">
          <span className="value">{sets.length}</span>
          <span className="label">Working sets</span>
        </div>
        <div className="stat">
          <span className="value">{formatWeight(volume, units, false)}</span>
          <span className="label">Volume ({units})</span>
        </div>
      </div>
      {prs.length > 0 ? (
        <div className="stack">
          <div className="section-title">Personal records</div>
          {prs.map((p, i) => (
            <div key={i} className="row small">
              <span style={{ color: 'var(--warning)' }}>
                <Icon name="trophy" size={18} title="Personal record" />
              </span>
              <span>{prText(p)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="small muted">
          No records this time — consistency is what moves the needle. Your next session is already calibrated from today.
        </p>
      )}
      <p className="small faint">Strength score tracks your {Object.values(LIFT_NAMES).join(', ').toLowerCase()} — see Progress.</p>
      <button type="button" className="btn primary lg block" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

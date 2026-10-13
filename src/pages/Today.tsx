import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BodyMap, Figure, MuscleThumb, targetFill } from '../components/BodyMap';
import { SwapSheet } from '../components/ExerciseSheets';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import { eraseAll } from '../db/demo';
import { generateAndSave, startEmptyWorkout, startWorkout } from '../db/repo';
import { detectPRs, weekStreak } from '../engine/analytics';
import { estimateMinutes, FOCUS_LABEL, splitFor, type Focus } from '../engine/generator';
import { flattenSets } from '../engine/history';
import { formatWeight } from '../engine/load';
import { MUSCLES, MUSCLE_IDS, PRIORITY_MUSCLES } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import { hoursUntilRecovered } from '../engine/recovery';
import type { ActivityKind, Exercise, Intensity, MuscleId, Profile, Workout, WorkoutExercise } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { formatDuration, formatEta, formatVolume, relativeDay, useExercises, useNow, useProfile, useTrainingState } from '../hooks';
import { haptics } from '../ui/haptics';
import { PlateStack } from '../ui/PlateStack';
import { Range } from '../ui/Range';
import { Ring } from '../ui/Ring';
import { toast } from '../ui/toast';
import { WeekStrip, type DayMark } from '../ui/WeekStrip';
import './Today.css';

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 5 ? 'Late session' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function readinessLabel(r: number): string {
  if (r >= 0.9) return 'Fully charged';
  if (r >= 0.75) return 'Good to go';
  if (r >= 0.55) return 'Still recovering';
  return 'Take it easy';
}

/** "Upper body · Chest, Lats & Upper back" → ["Upper body", "Chest, Lats & Upper back"] */
export function splitName(name: string): [string, string] {
  const [kind, ...rest] = name.split(' · ');
  return [kind ?? name, rest.join(' · ')];
}

export function Today() {
  const profile = useProfile();
  const state = useTrainingState();
  const ex = useExercises();
  const now = useNow();
  const navigate = useNavigate();
  const planned = useLiveQuery(async () => (await db.workouts.where('status').equals('planned').first()) ?? null);
  const active = useLiveQuery(async () => (await db.workouts.where('status').equals('active').first()) ?? null);
  const gyms = useLiveQuery(() => db.gyms.toArray());
  const [customize, setCustomize] = useState(false);
  const [logActivity, setLogActivity] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoGen = useRef(false);

  // A plan is only good for the day it was made: recovery moves on.
  useEffect(() => {
    if (planned === undefined || autoGen.current || !profile) return;
    if (planned === null || dayKey(planned.createdAt) !== dayKey(Date.now())) {
      autoGen.current = true;
      void generateAndSave();
    }
  }, [planned, profile]);

  const week = useMemo(() => {
    if (!state) return undefined;
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const days: DayMark[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = dayKey(d.getTime());
      return {
        date: d,
        lifted: state.workouts.some((w) => dayKey(w.finishedAt ?? 0) === k),
        cardio: state.activities.some((a) => dayKey(a.at) === k),
      };
    });
    return {
      days,
      count: days.filter((d) => d.lifted).length,
      streak: weekStreak(
        state.workouts.map((w) => w.finishedAt ?? w.createdAt),
        now,
      ),
    };
  }, [state, now]);

  if (!profile || !state || !ex || !week) return null;

  const trainedToday = state.workouts.some((w) => dayKey(w.finishedAt ?? 0) === dayKey(now));
  const last = state.workouts[0];

  async function regenerate(opts: Parameters<typeof generateAndSave>[0] = {}) {
    setBusy(true);
    try {
      await generateAndSave({ ...opts, seed: Math.floor(Math.random() * 1e9) });
      haptics.tap();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page today">
      <header className="page-header">
        <div>
          <div className="eyebrow">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</div>
          <h1 style={{ marginTop: 6 }}>
            {greeting(now)}
            {profile.name ? `, ${profile.name}` : ''}
          </h1>
        </div>
        <Link to="/settings" className="icon-btn" aria-label="Settings">
          <Icon name="settings" />
        </Link>
      </header>

      {profile.demo && (
        <div className="today-demo">
          <Icon name="sparkle" size={18} />
          <span className="grow small">Exploring sample data</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => confirm('Erase the sample data and set up your own profile?') && void eraseAll()}
          >
            Start fresh
          </button>
        </div>
      )}

      <section className="card tight">
        <WeekStrip days={week.days} now={now} />
        <div className="row between small" style={{ marginTop: 12, padding: '0 4px' }}>
          <span className="muted">
            <strong style={{ color: 'var(--text-1)' }}>{week.count}</strong> of {profile.daysPerWeek} workouts this week
          </span>
          {week.streak > 0 && (
            <span className="today-streak">
              <Icon name="flame" size={15} /> {week.streak}-week streak
            </span>
          )}
        </div>
      </section>

      {active ? (
        <Link to={`/workout/${active.id}`} className="card hero interactive today-resume">
          <div className="eyebrow">In progress</div>
          <div className="row" style={{ marginTop: 8 }}>
            <div className="grow">
              <h2 className="today-title">{splitName(active.name)[0]}</h2>
              <p className="small muted">
                {formatDuration(now - (active.startedAt ?? now))} in · {active.exercises.flatMap((e) => e.sets).filter((s) => s.done).length} sets logged
              </p>
            </div>
            <span className="btn primary">
              <Icon name="play" size={16} /> Resume
            </span>
          </div>
        </Link>
      ) : (
        <PlanCard
          plan={planned ?? undefined}
          trainedToday={trainedToday}
          profile={profile}
          exercises={ex.byId}
          busy={busy}
          onStart={async () => {
            if (!planned) return;
            haptics.success();
            await startWorkout(planned.id);
            navigate(`/workout/${planned.id}`);
          }}
          onRegenerate={() => regenerate()}
          onCustomize={() => setCustomize(true)}
        />
      )}

      <ReadinessCard state={state} plan={planned ?? undefined} exercises={ex.byId} onLogCardio={() => setLogActivity(true)} />

      {last && <LastWorkout workout={last} all={state.workouts} profile={profile} exercises={ex.byId} now={now} />}

      <button
        type="button"
        className="btn ghost"
        onClick={async () => {
          const id = await startEmptyWorkout();
          navigate(`/workout/${id}`);
        }}
      >
        <Icon name="plus" size={18} /> Start an empty workout
      </button>

      <CustomizeSheet
        open={customize}
        onClose={() => setCustomize(false)}
        profile={profile}
        gyms={gyms ?? []}
        onGenerate={async (opts) => {
          setCustomize(false);
          if (opts.gymId && opts.gymId !== profile.activeGymId) await db.profile.update('me', { activeGymId: opts.gymId });
          await regenerate(opts);
          toast('Workout rebuilt', { icon: 'sparkle' });
        }}
      />
      <ActivitySheet open={logActivity} onClose={() => setLogActivity(false)} />
    </div>
  );
}

// ── Today's plan ───────────────────────────────────────────────────────────

function planMuscles(plan: Workout, exercises: Record<string, Exercise>) {
  const primary = new Set<MuscleId>();
  const secondary = new Set<MuscleId>();
  for (const we of plan.exercises) {
    const e = exercises[we.exerciseId];
    e?.primary.forEach((m) => primary.add(m));
    e?.secondary.forEach((m) => secondary.add(m));
  }
  return { primary: [...primary], secondary: [...secondary].filter((m) => !primary.has(m)) };
}

function targetText(we: WorkoutExercise, ex: Exercise | undefined, profile: Profile) {
  const working = we.sets.filter((s) => s.kind === 'working');
  const first = working[0];
  const timed = ex ? isTimed(ex) : false;
  return {
    scheme: `${working.length} × ${first?.targetReps ?? '–'}${timed ? 's' : ''}`,
    load: first && first.targetWeightKg > 0 ? formatWeight(first.targetWeightKg, profile.units) : ex?.loading === 'bodyweight' ? 'Bodyweight' : ex?.loading === 'band' ? 'Band' : '',
  };
}

function PlanCard({
  plan,
  trainedToday,
  profile,
  exercises,
  busy,
  onStart,
  onRegenerate,
  onCustomize,
}: {
  plan?: Workout;
  trainedToday: boolean;
  profile: Profile;
  exercises: Record<string, Exercise>;
  busy: boolean;
  onStart: () => void;
  onRegenerate: () => void;
  onCustomize: () => void;
}) {
  const [preview, setPreview] = useState<WorkoutExercise | null>(null);
  const [swapFor, setSwapFor] = useState<WorkoutExercise | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);

  if (!plan) {
    return (
      <section className="card hero stack">
        <div className="skeleton" style={{ height: 14, width: 120 }} />
        <div className="skeleton" style={{ height: 40, width: '70%' }} />
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton" style={{ height: 52 }} />
        ))}
      </section>
    );
  }

  const [kind, muscles] = splitName(plan.name);
  const focus = planMuscles(plan, exercises);
  const sets = plan.exercises.reduce((a, we) => a + we.sets.filter((s) => s.kind === 'working').length, 0);

  async function updatePlan(exs: WorkoutExercise[]) {
    await db.workouts.update(plan!.id, { exercises: exs, estimatedMinutes: estimateMinutes(exs) });
  }

  return (
    <section className="card hero today-plan" aria-label="Today's workout">
      <div className="row top">
        <div className="grow">
          <div className="eyebrow">{trainedToday ? 'Next workout' : "Today's workout"}</div>
          <h2 className="today-title">{kind}</h2>
          {muscles && <p className="muted" style={{ marginTop: 2 }}>{muscles}</p>}
        </div>
        <MuscleThumb primary={focus.primary} secondary={focus.secondary} size={78} label={`Targets ${focus.primary.map((m) => MUSCLES[m].name).join(', ')}`} />
      </div>

      <div className="today-meta">
        <span>
          <Icon name="clock" size={16} /> {plan.estimatedMinutes} min
        </span>
        <span>
          <Icon name="layers" size={16} /> {plan.exercises.length} exercises
        </span>
        <span>
          <Icon name="bolt" size={16} /> {sets} sets
        </span>
      </div>

      {plan.summary && (
        <button type="button" className={`today-why${whyOpen ? ' open' : ''}`} onClick={() => setWhyOpen(!whyOpen)} aria-expanded={whyOpen}>
          <Icon name="info" size={15} />
          <span>{plan.summary}</span>
        </button>
      )}

      <ol className="today-list">
        {plan.exercises.map((we, i) => {
          const e = exercises[we.exerciseId];
          const t = targetText(we, e, profile);
          return (
            <li key={we.id}>
              <button type="button" className="today-ex" onClick={() => setPreview(we)}>
                <span className="today-ex-idx display">{i + 1}</span>
                {e && <MuscleThumb primary={e.primary} secondary={e.secondary} size={42} />}
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="today-ex-name truncate">{e?.name ?? we.exerciseId}</span>
                  <span className="small faint truncate" style={{ display: 'block' }}>
                    {we.sets.some((s) => s.kind === 'warmup') ? 'Warm-up included · ' : ''}
                    {e?.primary.map((m) => MUSCLES[m].name).join(', ')}
                  </span>
                </span>
                <span className="today-ex-target">
                  <span className="display">{t.scheme}</span>
                  <span className="small faint">{t.load}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {plan.exercises.length === 0 && <p className="small faint">Nothing fits these settings — try another focus or gym.</p>}

      <div className="row today-actions">
        <button type="button" className="icon-btn" onClick={onCustomize} aria-label="Customize today's workout">
          <Icon name="sliders" />
        </button>
        <button type="button" className="icon-btn" onClick={onRegenerate} disabled={busy} aria-label="Generate a different workout">
          <span className={busy ? 'spin' : undefined} style={{ display: 'inline-flex' }}>
            <Icon name="refresh" />
          </span>
        </button>
        <button type="button" className="btn primary lg grow" onClick={onStart} disabled={busy || plan.exercises.length === 0}>
          <Icon name="play" size={18} /> Start workout
        </button>
      </div>

      <ExercisePreview
        we={preview}
        exercise={preview ? exercises[preview.exerciseId] : undefined}
        profile={profile}
        canRemove={plan.exercises.length > 1}
        onClose={() => setPreview(null)}
        onSwap={() => {
          setSwapFor(preview);
          setPreview(null);
        }}
        onRemove={async () => {
          const id = preview!.id;
          setPreview(null);
          await updatePlan(plan.exercises.filter((x) => x.id !== id));
          toast('Exercise removed');
        }}
      />
      <SwapSheet
        target={swapFor}
        exercises={exercises}
        inWorkout={plan.exercises.map((x) => x.exerciseId)}
        onClose={() => setSwapFor(null)}
        onPick={async (replacement) => {
          const target = swapFor!;
          setSwapFor(null);
          await updatePlan(plan.exercises.map((x) => (x.id === target.id ? replacement : x)));
          toast(`Swapped in ${exercises[replacement.exerciseId]?.name ?? 'exercise'}`, { icon: 'swap' });
        }}
      />
    </section>
  );
}

function ExercisePreview({
  we,
  exercise,
  profile,
  canRemove,
  onClose,
  onSwap,
  onRemove,
}: {
  we: WorkoutExercise | null;
  exercise?: Exercise;
  profile: Profile;
  canRemove: boolean;
  onClose: () => void;
  onSwap: () => void;
  onRemove: () => void;
}) {
  const working = we?.sets.filter((s) => s.kind === 'working') ?? [];
  const top = working[0];
  return (
    <Sheet open={!!we} onClose={onClose} title={exercise?.name} subtitle={exercise?.primary.map((m) => MUSCLES[m].name).join(' · ')}>
      {we && exercise && (
        <div className="stack lg">
          <div className="today-figures">
            <Figure view="front" fill={(m) => targetFill(m, exercise.primary, exercise.secondary)} label="Front view" />
            <Figure view="back" fill={(m) => targetFill(m, exercise.primary, exercise.secondary)} label="Back view" />
          </div>
          <div className="rationale">
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Why this prescription
            </div>
            {we.rationale}
          </div>
          <div className="group">
            {we.sets.map((s, i) => (
              <div key={s.id} className="group-row" style={{ cursor: 'default' }}>
                <span className={`badge${s.kind === 'warmup' ? '' : ' accent'}`} style={{ minWidth: 30, justifyContent: 'center' }}>
                  {s.kind === 'warmup' ? 'W' : i + 1 - (we.sets.length - working.length)}
                </span>
                <span className="grow muted small">{s.kind === 'warmup' ? 'Warm-up' : `Working · ${s.targetRir} in reserve`}</span>
                <span className="display" style={{ fontSize: 20 }}>
                  {s.targetWeightKg > 0 ? `${formatWeight(s.targetWeightKg, profile.units)} × ` : ''}
                  {s.targetReps}
                  {isTimed(exercise) ? 's' : ''}
                </span>
              </div>
            ))}
          </div>
          {exercise.loading === 'barbell' && top && top.targetWeightKg > 0 && <PlateStack totalKg={top.targetWeightKg} units={profile.units} />}
          {exercise.cues.length > 0 && (
            <ol className="today-cues">
              {exercise.cues.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
          )}
          <div className="row">
            <button type="button" className="btn grow" onClick={onSwap}>
              <Icon name="swap" size={18} /> Swap
            </button>
            {canRemove && (
              <button type="button" className="btn grow danger" onClick={onRemove}>
                <Icon name="trash" size={18} /> Remove
              </button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

// ── Readiness ──────────────────────────────────────────────────────────────

function ReadinessCard({
  state,
  plan,
  exercises,
  onLogCardio,
}: {
  state: NonNullable<ReturnType<typeof useTrainingState>>;
  plan?: Workout;
  exercises: Record<string, Exercise>;
  onLogCardio: () => void;
}) {
  const [showMap, setShowMap] = useState(false);
  const [selected, setSelected] = useState<MuscleId | undefined>();
  const focus = plan ? planMuscles(plan, exercises).primary : [];
  const basis = focus.length ? focus : PRIORITY_MUSCLES;
  const readiness = basis.reduce((a, m) => a + state.recovery[m], 0) / basis.length;
  const tired = MUSCLE_IDS.filter((m) => state.recovery[m] < 0.9).sort((a, b) => state.recovery[a] - state.recovery[b]);
  const worst = tired[0];

  return (
    <section className="card today-ready">
      <div className="row" style={{ gap: 16 }}>
        <Ring value={readiness} size={92} stroke={9} label={`Readiness ${Math.round(readiness * 100)}%`}>
          <span className="display" style={{ fontSize: 30 }}>
            {Math.round(readiness * 100)}
            <span style={{ fontSize: 15, color: 'var(--text-3)' }}>%</span>
          </span>
        </Ring>
        <div className="grow">
          <div className="eyebrow">Readiness</div>
          <h3 style={{ fontSize: 18, marginTop: 4 }}>{readinessLabel(readiness)}</h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            {!worst
              ? 'Every muscle is fresh.'
              : focus.length && !focus.includes(worst)
                ? `${MUSCLES[worst].name} still recovering (${Math.round(state.recovery[worst] * 100)}%) — today's session works around them.`
                : `${MUSCLES[worst].name} at ${Math.round(state.recovery[worst] * 100)}%, fully back in ${formatEta(hoursUntilRecovered(worst, state.fatigue[worst]))}.`}
          </p>
        </div>
      </div>

      {tired.length > 0 && (
        <div className="today-fatigue">
          {tired.slice(0, 3).map((m) => (
            <div key={m} className="today-fatigue-row">
              <span className="small" style={{ width: 92 }}>
                {MUSCLES[m].name}
              </span>
              <span className="bar grow">
                <span className="fill" style={{ width: `${state.recovery[m] * 100}%`, background: 'linear-gradient(90deg, var(--fatigue), color-mix(in oklab, var(--fatigue) 50%, var(--accent-fill)))' }} />
              </span>
              <span className="small faint num" style={{ width: 36, textAlign: 'right' }}>
                {Math.round(state.recovery[m] * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {showMap && (
        <div style={{ marginTop: 14 }}>
          <BodyMap recovery={state.recovery} selected={selected} onSelect={setSelected} />
          {selected && (
            <p className="small muted center" style={{ marginTop: 8 }}>
              <strong style={{ color: 'var(--text-1)' }}>{MUSCLES[selected].name}</strong> · {Math.round(state.recovery[selected] * 100)}% recovered
            </p>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button type="button" className="btn sm" onClick={() => setShowMap(!showMap)} aria-expanded={showMap}>
          <Icon name="user" size={16} /> {showMap ? 'Hide body map' : 'Body map'}
        </button>
        <button type="button" className="btn sm" onClick={onLogCardio}>
          <Icon name="run" size={16} /> Log cardio
        </button>
      </div>
    </section>
  );
}

// ── Last workout ───────────────────────────────────────────────────────────

function LastWorkout({ workout, all, profile, exercises, now }: { workout: Workout; all: Workout[]; profile: Profile; exercises: Record<string, Exercise>; now: number }) {
  const prs = useMemo(() => {
    const before = all.filter((w) => (w.finishedAt ?? 0) < (workout.finishedAt ?? 0));
    return detectPRs(flattenSets([workout]), flattenSets(before)).length;
  }, [workout, all]);
  const sets = workout.exercises.flatMap((e) => e.sets).filter((s) => s.done && s.kind === 'working');
  const volume = sets.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const focus = planMuscles(workout, exercises);
  const [kind] = splitName(workout.name);
  return (
    <Link to={`/history/${workout.id}`} className="card interactive today-last">
      <div className="row" style={{ gap: 12 }}>
        <MuscleThumb primary={focus.primary} secondary={focus.secondary} size={52} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="eyebrow">Last workout</div>
          <div className="row" style={{ marginTop: 3, gap: 8 }}>
            <span className="truncate" style={{ fontWeight: 650 }}>
              {kind}
            </span>
            {prs > 0 && (
              <span className="badge pr">
                <Icon name="trophy" size={12} /> {prs} PR{prs > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="small faint num truncate">
            {relativeDay(workout.finishedAt ?? 0, now)} · {formatDuration((workout.finishedAt ?? 0) - (workout.startedAt ?? 0))} · {sets.length} sets · {formatVolume(volume, profile.units)}
          </div>
        </div>
        <Icon name="chevron" size={18} />
      </div>
    </Link>
  );
}

// ── Sheets ─────────────────────────────────────────────────────────────────

function CustomizeSheet({
  open,
  onClose,
  profile,
  gyms,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  profile: Profile;
  gyms: { id: string; name: string }[];
  onGenerate: (opts: { focus: Focus; minutes: number; avoidMuscles: MuscleId[]; gymId: string }) => void;
}) {
  const [focus, setFocus] = useState<Focus>('auto');
  const [minutes, setMinutes] = useState(profile.sessionMinutes);
  const [avoid, setAvoid] = useState<MuscleId[]>([]);
  const [gymId, setGymId] = useState(profile.activeGymId);
  const split = splitFor(profile.daysPerWeek);
  const focuses: Focus[] = ['auto', ...split, ...(['full', 'upper', 'lower', 'push', 'pull', 'legs', 'arms', 'core'] as Focus[]).filter((f) => !split.includes(f as never))];

  return (
    <Sheet open={open} onClose={onClose} title="Customize today" subtitle="The engine rebuilds the session around your constraints.">
      <div className="stack lg">
        <div className="field">
          <span>Focus</span>
          <div className="chips wrap">
            {focuses.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={focus === f} onClick={() => setFocus(f)}>
                {f === 'auto' && <Icon name="sparkle" size={14} />}
                {FOCUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <Range label="Time available" value={minutes} min={15} max={120} step={5} onChange={setMinutes} format={(v) => `${v} min`} />
        {gyms.length > 1 && (
          <div className="field">
            <span>Where are you training?</span>
            <div className="chips wrap">
              {gyms.map((g) => (
                <button key={g.id} type="button" className="chip" aria-pressed={gymId === g.id} onClick={() => setGymId(g.id)}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field">
          <span>Sore or injured? We'll work around it.</span>
          <div className="chips wrap">
            {MUSCLE_IDS.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={avoid.includes(m)} onClick={() => setAvoid((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}>
                {MUSCLES[m].name}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn primary lg block" onClick={() => onGenerate({ focus, minutes, avoidMuscles: avoid, gymId })}>
          <Icon name="sparkle" size={18} /> Build workout
        </button>
      </div>
    </Sheet>
  );
}

const ACTIVITY_KINDS: { id: ActivityKind; label: string; icon: IconName }[] = [
  { id: 'run', label: 'Run', icon: 'run' },
  { id: 'ride', label: 'Ride', icon: 'bike' },
  { id: 'hike', label: 'Hike', icon: 'mountain' },
  { id: 'swim', label: 'Swim', icon: 'waves' },
  { id: 'sport', label: 'Sport', icon: 'ball' },
  { id: 'other', label: 'Other', icon: 'heart' },
];

function ActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [kind, setKind] = useState<ActivityKind>('run');
  const [minutes, setMinutes] = useState(45);
  const [intensity, setIntensity] = useState<Intensity>('moderate');
  const [daysAgo, setDaysAgo] = useState(0);

  async function save() {
    const at = new Date();
    at.setDate(at.getDate() - daysAgo);
    if (daysAgo > 0) at.setHours(18, 0, 0, 0);
    await db.activities.add({ id: uid(), kind, minutes, intensity, at: at.getTime() });
    haptics.success();
    toast(`${ACTIVITY_KINDS.find((k) => k.id === kind)?.label} logged — recovery updated`, { icon: 'check' });
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log cardio" subtitle="Runs, rides and sport tire your legs too — this keeps recovery honest.">
      <div className="stack lg">
        <div className="today-kinds">
          {ACTIVITY_KINDS.map((k) => (
            <button key={k.id} type="button" className="option-card" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              <Icon name={k.icon} />
              <strong>{k.label}</strong>
            </button>
          ))}
        </div>
        <Range label="Duration" value={minutes} min={10} max={300} step={5} onChange={setMinutes} format={(v) => formatDuration(v * 60_000)} />
        <div className="field">
          <span>Intensity</span>
          <div className="segmented" role="group" aria-label="Intensity">
            {(['easy', 'moderate', 'hard'] as Intensity[]).map((i) => (
              <button key={i} type="button" aria-pressed={intensity === i} onClick={() => setIntensity(i)}>
                {i[0]!.toUpperCase() + i.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span>When</span>
          <div className="segmented" role="group" aria-label="When">
            {['Today', 'Yesterday', '2 days ago'].map((label, i) => (
              <button key={label} type="button" aria-pressed={daysAgo === i} onClick={() => setDaysAgo(i)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" className="btn primary lg block" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

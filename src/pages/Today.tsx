import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BodyMap, Figure, MuscleThumb, targetFill } from '../components/BodyMap';
import { SwapSheet } from '../components/ExerciseSheets';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ExerciseVideo } from '../components/ExerciseVideo';
import { DayPills, SplitSheet } from '../components/SplitSheet';
import { db } from '../db/db';
import { eraseAll } from '../db/demo';
import { generateAndSave, loadProjection, recentDayTypes, saveSplit, startEmptyWorkout, startWorkout } from '../db/repo';
import { detectPRs, weekStreak } from '../engine/analytics';
import { DAY_TYPES, dayTypeOf, estimateMinutes, FOCUS_LABEL, nextRotationIndex, splitDays, splitName as rotationName, splitOrder, type Focus } from '../engine/generator';
import { flattenSets } from '../engine/history';
import { kitFor } from '../engine/kit';
import { formatWeight } from '../engine/load';
import { MUSCLES, MUSCLE_IDS, PRIORITY_MUSCLES } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import { hoursUntilRecovered } from '../engine/recovery';
import { addDays, isTrainingDay, startOfDay, startOfWeek, trainingDays, type ProjectedDay } from '../engine/schedule';
import type { Activity, ActivityKind, DayType, Exercise, GymWeights, Intensity, MuscleId, Profile, Workout, WorkoutExercise } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { formatDuration, formatEta, formatVolume, relativeDay, useExercises, useNow, useProfile, useTrainingState } from '../hooks';
import { haptics } from '../ui/haptics';
import { PlateStack } from '../ui/PlateStack';
import { Range } from '../ui/Range';
import { Ring } from '../ui/Ring';
import { ask } from '../ui/ask';
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
  const [splitOpen, setSplitOpen] = useState(false);
  const [logActivity, setLogActivity] = useState(false);
  const [busy, setBusy] = useState(false);
  const autoGen = useRef(false);
  const today = startOfDay(now);
  const thisWeek = startOfWeek(now);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const [selected, setSelected] = useState(today);
  const [trainAnyway, setTrainAnyway] = useState(false);
  const weekEnd = addDays(weekStart, 6);
  // Forecast through the week on screen, and at least a week out for "up next".
  const projection = useLiveQuery(() => loadProjection(Math.max(weekEnd, addDays(today, 7))), [weekEnd, today]);

  // A new day: back to today.
  useEffect(() => {
    setSelected(today);
    setWeekStart(startOfWeek(today));
    setTrainAnyway(false);
  }, [today]);

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
    const byDay = new Map<number, ProjectedDay>((projection ?? []).map((p) => [p.day, p]));
    const activeType = active ? dayTypeOf(active) : undefined;
    const days: DayMark[] = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(weekStart, i);
      const done = state.workouts.find((w) => w.finishedAt && startOfDay(w.finishedAt) === day);
      const live = day === today && active ? activeType : undefined;
      const forecast = byDay.get(day)?.workout.focusKind;
      return {
        day,
        lifted: !!done,
        cardio: state.activities.some((a) => startOfDay(a.at) === day),
        type: done ? dayTypeOf(done) : (live ?? forecast),
        planned: !done && !!(live ?? forecast),
      };
    });
    return {
      days,
      byDay,
      count: days.filter((d) => d.lifted).length,
      planned: days.filter((d) => d.planned).length,
      streak: weekStreak(
        state.workouts.map((w) => w.finishedAt ?? w.createdAt),
        now,
      ),
    };
  }, [state, projection, weekStart, today, active, now]);

  if (!profile || !state || !ex || !week) return null;

  const doneOn = (day: number) => state.workouts.filter((w) => w.finishedAt && startOfDay(w.finishedAt) === day).reverse();
  const nextAfter = (day: number) => (projection ?? []).find((p) => p.day > day);
  const oldest = state.workouts[state.workouts.length - 1]?.finishedAt;
  const minWeek = Math.max(addDays(thisWeek, -7 * 26), oldest ? startOfWeek(oldest) : thisWeek);
  const maxWeek = addDays(thisWeek, 21);
  const select = (day: number) => {
    haptics.tap();
    setSelected(day);
  };
  const goWeek = (dir: 1 | -1) => {
    const w = addDays(weekStart, 7 * dir);
    if (w < minWeek || w > maxWeek) return;
    haptics.tap();
    setWeekStart(w);
    if (w === thisWeek) return setSelected(today);
    // Land on the first day with something to see.
    const days = Array.from({ length: 7 }, (_, i) => addDays(w, i));
    setSelected(days.find((d) => (w > thisWeek ? isTrainingDay(d, profile) : doneOn(d).length > 0)) ?? w);
  };
  const weekTitle = weekStart === thisWeek ? 'This week' : weekStart === addDays(thisWeek, 7) ? 'Next week' : weekStart === addDays(thisWeek, -7) ? 'Last week' : null;
  const rangeText = `${new Date(weekStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekEnd).toLocaleDateString(undefined, { month: new Date(weekEnd).getMonth() === new Date(weekStart).getMonth() ? undefined : 'short', day: 'numeric' })}`;
  const gymWeights = gyms?.find((g) => g.id === (planned?.gymId || profile.activeGymId))?.weights;
  const startPlan = async () => {
    if (!planned) return;
    haptics.success();
    await startWorkout(planned.id);
    navigate(`/workout/${planned.id}`);
  };

  const trainedToday = state.workouts.some((w) => dayKey(w.finishedAt ?? 0) === dayKey(now));
  const last = state.workouts[0];
  const rotation = splitDays(profile);
  const day = planned ? dayTypeOf(planned) : undefined;
  let current = day ? rotation.indexOf(day) : -1;
  if (day && splitOrder(profile) === 'rotate') {
    // A day repeated in the rotation: highlight the one that's actually up next.
    const next = nextRotationIndex(rotation, recentDayTypes(state.workouts));
    if (rotation[next] === day) current = next;
  }

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
            onClick={async () =>
              (await ask({ title: 'Start fresh?', body: 'The sample data is erased and you set up your own profile.', confirm: 'Erase sample data', tone: 'danger' })) &&
              void eraseAll()
            }
          >
            Start fresh
          </button>
        </div>
      )}

      <section className="card tight today-week" aria-label="Week">
        <div className="today-week-nav">
          <button type="button" className="icon-btn sm plain" aria-label="Previous week" disabled={weekStart <= minWeek} onClick={() => goWeek(-1)}>
            <Icon name="back" size={18} />
          </button>
          <div className="today-week-title" aria-live="polite">
            <strong>{weekTitle ?? rangeText}</strong>
            {weekTitle && <span>{rangeText}</span>}
          </div>
          <button type="button" className="icon-btn sm plain" aria-label="Next week" disabled={weekStart >= maxWeek} onClick={() => goWeek(1)}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
        <WeekStrip days={week.days} today={today} selected={selected} onSelect={select} />
        <div className="row between small today-week-foot">
          {weekStart === thisWeek ? (
            <>
              <span className="muted">
                <strong style={{ color: 'var(--text-1)' }}>{week.count}</strong> of {trainingDays(profile).length} workouts this week
              </span>
              {week.streak > 0 && (
                <span className="today-streak">
                  <Icon name="flame" size={15} /> {week.streak}-week streak
                </span>
              )}
            </>
          ) : weekStart > thisWeek ? (
            <span className="muted">
              <strong style={{ color: 'var(--text-1)' }}>{week.planned}</strong> {week.planned === 1 ? 'session' : 'sessions'} planned · tap a day to preview
            </span>
          ) : (
            <span className="muted">
              <strong style={{ color: 'var(--text-1)' }}>{week.count}</strong> {week.count === 1 ? 'workout' : 'workouts'} logged
            </span>
          )}
        </div>
      </section>

      {selected === today ? (
        active ? (
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
        ) : trainedToday && !trainAnyway ? (
          <>
            {doneOn(today).map((w) => (
              <LastWorkout key={w.id} eyebrow="Done today" workout={w} all={state.workouts} profile={profile} exercises={ex.byId} now={now} />
            ))}
            {nextAfter(today) && <NextUp next={nextAfter(today)!} today={today} onSelect={select} />}
          </>
        ) : !isTrainingDay(today, profile) && !trainAnyway ? (
          <RestCard day={today} today={today} next={nextAfter(today)} onSelect={select} onTrainAnyway={() => setTrainAnyway(true)} />
        ) : (
          <PlanCard
            plan={planned ?? undefined}
            eyebrow={isTrainingDay(today, profile) ? "Today's workout" : 'Extra session'}
            profile={profile}
            exercises={ex.byId}
            busy={busy}
            onStart={startPlan}
            onRegenerate={() => regenerate()}
            onCustomize={() => setCustomize(true)}
            rotation={rotation}
            current={current >= 0 ? current : undefined}
            onSplit={() => setSplitOpen(true)}
            weights={gymWeights}
          />
        )
      ) : selected > today ? (
        week.byDay.get(selected) ? (
          <UpcomingCard entry={week.byDay.get(selected)!} today={today} profile={profile} exercises={ex.byId} onStart={active ? undefined : startPlan} />
        ) : projection === undefined ? (
          <section className="card hero stack" aria-busy="true">
            <div className="skeleton" style={{ height: 14, width: 120 }} />
            <div className="skeleton" style={{ height: 40, width: '60%' }} />
          </section>
        ) : (
          <RestCard day={selected} today={today} next={nextAfter(selected)} onSelect={select} />
        )
      ) : (
        <DayLog
          day={selected}
          today={today}
          workouts={doneOn(selected)}
          activities={state.activities.filter((a) => startOfDay(a.at) === selected)}
          scheduled={isTrainingDay(selected, profile)}
          all={state.workouts}
          profile={profile}
          exercises={ex.byId}
          now={now}
        />
      )}

      {selected === today && (
        <>
          <ReadinessCard
            state={state}
            plan={!trainedToday && (isTrainingDay(today, profile) || trainAnyway) ? (planned ?? undefined) : undefined}
            exercises={ex.byId}
            onLogCardio={() => setLogActivity(true)}
          />

          {last && !trainedToday && <LastWorkout workout={last} all={state.workouts} profile={profile} exercises={ex.byId} now={now} />}

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
        </>
      )}

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
      {splitOpen && (
        <SplitSheet
          value={profile.split}
          daysPerWeek={profile.daysPerWeek}
          onSave={async (split) => {
            await saveSplit(split);
            haptics.tap();
            toast(split ? `Following ${rotationName(split.days)}` : 'Split set to automatic', { icon: 'check', tone: 'accent' });
          }}
          onClose={() => setSplitOpen(false)}
        />
      )}
    </div>
  );
}

// ── Today's plan ───────────────────────────────────────────────────────────

function planMuscles(plan: Pick<Workout, 'exercises'>, exercises: Record<string, Exercise>) {
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
  eyebrow,
  profile,
  exercises,
  busy,
  onStart,
  onRegenerate,
  onCustomize,
  rotation,
  current,
  onSplit,
  weights,
}: {
  plan?: Workout;
  eyebrow: string;
  profile: Profile;
  exercises: Record<string, Exercise>;
  busy: boolean;
  onStart: () => void;
  onRegenerate: () => void;
  onCustomize: () => void;
  rotation: DayType[];
  current?: number;
  onSplit: () => void;
  weights?: GymWeights;
}) {
  const [preview, setPreview] = useState<WorkoutExercise | null>(null);
  const [swapFor, setSwapFor] = useState<WorkoutExercise | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);

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
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="today-title">{kind}</h2>
          {muscles && <p className="muted" style={{ marginTop: 2 }}>{muscles}</p>}
        </div>
        <MuscleThumb primary={focus.primary} secondary={focus.secondary} size={78} label={`Targets ${focus.primary.map((m) => MUSCLES[m].name).join(', ')}`} />
      </div>

      <button type="button" className="today-split" onClick={onSplit}>
        <span className="sr-only">Your split: </span>
        <DayPills days={rotation} current={current} />
        {current !== undefined && rotation.length > 1 && <span className="sr-only">, today is day {current + 1} of {rotation.length}. </span>}
        <span className="today-split-edit">
          {profile.split ? 'Split' : 'Choose split'}
          <Icon name="chevron" size={15} />
        </span>
      </button>

      <div className="today-meta">
        <TimePill minutes={plan.estimatedMinutes} open={timeOpen} onToggle={() => setTimeOpen(!timeOpen)} />
        <span>
          <Icon name="layers" size={16} /> {plan.exercises.length} exercises
        </span>
        <span>
          <Icon name="bolt" size={16} /> {sets} sets
        </span>
      </div>
      {timeOpen && <TimeBreakdown minutes={plan.estimatedMinutes} exercises={plan.exercises} sessionMinutes={profile.sessionMinutes} />}

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
                  <span className="today-ex-name">{e?.name ?? we.exerciseId}</span>
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
        weights={weights}
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
  weights,
}: {
  we: WorkoutExercise | null;
  exercise?: Exercise;
  profile: Profile;
  canRemove: boolean;
  onClose: () => void;
  onSwap: () => void;
  onRemove: () => void;
  weights?: GymWeights;
}) {
  const working = we?.sets.filter((s) => s.kind === 'working') ?? [];
  const top = working[0];
  const kit = exercise ? kitFor(exercise, weights, profile.units) : undefined;
  return (
    <Sheet open={!!we} onClose={onClose} title={exercise?.name} subtitle={exercise?.primary.map((m) => MUSCLES[m].name).join(' · ')}>
      {we && exercise && (
        <div className="stack lg">
          <ExerciseVideo exercise={exercise} />
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
          {kit?.bar !== undefined && top && top.targetWeightKg > 0 && <PlateStack totalKg={top.targetWeightKg} kit={kit} units={profile.units} />}
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
                ? `${MUSCLES[worst].name} still recovering (${Math.round(state.recovery[worst] * 100)}%)${plan ? ' — the next session works around them.' : '.'}`
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

function LastWorkout({
  workout,
  all,
  profile,
  exercises,
  now,
  eyebrow = 'Last workout',
}: {
  workout: Workout;
  all: Workout[];
  profile: Profile;
  exercises: Record<string, Exercise>;
  now: number;
  eyebrow?: string;
}) {
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
          <div className="eyebrow">{eyebrow}</div>
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
            {eyebrow === 'Last workout' ? `${relativeDay(workout.finishedAt ?? 0, now)} · ` : ''}
            {formatDuration((workout.finishedAt ?? 0) - (workout.startedAt ?? 0))} · {sets.length} sets · {formatVolume(volume, profile.units)}
          </div>
        </div>
        <Icon name="chevron" size={18} />
      </div>
    </Link>
  );
}

// ── Session time ───────────────────────────────────────────────────────────

/** 75 s, 1½ min, 2 min. */
function restText(sec: number): string {
  if (sec < 85) return `${Math.round(sec / 5) * 5} s`;
  const half = Math.round(sec / 30) / 2;
  return `${Number.isInteger(half) ? half : `${Math.floor(half)}½`} min`;
}

function TimePill({ minutes, open, onToggle }: { minutes: number; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="today-meta-btn" aria-expanded={open} onClick={onToggle}>
      <Icon name="clock" size={16} /> {minutes} min
      <span className="sr-only">, how that adds up</span>
      <Icon name="info" size={13} />
    </button>
  );
}

/** Where the minutes go: working sets with their rests, warm-ups, setting up. */
function TimeBreakdown({ minutes, exercises, sessionMinutes }: { minutes: number; exercises: WorkoutExercise[]; sessionMinutes: number }) {
  let working = 0;
  let warm = 0;
  let rest = 0;
  for (const we of exercises) {
    for (const s of we.sets) {
      if (s.kind === 'warmup') warm++;
      else {
        working++;
        rest += we.restSec;
      }
    }
  }
  const avgRest = working ? rest / working : 0;
  const setMin = Math.round(((40 + avgRest) * working) / 60);
  return (
    <div className="today-time small" role="note">
      <dl>
        <div>
          <dt>
            {working} working sets
            <span> · ~40 s each + {restText(avgRest)} rest</span>
          </dt>
          <dd className="num">{setMin} min</dd>
        </div>
        {warm > 0 && (
          <div>
            <dt>{warm} warm-up sets</dt>
            <dd className="num">{warm} min</dd>
          </div>
        )}
        <div>
          <dt>Getting set up</dt>
          <dd className="num">5 min</dd>
        </div>
        <div className="today-time-total">
          <dt>About</dt>
          <dd className="num">{minutes} min</dd>
        </div>
      </dl>
      <p className="faint">
        Rest is most of it: longer rests between hard sets build more muscle. Built to fit your {sessionMinutes}-minute sessions; change that in Settings, or use Customize for a one-off.
      </p>
    </div>
  );
}

// ── Other days ─────────────────────────────────────────────────────────────

/** "Today", "Tomorrow", "Yesterday", else "Thursday, Jun 4". */
function dayLabel(day: number, today: number): string {
  if (day === today) return 'Today';
  if (day === addDays(today, 1)) return 'Tomorrow';
  if (day === addDays(today, -1)) return 'Yesterday';
  return new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function NextUp({ next, today, onSelect }: { next: ProjectedDay; today: number; onSelect: (day: number) => void }) {
  return (
    <button type="button" className="card interactive today-nextup" onClick={() => onSelect(next.day)}>
      <span className="grow">
        <span className="eyebrow">Up next · {dayLabel(next.day, today)}</span>
        <span className="today-nextup-title">{splitName(next.workout.name)[0]}</span>
      </span>
      <Icon name="chevron" size={18} />
    </button>
  );
}

function RestCard({
  day,
  today,
  next,
  onSelect,
  onTrainAnyway,
  title = 'Rest day',
  body,
}: {
  day: number;
  today: number;
  next?: ProjectedDay;
  onSelect?: (day: number) => void;
  onTrainAnyway?: () => void;
  title?: string;
  body?: string;
}) {
  return (
    <section className="card today-rest" aria-label={`${dayLabel(day, today)}: ${title}`}>
      <span className="today-rest-icon" aria-hidden="true">
        <Icon name="moon" size={22} />
      </span>
      <div className="eyebrow">{dayLabel(day, today)}</div>
      <h2 className="today-title">{title}</h2>
      <p className="muted">{body ?? (day === today ? 'Muscles grow between sessions. Walk, stretch, eat well, sleep well.' : 'No session planned. Recovery is part of the program.')}</p>
      {next && onSelect && (
        <button type="button" className="today-rest-next" onClick={() => onSelect(next.day)}>
          <span className="grow">
            <span className="eyebrow">Up next · {dayLabel(next.day, today)}</span>
            <span className="today-nextup-title">{splitName(next.workout.name)[0]}</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}
      {onTrainAnyway && (
        <button type="button" className="btn block" onClick={onTrainAnyway}>
          <Icon name="play" size={16} /> Train anyway
        </button>
      )}
    </section>
  );
}

/** A session further down the week: the plan that's waiting, or the engine's forecast. */
function UpcomingCard({
  entry,
  today,
  profile,
  exercises,
  onStart,
}: {
  entry: ProjectedDay;
  today: number;
  profile: Profile;
  exercises: Record<string, Exercise>;
  onStart?: () => void;
}) {
  const w = entry.workout;
  const [timeOpen, setTimeOpen] = useState(false);
  const [kind, muscles] = splitName(w.name);
  const focus = planMuscles(w, exercises);
  const sets = w.exercises.reduce((a, we) => a + we.sets.filter((s) => s.kind === 'working').length, 0);
  return (
    <section className="card hero today-plan today-upcoming" aria-label={`${dayLabel(entry.day, today)}: ${kind}`}>
      <div className="row top">
        <div className="grow">
          <div className="eyebrow">
            {dayLabel(entry.day, today)} · {entry.isPlan ? 'Up next' : 'Forecast'}
          </div>
          <h2 className="today-title">{kind}</h2>
          {muscles && <p className="muted" style={{ marginTop: 2 }}>{muscles}</p>}
        </div>
        <MuscleThumb primary={focus.primary} secondary={focus.secondary} size={78} label={`Targets ${focus.primary.map((m) => MUSCLES[m].name).join(', ')}`} />
      </div>

      <div className="today-meta">
        <TimePill minutes={w.estimatedMinutes} open={timeOpen} onToggle={() => setTimeOpen(!timeOpen)} />
        <span>
          <Icon name="layers" size={16} /> {w.exercises.length} exercises
        </span>
        <span>
          <Icon name="bolt" size={16} /> {sets} sets
        </span>
      </div>
      {timeOpen && <TimeBreakdown minutes={w.estimatedMinutes} exercises={w.exercises} sessionMinutes={profile.sessionMinutes} />}

      <ol className="today-list">
        {w.exercises.map((we, i) => {
          const e = exercises[we.exerciseId];
          const t = targetText(we, e, profile);
          return (
            <li key={`${we.exerciseId}-${i}`}>
              <Link to={`/library/${we.exerciseId}`} className="today-ex">
                <span className="today-ex-idx display">{i + 1}</span>
                {e && <MuscleThumb primary={e.primary} secondary={e.secondary} size={42} />}
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="today-ex-name">{e?.name ?? we.exerciseId}</span>
                  <span className="small faint truncate" style={{ display: 'block' }}>
                    {e?.primary.map((m) => MUSCLES[m].name).join(', ')}
                  </span>
                </span>
                <span className="today-ex-target">
                  <span className="display">{t.scheme}</span>
                  <span className="small faint">{t.load}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="today-forecast small">
        <Icon name="info" size={15} />
        <span>
          {entry.isPlan
            ? 'Your next session. Do it on the day, or start it now.'
            : 'A forecast that assumes the sessions before it go as prescribed. It updates as you train.'}
        </span>
      </p>
      {entry.isPlan && onStart && (
        <button type="button" className="btn primary lg block" onClick={onStart}>
          <Icon name="play" size={18} /> Start it now
        </button>
      )}
    </section>
  );
}

/** A day gone by: what was done, or that it was a rest day. */
function DayLog({
  day,
  today,
  workouts,
  activities,
  scheduled,
  all,
  profile,
  exercises,
  now,
}: {
  day: number;
  today: number;
  workouts: Workout[];
  activities: Activity[];
  scheduled: boolean;
  all: Workout[];
  profile: Profile;
  exercises: Record<string, Exercise>;
  now: number;
}) {
  if (!workouts.length && !activities.length) {
    return <RestCard day={day} today={today} title={scheduled ? 'Nothing logged' : 'Rest day'} body={scheduled ? 'A training day with no workout logged.' : 'No session planned.'} />;
  }
  return (
    <>
      {workouts.map((w) => (
        <LastWorkout key={w.id} eyebrow={dayLabel(day, today)} workout={w} all={all} profile={profile} exercises={exercises} now={now} />
      ))}
      {activities.map((a) => {
        const kind = ACTIVITY_KINDS.find((k) => k.id === a.kind);
        return (
          <div key={a.id} className="card today-activity">
            <span className="row-icon" aria-hidden="true">
              <Icon name={kind?.icon ?? 'heart'} size={18} />
            </span>
            <span className="grow">
              <span className="eyebrow">{dayLabel(day, today)}</span>
              <span className="today-nextup-title">
                {kind?.label ?? 'Cardio'} · {a.minutes} min
              </span>
            </span>
            <span className="small faint">{a.intensity}</span>
          </div>
        );
      })}
    </>
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
  const split = [...new Set(splitDays(profile))];
  const focuses: Focus[] = ['auto', ...split, ...DAY_TYPES.filter((d) => !split.includes(d))];

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

import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { BodyMap, MuscleThumb } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import { db } from '../db/db';
import { LEVELS, LIFT_NAMES, exerciseTrend, strengthScore, weekStreak } from '../engine/analytics';
import { estimate1RM, formatWeight, toDisplay } from '../engine/load';
import { MUSCLES, MUSCLE_IDS, PRIORITY_MUSCLES, weeklySetTarget } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import { hoursUntilRecovered } from '../engine/recovery';
import type { Activity, Exercise, Goal, MuscleId, PerformedSet, Profile, Units, Workout } from '../engine/types';
import { dayKey } from '../engine/util';
import { volumeStatus, type VolumeStatus } from '../engine/volume';
import { formatDate, relativeDay, useExercises, useNow, useProfile, useTrainingState, type TrainingState } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { EmptyState } from '../ui/EmptyState';
import { Ring } from '../ui/Ring';
import { Sparkline } from '../ui/Sparkline';
import './Progress.css';

const HEAT_WEEKS = 12;
const VOLUME_PREVIEW = 8;
const LIFTS_PREVIEW = 10;
const SPARK_SESSIONS = 12;
const MAX_SESSION_MS = 4 * 3_600_000;

const STATUS_LABEL: Record<VolumeStatus, string> = { under: 'Under', 'on-track': 'On track', high: 'High' };
const STATUS_ORDER: Record<VolumeStatus, number> = { under: 0, high: 1, 'on-track': 2 };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const workoutAt = (w: Workout) => w.finishedAt ?? w.startedAt ?? w.createdAt;

/** Set counts can be fractional (secondaries count half); show at most one decimal. */
const fmtSets = (n: number) => String(Math.round(n * 10) / 10);

function fmtDelta(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return '±0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function readyText(hours: number): string {
  if (hours <= 0) return 'Ready to train';
  if (hours >= 48) return `Ready in ~${Math.round(hours / 24)} days`;
  return `Ready in ~${Math.ceil(hours)}h`;
}

function mondayOf(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// ── Strength score ──────────────────────────────────────────────────────────

function StrengthHero({ sets, profile, byId, now }: { sets: PerformedSet[]; profile: Profile; byId: Record<string, Exercise>; now: number }) {
  const { bodyweightKg, sex, units } = profile;
  const score = useMemo(() => strengthScore(sets, bodyweightKg, sex, now), [sets, bodyweightKg, sex, now]);
  const sparks = useMemo(() => {
    const out = new Map<string, number[]>();
    for (const l of score.lifts) {
      const trend = exerciseTrend(sets.filter((s) => s.exerciseId === l.sourceId));
      out.set(l.sourceId, trend.slice(-SPARK_SESSIONS).map((p) => p.e1rmKg));
    }
    return out;
  }, [score, sets]);

  const has = score.lifts.length > 0;
  const overall = Math.floor(score.overall);
  const levelIdx = (LEVELS as readonly string[]).indexOf(score.level);
  const next = LEVELS[levelIdx + 1];
  const nextAt = (levelIdx + 2) * 20;

  return (
    <section className="card hero progress-hero" aria-labelledby="progress-strength">
      <div className="progress-hero-top">
        <Ring value={score.overall / 100} size={132} stroke={10} label={has ? `Strength score ${overall} of 100` : 'No strength score yet'}>
          <span className="display progress-ring-num">{has ? <CountUp value={score.overall} format={(n) => String(Math.floor(n))} /> : '–'}</span>
          <span className="progress-ring-of">of 100</span>
        </Ring>
        <div className="grow progress-hero-text">
          <h2 id="progress-strength" className="eyebrow">
            Strength score
          </h2>
          {has ? (
            <>
              <p className="progress-level">{score.level}</p>
              {next ? (
                <p className="progress-next">
                  Next: <strong>{next}</strong> at {nextAt}
                  <span className="progress-togo num">{plural(nextAt - overall, 'point')} to go</span>
                </p>
              ) : (
                <p className="progress-next">Top level — elite standards met.</p>
              )}
            </>
          ) : (
            <>
              <p className="progress-level">No score yet</p>
              <p className="progress-next">
                {bodyweightKg > 0 ? (
                  'Log a squat, bench, deadlift, overhead press or row to get rated against bodyweight standards.'
                ) : (
                  <>
                    Add your bodyweight in <Link to="/settings">Settings</Link> to get a score.
                  </>
                )}
              </p>
            </>
          )}
        </div>
      </div>

      {has && (
        <>
          <ul className="progress-lifts">
            {score.lifts.map((l) => {
              const source = byId[l.sourceId];
              const values = sparks.get(l.sourceId) ?? [];
              const liftScore = Math.floor(l.score);
              return (
                <li key={l.lift} className="progress-lift">
                  <div className="progress-lift-head">
                    <span className="progress-lift-name">{LIFT_NAMES[l.lift]}</span>
                    <span className="badge">{l.level}</span>
                  </div>
                  <div className="progress-lift-body">
                    <div className="progress-lift-figures">
                      <span className="display progress-lift-e1rm">{formatWeight(l.e1rmKg, units, false)}</span>
                      <span className="progress-unit">{units}</span>
                      <span className="progress-lift-ratio num">{l.ratio.toFixed(2)}× BW</span>
                    </div>
                    <span className="progress-spark">
                      <Sparkline values={values} width={72} height={26} label={`${LIFT_NAMES[l.lift]} estimated 1RM trend`} />
                    </span>
                  </div>
                  <div className="progress-lift-score">
                    <div className="bar progress-level-bar" role="img" aria-label={`Score ${liftScore} of 100`}>
                      <span className="fill" style={{ width: `${Math.min(100, Math.max(2, l.score))}%` }} />
                    </div>
                    <span className="num progress-lift-pts">{liftScore}</span>
                  </div>
                  {!l.sourceId.startsWith('barbell-') && source && <p className="progress-note">Estimated from {source.name}</p>}
                </li>
              );
            })}
          </ul>
          <p className="progress-foot">
            Best estimated 1RM in the last 6 months, rated against approximate standards for a {formatWeight(bodyweightKg, units)} lifter.
          </p>
        </>
      )}
    </section>
  );
}

// ── Consistency ─────────────────────────────────────────────────────────────

interface HeatDay {
  date: Date;
  sets: number;
  lifted: boolean;
  cardio: boolean;
  future: boolean;
  today: boolean;
}

function ConsistencyCard({ workouts, sets, activities, units, now }: { workouts: Workout[]; sets: PerformedSet[]; activities: Activity[]; units: Units; now: number }) {
  const data = useMemo(() => {
    const thisWeek = mondayOf(now);
    const start = addDays(thisWeek, -(HEAT_WEEKS - 1) * 7);
    const from = start.getTime();
    const todayKey = dayKey(now);

    const liftedDays = new Set<string>();
    let count = 0;
    let ms = 0;
    for (const w of workouts) {
      const at = workoutAt(w);
      if (at < from || at > now) continue;
      liftedDays.add(dayKey(at));
      count++;
      if (w.startedAt && w.finishedAt) ms += Math.min(MAX_SESSION_MS, Math.max(0, w.finishedAt - w.startedAt));
    }
    const setsByDay = new Map<string, number>();
    let volumeKg = 0;
    for (const s of sets) {
      if (s.kind !== 'working' || s.reps <= 0 || s.at < from || s.at > now) continue;
      const k = dayKey(s.at);
      setsByDay.set(k, (setsByDay.get(k) ?? 0) + 1);
      volumeKg += s.weightKg * s.reps;
    }
    const cardioDays = new Set(activities.filter((a) => a.at >= from).map((a) => dayKey(a.at)));

    const days: HeatDay[] = [];
    for (let i = 0; i < HEAT_WEEKS * 7; i++) {
      const date = addDays(start, i);
      const k = dayKey(date.getTime());
      days.push({
        date,
        sets: setsByDay.get(k) ?? 0,
        lifted: liftedDays.has(k),
        cardio: cardioDays.has(k),
        today: k === todayKey,
        future: date.getTime() > now,
      });
    }
    // Quartiles of this lifter's own days, so the shading shows their heavier and lighter sessions.
    const counts = days.filter((d) => d.lifted).map((d) => d.sets).sort((a, b) => a - b);
    const cuts = [0.25, 0.5, 0.75].map((p) => counts[Math.floor(p * counts.length)] ?? 0);
    const cardioOnly = days.filter((d) => d.cardio && !d.lifted).length;

    // Label a column when its Monday starts a new month; skip the first label if the next column would collide.
    const months: { col: number; label: string }[] = [];
    for (let w = 0; w < HEAT_WEEKS; w++) {
      const m = addDays(start, w * 7).getMonth();
      const prev = w > 0 ? addDays(start, (w - 1) * 7).getMonth() : -1;
      const nextDiffers = addDays(start, (w + 1) * 7).getMonth() !== m;
      if (m !== prev && !(w === 0 && nextDiffers)) {
        months.push({ col: w, label: addDays(start, w * 7).toLocaleDateString(undefined, { month: 'short' }) });
      }
    }

    return {
      days,
      cuts,
      months,
      liftDays: liftedDays.size,
      cardioOnly,
      count,
      hours: ms / 3_600_000,
      volume: toDisplay(volumeKg, units),
      streak: weekStreak(workouts.map(workoutAt), now),
      weekdays: days.slice(0, 7).map((d) => d.date.toLocaleDateString(undefined, { weekday: 'narrow' })),
    };
  }, [workouts, sets, activities, units, now]);

  const level = (d: HeatDay) => (d.lifted ? 1 + data.cuts.filter((c) => d.sets >= c).length : 0);
  const describe = (d: HeatDay) => {
    const date = formatDate(d.date.getTime());
    if (d.lifted) return `${date}: lifted, ${plural(d.sets, 'working set')}${d.cardio ? ' + cardio' : ''}`;
    if (d.cardio) return `${date}: cardio`;
    return `${date}: ${d.future ? 'upcoming' : 'rest'}`;
  };

  return (
    <section className="card progress-consistency" aria-labelledby="progress-consistency">
      <div className="card-title">
        <h2 id="progress-consistency" className="progress-card-h">
          Consistency
        </h2>
        <span className="small faint">Last {HEAT_WEEKS} weeks</span>
      </div>

      <div
        className="progress-heat"
        role="img"
        aria-label={`Training calendar, last ${HEAT_WEEKS} weeks: ${plural(data.liftDays, 'lifting day')}, ${plural(data.cardioOnly, 'cardio-only day')}.`}
      >
        {data.months.map((m) => (
          <span key={m.col} className="progress-heat-month" style={{ gridColumn: m.col + 2 }}>
            {m.label}
          </span>
        ))}
        {data.weekdays.map((w, i) => (
          <span key={i} className="progress-heat-wd" style={{ gridRow: i + 2 }}>
            {i % 2 === 0 ? w : ''}
          </span>
        ))}
        {data.days.map((d, i) => {
          const l = level(d);
          const cls = ['progress-cell', l ? `l${l}` : d.cardio ? 'cardio' : '', d.today ? 'today' : '', d.future ? 'future' : ''].filter(Boolean).join(' ');
          const col = Math.floor(i / 7);
          return (
            <span
              key={i}
              className={cls}
              title={describe(d)}
              style={{ gridColumn: col + 2, gridRow: (i % 7) + 2, '--col': col } as CSSProperties}
            />
          );
        })}
      </div>

      <div className="progress-heat-legend" aria-hidden="true">
        <span>Less</span>
        <span className="progress-cell l1" />
        <span className="progress-cell l2" />
        <span className="progress-cell l3" />
        <span className="progress-cell l4" />
        <span>More</span>
        <span className="progress-heat-legend-gap" />
        <span className="progress-cell cardio" />
        <span>Cardio</span>
      </div>

      <div className="stats four progress-stats">
        <div className="stat">
          <span className="value">
            <CountUp value={data.count} />
          </span>
          <span className="label">Workouts</span>
        </div>
        <div className="stat">
          <span className="value">
            <CountUp value={data.hours} format={(n) => (data.hours < 10 ? n.toFixed(1) : String(Math.round(n)))} />
          </span>
          <span className="label">Hours</span>
        </div>
        <div className="stat">
          <span className="value">
            <CountUp value={data.volume} format={compact} />
          </span>
          <span className="label">{units} lifted</span>
        </div>
        <div className="stat">
          <span className="value">
            <CountUp value={data.streak} />
            <small>wk</small>
          </span>
          <span className="label">Streak</span>
        </div>
      </div>
    </section>
  );
}

// ── Weekly volume ───────────────────────────────────────────────────────────

interface VolumeRow {
  m: MuscleId;
  min: number;
  max: number;
  done: number;
  status: VolumeStatus;
}

function VolumeCard({ weekly, goal }: { weekly: TrainingState['weekly']; goal: Goal }) {
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(() => {
    const rank = (m: MuscleId) => {
      const i = PRIORITY_MUSCLES.indexOf(m);
      return i < 0 ? PRIORITY_MUSCLES.length : i;
    };
    const out: VolumeRow[] = [];
    for (const m of MUSCLE_IDS) {
      const { min, max } = weeklySetTarget(m, goal);
      if (max <= 0) continue;
      out.push({ m, min, max, done: weekly[m], status: volumeStatus(m, weekly[m], goal) });
    }
    // Under target first (furthest behind first), then over, then on track; key muscles break ties.
    return out.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (a.status === 'under' ? a.done / a.min - b.done / b.min : 0) ||
        rank(a.m) - rank(b.m),
    );
  }, [weekly, goal]);

  const shown = showAll ? rows : rows.slice(0, VOLUME_PREVIEW);
  const under = rows.filter((r) => r.status === 'under').length;

  return (
    <section className="card" aria-labelledby="progress-volume">
      <div className="card-title progress-title-stack">
        <div>
          <h2 id="progress-volume" className="progress-card-h">
            Weekly volume
          </h2>
          <p className="small faint">Hard sets, last 7 days · shaded band is your {goal} target</p>
        </div>
        <span className={`badge${under ? '' : ' accent'}`}>{under ? `${under} under` : 'All on target'}</span>
      </div>
      <ul className="progress-vol">
        {shown.map((r) => {
          const scale = Math.max(r.max * 1.3, r.done * 1.08, 1);
          const pct = (v: number) => Math.min(100, (v / scale) * 100);
          return (
            <li key={r.m} className={`progress-vol-row ${r.status}`}>
              <div className="progress-vol-head">
                <span className="progress-vol-name">{MUSCLES[r.m].name}</span>
                <span className="progress-vol-nums num">
                  <strong>{fmtSets(r.done)}</strong> / {r.min === r.max ? r.max : `${r.min}–${r.max}`}
                </span>
                <span className="progress-vol-status">{STATUS_LABEL[r.status]}</span>
              </div>
              <div className="progress-vol-track" aria-hidden="true">
                <span className="progress-vol-band" style={{ left: `${pct(r.min)}%`, width: `${pct(r.max) - pct(r.min)}%` }} />
                <span className="progress-vol-fill" style={{ width: `${pct(r.done)}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > VOLUME_PREVIEW && (
        <button type="button" className="btn ghost sm block progress-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show less' : `Show all ${rows.length} muscles`}
          <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={16} />
        </button>
      )}
    </section>
  );
}

// ── Recovery ────────────────────────────────────────────────────────────────

function RecoveryCard({ recovery, fatigue }: { recovery: TrainingState['recovery']; fatigue: TrainingState['fatigue'] }) {
  const [sel, setSel] = useState<MuscleId | undefined>();
  const mostFatigued = useMemo(
    () =>
      MUSCLE_IDS.filter((m) => recovery[m] < 0.9)
        .sort((a, b) => recovery[a] - recovery[b])
        .slice(0, 6),
    [recovery],
  );
  const ready = MUSCLE_IDS.filter((m) => hoursUntilRecovered(m, fatigue[m]) === 0).length;
  const select = (m: MuscleId) => setSel((cur) => (cur === m ? undefined : m));

  return (
    <section className="card" aria-labelledby="progress-recovery">
      <div className="card-title">
        <h2 id="progress-recovery" className="progress-card-h">
          Recovery
        </h2>
        <span className="small faint num">
          {ready} of {MUSCLE_IDS.length} ready
        </span>
      </div>
      <BodyMap recovery={recovery} selected={sel} onSelect={select} />
      <div className={`progress-readout${sel ? ' on' : ''}`} aria-live="polite">
        {sel ? (
          <>
            <span className="grow">
              <strong>{MUSCLES[sel].name}</strong>
              <span className="progress-readout-sub">{readyText(hoursUntilRecovered(sel, fatigue[sel]))}</span>
            </span>
            <span className="progress-readout-pct">
              <span className="display">{Math.round(recovery[sel] * 100)}%</span>
              <span>recovered</span>
            </span>
          </>
        ) : (
          <span className="faint">Tap a muscle to see how recovered it is</span>
        )}
      </div>
      {mostFatigued.length > 0 ? (
        <div className="progress-fatigued">
          <span className="eyebrow">Most fatigued</span>
          <div className="chips wrap">
            {mostFatigued.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={sel === m} onClick={() => select(m)}>
                {MUSCLES[m].name}
                <span className="num progress-chip-pct">{Math.round(recovery[m] * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="small faint progress-fatigued">Every muscle is fresh — train whatever you like.</p>
      )}
    </section>
  );
}

// ── Lifts ───────────────────────────────────────────────────────────────────

interface LiftRow {
  id: string;
  ex: Exercise | undefined;
  lastAt: number;
  best: string;
  spark: number[];
  delta: number | null;
  deltaLabel: string;
}

function liftRows(sets: PerformedSet[], byId: Record<string, Exercise>, units: Units): LiftRow[] {
  const byExercise = new Map<string, PerformedSet[]>();
  for (const s of sets) {
    if (s.kind !== 'working' || s.reps <= 0) continue;
    const list = byExercise.get(s.exerciseId);
    if (list) list.push(s);
    else byExercise.set(s.exerciseId, [s]);
  }

  const rows: LiftRow[] = [];
  for (const [id, list] of byExercise) {
    const ex = byId[id];
    const timed = ex ? isTimed(ex) : false;
    const weighted = !timed && list.some((s) => s.weightKg > 0);
    const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
    const lastSession = list.filter((s) => s.workoutId === latest.workoutId);

    const top = lastSession.reduce((a, b) => {
      const ea = weighted ? estimate1RM(a.weightKg, a.reps) : a.reps;
      const eb = weighted ? estimate1RM(b.weightKg, b.reps) : b.reps;
      return eb > ea || (eb === ea && b.weightKg > a.weightKg) ? b : a;
    });
    const reps = timed ? `${top.reps}s` : weighted ? String(top.reps) : `${top.reps} reps`;
    const best = top.weightKg > 0 ? `${formatWeight(top.weightKg, units)} × ${reps}` : reps;

    // Loaded lifts trend by e1RM; bodyweight and timed work by best reps/seconds.
    const trend = exerciseTrend(list);
    const series = trend.map((p) => (weighted ? p.e1rmKg : p.bestReps));
    const first = series[0] ?? 0;
    const last = series[series.length - 1] ?? 0;
    const delta = series.length >= 2 && first > 0 ? (last / first - 1) * 100 : null;
    const metric = weighted ? 'estimated 1RM' : timed ? 'best time' : 'best reps';

    rows.push({
      id,
      ex,
      lastAt: latest.at,
      best,
      spark: series.slice(-SPARK_SESSIONS),
      delta,
      deltaLabel: `${metric} since your first session`,
    });
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt);
}

function LiftsSection({ rows, now }: { rows: LiftRow[]; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? rows : rows.slice(0, LIFTS_PREVIEW);
  return (
    <section className="stack progress-lifts-section" aria-labelledby="progress-lifts">
      <h2 id="progress-lifts" className="section-title">
        Lifts
      </h2>
      <div className="card progress-list-card">
        <div className="list">
          {shown.map((l) => {
            const name = l.ex?.name ?? 'Deleted exercise';
            return (
              <Link key={l.id} to={`/library/${encodeURIComponent(l.id)}`} className="list-item progress-liftrow">
                <MuscleThumb primary={l.ex?.primary ?? []} secondary={l.ex?.secondary ?? []} size={44} />
                <div className="grow">
                  <div className="progress-liftrow-name">{name}</div>
                  <div className="progress-liftrow-meta num">
                    {l.best} · {relativeDay(l.lastAt, now)}
                  </div>
                </div>
                <div className="progress-liftrow-trend">
                  <Sparkline values={l.spark} width={56} height={20} label={`${name} trend`} />
                  {l.delta !== null && (
                    <span
                      className={`badge num${Math.round(l.delta) > 0 ? ' accent' : ''}`}
                      title={`Change in ${l.deltaLabel}`}
                      aria-label={`${fmtDelta(l.delta)} ${l.deltaLabel}`}
                    >
                      {fmtDelta(l.delta)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
        {rows.length > LIFTS_PREVIEW && (
          <button type="button" className="btn ghost sm block progress-more" aria-expanded={showAll} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show less' : `Show all ${rows.length} lifts`}
            <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function Progress() {
  const profile = useProfile();
  const state = useTrainingState();
  const exercises = useExercises();
  const activities = useLiveQuery(() => db.activities.toArray());
  const now = useNow();

  const units = profile?.units ?? 'kg';
  const lifts = useMemo(() => (state && exercises ? liftRows(state.sets, exercises.byId, units) : []), [state, exercises, units]);

  if (!profile || !state || !exercises || !activities) return null;

  const total = state.workouts.length;
  const firstAt = total ? Math.min(...state.workouts.map(workoutAt)) : now;
  const sameYear = new Date(firstAt).getFullYear() === new Date(now).getFullYear();
  const since = formatDate(firstAt, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });

  return (
    <div className="page progress-page">
      <header className="page-header">
        <div>
          <h1>Progress</h1>
          <div className="sub num">{total ? `${plural(total, 'workout')} · since ${since}` : 'Your training, measured'}</div>
        </div>
      </header>

      {total === 0 ? (
        <div className="card">
          <EmptyState
            icon="progress"
            title="Your progress starts here"
            action={
              <Link to="/" className="btn primary progress-empty-cta">
                Start a workout
              </Link>
            }
          >
            Finish a workout to unlock your strength score, consistency, weekly volume and recovery.
          </EmptyState>
        </div>
      ) : (
        <>
          <StrengthHero sets={state.sets} profile={profile} byId={exercises.byId} now={now} />
          <ConsistencyCard workouts={state.workouts} sets={state.sets} activities={activities} units={units} now={now} />
          <VolumeCard weekly={state.weekly} goal={profile.goal} />
          <RecoveryCard recovery={state.recovery} fatigue={state.fatigue} />
          {lifts.length > 0 && <LiftsSection rows={lifts} now={now} />}
        </>
      )}
    </div>
  );
}

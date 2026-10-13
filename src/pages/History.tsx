import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MuscleThumb } from '../components/BodyMap';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import { flattenSets } from '../db/repo';
import { detectPRs } from '../engine/analytics';
import { toDisplay } from '../engine/load';
import { MUSCLES } from '../engine/muscles';
import type { Activity, ActivityKind, Exercise, MuscleId, PerformedSet, Units, Workout } from '../engine/types';
import { dayKey } from '../engine/util';
import { formatDate, formatDuration, useDoneWorkouts, useExercises, useNow, useProfile } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { EmptyState } from '../ui/EmptyState';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import './History.css';

// ── Shared workout helpers (also used by WorkoutDetail) ─────────────────────

export type SessionTag = 'push' | 'pull' | 'legs' | 'full';

export interface Session {
  /** "Upper body" */
  type: string;
  /** "Chest, Lats & Upper back" */
  title: string;
  tag: SessionTag;
  primary: MuscleId[];
  secondary: MuscleId[];
}

const TAG_BY_TYPE: Record<string, SessionTag> = { push: 'push', pull: 'pull', legs: 'legs', 'lower body': 'legs' };
const REGION_TYPE = { push: 'Push', pull: 'Pull', legs: 'Legs' } as const;

/** Names without a "Type · Muscles" split (imports, freestyle) get a type from the muscles worked. */
function inferType(primary: MuscleId[]): string {
  if (!primary.length) return 'Workout';
  const regions = new Set(primary.map((m) => MUSCLES[m].region));
  regions.delete('core');
  const [only] = regions;
  if (!only) return 'Core';
  if (regions.size === 1 && only !== 'core') return REGION_TYPE[only];
  return regions.has('legs') ? 'Full body' : 'Upper body';
}

export function sessionOf(w: Workout, byId: Record<string, Exercise>): Session {
  const primary = new Set<MuscleId>();
  const secondary = new Set<MuscleId>();
  for (const we of w.exercises) {
    const ex = byId[we.exerciseId];
    if (!ex || !we.sets.some((s) => s.done)) continue;
    ex.primary.forEach((m) => primary.add(m));
    ex.secondary.forEach((m) => secondary.add(m));
  }
  const p = [...primary];
  const split = w.name.indexOf(' · ');
  const type = split > 0 ? w.name.slice(0, split) : inferType(p);
  return {
    type,
    title: split > 0 ? w.name.slice(split + 3) : w.name,
    tag: TAG_BY_TYPE[type.toLowerCase()] ?? 'full',
    primary: p,
    secondary: [...secondary].filter((m) => !primary.has(m)),
  };
}

export const tagStyle = (tag: SessionTag) => ({ '--tag-color': `var(--tag-${tag})` }) as CSSProperties;

export const workoutAt = (w: Workout) => w.startedAt ?? w.finishedAt ?? w.createdAt;

export const workoutDuration = (w: Workout) =>
  w.startedAt !== undefined && w.finishedAt !== undefined ? Math.max(0, w.finishedAt - w.startedAt) : 0;

/** Done working sets and their tonnage (kg). */
export function workoutTotals(w: Workout): { sets: number; volumeKg: number } {
  let sets = 0;
  let volumeKg = 0;
  for (const we of w.exercises) {
    for (const s of we.sets) {
      if (!s.done || s.kind !== 'working') continue;
      sets++;
      volumeKg += (s.weightKg ?? 0) * (s.reps ?? 0);
    }
  }
  return { sets, volumeKg };
}

/** 9,450 · 18.4k · 183k */
export function compactNumber(v: number): string {
  if (v < 10_000) return Math.round(v).toLocaleString();
  return `${v < 100_000 ? Math.round(v / 100) / 10 : Math.round(v / 1000)}k`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/** Bottom-sheet confirmation for destructive actions. */
export function ConfirmSheet({
  open,
  title,
  subtitle,
  confirmLabel,
  children,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  confirmLabel: string;
  children: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} subtitle={subtitle}>
      <div className="stack lg">
        <p className="muted">{children}</p>
        <button type="button" className="btn block danger" onClick={onConfirm}>
          <Icon name="trash" size={18} />
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}

// ── History ────────────────────────────────────────────────────────────────

const ACTIVITY: Record<ActivityKind, { label: string; icon: IconName }> = {
  run: { label: 'Run', icon: 'run' },
  ride: { label: 'Ride', icon: 'bike' },
  hike: { label: 'Hike', icon: 'mountain' },
  swim: { label: 'Swim', icon: 'waves' },
  sport: { label: 'Sport', icon: 'ball' },
  other: { label: 'Cardio', icon: 'heart' },
};

type Entry = { kind: 'workout'; id: string; at: number; workout: Workout } | { kind: 'activity'; id: string; at: number; activity: Activity };

interface Week {
  start: number;
  entries: Entry[];
  workouts: number;
  sets: number;
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

const monthIndex = (t: number) => {
  const d = new Date(t);
  return d.getFullYear() * 12 + d.getMonth();
};
const monthDate = (mi: number, day = 1) => new Date(Math.floor(mi / 12), mi % 12, day);
const daysIn = (mi: number) => monthDate(mi + 1, 0).getDate();
const shortMonth = (mi: number) => monthDate(mi).toLocaleDateString(undefined, { month: 'short' });

function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function weekLabel(start: number, now: number): string {
  const current = weekStart(now);
  if (start === current) return 'This week';
  if (start === weekStart(current - 1)) return 'Last week';
  const s = new Date(start);
  const e = new Date(start);
  e.setDate(e.getDate() + 6);
  const md = { month: 'short', day: 'numeric' } as const;
  const end = e.getMonth() === s.getMonth() ? String(e.getDate()) : e.toLocaleDateString(undefined, md);
  const year = e.getFullYear() !== new Date(now).getFullYear() ? `, ${e.getFullYear()}` : '';
  return `${s.toLocaleDateString(undefined, md)} – ${end}${year}`;
}

/** Number of exercises with a PR, per workout, each judged against everything before it. */
function prCounts(workouts: Workout[]): Map<string, number> {
  const prior = new Map<string, PerformedSet[]>();
  const out = new Map<string, number>();
  for (const w of [...workouts].sort((a, b) => workoutAt(a) - workoutAt(b))) {
    const sets = flattenSets([w]);
    const ids = new Set(sets.map((s) => s.exerciseId));
    const prs = detectPRs(sets, [...ids].flatMap((id) => prior.get(id) ?? []));
    const n = new Set(prs.map((p) => p.exerciseId)).size;
    if (n) out.set(w.id, n);
    for (const s of sets) {
      const list = prior.get(s.exerciseId);
      if (list) list.push(s);
      else prior.set(s.exerciseId, [s]);
    }
  }
  return out;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function History() {
  const profile = useProfile();
  const workouts = useDoneWorkouts();
  const activities = useLiveQuery(() => db.activities.toArray());
  const ex = useExercises();
  const now = useNow();
  const navigate = useNavigate();
  const [month, setMonth] = useState(() => monthIndex(Date.now()));
  const [flash, setFlash] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Activity | null>(null);

  const prs = useMemo(() => (workouts ? prCounts(workouts) : undefined), [workouts]);

  const entries = useMemo((): Entry[] | undefined => {
    if (!workouts || !activities) return undefined;
    return [
      ...workouts.map((w): Entry => ({ kind: 'workout', id: w.id, at: workoutAt(w), workout: w })),
      ...activities.map((a): Entry => ({ kind: 'activity', id: a.id, at: a.at, activity: a })),
    ].sort((a, b) => b.at - a.at);
  }, [workouts, activities]);

  const weeks = useMemo(() => {
    const out: Week[] = [];
    for (const e of entries ?? []) {
      const start = weekStart(e.at);
      let week = out[out.length - 1];
      if (!week || week.start !== start) {
        week = { start, entries: [], workouts: 0, sets: 0 };
        out.push(week);
      }
      week.entries.push(e);
      if (e.kind === 'workout') {
        week.workouts++;
        week.sets += workoutTotals(e.workout).sets;
      }
    }
    return out;
  }, [entries]);

  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries ?? []) {
      const k = dayKey(e.at);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return map;
  }, [entries]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  if (!profile || !workouts || !entries || !ex || !prs) return null;
  const units = profile.units;

  const header = (
    <header className="page-header">
      <div className="grow">
        <h1>History</h1>
        <div className="sub">
          {workouts.length
            ? `${plural(workouts.length, 'workout')} since ${formatDate(workoutAt(workouts[workouts.length - 1]!), { month: 'short', day: 'numeric', year: 'numeric' })}`
            : entries.length
              ? `${plural(entries.length, 'cardio session')} logged`
              : 'Every session you finish lands here'}
        </div>
      </div>
    </header>
  );

  if (!entries.length) {
    return (
      <div className="page">
        {header}
        <div className="card">
          <EmptyState
            icon="history"
            title="No workouts yet"
            action={
              <Link to="/" className="btn primary" style={{ marginTop: 6 }}>
                <Icon name="play" size={16} />
                Start your first workout
              </Link>
            }
          >
            Finished sessions and logged cardio show up here, with your records and monthly totals.
          </EmptyState>
        </div>
      </div>
    );
  }

  const openDay = (list: Entry[]) => {
    haptics.tap();
    const lifts = list.filter((e) => e.kind === 'workout');
    if (lifts.length === 1) return navigate(`/history/${lifts[0]!.id}`);
    const target = lifts[0] ?? list[0];
    if (!target) return;
    document.getElementById(`entry-${target.id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    setFlash(target.id);
  };

  const removeActivity = async (a: Activity) => {
    setToDelete(null);
    await db.activities.delete(a.id);
    haptics.tap();
    toast(`${ACTIVITY[a.kind].label} deleted`, { icon: 'trash' });
  };

  let card = 0;
  return (
    <div className="page">
      {header}

      <MonthCard
        month={month}
        onMonth={setMonth}
        minMonth={monthIndex(entries[entries.length - 1]!.at)}
        workouts={workouts}
        byDay={byDay}
        units={units}
        now={now}
        onDay={openDay}
      />

      {weeks.map((w) => (
        <section key={w.start} className="hist-week" aria-label={weekLabel(w.start, now)}>
          <h2 className="section-title">
            <span>{weekLabel(w.start, now)}</span>
            {w.workouts > 0 && (
              <span className="hist-week-total num">
                {plural(w.workouts, 'workout')} · {plural(w.sets, 'set')}
              </span>
            )}
          </h2>
          <div className="hist-entries">
            {w.entries.map((e) => {
              const style = { '--i': Math.min(card++, 8) } as CSSProperties;
              const lit = flash === e.id ? ' flash' : '';
              return e.kind === 'workout' ? (
                <WorkoutCard key={e.id} workout={e.workout} byId={ex.byId} prs={prs.get(e.id) ?? 0} units={units} className={lit} style={style} />
              ) : (
                <CardioRow key={e.id} activity={e.activity} className={lit} style={style} onDelete={() => setToDelete(e.activity)} />
              );
            })}
          </div>
        </section>
      ))}

      <ConfirmSheet
        open={!!toDelete}
        title={`Delete this ${toDelete ? ACTIVITY[toDelete.kind].label.toLowerCase() : 'session'}?`}
        subtitle={toDelete ? `${formatDate(toDelete.at, { weekday: 'long', month: 'short', day: 'numeric' })} · ${toDelete.minutes} min` : undefined}
        confirmLabel={`Delete ${toDelete ? ACTIVITY[toDelete.kind].label.toLowerCase() : ''}`}
        onConfirm={() => toDelete && void removeActivity(toDelete)}
        onClose={() => setToDelete(null)}
      >
        It will stop counting toward your muscle recovery. This can't be undone.
      </ConfirmSheet>
    </div>
  );
}

// ── Month card: summary + calendar ─────────────────────────────────────────

interface MonthTotals {
  count: number;
  minutes: number;
  volume: number;
}

function totalsBetween(workouts: Workout[], from: number, to: number, units: Units): MonthTotals {
  const t: MonthTotals = { count: 0, minutes: 0, volume: 0 };
  for (const w of workouts) {
    const at = workoutAt(w);
    if (at < from || at >= to) continue;
    t.count++;
    t.minutes += workoutDuration(w) / 60_000;
    t.volume += toDisplay(workoutTotals(w).volumeKg, units);
  }
  return t;
}

function deltaText(cur: number, prev: number, vs: string, percent: boolean): string {
  if (prev <= 0) return cur > 0 ? `None in ${vs}` : '';
  if (percent) {
    const p = Math.round(((cur - prev) / prev) * 100);
    return p === 0 ? `Level with ${vs}` : `${p > 0 ? '+' : '−'}${Math.abs(p)}% vs ${vs}`;
  }
  const d = Math.round(cur - prev);
  return d === 0 ? `Same as ${vs}` : `${d > 0 ? '+' : '−'}${Math.abs(d)} vs ${vs}`;
}

function MonthCard({
  month,
  onMonth,
  minMonth,
  workouts,
  byDay,
  units,
  now,
  onDay,
}: {
  month: number;
  onMonth: (m: number) => void;
  minMonth: number;
  workouts: Workout[];
  byDay: Map<string, Entry[]>;
  units: Units;
  now: number;
  onDay: (list: Entry[]) => void;
}) {
  const [dir, setDir] = useState<'next' | 'prev'>('prev');
  const maxMonth = monthIndex(now);
  const current = month === maxMonth;
  const prev = month - 1;
  // Mid-month, compare against the same stretch of last month so the numbers are fair.
  const span = current ? Math.min(new Date(now).getDate(), daysIn(prev)) : daysIn(prev);
  const cur = totalsBetween(workouts, monthDate(month).getTime(), monthDate(month + 1).getTime(), units);
  const before = totalsBetween(workouts, monthDate(prev).getTime(), monthDate(prev, span + 1).getTime(), units);
  const vs = shortMonth(prev);
  const go = (step: number) => {
    setDir(step > 0 ? 'next' : 'prev');
    onMonth(month + step);
  };
  const date = monthDate(month);

  return (
    <section className="card hist-month" aria-label="Monthly summary">
      <div className="hist-month-head">
        <div>
          <div className="eyebrow">{current ? 'This month' : date.getFullYear()}</div>
          <h2 className="hist-month-name">{date.toLocaleDateString(undefined, { month: 'long' })}</h2>
        </div>
        <div className="hist-month-nav">
          <button type="button" className="icon-btn sm" aria-label="Previous month" disabled={month <= minMonth} onClick={() => go(-1)}>
            <Icon name="back" size={18} />
          </button>
          <button type="button" className="icon-btn sm" aria-label="Next month" disabled={current} onClick={() => go(1)}>
            <Icon name="chevron" size={18} />
          </button>
        </div>
      </div>

      <div className="hist-month-stats">
        <MonthStat label={cur.count === 1 ? 'Workout' : 'Workouts'} delta={deltaText(cur.count, before.count, vs, false)}>
          <CountUp value={cur.count} />
        </MonthStat>
        <MonthStat label="Time" delta={deltaText(cur.minutes, before.minutes, vs, true)}>
          {cur.minutes < 60 ? (
            <>
              <CountUp value={cur.minutes} />
              <small>m</small>
            </>
          ) : (
            <>
              <CountUp value={cur.minutes / 60} format={(n) => n.toFixed(1)} />
              <small>h</small>
            </>
          )}
        </MonthStat>
        <MonthStat label="Volume" delta={deltaText(cur.volume, before.volume, vs, true)}>
          <CountUp value={cur.volume} format={compactNumber} />
          <small>{units}</small>
        </MonthStat>
      </div>

      <MonthGrid key={month} month={month} byDay={byDay} now={now} onDay={onDay} dir={dir} />

      <div className="hist-legend" aria-hidden="true">
        <span className="hist-key lifted">Lifted</span>
        <span className="hist-key cardio">Cardio</span>
        {before.count + cur.count > 0 && (
          <span className="hist-legend-vs num">
            vs {vs} {current ? `1–${span}` : ''}
          </span>
        )}
      </div>
    </section>
  );
}

function MonthStat({ label, delta, children }: { label: string; delta: string; children: ReactNode }) {
  return (
    <div className="stat">
      <span className="value">{children}</span>
      <span className="label">{label}</span>
      <span className="hist-delta num">{delta || ' '}</span>
    </div>
  );
}

function describeDay(list: Entry[]): string {
  return list
    .map((e) => (e.kind === 'workout' ? `${e.workout.name.split(' · ')[0]} workout` : `${e.activity.minutes} minute ${ACTIVITY[e.activity.kind].label.toLowerCase()}`))
    .join(', ');
}

function MonthGrid({ month, byDay, now, onDay, dir }: { month: number; byDay: Map<string, Entry[]>; now: number; onDay: (list: Entry[]) => void; dir: 'next' | 'prev' }) {
  const offset = (monthDate(month).getDay() + 6) % 7;
  const today = dayKey(now);
  const endOfToday = new Date(now).setHours(23, 59, 59, 999);
  return (
    <div className="hist-cal">
      <div className="hist-cal-head" aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className={`hist-cal-grid ${dir}`}>
        {Array.from({ length: offset }, (_, i) => (
          <span key={`pad${i}`} />
        ))}
        {Array.from({ length: daysIn(month) }, (_, i) => {
          const date = monthDate(month, i + 1);
          const key = dayKey(date.getTime());
          const list = byDay.get(key) ?? [];
          const lifted = list.some((e) => e.kind === 'workout');
          const cardio = list.some((e) => e.kind === 'activity');
          const isToday = key === today;
          const future = date.getTime() > endOfToday;
          const cls = `hist-day${lifted ? ' lifted' : ''}${cardio ? ' cardio' : ''}${isToday ? ' today' : ''}${future ? ' future' : ''}`;
          const name = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
          const inner = (
            <>
              <span className="hist-day-num num">{i + 1}</span>
              <span className="hist-day-dot" />
            </>
          );
          return list.length ? (
            <button key={key} type="button" className={cls} aria-label={`${isToday ? 'Today, ' : ''}${name}: ${describeDay(list)}`} onClick={() => onDay(list)}>
              {inner}
            </button>
          ) : (
            <span key={key} className={cls} role="img" aria-label={`${isToday ? 'Today, ' : ''}${name}: ${future ? 'upcoming' : 'rest'}`}>
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── Timeline rows ──────────────────────────────────────────────────────────

const weekday = (t: number) => formatDate(t, { weekday: 'short' });

function WorkoutCard({
  workout,
  byId,
  prs,
  units,
  className,
  style,
}: {
  workout: Workout;
  byId: Record<string, Exercise>;
  prs: number;
  units: Units;
  className: string;
  style: CSSProperties;
}) {
  const s = sessionOf(workout, byId);
  const { sets, volumeKg } = workoutTotals(workout);
  const duration = workoutDuration(workout);
  return (
    <Link to={`/history/${workout.id}`} id={`entry-${workout.id}`} className={`card interactive hist-workout${className}`} style={style}>
      <MuscleThumb primary={s.primary} secondary={s.secondary} size={54} label={`Worked ${s.primary.map((m) => MUSCLES[m].name).join(', ')}`} />
      <span className="hist-workout-body">
        <span className="hist-workout-top">
          <span className="tag" style={tagStyle(s.tag)}>
            {s.type}
          </span>
          {prs > 0 && (
            <span className="badge pr">
              <Icon name="trophy" size={12} />
              {prs === 1 ? 'PR' : `${prs} PRs`}
            </span>
          )}
        </span>
        <span className="hist-workout-title">{s.title}</span>
        <span className="hist-meta num">
          <span>{weekday(workoutAt(workout))}</span>
          {duration > 0 && <span>{formatDuration(duration)}</span>}
          <span>{plural(sets, 'set')}</span>
          {volumeKg > 0 && (
            <span>
              {compactNumber(toDisplay(volumeKg, units))} {units}
            </span>
          )}
        </span>
      </span>
      <span className="hist-chevron">
        <Icon name="chevron" size={18} />
      </span>
    </Link>
  );
}

function CardioRow({ activity, className, style, onDelete }: { activity: Activity; className: string; style: CSSProperties; onDelete: () => void }) {
  const meta = ACTIVITY[activity.kind];
  const intensity = activity.intensity.charAt(0).toUpperCase() + activity.intensity.slice(1);
  return (
    <div id={`entry-${activity.id}`} className={`hist-cardio${className}`} style={style}>
      <span className="hist-cardio-icon">
        <Icon name={meta.icon} size={18} />
      </span>
      <span className="grow">
        <span className="hist-cardio-title">
          {meta.label}
          {activity.note && <span className="hist-cardio-note"> · {activity.note}</span>}
        </span>
        <span className="hist-meta num">
          <span>{weekday(activity.at)}</span>
          <span>{activity.minutes} min</span>
          <span>{intensity}</span>
        </span>
      </span>
      <button
        type="button"
        className="icon-btn plain hist-cardio-del"
        aria-label={`Delete ${meta.label.toLowerCase()} from ${formatDate(activity.at)}`}
        onClick={onDelete}
      >
        <Icon name="trash" size={17} />
      </button>
    </div>
  );
}

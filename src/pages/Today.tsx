import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BodyMap } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { db } from '../db/db';
import { generateAndSave, startEmptyWorkout, startWorkout } from '../db/repo';
import { weekStreak } from '../engine/analytics';
import { FOCUS_LABEL, splitFor, type Focus } from '../engine/generator';
import { formatWeight } from '../engine/load';
import { MUSCLES, MUSCLE_IDS } from '../engine/muscles';
import { hoursUntilRecovered } from '../engine/recovery';
import type { ActivityKind, Intensity, MuscleId, Profile, Workout } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { formatDuration, useExercises, useNow, useProfile, useTrainingState } from '../hooks';

function greeting(now: number) {
  const h = new Date(now).getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
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
  const [selected, setSelected] = useState<MuscleId | undefined>();
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
    const thisWeek = state.workouts.filter((w) => (w.finishedAt ?? 0) >= start.getTime());
    return {
      count: thisWeek.length,
      sets: state.sets.filter((s) => s.kind === 'working' && s.at >= start.getTime()).length,
      streak: weekStreak(
        state.workouts.map((w) => w.finishedAt ?? w.createdAt),
        now,
      ),
    };
  }, [state, now]);

  if (!profile || !state || !ex) return null;

  const tired = MUSCLE_IDS.filter((m) => state.recovery[m] < 0.85).sort((a, b) => state.recovery[a] - state.recovery[b]);
  const sel = selected ?? tired[0];

  async function regenerate(opts: Parameters<typeof generateAndSave>[0] = {}) {
    setBusy(true);
    try {
      await generateAndSave({ ...opts, seed: Math.floor(Math.random() * 1e9) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>
            {greeting(now)}
            {profile.name ? `, ${profile.name}` : ''}
          </h1>
          <div className="sub">
            {new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
        </div>
        <Link to="/settings" className="icon-btn" aria-label="Settings">
          <Icon name="settings" />
        </Link>
      </header>

      {active && (
        <Link to={`/workout/${active.id}`} className="card accent row" style={{ textDecoration: 'none', color: 'inherit' }}>
          <Icon name="play" />
          <div className="grow">
            <strong>Workout in progress</strong>
            <div className="small muted">
              {active.name} · {formatDuration(now - (active.startedAt ?? now))}
            </div>
          </div>
          <Icon name="chevron" />
        </Link>
      )}

      {week && (
        <div className="card stats">
          <div className="stat">
            <span className="value">
              {week.count}
              <span className="faint small">/{profile.daysPerWeek}</span>
            </span>
            <span className="label">Workouts this week</span>
          </div>
          <div className="stat">
            <span className="value">{week.sets}</span>
            <span className="label">Hard sets</span>
          </div>
          <div className="stat">
            <span className="value">{week.streak}</span>
            <span className="label">Week streak</span>
          </div>
        </div>
      )}

      {!active && (
        <PlanCard
          plan={planned ?? undefined}
          trainedToday={state.workouts.some((w) => dayKey(w.finishedAt ?? 0) === dayKey(now))}
          profile={profile}
          names={ex.byId}
          busy={busy}
          onStart={async () => {
            if (!planned) return;
            await startWorkout(planned.id);
            navigate(`/workout/${planned.id}`);
          }}
          onRegenerate={() => regenerate()}
          onCustomize={() => setCustomize(true)}
        />
      )}

      <section className="card">
        <div className="card-title">
          <h3>Recovery</h3>
          <button type="button" className="btn sm" onClick={() => setLogActivity(true)}>
            <Icon name="run" size={18} /> Log cardio
          </button>
        </div>
        <BodyMap recovery={state.recovery} selected={sel} onSelect={setSelected} />
        {sel ? (
          <p className="small muted" style={{ marginTop: 8 }}>
            <strong style={{ color: 'var(--text-1)' }}>{MUSCLES[sel].name}</strong> {Math.round(state.recovery[sel] * 100)}%
            recovered
            {state.recovery[sel] < 0.9 &&
              ` · ready in ~${Math.max(1, Math.round(hoursUntilRecovered(sel, state.fatigue[sel])))}h`}
          </p>
        ) : (
          <p className="small muted" style={{ marginTop: 8 }}>
            Everything's fresh. Tap a muscle to see its recovery.
          </p>
        )}
      </section>

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
        }}
      />
      <ActivitySheet open={logActivity} onClose={() => setLogActivity(false)} />
    </div>
  );
}

function PlanCard({
  plan,
  trainedToday,
  profile,
  names,
  busy,
  onStart,
  onRegenerate,
  onCustomize,
}: {
  plan?: Workout;
  trainedToday: boolean;
  profile: Profile;
  names: Record<string, { name: string }>;
  busy: boolean;
  onStart: () => void;
  onRegenerate: () => void;
  onCustomize: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (!plan) {
    return (
      <section className="card accent">
        <p className="muted">Building today's workout…</p>
      </section>
    );
  }
  return (
    <section className="card accent stack">
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <div className="tiny faint">
            {trainedToday ? 'Next workout' : "Today's workout"} · ~{plan.estimatedMinutes} min
          </div>
          <h2 style={{ marginTop: 4 }}>{plan.name}</h2>
        </div>
        <button type="button" className="icon-btn" onClick={onRegenerate} disabled={busy} aria-label="Generate a different workout">
          <Icon name="refresh" />
        </button>
      </div>
      <p className="small muted">{plan.summary}</p>
      <div className="list">
        {plan.exercises.map((we) => {
          const working = we.sets.filter((s) => s.kind === 'working');
          const first = working[0];
          const warmups = we.sets.length - working.length;
          return (
            <div key={we.id}>
              <button
                type="button"
                className="list-item"
                aria-expanded={open === we.id}
                onClick={() => setOpen(open === we.id ? null : we.id)}
              >
                <div className="grow">
                  <div style={{ fontWeight: 600 }}>{names[we.exerciseId]?.name ?? we.exerciseId}</div>
                  <div className="small muted num">
                    {working.length} × {first?.targetReps}
                    {first && first.targetWeightKg > 0 ? ` @ ${formatWeight(first.targetWeightKg, profile.units)}` : ''}
                    {warmups ? ` · ${warmups} warm-up` : ''}
                  </div>
                </div>
                <Icon name="info" size={18} />
              </button>
              {open === we.id && <p className="rationale" style={{ marginBottom: 8 }}>{we.rationale}</p>}
            </div>
          );
        })}
        {plan.exercises.length === 0 && (
          <p className="small faint">No exercises fit these settings — try a different focus or gym.</p>
        )}
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={onCustomize}>
          Customize
        </button>
        <button type="button" className="btn primary lg grow" onClick={onStart} disabled={busy || plan.exercises.length === 0}>
          <Icon name="play" size={18} /> Start workout
        </button>
      </div>
    </section>
  );
}

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
    <Sheet open={open} onClose={onClose} title="Customize today">
      <div className="stack lg">
        <div className="field">
          <span>Focus</span>
          <div className="chips wrap">
            {focuses.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={focus === f} onClick={() => setFocus(f)}>
                {FOCUS_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>
            Time available: <strong className="num">{minutes} min</strong>
          </span>
          <input type="range" min={15} max={120} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
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
          <span>Anything sore or injured? We'll work around it.</span>
          <div className="chips wrap">
            {MUSCLE_IDS.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={avoid.includes(m)}
                onClick={() => setAvoid((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]))}
              >
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

const ACTIVITY_KINDS: { id: ActivityKind; label: string }[] = [
  { id: 'run', label: 'Run' },
  { id: 'ride', label: 'Ride' },
  { id: 'hike', label: 'Hike' },
  { id: 'swim', label: 'Swim' },
  { id: 'sport', label: 'Sport' },
  { id: 'other', label: 'Other' },
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
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Log other training">
      <div className="stack lg">
        <p className="small muted">
          Runs, rides and sport tire your legs too. Logging them keeps your recovery map honest so leg day doesn't land on a
          wrecked set of quads.
        </p>
        <div className="chips wrap">
          {ACTIVITY_KINDS.map((k) => (
            <button key={k.id} type="button" className="chip" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>
            Duration: <strong className="num">{formatDuration(minutes * 60_000)}</strong>
          </span>
          <input type="range" min={10} max={300} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </label>
        <div className="segmented" role="group" aria-label="Intensity">
          {(['easy', 'moderate', 'hard'] as Intensity[]).map((i) => (
            <button key={i} type="button" aria-pressed={intensity === i} onClick={() => setIntensity(i)}>
              {i[0]!.toUpperCase() + i.slice(1)}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="When">
          {['Today', 'Yesterday', '2 days ago'].map((label, i) => (
            <button key={label} type="button" aria-pressed={daysAgo === i} onClick={() => setDaysAgo(i)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary lg block" onClick={save}>
          Save
        </button>
      </div>
    </Sheet>
  );
}

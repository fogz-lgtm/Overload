import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BodyMap } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import { LEVELS, LIFT_NAMES, exerciseTrend, strengthScore } from '../engine/analytics';
import { estimate1RM, formatWeight } from '../engine/load';
import { MUSCLES, MUSCLE_IDS, weeklySetTarget } from '../engine/muscles';
import { isTimed } from '../engine/progression';
import { hoursUntilRecovered } from '../engine/recovery';
import type { Exercise, Goal, MuscleId, PerformedSet, Sex, Units } from '../engine/types';
import { volumeStatus, type VolumeStatus } from '../engine/volume';
import { relativeDay, useExercises, useNow, useProfile, useTrainingState, type TrainingState } from '../hooks';

const CARD_TITLE = { fontSize: 17 } as const;
const VOLUME_PREVIEW = 8;

const STATUS_LABEL: Record<VolumeStatus, string> = { under: 'Under', 'on-track': 'On track', high: 'High' };
const STATUS_FILL: Record<VolumeStatus, string> = {
  under: 'var(--text-3)',
  'on-track': 'var(--accent)',
  high: 'var(--warning)',
};

/** Set counts can be fractional (secondaries count half); show at most one decimal. */
function fmtSets(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function readyText(hours: number): string {
  if (hours <= 0) return 'ready now';
  if (hours >= 48) return `ready in ~${Math.round(hours / 24)} days`;
  return `ready in ~${Math.ceil(hours)}h`;
}

function fmtDelta(pct: number): string {
  const r = Math.round(pct);
  if (r === 0) return '±0%';
  return `${r > 0 ? '+' : '−'}${Math.abs(r)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── Strength score ──────────────────────────────────────────────────────────

function StrengthCard({
  sets,
  bodyweightKg,
  sex,
  units,
  byId,
  now,
}: {
  sets: PerformedSet[];
  bodyweightKg: number;
  sex: Sex;
  units: Units;
  byId: Record<string, Exercise>;
  now: number;
}) {
  const score = useMemo(() => strengthScore(sets, bodyweightKg, sex, now), [sets, bodyweightKg, sex, now]);
  const levelIdx = (LEVELS as readonly string[]).indexOf(score.level);
  const next = levelIdx >= 0 && levelIdx < LEVELS.length - 1 ? LEVELS[levelIdx + 1] : undefined;

  return (
    <section className="card accent" aria-labelledby="strength-title">
      <div className="card-title">
        <h2 id="strength-title" style={CARD_TITLE}>
          Strength score
        </h2>
        <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>
          <Icon name="trophy" size={20} />
        </span>
      </div>
      {score.lifts.length === 0 ? (
        <p className="small muted">
          Log a squat, bench press, deadlift, overhead press or row to get a score from 0 to 100. Barbell lifts count,
          as do front squats, trap-bar deadlifts and dumbbell bench presses, shoulder presses and rows. Your estimated
          1RM is compared with approximate bodyweight-based standards.
          {bodyweightKg <= 0 && ' Add your bodyweight in Settings first.'}
        </p>
      ) : (
        <>
          <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
            <span className="num" style={{ fontSize: 52, fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
              {Math.round(score.overall)}
            </span>
            <div className="stack" style={{ gap: 0, paddingBottom: 4 }}>
              <strong>{score.level}</strong>
              <span className="small faint">{next ? `Next: ${next} at ${(levelIdx + 2) * 20}` : 'Top level'}</span>
            </div>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {score.lifts.map((l) => {
              const source = byId[l.sourceId];
              const variant = source && !source.name.toLowerCase().startsWith('barbell') ? source.name : undefined;
              return (
                <div key={l.lift} className="list-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                  <div className="row between">
                    <span style={{ fontWeight: 600 }}>{LIFT_NAMES[l.lift]}</span>
                    <span className="badge">{l.level}</span>
                  </div>
                  <div className="row between wrap small">
                    <span className="muted num">
                      e1RM {formatWeight(l.e1rmKg, units)} · {l.ratio.toFixed(2)} × bodyweight
                    </span>
                    <span className="faint num">{Math.round(l.score)}/100</span>
                  </div>
                  <div className="bar" aria-hidden="true">
                    <span className="fill" style={{ width: `${Math.min(100, Math.max(0, l.score))}%` }} />
                  </div>
                  {variant && <span className="small faint">Estimated from {variant}</span>}
                </div>
              );
            })}
          </div>
          <p className="small faint" style={{ marginTop: 8 }}>
            Best estimated 1RM from the last 6 months against approximate bodyweight standards.
          </p>
        </>
      )}
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
    const out: VolumeRow[] = [];
    for (const m of MUSCLE_IDS) {
      const { min, max } = weeklySetTarget(m, goal);
      if (max <= 0) continue;
      const done = weekly[m];
      out.push({ m, min, max, done, status: volumeStatus(m, done, goal) });
    }
    // Under-target muscles first (furthest behind first); the rest keep body order.
    const behind = (r: VolumeRow) => (r.status === 'under' ? r.done / r.min : 2);
    return out.sort((a, b) => behind(a) - behind(b));
  }, [weekly, goal]);

  const shown = showAll ? rows : rows.slice(0, VOLUME_PREVIEW);
  const underCount = rows.filter((r) => r.status === 'under').length;

  return (
    <section className="card" aria-labelledby="volume-title">
      <div className="card-title">
        <h2 id="volume-title" style={CARD_TITLE}>
          Weekly volume
        </h2>
        <span className="small faint">{underCount ? `${underCount} under target` : 'All on target'}</span>
      </div>
      <p className="small faint" style={{ marginTop: -6, marginBottom: 12 }}>
        Hard sets in the last 7 days. The shaded zone is your {goal} target.
      </p>
      <ul className="stack" style={{ gap: 14, listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((r) => {
          const scale = r.max * 1.4;
          const pct = (v: number) => Math.min(100, (v / scale) * 100);
          return (
            <li key={r.m} className="stack" style={{ gap: 6 }}>
              <div className="row between wrap" style={{ rowGap: 4 }}>
                <span style={{ fontWeight: 600 }}>{MUSCLES[r.m].name}</span>
                <span className="row small" style={{ gap: 8 }}>
                  <span className="num muted">
                    {fmtSets(r.done)} / {r.min === r.max ? r.max : `${r.min}–${r.max}`} sets
                  </span>
                  <span className={`badge${r.status === 'on-track' ? ' accent' : ''}`}>{STATUS_LABEL[r.status]}</span>
                </span>
              </div>
              <div className="bar" style={{ height: 12 }} aria-hidden="true">
                <span
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${pct(r.min)}%`,
                    width: `${pct(r.max) - pct(r.min)}%`,
                    background: 'color-mix(in oklab, var(--accent) 24%, transparent)',
                  }}
                />
                <span className="fill" style={{ top: 3, bottom: 3, width: `${pct(r.done)}%`, background: STATUS_FILL[r.status] }} />
              </div>
            </li>
          );
        })}
      </ul>
      {rows.length > VOLUME_PREVIEW && (
        <button
          type="button"
          className="btn ghost sm block"
          style={{ marginTop: 12 }}
          aria-expanded={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Show less' : `Show all ${rows.length} muscles`}
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
  const readyCount = MUSCLE_IDS.filter((m) => hoursUntilRecovered(m, fatigue[m]) === 0).length;
  const select = (m: MuscleId) => setSel((cur) => (cur === m ? undefined : m));

  return (
    <section className="card" aria-labelledby="recovery-title">
      <div className="card-title">
        <h2 id="recovery-title" style={CARD_TITLE}>
          Recovery
        </h2>
        <span className="small faint num">
          {readyCount}/{MUSCLE_IDS.length} ready
        </span>
      </div>
      <BodyMap recovery={recovery} selected={sel} onSelect={select} />
      <p className="small" style={{ marginTop: 12, minHeight: '1.45em' }} aria-live="polite">
        {sel ? (
          <>
            <strong>{MUSCLES[sel].name}</strong>
            <span className="muted">
              {' '}
              — {Math.round(recovery[sel] * 100)}% recovered · {readyText(hoursUntilRecovered(sel, fatigue[sel]))}
            </span>
          </>
        ) : (
          <span className="faint">Tap a muscle to see how recovered it is.</span>
        )}
      </p>
      {mostFatigued.length > 0 ? (
        <div className="stack" style={{ marginTop: 12, gap: 6 }}>
          <span className="tiny faint">Most fatigued</span>
          <div className="chips wrap">
            {mostFatigued.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={sel === m} onClick={() => select(m)}>
                {MUSCLES[m].name} <span className="num faint">{Math.round(recovery[m] * 100)}%</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="small faint" style={{ marginTop: 8 }}>
          Every muscle is fresh — train whatever you like.
        </p>
      )}
    </section>
  );
}

// ── Lifts ───────────────────────────────────────────────────────────────────

interface LiftRow {
  id: string;
  name: string;
  lastAt: number;
  best: string;
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
    const latest = list.reduce((a, b) => (b.at > a.at ? b : a));
    const lastSession = list.filter((s) => s.workoutId === latest.workoutId);
    const weighted = list.some((s) => s.weightKg > 0);

    let bestText: string;
    if (weighted) {
      const best = lastSession.reduce((a, b) => {
        const ea = estimate1RM(a.weightKg, a.reps);
        const eb = estimate1RM(b.weightKg, b.reps);
        return eb > ea || (eb === ea && b.weightKg > a.weightKg) ? b : a;
      });
      const reps = timed ? `${best.reps}s` : String(best.reps);
      bestText = best.weightKg > 0 ? `${formatWeight(best.weightKg, units)} × ${reps}` : timed ? reps : `${reps} reps`;
    } else {
      const reps = Math.max(...lastSession.map((s) => s.reps));
      bestText = timed ? `${reps}s` : `${reps} reps`;
    }

    // Trend vs. the first logged session: e1RM for loaded lifts, best reps otherwise.
    const trend = exerciseTrend(list);
    const first = trend[0];
    const last = trend[trend.length - 1];
    let delta: number | null = null;
    let deltaLabel = '';
    if (trend.length >= 2 && first && last) {
      if (weighted && first.e1rmKg > 0 && last.e1rmKg > 0) {
        delta = (last.e1rmKg / first.e1rmKg - 1) * 100;
        deltaLabel = 'Change in estimated 1RM since your first session';
      } else if (!weighted && first.bestReps > 0) {
        delta = (last.bestReps / first.bestReps - 1) * 100;
        deltaLabel = `Change in best ${timed ? 'time' : 'reps'} since your first session`;
      }
    }

    rows.push({ id, name: ex?.name ?? 'Deleted exercise', lastAt: latest.at, best: bestText, delta, deltaLabel });
  }
  return rows.sort((a, b) => b.lastAt - a.lastAt);
}

// ── Page ────────────────────────────────────────────────────────────────────

export function Progress() {
  const profile = useProfile();
  const state = useTrainingState();
  const exercises = useExercises();
  const now = useNow();

  const units = profile?.units ?? 'kg';
  const lifts = useMemo(
    () => (state && exercises ? liftRows(state.sets, exercises.byId, units) : []),
    [state, exercises, units],
  );

  if (!profile || !state || !exercises) return null;

  const total = state.workouts.length;
  const today = new Date(now);
  const thisMonth = state.workouts.filter((w) => {
    const d = new Date(w.finishedAt ?? w.createdAt);
    return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
  }).length;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Progress</h1>
          <div className="sub">
            {plural(total, 'workout')} · {thisMonth} this month
          </div>
        </div>
      </header>

      {total === 0 ? (
        <div className="card empty">
          <Icon name="progress" size={32} />
          <p style={{ marginTop: 8, fontWeight: 600, color: 'var(--text-1)' }}>No workouts yet</p>
          <p className="small" style={{ marginTop: 4 }}>
            Finish your first workout to see your strength score, weekly volume, recovery and lift trends here.
          </p>
          <Link to="/" className="btn primary" style={{ marginTop: 16 }}>
            Start training
          </Link>
        </div>
      ) : (
        <>
          <StrengthCard
            sets={state.sets}
            bodyweightKg={profile.bodyweightKg}
            sex={profile.sex}
            units={units}
            byId={exercises.byId}
            now={now}
          />
          <VolumeCard weekly={state.weekly} goal={profile.goal} />
          <RecoveryCard recovery={state.recovery} fatigue={state.fatigue} />

          <h2 className="section-title">Lifts</h2>
          {lifts.length === 0 ? (
            <div className="card empty small">No working sets logged yet.</div>
          ) : (
            <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
              <div className="list">
                {lifts.map((l) => (
                  <Link key={l.id} to={`/library/${encodeURIComponent(l.id)}`} className="list-item">
                    <div className="grow">
                      <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{l.name}</div>
                      <div className="small muted num">
                        {l.best} · {relativeDay(l.lastAt, now)}
                      </div>
                    </div>
                    {l.delta !== null && (
                      <span className={`badge num${Math.round(l.delta) > 0 ? ' accent' : ''}`} title={l.deltaLabel}>
                        {fmtDelta(l.delta)}
                      </span>
                    )}
                    <span className="faint" style={{ display: 'inline-flex' }}>
                      <Icon name="chevron" size={18} />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

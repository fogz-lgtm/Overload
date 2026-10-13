import { Link } from 'react-router-dom';
import { Figure, MuscleThumb } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import type { PR } from '../engine/analytics';
import { estimate1RM, formatWeight, toDisplay } from '../engine/load';
import type { Exercise, MuscleId, Profile, Workout } from '../engine/types';
import { formatDate } from '../hooks';
import { CountUp } from '../ui/CountUp';
import { splitName } from './Today';
import './WorkoutSummary.css';

const CONFETTI = ['var(--accent-fill)', 'var(--pr)', '#ffffff', 'var(--tag-pull)', 'var(--accent-fill-2)'];

/** Burst of paper from the badge — only shown when there's something to celebrate. */
function Confetti() {
  return (
    <div className="sum-confetti" aria-hidden="true">
      {Array.from({ length: 36 }, (_, i) => {
        const angle = (i / 36) * Math.PI * 2 + (i % 3) * 0.2;
        const dist = 110 + ((i * 37) % 90);
        return (
          <i
            key={i}
            style={
              {
                '--x': `${Math.cos(angle) * dist}px`,
                '--y': `${Math.sin(angle) * dist * 0.8 + 60}px`,
                '--r': `${(i * 47) % 360}deg`,
                '--c': CONFETTI[i % CONFETTI.length],
                animationDelay: `${(i % 6) * 25}ms`,
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

export function WorkoutSummary({ workout, prs, exercises, profile, onDone }: { workout: Workout; prs: PR[]; exercises: Record<string, Exercise>; profile: Profile; onDone: () => void }) {
  const [kind, muscles] = splitName(workout.name);
  const working = workout.exercises.flatMap((e) => e.sets).filter((s) => s.done && s.kind === 'working');
  const volume = working.reduce((a, s) => a + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
  const minutes = Math.max(1, Math.round(((workout.finishedAt ?? 0) - (workout.startedAt ?? 0)) / 60_000));

  // Sets per muscle → shading for the "muscles worked" figure.
  const load = new Map<MuscleId, number>();
  for (const we of workout.exercises) {
    const e = exercises[we.exerciseId];
    const n = we.sets.filter((s) => s.done && s.kind === 'working').length;
    e?.primary.forEach((m) => load.set(m, (load.get(m) ?? 0) + n));
    e?.secondary.forEach((m) => load.set(m, (load.get(m) ?? 0) + n / 2));
  }
  const maxLoad = Math.max(1, ...load.values());
  const fill = (m: MuscleId) => {
    const v = load.get(m) ?? 0;
    return v > 0 ? `color-mix(in oklab, var(--muscle-hit) ${Math.round(30 + (v / maxLoad) * 70)}%, var(--muscle-base))` : 'var(--muscle-base)';
  };

  const prText = (p: PR) => {
    const name = exercises[p.exerciseId]?.name ?? p.exerciseId;
    // Estimates carry false precision; whole units read as what they are.
    const whole = (kg: number) => `${Math.round(toDisplay(kg, profile.units))} ${profile.units}`;
    if (p.kind === 'e1rm') return { name, what: 'Estimated 1RM', value: whole(p.value), was: whole(p.previous) };
    if (p.kind === 'weight') return { name, what: 'Heaviest weight', value: formatWeight(p.value, profile.units), was: formatWeight(p.previous, profile.units) };
    return { name, what: `Reps at ${formatWeight(p.weightKg ?? 0, profile.units)}`, value: `${p.value} reps`, was: `${p.previous}` };
  };

  return (
    <div className="sum-page">
      <div className="sum-glow" aria-hidden="true" />
      <div className="sum-hero">
        {prs.length > 0 && <Confetti />}
        <span className="sum-badge">
          <Icon name={prs.length ? 'trophy' : 'check'} size={34} />
        </span>
        <div className="eyebrow">{prs.length ? `Workout complete · ${prs.length} new record${prs.length > 1 ? 's' : ''}` : 'Workout complete'}</div>
        <h1 className="sum-title">{kind}</h1>
        <p className="muted small">
          {muscles ? `${muscles} · ` : ''}
          {formatDate(workout.finishedAt ?? Date.now(), { weekday: 'long', month: 'short', day: 'numeric' })}
        </p>
      </div>

      <section className="card stats four sum-stats">
        <div className="stat">
          <span className="value">
            <CountUp value={minutes} />
            <small>min</small>
          </span>
          <span className="label">Duration</span>
        </div>
        <div className="stat">
          <span className="value">
            <CountUp value={toDisplay(volume, profile.units)} format={(n) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : Math.round(n).toLocaleString())} />
          </span>
          <span className="label">Volume ({profile.units})</span>
        </div>
        <div className="stat">
          <span className="value">
            <CountUp value={working.length} />
          </span>
          <span className="label">Sets</span>
        </div>
        <div className="stat">
          <span className="value" style={prs.length ? { color: 'var(--pr)' } : undefined}>
            <CountUp value={prs.length} />
          </span>
          <span className="label">Records</span>
        </div>
      </section>

      {prs.length > 0 && (
        <section className="stack">
          <div className="section-title">New personal records</div>
          {prs.map((p, i) => {
            const t = prText(p);
            return (
              <div key={i} className="sum-pr" style={{ animationDelay: `${200 + i * 90}ms` }}>
                <span className="sum-pr-icon">
                  <Icon name="trophy" size={20} />
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 650 }}>
                    {t.name}
                  </div>
                  <div className="small faint">
                    {t.what} · was {t.was}
                  </div>
                </div>
                <span className="display" style={{ fontSize: 24, color: 'var(--pr)' }}>
                  {t.value}
                </span>
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <div className="card-title">
          <h3>Muscles worked</h3>
          <span className="small faint">{load.size} groups</span>
        </div>
        <div className="sum-figures">
          <Figure view="front" fill={fill} label="Muscles worked, front" />
          <Figure view="back" fill={fill} label="Muscles worked, back" />
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          <h3>Exercises</h3>
        </div>
        <div className="list">
          {workout.exercises.map((we) => {
            const e = exercises[we.exerciseId];
            const done = we.sets.filter((s) => s.done && s.kind === 'working');
            const best = [...done].sort((a, b) => estimate1RM(b.weightKg ?? 0, b.reps ?? 0) - estimate1RM(a.weightKg ?? 0, a.reps ?? 0))[0];
            return (
              <div key={we.id} className="list-item" style={{ cursor: 'default' }}>
                {e && <MuscleThumb primary={e.primary} secondary={e.secondary} size={40} />}
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {e?.name ?? we.exerciseId}
                  </div>
                  <div className="small faint">{done.length} sets</div>
                </div>
                {best && (
                  <span className="display" style={{ fontSize: 19 }}>
                    {best.weightKg ? `${formatWeight(best.weightKg, profile.units)} × ` : ''}
                    {best.reps}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="stack sum-actions">
        <button type="button" className="btn primary lg block" onClick={onDone}>
          Done
        </button>
        <Link to={`/history/${workout.id}`} className="btn ghost block">
          View full details
        </Link>
      </div>
    </div>
  );
}

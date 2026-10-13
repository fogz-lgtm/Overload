import { Link, NavLink } from 'react-router-dom';
import type { Workout } from '../engine/types';
import { formatClock, useNow } from '../hooks';
import { Icon, type IconName } from './Icon';

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Train', icon: 'dumbbell' },
  { to: '/history', label: 'History', icon: 'calendar' },
  { to: '/progress', label: 'Progress', icon: 'progress' },
  { to: '/library', label: 'Exercises', icon: 'library' },
  { to: '/coach', label: 'Coach', icon: 'sparkle' },
];

/** While a workout is running, a dock above the tabs leads back to it from anywhere. */
function ActiveDock({ active }: { active: Workout }) {
  const now = useNow(1000);
  const done = active.exercises.flatMap((e) => e.sets).filter((s) => s.done).length;
  const total = active.exercises.flatMap((e) => e.sets).length;
  return (
    <Link to={`/workout/${active.id}`} className="dock" aria-label={`Resume ${active.name}`}>
      <span className="pulse" />
      <span className="grow" style={{ minWidth: 0 }}>
        <strong className="truncate" style={{ display: 'block', fontSize: 14 }}>
          {active.name.split(' · ')[0]}
        </strong>
        <span className="num" style={{ fontSize: 12, opacity: 0.75 }}>
          {formatClock(now - (active.startedAt ?? now))} · {done}/{total} sets
        </span>
      </span>
      <span className="btn sm" style={{ background: 'var(--accent-ink)', color: 'var(--accent-fill)', border: 0 }}>
        Resume
      </span>
    </Link>
  );
}

export function TabBar({ active }: { active?: Workout }) {
  return (
    <div className="tabbar">
      {active && <ActiveDock active={active} />}
      <nav aria-label="Main">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={t.icon} size={23} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

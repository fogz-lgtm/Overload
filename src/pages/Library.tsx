import { useLiveQuery } from 'dexie-react-hooks';
import { memo, useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Figure, MuscleThumb, targetFill } from '../components/BodyMap';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { guessExercise } from '../db/backup';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, db } from '../db/db';
import { prefsMap } from '../db/repo';
import { MUSCLES, MUSCLE_IDS, weeklySetTarget } from '../engine/muscles';
import type { Equipment, Exercise, Goal, Loading, MovementPattern, MuscleId } from '../engine/types';
import { uid } from '../engine/util';
import { useExercises, useProfile } from '../hooks';
import { EmptyState } from '../ui/EmptyState';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import './Library.css';

type Mechanic = Exercise['mechanic'];

const LOADING_OPTIONS: { value: Loading; label: string }[] = [
  { value: 'barbell', label: 'Barbell' },
  { value: 'dumbbell', label: 'Dumbbell' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'Bodyweight' },
  { value: 'band', label: 'Band' },
];

const LOADING_HINT: Record<Loading, string> = {
  barbell: 'Log the total bar weight.',
  dumbbell: 'Log the weight of one dumbbell.',
  kettlebell: 'Log the weight of one bell.',
  machine: 'Log the stack or plate weight.',
  cable: 'Log the stack weight.',
  bodyweight: 'Log reps, plus any added load.',
  band: 'Log reps only.',
};

const COMPOUND_PATTERN: Record<MuscleId, MovementPattern> = {
  chest: 'horizontal_push',
  front_delts: 'vertical_push',
  side_delts: 'vertical_push',
  rear_delts: 'horizontal_pull',
  biceps: 'vertical_pull',
  triceps: 'horizontal_push',
  forearms: 'carry',
  traps: 'shrug',
  lats: 'vertical_pull',
  upper_back: 'horizontal_pull',
  lower_back: 'hinge',
  abs: 'core',
  obliques: 'core',
  glutes: 'hinge',
  quads: 'squat',
  hamstrings: 'hinge',
  adductors: 'lunge',
  calves: 'calf_raise',
};

const ISOLATION_PATTERN: Record<MuscleId, MovementPattern> = {
  chest: 'chest_isolation',
  front_delts: 'shoulder_isolation',
  side_delts: 'shoulder_isolation',
  rear_delts: 'shoulder_isolation',
  biceps: 'elbow_flexion',
  triceps: 'elbow_extension',
  forearms: 'elbow_flexion',
  traps: 'shrug',
  lats: 'vertical_pull',
  upper_back: 'horizontal_pull',
  lower_back: 'hinge',
  abs: 'core',
  obliques: 'core',
  glutes: 'hip_isolation',
  quads: 'knee_extension',
  hamstrings: 'knee_flexion',
  adductors: 'hip_isolation',
  calves: 'calf_raise',
};

/** Sensible loading default from the equipment picked (until the user chooses one). */
function guessLoading(equipment: Equipment[]): Loading {
  const has = (...items: Equipment[]) => items.some((e) => equipment.includes(e));
  if (has('barbell', 'ez_bar', 'trap_bar', 'smith_machine')) return 'barbell';
  if (has('dumbbells')) return 'dumbbell';
  if (has('kettlebells')) return 'kettlebell';
  if (has('cable')) return 'cable';
  if (has('machines', 'leg_press')) return 'machine';
  if (has('bands')) return 'band';
  return 'bodyweight';
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

const muscleText = (ex: Exercise) => (ex.primary.length ? ex.primary.map((m) => MUSCLES[m].name).join(', ') : 'No muscle set');
const equipmentText = (ex: Exercise) => (ex.equipment.length ? ex.equipment.map((e) => EQUIPMENT_LABEL[e]).join(', ') : 'Bodyweight');
const byName = (a: Exercise, b: Exercise) => a.name.localeCompare(b.name);

interface Indexed {
  ex: Exercise;
  name: string;
  words: string[];
  hay: string;
}

/** Lower is better; null = no match. Name prefix beats word prefix beats substring beats muscle/equipment. */
function searchScore(it: Indexed, q: string, tokens: string[]): number | null {
  if (it.name.startsWith(q)) return 0;
  if (it.words.some((w) => w.startsWith(q))) return 1;
  if (it.name.includes(q)) return 2;
  if (!tokens.every((t) => it.hay.includes(t))) return null;
  return tokens.every((t) => it.name.includes(t)) ? 3 : 4;
}

interface Section {
  id: string;
  title: string;
  variant: 'letter' | 'label' | 'favorites';
  items: Exercise[];
}

// ── Row ─────────────────────────────────────────────────────────────────────

const ExerciseRow = memo(function ExerciseRow({ ex, favorite, hidden }: { ex: Exercise; favorite: boolean; hidden: boolean }) {
  return (
    <Link to={`/library/${encodeURIComponent(ex.id)}`} className={`lib-row${hidden ? ' is-hidden' : ''}`}>
      <span aria-hidden="true" className="lib-row-thumb">
        <MuscleThumb primary={ex.primary} secondary={ex.secondary} size={48} />
      </span>
      <span className="lib-row-text">
        <span className="lib-row-name">{ex.name}</span>
        <span className="lib-row-meta">
          <span className="lib-row-muscles">{muscleText(ex)}</span>
          <span aria-hidden="true"> · </span>
          {equipmentText(ex)}
        </span>
      </span>
      {(favorite || hidden || ex.custom) && (
        <span className="lib-row-trail">
          {ex.custom && <span className="badge">Custom</span>}
          {hidden && (
            <span className="badge lib-badge-hidden">
              <Icon name="eyeOff" size={12} />
              Hidden
            </span>
          )}
          {favorite && (
            <span className="lib-star">
              <Icon name="star" size={18} title="Favorite" />
            </span>
          )}
        </span>
      )}
    </Link>
  );
});

// ── A–Z index rail ──────────────────────────────────────────────────────────

function IndexRail({ letters, onJump }: { letters: string[]; onJump: (letter: string) => void }) {
  const rail = useRef<HTMLElement>(null);
  const last = useRef<string | null>(null);
  const pick = (y: number) => {
    const r = rail.current?.getBoundingClientRect();
    if (!r) return;
    const el = document.elementFromPoint(r.left + r.width / 2, y);
    const letter = el instanceof HTMLElement ? el.dataset.letter : undefined;
    if (letter && letter !== last.current) {
      last.current = letter;
      haptics.tap();
      onJump(letter);
    }
  };
  return (
    <nav
      ref={rail}
      className="lib-rail"
      aria-label="Jump to letter"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        last.current = null;
        pick(e.clientY);
      }}
      onPointerMove={(e) => e.buttons && pick(e.clientY)}
    >
      {letters.map((l) => (
        <button
          key={l}
          type="button"
          data-letter={l}
          aria-label={`Jump to ${l}`}
          // Pointer presses are handled above; this covers keyboard activation.
          onClick={(e) => e.detail === 0 && onJump(l)}
        >
          {l}
        </button>
      ))}
    </nav>
  );
}

// ── Muscle summary (when a muscle filter is active) ─────────────────────────

function MuscleSummary({ muscle, items, goal }: { muscle: MuscleId; items: Exercise[]; goal: Goal }) {
  const compound = items.filter((e) => e.mechanic === 'compound').length;
  const { min, max } = weeklySetTarget(muscle, goal);
  const fill = (m: MuscleId) => targetFill(m, [muscle], []);
  return (
    <section className="card lib-muscle" aria-label={`${MUSCLES[muscle].name} overview`}>
      <div className="lib-muscle-figs" aria-hidden="true">
        <Figure view="front" fill={fill} label="Front" viewBox="10 0 100 252" />
        <Figure view="back" fill={fill} label="Back" viewBox="10 0 100 252" />
      </div>
      <div className="lib-muscle-text">
        <span className="eyebrow">Primary muscle</span>
        <h2>{MUSCLES[muscle].name}</h2>
        <p className="small muted num">
          {items.length} {items.length === 1 ? 'exercise' : 'exercises'} · {compound} compound
        </p>
        <p className="small faint">
          {min > 0 ? `Aim for ${min}–${max} hard sets a week.` : `Up to ${max} direct sets a week; compound lifts already train it.`}
        </p>
      </div>
    </section>
  );
}

// ── New exercise sheet ──────────────────────────────────────────────────────

function NewExerciseSheet({
  initialName,
  existingNames,
  onClose,
  onSaved,
}: {
  initialName: string;
  existingNames: Set<string>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const ids = useId();
  const [name, setName] = useState(initialName);
  const [primaryChoice, setPrimary] = useState<MuscleId | null>(null);
  const [secondaryChoice, setSecondary] = useState<MuscleId[] | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loadingChoice, setLoading] = useState<Loading | null>(null);
  const [mechanicChoice, setMechanic] = useState<Mechanic | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Until the user picks, muscles and type follow what the name suggests ("Cable lateral raise" → side delts, isolation).
  const trimmed = name.trim();
  const guess = useMemo(() => guessExercise(trimmed), [trimmed]);
  const suggested = guess.primary[0];
  const primary = primaryChoice ?? suggested ?? 'chest';
  const secondary = (secondaryChoice ?? guess.primary.slice(1)).filter((m) => m !== primary);
  const mechanic = mechanicChoice ?? (suggested ? guess.mechanic : 'compound');
  const loading = loadingChoice ?? guessLoading(equipment);
  const duplicate = existingNames.has(trimmed.toLowerCase());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const pattern =
      suggested && guess.primary.includes(primary) && guess.mechanic === mechanic
        ? guess.pattern
        : (mechanic === 'compound' ? COMPOUND_PATTERN : ISOLATION_PATTERN)[primary];
    const ex: Exercise = {
      id: `custom-${uid()}`,
      name: trimmed,
      primary: [primary],
      secondary,
      equipment: ALL_EQUIPMENT.filter((eq) => equipment.includes(eq)),
      pattern,
      mechanic,
      loading,
      skill: 1,
      fatigue: mechanic === 'compound' ? 2 : 1,
      cues: [],
      custom: true,
    };
    try {
      await db.customExercises.add(ex);
      haptics.success();
      toast(`${trimmed} added`, { icon: 'check', tone: 'accent' });
      onSaved(ex.id);
    } catch {
      setError("Couldn't save the exercise. Try again.");
      setSaving(false);
    }
  };

  const loadingLabel = LOADING_OPTIONS.find((o) => o.value === loading)?.label ?? loading;

  return (
    <Sheet open onClose={onClose} title="New exercise" subtitle="Custom exercises work everywhere: workouts, history and the coach.">
      <form className="stack lg lib-form" onSubmit={save}>
        <div className="lib-preview" aria-live="polite">
          <MuscleThumb primary={[primary]} secondary={secondary} size={64} />
          <div className="grow">
            <div className={`lib-preview-name${trimmed ? '' : ' placeholder'}`}>{trimmed || 'Untitled exercise'}</div>
            <div className="small muted">
              {MUSCLES[primary].name}
              {secondary.length > 0 && <span className="faint"> + {secondary.length}</span>}
            </div>
            <div className="small faint">
              {mechanic === 'compound' ? 'Compound' : 'Isolation'} · {loadingLabel}
            </div>
          </div>
        </div>

        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Landmine press"
            maxLength={80}
            autoComplete="off"
            autoCapitalize="words"
            required
            autoFocus={!initialName}
          />
          {duplicate && <small className="small lib-warn">You already have an exercise with this name.</small>}
        </label>

        <div className="field" role="group" aria-labelledby={`${ids}-primary`}>
          <span id={`${ids}-primary`} className="lib-field-label">
            Primary muscle
            {!primaryChoice && suggested && <em className="lib-auto">Suggested from name</em>}
          </span>
          <div className="chips wrap">
            {MUSCLE_IDS.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={primary === m} onClick={() => setPrimary(m)}>
                {MUSCLES[m].name}
              </button>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-labelledby={`${ids}-secondary`}>
          <span id={`${ids}-secondary`}>Also works</span>
          <div className="chips wrap">
            {MUSCLE_IDS.filter((m) => m !== primary).map((m) => (
              <button
                key={m}
                type="button"
                className="chip lib-chip-soft"
                aria-pressed={secondary.includes(m)}
                onClick={() => setSecondary(toggle(secondary, m))}
              >
                {MUSCLES[m].name}
              </button>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-labelledby={`${ids}-equipment`}>
          <span id={`${ids}-equipment`}>Equipment</span>
          <div className="chips wrap">
            {ALL_EQUIPMENT.map((eq) => (
              <button
                key={eq}
                type="button"
                className="chip"
                aria-pressed={equipment.includes(eq)}
                onClick={() => setEquipment((cur) => toggle(cur, eq))}
              >
                {EQUIPMENT_LABEL[eq]}
              </button>
            ))}
          </div>
          <small className="small faint">Pick everything it needs. Leave empty for bodyweight.</small>
        </div>

        <div className="field" role="group" aria-labelledby={`${ids}-loading`}>
          <span id={`${ids}-loading`} className="lib-field-label">
            Loading
            {!loadingChoice && <em className="lib-auto">From equipment</em>}
          </span>
          <div className="chips wrap">
            {LOADING_OPTIONS.map((o) => (
              <button key={o.value} type="button" className="chip" aria-pressed={loading === o.value} onClick={() => setLoading(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
          <small className="small faint">{LOADING_HINT[loading]}</small>
        </div>

        <div className="field" role="group" aria-labelledby={`${ids}-mechanic`}>
          <span id={`${ids}-mechanic`}>Type</span>
          <div className="segmented">
            {(['compound', 'isolation'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mechanic === m} onClick={() => setMechanic(m)}>
                {m === 'compound' ? 'Compound' : 'Isolation'}
              </button>
            ))}
          </div>
          <small className="small faint">
            {mechanic === 'compound' ? 'Several joints, like presses, rows and squats.' : 'One joint, like curls, raises and extensions.'}
          </small>
        </div>

        {error && (
          <p className="small lib-error" role="alert">
            {error}
          </p>
        )}

        <div className="lib-sheet-foot">
          <button type="submit" className="btn primary block lg" disabled={!trimmed || saving}>
            Save exercise
          </button>
        </div>
      </form>
    </Sheet>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function Library() {
  const navigate = useNavigate();
  const profile = useProfile();
  const exercises = useExercises();
  const prefs = useLiveQuery(prefsMap);
  const activeGymId = profile?.activeGymId;
  // null = no gym configured; undefined = still loading.
  const gym = useLiveQuery(async () => (activeGymId ? ((await db.gyms.get(activeGymId)) ?? null) : null), [activeGymId]);

  // Filters live in the URL so they survive opening an exercise and coming back.
  const [params, setParams] = useSearchParams();
  const muscleParam = params.get('muscle');
  const muscle = MUSCLE_IDS.find((m) => m === muscleParam) ?? 'all';
  const gymOnly = params.get('gym') === '1' && !!gym;
  // The search box keeps local state (URL updates run in a transition, which would make typing laggy).
  const [query, setQueryState] = useState(() => params.get('q') ?? '');
  const deferredQuery = useDeferredValue(query);
  const [adding, setAdding] = useState<string | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setQuery = (v: string) => {
    setQueryState(v);
    setParam('q', v.trim() ? v : null);
  };
  const setMuscle = (m: MuscleId | 'all') => {
    haptics.tap();
    setParam('muscle', m === 'all' ? null : m);
  };

  const index = useMemo<Indexed[]>(
    () =>
      (exercises?.list ?? []).map((ex) => {
        const name = ex.name.toLowerCase();
        const extra = [...ex.primary.map((m) => MUSCLES[m].name), ...ex.equipment.map((e) => EQUIPMENT_LABEL[e])].join(' ');
        return { ex, name, words: name.split(/[\s-]+/), hay: `${name} ${extra.toLowerCase()}` };
      }),
    [exercises],
  );

  const q = deferredQuery.trim().toLowerCase();
  const searching = q !== '';
  const gear = gymOnly && gym ? gym.equipment : null;

  const { sections, matched, letters } = useMemo(() => {
    const fits = (ex: Exercise) =>
      (muscle === 'all' || ex.primary.includes(muscle)) && (!gear || ex.equipment.every((e) => gear.includes(e)));
    const out: Section[] = [];
    if (searching) {
      const tokens = q.split(/\s+/);
      const hits = index
        .filter((it) => fits(it.ex))
        .map((it) => ({ ex: it.ex, score: searchScore(it, q, tokens) }))
        .filter((h): h is { ex: Exercise; score: number } => h.score !== null)
        .sort((a, b) => a.score - b.score || byName(a.ex, b.ex))
        .map((h) => h.ex);
      if (hits.length) out.push({ id: 'results', title: hits.length === 1 ? '1 result' : `${hits.length} results`, variant: 'label', items: hits });
      return { sections: out, matched: hits, letters: [] };
    }
    const base = index.map((it) => it.ex).filter(fits).sort(byName);
    const favs = base.filter((ex) => prefs?.[ex.id]?.favorite);
    if (favs.length) out.push({ id: 'favorites', title: 'Favorites', variant: 'favorites', items: favs });
    if (muscle !== 'all') {
      for (const m of ['compound', 'isolation'] as const) {
        const items = base.filter((ex) => ex.mechanic === m);
        if (items.length) out.push({ id: m, title: m === 'compound' ? 'Compound' : 'Isolation', variant: 'label', items });
      }
      return { sections: out, matched: base, letters: [] };
    }
    const groups = new Map<string, Exercise[]>();
    for (const ex of base) {
      const first = ex.name.charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      groups.set(letter, [...(groups.get(letter) ?? []), ex]);
    }
    for (const [letter, items] of groups) out.push({ id: letter, title: letter, variant: 'letter', items });
    return { sections: out, matched: base, letters: [...groups.keys()] };
  }, [index, prefs, q, searching, muscle, gear]);

  // Keep the selected muscle chip in view (also when arriving from a shared URL).
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('[data-muscle][aria-pressed="true"]');
    if (!row || !chip) return;
    row.scrollTo({ left: chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
  }, [muscle, exercises]);

  // Hairline under the search bar once it sticks; its height positions jump targets below it.
  useEffect(() => {
    const page = pageRef.current;
    const bar = barRef.current;
    const header = headerRef.current;
    if (!page || !bar || !header) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const stuck = bar.getBoundingClientRect().top - header.getBoundingClientRect().bottom > 17;
      page.toggleAttribute('data-stuck', stuck);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    const ro = new ResizeObserver(() => page.style.setProperty('--lib-bar-h', `${bar.offsetHeight}px`));
    ro.observe(bar);
    check();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [exercises, prefs]);

  const jump = useCallback((letter: string) => {
    document.getElementById(`lib-sec-${letter}`)?.scrollIntoView({ block: 'start' });
  }, []);

  const existingNames = useMemo(() => new Set((exercises?.list ?? []).map((e) => e.name.trim().toLowerCase())), [exercises]);
  const closeSheet = useCallback(() => setAdding(null), []);
  const onSaved = useCallback(
    (id: string) => {
      setAdding(null);
      navigate(`/library/${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  if (!profile || !exercises || !prefs) return null;

  const total = exercises.list.length;
  const atGym = gym ? exercises.list.filter((ex) => ex.equipment.every((e) => gym.equipment.includes(e))).length : null;
  const filtering = searching || muscle !== 'all' || gymOnly;
  const clearFilters = () => {
    setQueryState('');
    setParams(new URLSearchParams(), { replace: true });
  };

  let empty: ReactNode = null;
  if (!sections.length) {
    const typed = query.trim();
    empty = (
      <EmptyState
        icon="search"
        title={typed ? `No matches for “${typed}”` : 'Nothing here yet'}
        action={
          <div className="lib-empty-actions">
            {typed && (
              <button type="button" className="btn primary sm" onClick={() => setAdding(typed)}>
                <Icon name="plus" size={16} />
                Create “{typed.length > 24 ? `${typed.slice(0, 24)}…` : typed}”
              </button>
            )}
            {filtering && (
              <button type="button" className="btn sm" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        }
      >
        {typed
          ? 'Try another name, a muscle or a piece of equipment. Or add it as your own exercise.'
          : gymOnly
            ? `${gym?.name ?? 'Your gym'} doesn't have the equipment for any of these.`
            : 'No exercises match these filters.'}
      </EmptyState>
    );
  }

  return (
    <div className="page lib" ref={pageRef}>
      <header className="page-header" ref={headerRef}>
        <div className="grow">
          <h1>Exercises</h1>
          <div className="sub num">
            {total} movements
            {gym && atGym !== null && ` · ${atGym} at ${gym.name}`}
          </div>
        </div>
        <button type="button" className="icon-btn" onClick={() => setAdding('')} aria-label="New exercise" title="New exercise">
          <Icon name="plus" />
        </button>
      </header>

      <div className="lib-bar" ref={barRef}>
        <div className="search lib-search">
          <Icon name="search" size={18} />
          <input
            className="input"
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            placeholder={`Search ${total} exercises`}
            aria-label="Search exercises by name, muscle or equipment"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="lib-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <div className="chips lib-chips" ref={chipsRef} role="group" aria-label="Filters">
          <button
            type="button"
            className="chip lib-gym-chip"
            aria-pressed={gymOnly}
            disabled={!gym}
            title={gym ? `Only exercises you can do at ${gym.name}` : 'Set up a gym in Settings first'}
            onClick={() => {
              haptics.tap();
              setParam('gym', gymOnly ? null : '1');
            }}
          >
            <Icon name="gym" size={15} />
            At my gym
          </button>
          <span className="lib-chip-sep" aria-hidden="true" />
          <button type="button" className="chip" aria-pressed={muscle === 'all'} onClick={() => setMuscle('all')}>
            All
          </button>
          {MUSCLE_IDS.map((m) => (
            <button key={m} type="button" className="chip" data-muscle={m} aria-pressed={muscle === m} onClick={() => setMuscle(m)}>
              {MUSCLES[m].name}
            </button>
          ))}
        </div>
      </div>

      {muscle !== 'all' && !searching && matched.length > 0 && <MuscleSummary muscle={muscle} items={matched} goal={profile.goal} />}

      {empty}

      {sections.map((s) => (
        <section key={s.id} className="lib-section" aria-labelledby={`lib-sec-${s.id}`}>
          <h2 id={`lib-sec-${s.id}`} className={`lib-head ${s.variant}`}>
            {s.variant === 'favorites' && <Icon name="star" size={13} />}
            <span>{s.title}</span>
            {s.variant !== 'letter' && s.id !== 'results' && <span className="lib-head-count num">{s.items.length}</span>}
          </h2>
          <div className="lib-list">
            {s.items.map((ex) => (
              <ExerciseRow key={ex.id} ex={ex} favorite={!!prefs[ex.id]?.favorite} hidden={!!prefs[ex.id]?.excluded} />
            ))}
          </div>
        </section>
      ))}

      {letters.length > 4 && <IndexRail letters={letters} onJump={jump} />}

      {adding !== null && <NewExerciseSheet initialName={adding} existingNames={existingNames} onClose={closeSheet} onSaved={onSaved} />}
    </div>
  );
}

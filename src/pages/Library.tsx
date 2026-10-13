import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useId, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, db } from '../db/db';
import { prefsMap } from '../db/repo';
import { MUSCLES, MUSCLE_IDS } from '../engine/muscles';
import type { Equipment, Exercise, Loading, MovementPattern, MuscleId } from '../engine/types';
import { uid } from '../engine/util';
import { useExercises, useProfile } from '../hooks';

const LOADING_OPTIONS: { value: Loading; label: string }[] = [
  { value: 'barbell', label: 'Barbell (total weight)' },
  { value: 'dumbbell', label: 'Dumbbell (per hand)' },
  { value: 'kettlebell', label: 'Kettlebell' },
  { value: 'machine', label: 'Machine' },
  { value: 'cable', label: 'Cable' },
  { value: 'bodyweight', label: 'Bodyweight (+ optional load)' },
  { value: 'band', label: 'Band' },
];

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

/** Best-guess movement pattern so custom exercises slot into generated workouts sensibly. */
function guessPattern(primary: MuscleId, mechanic: Exercise['mechanic']): MovementPattern {
  return (mechanic === 'compound' ? COMPOUND_PATTERN : ISOLATION_PATTERN)[primary];
}

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

function equipmentText(ex: Exercise): string {
  return ex.equipment.length ? ex.equipment.map((e) => EQUIPMENT_LABEL[e]).join(', ') : 'Bodyweight';
}

// ── Add custom exercise ─────────────────────────────────────────────────────

function AddExerciseSheet({
  existingNames,
  onClose,
  onSaved,
}: {
  existingNames: Set<string>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const ids = useId();
  const [name, setName] = useState('');
  const [primary, setPrimary] = useState<MuscleId>('chest');
  const [secondary, setSecondary] = useState<MuscleId[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loadingChoice, setLoadingChoice] = useState<Loading | null>(null);
  const [mechanic, setMechanic] = useState<Exercise['mechanic']>('compound');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = loadingChoice ?? guessLoading(equipment);
  const trimmed = name.trim();
  const duplicate = existingNames.has(trimmed.toLowerCase());

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    const ex: Exercise = {
      id: `custom-${uid()}`,
      name: trimmed,
      primary: [primary],
      secondary: secondary.filter((m) => m !== primary),
      equipment,
      pattern: guessPattern(primary, mechanic),
      mechanic,
      loading,
      skill: 1,
      fatigue: mechanic === 'compound' ? 2 : 1,
      cues: [],
      custom: true,
    };
    try {
      await db.customExercises.add(ex);
      onSaved(ex.id);
    } catch {
      setError('Could not save the exercise. Please try again.');
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Add custom exercise">
      <form className="stack lg" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Landmine press"
            maxLength={80}
            autoComplete="off"
            required
            autoFocus
          />
          {duplicate && <small className="small faint">An exercise with this name already exists.</small>}
        </label>

        <label className="field">
          <span>Primary muscle</span>
          <select className="input" value={primary} onChange={(e) => setPrimary(e.target.value as MuscleId)}>
            {MUSCLE_IDS.map((m) => (
              <option key={m} value={m}>
                {MUSCLES[m].name}
              </option>
            ))}
          </select>
        </label>

        <div className="field" role="group" aria-labelledby={`${ids}-secondary`}>
          <span id={`${ids}-secondary`}>Secondary muscles</span>
          <div className="chips wrap">
            {MUSCLE_IDS.filter((m) => m !== primary).map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                aria-pressed={secondary.includes(m)}
                onClick={() => setSecondary((cur) => toggle(cur, m))}
              >
                {MUSCLES[m].name}
              </button>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-labelledby={`${ids}-equipment`}>
          <span id={`${ids}-equipment`}>Equipment needed</span>
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
          <small className="small faint">Select everything required. Leave empty for bodyweight.</small>
        </div>

        <label className="field">
          <span>Loading</span>
          <select className="input" value={loading} onChange={(e) => setLoadingChoice(e.target.value as Loading)}>
            {LOADING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

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
            {mechanic === 'compound' ? 'Multi-joint, e.g. presses, rows, squats.' : 'Single-joint, e.g. curls, raises, extensions.'}
          </small>
        </div>

        {error && (
          <p className="small" role="alert" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <div className="row">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary grow" disabled={!trimmed || saving}>
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
  const gymOnly = params.get('gym') === '1';
  // The search box keeps local state (URL updates run in a transition, which would make typing laggy).
  const [query, setQueryState] = useState(() => params.get('q') ?? '');
  const [adding, setAdding] = useState(false);

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
  const setMuscle = (m: MuscleId | 'all') => setParam('muscle', m === 'all' ? null : m);

  const filtered = useMemo(() => {
    if (!exercises || !prefs) return [];
    const q = query.trim().toLowerCase();
    const gear = gymOnly && gym ? gym.equipment : null;
    return exercises.list
      .filter(
        (ex) =>
          (!q || ex.name.toLowerCase().includes(q)) &&
          (muscle === 'all' || ex.primary.includes(muscle)) &&
          (!gear || ex.equipment.every((e) => gear.includes(e))),
      )
      .sort((a, b) => {
        const fav = Number(!!prefs[b.id]?.favorite) - Number(!!prefs[a.id]?.favorite);
        return fav || a.name.localeCompare(b.name);
      });
  }, [exercises, prefs, query, muscle, gymOnly, gym]);

  const existingNames = useMemo(
    () => new Set((exercises?.list ?? []).map((e) => e.name.trim().toLowerCase())),
    [exercises],
  );
  const closeSheet = useCallback(() => setAdding(false), []);
  const onSaved = useCallback(
    (id: string) => {
      setAdding(false);
      navigate(`/library/${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  if (!profile || !exercises || !prefs) return null;

  const total = exercises.list.length;
  const filtering = query.trim() !== '' || muscle !== 'all' || (gymOnly && !!gym);
  const clearFilters = () => {
    setQueryState('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <div className="page">
      <header className="page-header">
        <div style={{ minWidth: 0 }}>
          <h1>Exercise library</h1>
          <div className="sub num">
            {filtering ? `${filtered.length} of ${total}` : total} exercises
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setAdding(true)}
          aria-label="Add custom exercise"
          title="Add custom exercise"
        >
          <Icon name="plus" />
        </button>
      </header>

      <input
        className="input"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search exercises"
        aria-label="Search exercises by name"
        autoComplete="off"
      />

      <div className="chips" role="group" aria-label="Filter by primary muscle">
        <button type="button" className="chip" aria-pressed={muscle === 'all'} onClick={() => setMuscle('all')}>
          All
        </button>
        {MUSCLE_IDS.map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={muscle === m} onClick={() => setMuscle(m)}>
            {MUSCLES[m].name}
          </button>
        ))}
      </div>

      <div className="row wrap">
        <button
          type="button"
          className="chip"
          aria-pressed={gymOnly && !!gym}
          disabled={!gym}
          style={gym ? undefined : { opacity: 0.5, cursor: 'not-allowed' }}
          onClick={() => setParam('gym', gymOnly ? null : '1')}
        >
          {gymOnly && gym && <Icon name="check" size={16} />}
          Available at my gym
        </button>
        {gym ? (
          <span className="small faint">{gym.name}</span>
        ) : (
          gym === null && <span className="small faint">No gym set up</span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty">
          <p>No exercises match{query.trim() ? ` “${query.trim()}”` : ''}.</p>
          {filtering && (
            <button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <div className="list">
            {filtered.map((ex) => {
              const pref = prefs[ex.id];
              return (
                <Link key={ex.id} to={`/library/${encodeURIComponent(ex.id)}`} className="list-item">
                  <div className="grow">
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{ex.name}</span>
                      {pref?.favorite && (
                        <span style={{ display: 'inline-flex', color: 'var(--accent)' }}>
                          <Icon name="star" size={16} title="Favorite" />
                        </span>
                      )}
                      {pref?.excluded && <span className="badge">Hidden</span>}
                      {ex.custom && <span className="badge accent">Custom</span>}
                    </div>
                    <div className="small muted">{ex.primary.map((m) => MUSCLES[m].name).join(', ')}</div>
                    <div className="small faint">{equipmentText(ex)}</div>
                  </div>
                  <span className="faint" style={{ display: 'inline-flex' }}>
                    <Icon name="chevron" size={18} />
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <button type="button" className="btn block" onClick={() => setAdding(true)}>
        <Icon name="plus" size={18} />
        Add custom exercise
      </button>

      {adding && <AddExerciseSheet existingNames={existingNames} onClose={closeSheet} onSaved={onSaved} />}
    </div>
  );
}

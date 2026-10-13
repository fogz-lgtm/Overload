import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { exportBackup, exportCsv, importWorkoutCsv, restoreBackup, type CsvImportSummary } from '../db/backup';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, GYM_PRESETS, db } from '../db/db';
import { formatWeight, fromDisplay } from '../engine/load';
import type { Equipment, Experience, Goal, Gym, Profile, Sex, Units } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { download, useProfile } from '../hooks';
import { getTheme, setTheme, type ThemePref } from '../theme';

// ── Options ────────────────────────────────────────────────────────────────

const SEXES: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'unspecified', label: 'Prefer not to say' },
];

const GOALS: { value: Goal; label: string }[] = [
  { value: 'strength', label: 'Strength' },
  { value: 'hypertrophy', label: 'Hypertrophy' },
  { value: 'general', label: 'General fitness' },
  { value: 'endurance', label: 'Muscular endurance' },
];

const EXPERIENCE: { value: Experience; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const UNITS: { value: Units; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'lb', label: 'lb' },
];

const DAYS = [2, 3, 4, 5, 6].map((d) => ({ value: d, label: String(d) }));

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const DEFAULT_MODEL = 'claude-opus-5-5';
const MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — best coaching (default)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — faster, cheaper' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — cheapest' },
];

const FORMAT_LABEL: Record<string, string> = { strong: 'Strong', hevy: 'Hevy' };

const radioStyle = { width: 20, height: 20, margin: 0, flexShrink: 0, accentColor: 'var(--accent)' } as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function updateProfile(patch: Partial<Profile>): void {
  void db.profile.update('me', patch);
}

function errorText(err: unknown): string {
  if (err instanceof SyntaxError) return "the file isn't valid JSON.";
  if (err instanceof Error) return err.message;
  return String(err);
}

function equipmentSummary(equipment: Equipment[]): string {
  if (!equipment.length) return 'Bodyweight only';
  if (equipment.length === ALL_EQUIPMENT.length) return 'Full equipment';
  const labels = ALL_EQUIPMENT.filter((e) => equipment.includes(e)).map((e) => EQUIPMENT_LABEL[e]);
  const shown = labels.slice(0, 3).join(', ');
  return labels.length > 3 ? `${shown} +${labels.length - 3} more` : shown;
}

/** Back to wherever the user came from, or home when Settings was opened directly. */
function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (idx) navigate(-1);
    else navigate(fallback);
  };
}

// ── Small controls ─────────────────────────────────────────────────────────

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <div className="segmented" role="group" aria-labelledby={id}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <div className="chips wrap" role="group" aria-labelledby={id} aria-describedby={hint ? `${id}-hint` : undefined}>
        {options.map((o) => (
          <button key={o.value} type="button" className="chip" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="faint small">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="section-title">
      {children}
    </h2>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function Settings() {
  const profile = useProfile();
  const goBack = useGoBack('/');
  // Bumped after a restore so locally-edited fields re-read the restored profile.
  const [epoch, setEpoch] = useState(0);
  const onRestored = useCallback(() => setEpoch((e) => e + 1), []);
  if (!profile) return null;

  return (
    <div className="page">
      <header className="page-header">
        <button type="button" className="icon-btn" aria-label="Back" onClick={goBack}>
          <Icon name="back" />
        </button>
        <h1 className="grow">Settings</h1>
      </header>

      <ProfileSection key={`profile-${epoch}`} profile={profile} />
      <GymsSection profile={profile} />
      <AiSection key={`ai-${epoch}`} profile={profile} />
      <AppearanceSection />
      <DataSection profile={profile} onRestored={onRestored} />
      <DangerSection />
      <AboutSection />
    </div>
  );
}

function AboutSection() {
  const titleId = useId();
  return (
    <>
      <SectionTitle id={titleId}>About</SectionTitle>
      <section className="card" aria-labelledby={titleId}>
        <p className="muted small">
          Overload is open source (MIT) and local-first. Your training data never leaves this device unless you export it or use the AI
          coach.
        </p>
      </section>
    </>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSection({ profile }: { profile: Profile }) {
  const titleId = useId();
  return (
    <>
      <SectionTitle id={titleId}>Profile</SectionTitle>
      <section className="card stack lg" aria-labelledby={titleId}>
        <NameField initial={profile.name} />
        <Segmented label="Units" value={profile.units} options={UNITS} onChange={(units) => updateProfile({ units })} />
        <BodyweightField key={profile.units} kg={profile.bodyweightKg} units={profile.units} />
        <ChoiceChips
          label="Sex"
          value={profile.sex}
          options={SEXES}
          onChange={(sex) => updateProfile({ sex })}
          hint="Only used to compare your lifts against strength standards."
        />
        <ChoiceChips label="Goal" value={profile.goal} options={GOALS} onChange={(goal) => updateProfile({ goal })} />
        <Segmented
          label="Experience"
          value={profile.experience}
          options={EXPERIENCE}
          onChange={(experience) => updateProfile({ experience })}
        />
        <Segmented
          label="Days per week"
          value={profile.daysPerWeek}
          options={DAYS}
          onChange={(daysPerWeek) => updateProfile({ daysPerWeek })}
        />
        <SessionLengthField initial={profile.sessionMinutes} />
      </section>
    </>
  );
}

function NameField({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  return (
    <label className="field">
      <span>Name</span>
      <input
        className="input"
        type="text"
        autoComplete="given-name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          updateProfile({ name: e.target.value.trim() });
        }}
      />
    </label>
  );
}

function BodyweightField({ kg, units }: { kg: number; units: Units }) {
  const [text, setText] = useState(() => formatWeight(kg, units, false));
  const value = parseFloat(text);
  const valueKg = fromDisplay(value, units);
  const valid = Number.isFinite(value) && valueKg >= 20 && valueKg <= 400;
  return (
    <label className="field">
      <span>Bodyweight ({units})</span>
      <input
        className="input num"
        type="number"
        inputMode="decimal"
        min={0}
        step={0.1}
        value={text}
        aria-invalid={text !== '' && !valid}
        onChange={(e) => {
          setText(e.target.value);
          const v = parseFloat(e.target.value);
          const next = fromDisplay(v, units);
          if (Number.isFinite(v) && next >= 20 && next <= 400) updateProfile({ bodyweightKg: next });
        }}
      />
    </label>
  );
}

function SessionLengthField({ initial }: { initial: number }) {
  const [minutes, setMinutes] = useState(initial);
  return (
    <label className="field">
      <span className="row between">
        <span>Session length</span>
        <span className="num">{minutes} min</span>
      </span>
      <input
        type="range"
        min={20}
        max={90}
        step={5}
        value={minutes}
        onChange={(e) => {
          const v = Number(e.target.value);
          setMinutes(v);
          updateProfile({ sessionMinutes: v });
        }}
      />
    </label>
  );
}

// ── Gyms ───────────────────────────────────────────────────────────────────

function GymsSection({ profile }: { profile: Profile }) {
  const titleId = useId();
  const radioName = useId();
  const gyms = useLiveQuery(async () => (await db.gyms.toArray()).sort((a, b) => a.name.localeCompare(b.name)));
  const [editing, setEditing] = useState<Gym | 'new' | null>(null);
  const close = useCallback(() => setEditing(null), []);
  if (!gyms) return null;

  return (
    <>
      <SectionTitle id={titleId}>Gyms</SectionTitle>
      <section className="card stack" aria-labelledby={titleId}>
        <p className="faint small">Workouts are built from the equipment at your active gym.</p>
        {gyms.length > 0 && (
          <div className="list" role="radiogroup" aria-label="Active gym">
            {gyms.map((g) => (
              <div key={g.id} className="list-item" style={{ cursor: 'default' }}>
                <label className="row grow" style={{ gap: 12, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name={radioName}
                    checked={g.id === profile.activeGymId}
                    onChange={() => updateProfile({ activeGymId: g.id })}
                    style={radioStyle}
                  />
                  <span className="grow">
                    <strong style={{ display: 'block' }}>{g.name}</strong>
                    <span className="faint small">{equipmentSummary(g.equipment)}</span>
                  </span>
                </label>
                <button type="button" className="btn sm" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn block" onClick={() => setEditing('new')}>
          <Icon name="plus" size={18} />
          Add gym
        </button>
      </section>

      <Sheet open={editing !== null} onClose={close} title={editing === 'new' ? 'Add gym' : 'Edit gym'}>
        {editing !== null && (
          <GymEditor
            key={editing === 'new' ? 'new' : editing.id}
            gym={editing === 'new' ? null : editing}
            gyms={gyms}
            activeGymId={profile.activeGymId}
            onDone={close}
          />
        )}
      </Sheet>
    </>
  );
}

function GymEditor({
  gym,
  gyms,
  activeGymId,
  onDone,
}: {
  gym: Gym | null;
  gyms: Gym[];
  activeGymId: string;
  onDone: () => void;
}) {
  const [name, setName] = useState(gym?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment[]>(gym?.equipment ?? []);
  const equipmentLabel = useId();
  const others = gyms.filter((g) => g.id !== gym?.id);

  const toggle = (e: Equipment) => setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  const applyPreset = (preset: (typeof GYM_PRESETS)[number]) => {
    setEquipment(preset.equipment);
    if (!name.trim() || GYM_PRESETS.some((p) => p.name === name)) setName(preset.name);
  };

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ordered = ALL_EQUIPMENT.filter((e) => equipment.includes(e));
    if (gym) await db.gyms.update(gym.id, { name: trimmed, equipment: ordered });
    else await db.gyms.add({ id: uid(), name: trimmed, equipment: ordered });
    onDone();
  };

  const remove = async () => {
    const next = others[0];
    if (!gym || !next) return;
    if (!confirm(`Delete “${gym.name}”?`)) return;
    await db.transaction('rw', db.gyms, db.profile, async () => {
      await db.gyms.delete(gym.id);
      if (activeGymId === gym.id) await db.profile.update('me', { activeGymId: next.id });
    });
    onDone();
  };

  return (
    <form className="stack lg" onSubmit={save}>
      <label className="field">
        <span>Name</span>
        <input className="input" type="text" value={name} placeholder="e.g. Home gym" onChange={(e) => setName(e.target.value)} />
      </label>

      {!gym && (
        <div className="field">
          <span>Start from a preset</span>
          <div className="chips wrap">
            {GYM_PRESETS.map((p) => (
              <button key={p.name} type="button" className="chip" onClick={() => applyPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <span id={equipmentLabel}>Equipment</span>
        <div className="chips wrap" role="group" aria-labelledby={equipmentLabel}>
          {ALL_EQUIPMENT.map((e) => (
            <button key={e} type="button" className="chip" aria-pressed={equipment.includes(e)} onClick={() => toggle(e)}>
              {EQUIPMENT_LABEL[e]}
            </button>
          ))}
        </div>
        {!equipment.length && <p className="faint small">No equipment selected — workouts will be bodyweight only.</p>}
      </div>

      <button type="submit" className="btn primary block" disabled={!name.trim()}>
        {gym ? 'Save' : 'Add gym'}
      </button>
      {gym && (
        <div className="stack">
          <button type="button" className="btn danger block" disabled={!others.length} onClick={remove}>
            <Icon name="trash" size={18} />
            Delete gym
          </button>
          {!others.length && <p className="faint small center">You need at least one gym.</p>}
        </div>
      )}
    </form>
  );
}

// ── AI coach ───────────────────────────────────────────────────────────────

function AiSection({ profile }: { profile: Profile }) {
  const titleId = useId();
  const keyId = useId();
  const [apiKey, setApiKey] = useState(profile.ai?.apiKey ?? '');
  const [model, setModel] = useState(profile.ai?.model ?? DEFAULT_MODEL);
  const [show, setShow] = useState(false);

  const save = (key: string, m: string) => {
    const k = key.trim();
    updateProfile({ ai: k || m !== DEFAULT_MODEL ? { apiKey: k, model: m } : undefined });
  };

  const saved = !!profile.ai?.apiKey;
  const trimmed = apiKey.trim();
  const suspicious = trimmed !== '' && !trimmed.startsWith('sk-ant-');

  return (
    <>
      <SectionTitle id={titleId}>AI coach</SectionTitle>
      <section className="card stack lg" aria-labelledby={titleId}>
        <div className="stack">
          <div className="row between">
            <strong>Optional</strong>
            <span className={saved ? 'badge accent' : 'badge'}>{saved ? 'Key saved' : 'Off'}</span>
          </div>
          <p className="muted small">
            The coach chat uses your own Anthropic API key, billed to your Anthropic account. The key is stored only on this device and is
            sent only to api.anthropic.com. Everything else works without it.
          </p>
          <a className="small" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
            Get an API key from the Anthropic Console
          </a>
        </div>

        <div className="field">
          <span>
            <label htmlFor={keyId}>Anthropic API key</label>
          </span>
          <div className="row">
            <input
              id={keyId}
              className="input grow"
              type={show ? 'text' : 'password'}
              value={apiKey}
              placeholder="sk-ant-…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => {
                setApiKey(e.target.value);
                save(e.target.value, model);
              }}
            />
            <button type="button" className="btn sm" aria-pressed={show} onClick={() => setShow((s) => !s)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          {suspicious && (
            <p className="small" style={{ color: 'var(--warning)' }}>
              That doesn't look like an Anthropic API key — they start with “sk-ant-”.
            </p>
          )}
        </div>

        <label className="field">
          <span>Model</span>
          <select
            className="input"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              save(apiKey, e.target.value);
            }}
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
          </select>
        </label>

        {(saved || apiKey !== '') && (
          <button
            type="button"
            className="btn danger block"
            onClick={() => {
              setApiKey('');
              setShow(false);
              save('', model);
            }}
          >
            Remove key
          </button>
        )}
      </section>
    </>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────

function AppearanceSection() {
  const titleId = useId();
  const [theme, setThemePref] = useState<ThemePref>(getTheme);
  return (
    <>
      <SectionTitle id={titleId}>Appearance</SectionTitle>
      <section className="card" aria-labelledby={titleId}>
        <Segmented
          label="Theme"
          value={theme}
          options={THEMES}
          onChange={(t) => {
            setTheme(t);
            setThemePref(t);
          }}
        />
      </section>
    </>
  );
}

// ── Your data ──────────────────────────────────────────────────────────────

type Status = { kind: 'ok' | 'error'; text: string } | null;

function DataSection({ profile, onRestored }: { profile: Profile; onRestored: () => void }) {
  const titleId = useId();
  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [strongUnit, setStrongUnit] = useState<Units>(profile.units);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);
  const closeSummary = useCallback(() => setSummary(null), []);

  const run = async (task: () => Promise<Status>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus(await task());
    } finally {
      setBusy(false);
    }
  };

  const exportJson = () =>
    run(async () => {
      try {
        download(`overload-backup-${dayKey(Date.now())}.json`, await exportBackup(), 'application/json');
        return null;
      } catch (err) {
        return { kind: 'error', text: `Couldn't export: ${errorText(err)}` };
      }
    });

  const exportSets = () =>
    run(async () => {
      try {
        download(`overload-sets-${dayKey(Date.now())}.csv`, await exportCsv(), 'text/csv');
        return null;
      } catch (err) {
        return { kind: 'error', text: `Couldn't export: ${errorText(err)}` };
      }
    });

  const onRestoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (!confirm('Restore this backup? It replaces ALL data on this device — workouts, gyms, activities and profile.')) return;
    await run(async () => {
      try {
        const result = await restoreBackup(await file.text());
        onRestored();
        return {
          kind: 'ok',
          text: `Backup restored — ${result.workouts} workout${result.workouts === 1 ? '' : 's'}.`,
        };
      } catch (err) {
        return { kind: 'error', text: `Couldn't restore: ${errorText(err)}` };
      }
    });
  };

  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    await run(async () => {
      try {
        setSummary(await importWorkoutCsv(await file.text(), strongUnit));
        return null;
      } catch (err) {
        return { kind: 'error', text: `Couldn't import: ${errorText(err)}` };
      }
    });
  };

  return (
    <>
      <SectionTitle id={titleId}>Your data</SectionTitle>
      <section className="card stack lg" aria-labelledby={titleId}>
        <div className="stack">
          <button type="button" className="btn block" disabled={busy} onClick={exportJson}>
            <Icon name="download" size={18} />
            Export backup (JSON)
          </button>
          <button type="button" className="btn block" disabled={busy} onClick={exportSets}>
            <Icon name="download" size={18} />
            Export sets (CSV)
          </button>
          <button type="button" className="btn block" disabled={busy} onClick={() => restoreRef.current?.click()}>
            <Icon name="upload" size={18} />
            Restore backup
          </button>
          <p className="faint small">Backups include everything except your API key.</p>
          <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={onRestoreFile} />
        </div>

        <div className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <Segmented label="Strong exports weights in" value={strongUnit} options={UNITS} onChange={setStrongUnit} />
          <p className="faint small">Strong CSVs don't say which unit they use. Hevy files do, so this is ignored for them.</p>
          <button type="button" className="btn block" disabled={busy} onClick={() => importRef.current?.click()}>
            <Icon name="upload" size={18} />
            Import from Strong / Hevy
          </button>
          <input ref={importRef} type="file" accept=".csv,text/csv" hidden onChange={onImportFile} />
        </div>

        {busy && (
          <p className="muted small" role="status">
            Working…
          </p>
        )}
        {status && (
          <p
            className="small"
            role={status.kind === 'error' ? 'alert' : 'status'}
            style={{ color: status.kind === 'error' ? 'var(--danger)' : 'var(--text-2)' }}
          >
            {status.text}
          </p>
        )}
      </section>

      <Sheet open={summary !== null} onClose={closeSummary} title="Import complete">
        {summary && <ImportSummary summary={summary} onDone={closeSummary} />}
      </Sheet>
    </>
  );
}

const MAX_WARNINGS = 20;

function ImportSummary({ summary, onDone }: { summary: CsvImportSummary; onDone: () => void }) {
  const { format, imported, skipped, newExercises, warnings } = summary;
  return (
    <div className="stack lg">
      <p className="muted">Read a {FORMAT_LABEL[format] ?? format} export.</p>
      <div className="stats">
        <div className="stat">
          <span className="value">{imported}</span>
          <span className="label">workouts imported</span>
        </div>
        <div className="stat">
          <span className="value">{skipped}</span>
          <span className="label">duplicates skipped</span>
        </div>
        <div className="stat">
          <span className="value">{newExercises.length}</span>
          <span className="label">new exercises</span>
        </div>
      </div>
      {skipped > 0 && <p className="faint small">Skipped workouts were already in your history.</p>}

      {newExercises.length > 0 && (
        <div className="stack">
          <h3>New custom exercises</h3>
          <p className="faint small">
            These didn't match the library, so they were added as custom exercises with a best guess at the muscles they work.
          </p>
          <div className="row wrap">
            {newExercises.map((n) => (
              <span key={n} className="badge">
                {n}
              </span>
            ))}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="stack">
          <h3>Warnings</h3>
          <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.slice(0, MAX_WARNINGS).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {warnings.length > MAX_WARNINGS && <p className="faint small">…and {warnings.length - MAX_WARNINGS} more.</p>}
        </div>
      )}

      <button type="button" className="btn primary block" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

// ── Danger zone ────────────────────────────────────────────────────────────

function DangerSection() {
  const titleId = useId();
  const erase = async () => {
    if (!confirm('Erase ALL data on this device? Workouts, gyms, profile and API key will be deleted. This cannot be undone.')) return;
    await db.delete();
    location.reload();
  };
  return (
    <>
      <SectionTitle id={titleId}>Danger zone</SectionTitle>
      <section className="card stack" aria-labelledby={titleId}>
        <p className="faint small">Export a backup first if you might want your history back.</p>
        <button type="button" className="btn danger block" onClick={erase}>
          <Icon name="trash" size={18} />
          Erase all data
        </button>
      </section>
    </>
  );
}

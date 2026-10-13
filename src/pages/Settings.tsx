import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { exportBackup, exportCsv, importWorkoutCsv, restoreBackup, type CsvImportSummary } from '../db/backup';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, GYM_PRESETS, db } from '../db/db';
import { eraseAll } from '../db/demo';
import { formatWeight, formatWeightWhole, fromDisplay } from '../engine/load';
import type { Equipment, Experience, Goal, Gym, Profile, Sex, Units } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { download, formatDate, useProfile } from '../hooks';
import { getTheme, setTheme, type ThemePref } from '../theme';
import { haptics } from '../ui/haptics';
import { toast } from '../ui/toast';
import './Settings.css';

// ── Options ────────────────────────────────────────────────────────────────

interface Option<T> {
  value: T;
  title: string;
  body: string;
}

const GOALS: Option<Goal>[] = [
  { value: 'hypertrophy', title: 'Hypertrophy', body: 'Build muscle. Moderate weights, 6–15 reps, more weekly volume.' },
  { value: 'strength', title: 'Strength', body: 'Lift heavier. Big compounds, 3–6 reps, longer rest.' },
  { value: 'general', title: 'General fitness', body: 'Balanced, efficient sessions that fit around life.' },
  { value: 'endurance', title: 'Muscular endurance', body: 'Higher reps and short rest. Pairs well with running or sport.' },
];

const EXPERIENCE: Option<Experience>[] = [
  { value: 'beginner', title: 'Beginner', body: 'Under a year of consistent training.' },
  { value: 'intermediate', title: 'Intermediate', body: '1–3 years and comfortable with the main lifts.' },
  { value: 'advanced', title: 'Advanced', body: '3+ years. Progress now comes slowly.' },
];

const UNITS: Option<Units>[] = [
  { value: 'kg', title: 'Kilograms', body: 'Plates, bars and bodyweight in kg.' },
  { value: 'lb', title: 'Pounds', body: 'Plates, bars and bodyweight in lb.' },
];

const STANDARDS: { value: Sex; label: string }[] = [
  { value: 'male', label: 'Men’s' },
  { value: 'female', label: 'Women’s' },
  { value: 'unspecified', label: 'Blended' },
];

const THEMES: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Mirrors src/ai/coach.ts, which isn't imported here so the Anthropic SDK stays out of the main bundle.
const DEFAULT_MODEL = 'claude-opus-5-5';
const MODELS: { id: string; name: string; note: string }[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Best coaching (default)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Faster, cheaper' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Cheapest' },
];

const FORMAT_LABEL: Record<string, string> = { strong: 'Strong', hevy: 'Hevy' };
const MAX_WARNINGS = 20;
const SOURCE_URL = 'https://github.com/fogz-lgtm/Overload';
const KEYS_URL = 'https://console.anthropic.com/settings/keys';

// ── Helpers ────────────────────────────────────────────────────────────────

const titleOf = <T,>(options: Option<T>[], value: T) => options.find((o) => o.value === value)?.title ?? String(value);
const modelName = (id: string) => MODELS.find((m) => m.id === id)?.name ?? id;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function splitText(days: number): string {
  if (days <= 3) return 'Full-body sessions.';
  if (days === 4) return 'An upper / lower split.';
  return 'A push / pull / legs rotation.';
}

async function saveProfile(patch: Partial<Profile>, message: string): Promise<void> {
  await db.profile.update('me', patch);
  haptics.tap();
  toast(message, { icon: 'check', tone: 'accent' });
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
  const shown = labels.slice(0, 2).join(', ');
  return labels.length > 2 ? `${shown} +${labels.length - 2}` : shown;
}

/**
 * Closes the open Sheet with its slide-down animation. Sheet only animates when it closes itself,
 * and it already listens for Escape, so we ask it the same way a keyboard would.
 */
function dismissSheet(delay = 0): void {
  setTimeout(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })), delay);
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

// ── Building blocks ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="set-section" aria-labelledby={id}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function RowBody({ icon, label, sub, value, trail = 'chevron', tone }: RowProps) {
  return (
    <>
      <span className={`row-icon${tone ? ` set-icon-${tone}` : ''}`}>
        <Icon name={icon} size={17} />
      </span>
      <span className="set-row-text">
        <span className="set-row-label">{label}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      {value !== undefined && <span className="value set-value">{value}</span>}
      {trail === 'chevron' && (
        <span className="set-trail">
          <Icon name="chevron" size={17} />
        </span>
      )}
      {trail === 'external' && (
        <span className="set-trail">
          <Icon name="external" size={16} />
        </span>
      )}
      {trail === 'busy' && <span className="set-spinner" aria-hidden="true" />}
    </>
  );
}

interface RowProps {
  icon: IconName;
  label: string;
  sub?: ReactNode;
  value?: ReactNode;
  trail?: 'chevron' | 'external' | 'busy' | 'none';
  tone?: 'danger';
}

function Row({ onClick, disabled, ...props }: RowProps & { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`group-row set-row${props.tone ? ` ${props.tone}` : ''}`} onClick={onClick} disabled={disabled}>
      <RowBody {...props} />
    </button>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function OptionCards<T extends string>({ options, value, onPick }: { options: Option<T>[]; value: T; onPick: (v: T) => void }) {
  return (
    <div className="stack">
      {options.map((o) => (
        <button key={o.value} type="button" className="option-card set-option" aria-pressed={o.value === value} onClick={() => onPick(o.value)}>
          <span className="grow">
            <strong>{o.title}</strong>
            <span>{o.body}</span>
          </span>
          <span className="set-radio" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** Destructive button that needs a second tap within a few seconds. */
function ConfirmButton({ label, armedLabel, onConfirm, disabled }: { label: string; armedLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`btn danger block set-confirm${armed ? ' armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        haptics.tap();
        if (armed) onConfirm();
        else setArmed(true);
      }}
    >
      <Icon name="trash" size={18} />
      <span aria-live="polite">{armed ? armedLabel : label}</span>
    </button>
  );
}

function InlineError({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p className="set-error small" role="alert">
      <Icon name="info" size={16} />
      {text}
    </p>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

type Panel = 'profile' | 'goal' | 'experience' | 'days' | 'length' | 'units' | 'ai' | 'fresh';

export function Settings() {
  const profile = useProfile();
  const goBack = useGoBack('/');
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = useCallback(() => setPanel(null), []);
  if (!profile) return null;

  const initial = profile.name.trim().charAt(0).toUpperCase();
  const connected = !!profile.ai?.apiKey;

  return (
    <div className="page set">
      <header className="page-header set-header">
        <button type="button" className="icon-btn" aria-label="Back" onClick={goBack}>
          <Icon name="back" />
        </button>
        <h1 className="grow">Settings</h1>
      </header>

      <button type="button" className="card interactive set-profile" onClick={() => setPanel('profile')}>
        <span className="sr-only">Edit profile: </span>
        <span className="set-avatar" aria-hidden="true">
          {initial || <Icon name="user" size={26} />}
        </span>
        <span className="grow">
          <span className="set-profile-name">{profile.name.trim() || 'Add your name'}</span>
          <span className="set-profile-sub">
            <span>{titleOf(GOALS, profile.goal)}</span> · <span>{titleOf(EXPERIENCE, profile.experience)}</span> ·{' '}
            <span className="num">{profile.daysPerWeek} days/week</span>
          </span>
          <span className="set-profile-meta num">
            {formatWeightWhole(profile.bodyweightKg, profile.units)} · {STANDARDS.find((s) => s.value === profile.sex)?.label} standards
          </span>
        </span>
        <span className="set-trail">
          <Icon name="chevron" size={18} />
        </span>
      </button>

      {profile.demo && (
        <section className="card hero set-demo" aria-labelledby="set-demo-title">
          <div className="set-demo-head">
            <span className="set-demo-icon" aria-hidden="true">
              <Icon name="sparkle" size={20} />
            </span>
            <div className="grow stack">
              <div className="stack xs">
                <h2 id="set-demo-title">You're exploring sample data</h2>
                <p className="small muted">Eight weeks of simulated training so you can look around. Start fresh when you're ready to log your own.</p>
              </div>
              <button type="button" className="btn primary sm set-demo-btn" onClick={() => setPanel('fresh')}>
                Start fresh
              </button>
            </div>
          </div>
        </section>
      )}

      <Section title="Training">
        <div className="group">
          <Row icon="target" label="Goal" value={titleOf(GOALS, profile.goal)} onClick={() => setPanel('goal')} />
          <Row icon="medal" label="Experience" value={titleOf(EXPERIENCE, profile.experience)} onClick={() => setPanel('experience')} />
          <Row icon="calendar" label="Days per week" value={<span className="num">{profile.daysPerWeek} days</span>} onClick={() => setPanel('days')} />
          <Row icon="clock" label="Session length" value={<span className="num">{profile.sessionMinutes} min</span>} onClick={() => setPanel('length')} />
          <Row icon="scale" label="Units" value={profile.units === 'kg' ? 'Kilograms' : 'Pounds'} onClick={() => setPanel('units')} />
        </div>
      </Section>

      <GymsSection activeGymId={profile.activeGymId} />

      <Section title="AI coach">
        <div className="group">
          <Row
            icon="sparkle"
            label="Coach"
            sub={
              connected ? (
                <span className="set-status on">Connected · {modelName(profile.ai?.model ?? DEFAULT_MODEL)}</span>
              ) : (
                <span className="set-status">Off · add your Anthropic API key</span>
              )
            }
            onClick={() => setPanel('ai')}
          />
        </div>
      </Section>

      <AppearanceSection />

      <DataSection units={profile.units} />

      <Section title="About">
        <div className="group">
          <p className="set-about small">
            Overload is open source (MIT) and local-first. Your training data never leaves this device unless you export it or use the AI coach.
          </p>
          <a className="group-row set-row" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
            <RowBody icon="github" label="Source on GitHub" trail="external" />
          </a>
          <div className="group-row set-row set-static">
            <RowBody icon="info" label="Build" value={<span className="num set-build">{__BUILD_ID__}</span>} trail="none" />
          </div>
        </div>
      </Section>

      <EraseSection />

      {panel === 'profile' && <ProfileSheet profile={profile} onClose={close} />}
      {panel === 'goal' && (
        <Sheet open onClose={close} title="Goal" subtitle="Shapes rep ranges, rest and weekly volume.">
          <OptionCards
            options={GOALS}
            value={profile.goal}
            onPick={(goal) => {
              void saveProfile({ goal }, `Goal set to ${titleOf(GOALS, goal).toLowerCase()}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
      {panel === 'experience' && (
        <Sheet open onClose={close} title="Experience" subtitle="Sets how fast loads progress and how technical exercises get.">
          <OptionCards
            options={EXPERIENCE}
            value={profile.experience}
            onPick={(experience) => {
              void saveProfile({ experience }, `Experience set to ${experience}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
      {panel === 'days' && <DaysSheet days={profile.daysPerWeek} onClose={close} />}
      {panel === 'length' && <LengthSheet minutes={profile.sessionMinutes} onClose={close} />}
      {panel === 'units' && (
        <Sheet open onClose={close} title="Units" subtitle="Everything is stored precisely, so switching never loses data.">
          <OptionCards
            options={UNITS}
            value={profile.units}
            onPick={(units) => {
              void saveProfile({ units }, `Units set to ${units === 'kg' ? 'kilograms' : 'pounds'}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
      {panel === 'ai' && <AiSheet profile={profile} onClose={close} />}
      {panel === 'fresh' && (
        <Sheet open onClose={close} title="Start fresh?" subtitle="Clears the sample data and takes you to setup.">
          <div className="stack lg">
            <p className="muted">Anything you logged while exploring is cleared too. Your theme choice stays.</p>
            <button type="button" className="btn primary block lg" onClick={() => void eraseAll()}>
              Start fresh
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const ids = useId();
  const [name, setName] = useState(profile.name);
  const [weight, setWeight] = useState(() => formatWeight(profile.bodyweightKg, profile.units, false));
  const [sex, setSex] = useState<Sex>(profile.sex);
  const [touched, setTouched] = useState(false);
  const units = profile.units;
  const value = parseFloat(weight);
  const kg = fromDisplay(value, units);
  const valid = Number.isFinite(value) && kg >= 20 && kg <= 400;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    await saveProfile({ name: name.trim(), bodyweightKg: kg, sex }, 'Profile saved');
    dismissSheet();
  };

  return (
    <Sheet open onClose={onClose} title="Profile">
      <form className="stack lg" onSubmit={save} noValidate>
        <label className="field">
          <span>Name</span>
          <input className="input" type="text" autoComplete="given-name" value={name} placeholder="Your name" maxLength={40} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Bodyweight</span>
          <span className="set-unit-input">
            <input
              className="input num"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.1}
              value={weight}
              aria-invalid={touched && !valid}
              aria-describedby={`${ids}-bw`}
              onChange={(e) => setWeight(e.target.value)}
              onBlur={() => setTouched(true)}
            />
            <span className="set-unit" aria-hidden="true">
              {units}
            </span>
          </span>
          {touched && !valid ? (
            <small id={`${ids}-bw`} className="small set-invalid">
              Enter a weight between {formatWeight(20, units)} and {formatWeight(400, units)}.
            </small>
          ) : (
            <small id={`${ids}-bw`} className="small faint">
              Seeds first-session weights and scales your strength score.
            </small>
          )}
        </label>
        <div className="field">
          <span>Strength standards</span>
          <Segmented label="Strength standards" value={sex} options={STANDARDS} onChange={setSex} />
          <small className="small faint">Only used to compare your lifts with other lifters.</small>
        </div>
        <button type="submit" className="btn primary block lg">
          Save
        </button>
      </form>
    </Sheet>
  );
}

// ── Training sheets ────────────────────────────────────────────────────────

function DaysSheet({ days, onClose }: { days: number; onClose: () => void }) {
  const [shown, setShown] = useState(days);
  return (
    <Sheet open onClose={onClose} title="Days per week" subtitle="The order adapts to whatever you've recovered from.">
      <div className="stack lg">
        <div className="set-days" role="group" aria-label="Days per week">
          {[2, 3, 4, 5, 6].map((d) => (
            <button
              key={d}
              type="button"
              className="set-day"
              aria-pressed={shown === d}
              onClick={() => {
                setShown(d);
                void saveProfile({ daysPerWeek: d }, `Training ${d} days a week`);
                dismissSheet(420);
              }}
            >
              <span className="display">{d}</span>
              <span className="set-day-unit">days</span>
            </button>
          ))}
        </div>
        <p className="muted center set-days-note" key={shown}>
          {splitText(shown)}
        </p>
      </div>
    </Sheet>
  );
}

function LengthSheet({ minutes, onClose }: { minutes: number; onClose: () => void }) {
  const [value, setValue] = useState(minutes);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const pct = ((value - 20) / (90 - 20)) * 100;

  const change = (v: number) => {
    setValue(v);
    void db.profile.update('me', { sessionMinutes: v });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => toast(`Sessions set to ${v} min`, { icon: 'check', tone: 'accent' }), 700);
  };

  return (
    <Sheet open onClose={onClose} title="Session length" subtitle="Workouts are built to fit, warm-ups included.">
      <div className="stack lg set-length">
        <div className="set-length-hero" aria-hidden="true">
          <span className="display">{value}</span>
          <span className="set-length-unit">min</span>
        </div>
        <div className="stack xs">
          <input
            type="range"
            min={20}
            max={90}
            step={5}
            value={value}
            aria-label="Session length in minutes"
            aria-valuetext={`${value} minutes`}
            onChange={(e) => change(Number(e.target.value))}
            style={{ '--fill': `${pct}%` } as CSSProperties}
          />
          <div className="row between small faint num">
            <span>20 min</span>
            <span>90 min</span>
          </div>
        </div>
        <div className="chips wrap set-length-presets" role="group" aria-label="Presets">
          {[30, 45, 60, 75].map((m) => (
            <button key={m} type="button" className="chip" aria-pressed={value === m} onClick={() => change(m)}>
              {m} min
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

// ── Gyms ───────────────────────────────────────────────────────────────────

function GymsSection({ activeGymId }: { activeGymId: string }) {
  const gyms = useLiveQuery(async () => (await db.gyms.toArray()).sort((a, b) => a.name.localeCompare(b.name)));
  const [editing, setEditing] = useState<Gym | 'new' | null>(null);
  const close = useCallback(() => setEditing(null), []);
  if (!gyms) return null;

  const select = (g: Gym) => {
    if (g.id === activeGymId) return;
    void saveProfile({ activeGymId: g.id }, `Training at ${g.name}`);
  };

  return (
    <Section title="Gyms">
      <div className="group">
        {gyms.map((g) => {
          const active = g.id === activeGymId;
          return (
            <div key={g.id} className={`set-gym${active ? ' active' : ''}`}>
              <button type="button" className="group-row set-row" aria-pressed={active} onClick={() => select(g)}>
                <RowBody icon="gym" label={g.name} sub={active ? `Active · ${equipmentSummary(g.equipment)}` : equipmentSummary(g.equipment)} trail="none" />
                <span className="set-check" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              </button>
              <button type="button" className="set-gym-edit" aria-label={`Edit ${g.name}`} onClick={() => setEditing(g)}>
                Edit
              </button>
            </div>
          );
        })}
        <button type="button" className="group-row set-row set-add" onClick={() => setEditing('new')}>
          <span className="row-icon">
            <Icon name="plus" size={17} />
          </span>
          <span className="set-row-label">Add gym</span>
        </button>
      </div>
      <p className="set-footnote small">Workouts only use equipment at your active gym. Tap a gym to switch.</p>

      {editing !== null && (
        <Sheet open onClose={close} title={editing === 'new' ? 'Add gym' : 'Edit gym'} subtitle={editing === 'new' ? 'Start from a preset, then fine-tune.' : undefined}>
          <GymEditor gym={editing === 'new' ? null : editing} gyms={gyms} activeGymId={activeGymId} />
        </Sheet>
      )}
    </Section>
  );
}

function GymEditor({ gym, gyms, activeGymId }: { gym: Gym | null; gyms: Gym[]; activeGymId: string }) {
  const [name, setName] = useState(gym?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment[]>(gym?.equipment ?? []);
  const [preset, setPreset] = useState<string | null>(null);
  const equipmentLabel = useId();
  const others = gyms.filter((g) => g.id !== gym?.id);

  const toggle = (e: Equipment) => {
    setPreset(null);
    setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  };

  const applyPreset = (p: (typeof GYM_PRESETS)[number]) => {
    haptics.tap();
    setPreset(p.name);
    setEquipment(p.equipment);
    if (!name.trim() || GYM_PRESETS.some((x) => x.name === name)) setName(p.name);
  };

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    const ordered = ALL_EQUIPMENT.filter((e) => equipment.includes(e));
    if (gym) await db.gyms.update(gym.id, { name: trimmed, equipment: ordered });
    else await db.gyms.add({ id: uid(), name: trimmed, equipment: ordered });
    haptics.success();
    toast(gym ? `${trimmed} saved` : `${trimmed} added`, { icon: 'check', tone: 'accent' });
    dismissSheet();
  };

  const remove = async () => {
    const next = others[0];
    if (!gym || !next) return;
    await db.transaction('rw', db.gyms, db.profile, async () => {
      await db.gyms.delete(gym.id);
      if (activeGymId === gym.id) await db.profile.update('me', { activeGymId: next.id });
    });
    toast(`${gym.name} deleted`, { icon: 'trash' });
    dismissSheet();
  };

  return (
    <form className="stack lg" onSubmit={save}>
      {!gym && (
        <div className="set-presets" role="group" aria-label="Presets">
          {GYM_PRESETS.map((p) => (
            <button key={p.name} type="button" className="option-card set-preset" aria-pressed={preset === p.name} onClick={() => applyPreset(p)}>
              <strong>{p.name}</strong>
              <span className="num">{p.equipment.length === ALL_EQUIPMENT.length ? 'Everything' : plural(p.equipment.length, 'item')}</span>
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <span>Name</span>
        <input className="input" type="text" value={name} placeholder="e.g. Home gym" maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="field">
        <span id={equipmentLabel} className="set-field-head">
          Equipment
          <span className="num faint">
            {equipment.length} of {ALL_EQUIPMENT.length}
          </span>
        </span>
        <div className="chips wrap" role="group" aria-labelledby={equipmentLabel}>
          {ALL_EQUIPMENT.map((e) => (
            <button key={e} type="button" className="chip" aria-pressed={equipment.includes(e)} onClick={() => toggle(e)}>
              {EQUIPMENT_LABEL[e]}
            </button>
          ))}
        </div>
        {!equipment.length && <p className="faint small">Nothing selected, so workouts here will be bodyweight only.</p>}
      </div>

      <button type="submit" className="btn primary block lg" disabled={!name.trim()}>
        {gym ? 'Save gym' : 'Add gym'}
      </button>
      {gym &&
        (others.length ? (
          <ConfirmButton label="Delete gym" armedLabel={`Tap again to delete ${gym.name}`} onConfirm={() => void remove()} />
        ) : (
          <p className="faint small center">You need at least one gym, so this one can't be deleted.</p>
        ))}
    </form>
  );
}

// ── AI coach ───────────────────────────────────────────────────────────────

function AiSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const keyId = useId();
  const savedKey = profile.ai?.apiKey ?? '';
  const savedModel = profile.ai?.model ?? DEFAULT_MODEL;
  const [apiKey, setApiKey] = useState(savedKey);
  const [model, setModel] = useState(savedModel);
  const [show, setShow] = useState(false);
  const trimmed = apiKey.trim();
  const dirty = trimmed !== savedKey || model !== savedModel;
  const suspicious = trimmed !== '' && !trimmed.startsWith('sk-ant-');

  const persist = (key: string, m: string) => db.profile.update('me', { ai: key || m !== DEFAULT_MODEL ? { apiKey: key, model: m } : undefined });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await persist(trimmed, model);
    haptics.success();
    toast(trimmed ? `Coach connected · ${modelName(model)}` : 'Coach settings saved', { icon: 'check', tone: 'accent' });
    dismissSheet();
  };

  const remove = async () => {
    setApiKey('');
    setShow(false);
    await persist('', model);
    toast('API key removed', { icon: 'trash' });
  };

  return (
    <Sheet open onClose={onClose} title="AI coach" subtitle="Optional. Everything else works without it.">
      <form className="stack lg" onSubmit={save}>
        <div className="set-privacy">
          <Icon name="shield" size={20} />
          <p className="small">
            The coach uses your own Anthropic API key, billed to your Anthropic account. The key stays on this device and is sent only to{' '}
            <span className="set-mono">api.anthropic.com</span>.
          </p>
        </div>

        <div className="field">
          <span className="set-field-head">
            <label htmlFor={keyId}>API key</label>
            {savedKey && <span className="set-status on">Saved</span>}
          </span>
          <span className="set-key">
            <input
              id={keyId}
              className="input set-mono"
              type={show ? 'text' : 'password'}
              value={apiKey}
              placeholder="sk-ant-…"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button type="button" className="set-key-toggle" aria-pressed={show} aria-label={show ? 'Hide key' : 'Show key'} onClick={() => setShow((s) => !s)}>
              <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
            </button>
          </span>
          {suspicious ? (
            <small className="small set-warn">That doesn't look like an Anthropic key. They start with “sk-ant-”.</small>
          ) : (
            <a className="small set-link" href={KEYS_URL} target="_blank" rel="noopener noreferrer">
              Get a key from the Anthropic Console
              <Icon name="external" size={13} />
            </a>
          )}
        </div>

        <div className="field">
          <span>Model</span>
          <div className="stack">
            {MODELS.map((m) => (
              <button key={m.id} type="button" className="option-card set-option compact" aria-pressed={model === m.id} onClick={() => setModel(m.id)}>
                <span className="grow">
                  <strong>{m.name}</strong>
                  <span>{m.note}</span>
                </span>
                <span className="set-radio" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              </button>
            ))}
            {!MODELS.some((m) => m.id === model) && <p className="faint small">Using custom model “{model}”.</p>}
          </div>
        </div>

        <div className="stack">
          <button type="submit" className="btn primary block lg" disabled={!dirty}>
            {trimmed && trimmed !== savedKey ? 'Save key' : 'Save'}
          </button>
          {(savedKey || apiKey) && (
            <button type="button" className="btn ghost danger block" onClick={() => void remove()}>
              Remove key
            </button>
          )}
        </div>
      </form>
    </Sheet>
  );
}

// ── Appearance ─────────────────────────────────────────────────────────────

function AppearanceSection() {
  const [theme, setThemePref] = useState<ThemePref>(getTheme);
  return (
    <Section title="Appearance">
      <div className="group">
        <div className="group-row set-row set-static set-theme">
          <span className="row-icon">
            <Icon name="palette" size={17} />
          </span>
          <span className="set-row-label grow">Theme</span>
          <Segmented
            label="Theme"
            value={theme}
            options={THEMES}
            className="set-seg-compact"
            onChange={(t) => {
              haptics.tap();
              setTheme(t);
              setThemePref(t);
            }}
          />
        </div>
      </div>
    </Section>
  );
}

// ── Your data ──────────────────────────────────────────────────────────────

interface PendingRestore {
  file: string;
  text: string;
  workouts: number;
  exportedAt: number | null;
}

/** Reads enough of a backup to describe it before anything is replaced. */
function inspectBackup(file: string, text: string): PendingRestore {
  const data: unknown = JSON.parse(text);
  const d = (typeof data === 'object' && data !== null ? data : {}) as { app?: unknown; workouts?: unknown; exportedAt?: unknown };
  if (d.app !== 'overload') throw new Error('Not an Overload backup file');
  const at = typeof d.exportedAt === 'string' ? Date.parse(d.exportedAt) : NaN;
  return { file, text, workouts: Array.isArray(d.workouts) ? d.workouts.length : 0, exportedAt: Number.isFinite(at) ? at : null };
}

function DataSection({ units }: { units: Units }) {
  const restoreRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'json' | 'csv' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [importing, setImporting] = useState(false);
  const closeRestore = useCallback(() => setPending(null), []);
  const closeImport = useCallback(() => setImporting(false), []);

  const exportFile = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    setError(null);
    try {
      const stamp = dayKey(Date.now());
      if (kind === 'json') download(`overload-backup-${stamp}.json`, await exportBackup(), 'application/json');
      else download(`overload-sets-${stamp}.csv`, await exportCsv(), 'text/csv');
      toast(kind === 'json' ? 'Backup downloaded' : 'Sets downloaded', { icon: 'download', tone: 'accent' });
    } catch (err) {
      setError(`Couldn't export: ${errorText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const onRestoreFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setError(null);
    try {
      setPending(inspectBackup(file.name, await file.text()));
    } catch (err) {
      setError(`Couldn't restore: ${errorText(err)}`);
    }
  };

  return (
    <Section title="Your data">
      <div className="group">
        <Row
          icon="download"
          label="Export backup"
          sub="JSON · everything except your API key"
          trail={busy === 'json' ? 'busy' : 'none'}
          disabled={busy !== null}
          onClick={() => void exportFile('json')}
        />
        <Row
          icon="layers"
          label="Export sets"
          sub="CSV · one row per set, for spreadsheets"
          trail={busy === 'csv' ? 'busy' : 'none'}
          disabled={busy !== null}
          onClick={() => void exportFile('csv')}
        />
        <Row icon="upload" label="Restore backup" sub="Replace this device's data with a backup" trail="none" onClick={() => restoreRef.current?.click()} />
        <Row icon="repeat" label="Import from Strong or Hevy" sub="Bring in your workout history" onClick={() => setImporting(true)} />
      </div>
      <input ref={restoreRef} type="file" accept=".json,application/json" hidden onChange={onRestoreFile} />
      <InlineError text={error} />

      {pending && <RestoreSheet pending={pending} onClose={closeRestore} />}
      {importing && <ImportSheet defaultUnit={units} onClose={closeImport} />}
    </Section>
  );
}

function RestoreSheet({ pending, onClose }: { pending: PendingRestore; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await restoreBackup(pending.text);
      haptics.success();
      toast(`Backup restored · ${plural(result.workouts, 'workout')}`, { icon: 'check', tone: 'accent' });
      dismissSheet();
    } catch (err) {
      setError(`Couldn't restore: ${errorText(err)}`);
      setBusy(false);
    }
  };

  return (
    <Sheet open onClose={onClose} title="Restore this backup?" subtitle="It replaces everything on this device.">
      <div className="stack lg">
        <div className="set-file">
          <span className="row-icon">
            <Icon name="database" size={17} />
          </span>
          <span className="grow">
            <span className="set-row-label truncate">{pending.file}</span>
            <span className="set-row-sub num">
              {plural(pending.workouts, 'workout')}
              {pending.exportedAt !== null && ` · saved ${formatDate(pending.exportedAt, { month: 'short', day: 'numeric', year: 'numeric' })}`}
            </span>
          </span>
        </div>
        <p className="muted small">Your current workouts, gyms, activities and profile are replaced. Your API key and theme stay.</p>
        <InlineError text={error} />
        <button type="button" className="btn primary block lg" disabled={busy} onClick={() => void restore()}>
          {busy ? 'Restoring…' : 'Replace and restore'}
        </button>
      </div>
    </Sheet>
  );
}

function ImportSheet({ defaultUnit, onClose }: { defaultUnit: Units; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [unit, setUnit] = useState<Units>(defaultUnit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<CsvImportSummary | null>(null);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importWorkoutCsv(await file.text(), unit);
      setSummary(result);
      haptics.success();
      toast(`Imported ${plural(result.imported, 'workout')}`, { icon: 'check', tone: 'accent' });
    } catch (err) {
      setError(`Couldn't import: ${errorText(err)}`);
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    return (
      <Sheet open onClose={onClose} title="Import complete" subtitle={`Read a ${FORMAT_LABEL[summary.format] ?? summary.format} export.`}>
        <ImportSummary summary={summary} />
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="Import workouts" subtitle="From a Strong or Hevy CSV export.">
      <div className="stack lg">
        <ol className="set-steps small muted">
          <li>In Strong or Hevy, export your workout data as CSV.</li>
          <li>Choose the file here. Re-importing the same file is safe; duplicates are skipped.</li>
        </ol>
        <div className="field">
          <span>Strong exports weights in</span>
          <Segmented
            label="Strong exports weights in"
            value={unit}
            options={[
              { value: 'kg', label: 'kg' },
              { value: 'lb', label: 'lb' },
            ]}
            onChange={setUnit}
          />
          <small className="small faint">Strong files don't say which unit they use. Hevy files do, so this is ignored for them.</small>
        </div>
        <InlineError text={error} />
        <button type="button" className="btn primary block lg" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? (
            <>
              <span className="set-spinner" aria-hidden="true" />
              Importing…
            </>
          ) : (
            <>
              <Icon name="upload" size={18} />
              Choose CSV file
            </>
          )}
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={onFile} />
      </div>
    </Sheet>
  );
}

function ImportSummary({ summary }: { summary: CsvImportSummary }) {
  const { imported, skipped, newExercises, warnings } = summary;
  return (
    <div className="stack lg">
      <div className="stats set-stats">
        <div className="stat">
          <span className="value accent-text">{imported}</span>
          <span className="label">imported</span>
        </div>
        <div className="stat">
          <span className="value">{skipped}</span>
          <span className="label">already here</span>
        </div>
        <div className="stat">
          <span className="value">{newExercises.length}</span>
          <span className="label">new exercises</span>
        </div>
      </div>

      {newExercises.length > 0 && (
        <div className="stack">
          <h3>New custom exercises</h3>
          <p className="faint small">These didn't match the library, so they were added with a best guess at the muscles they work. You'll find them in Exercises.</p>
          <div className="row wrap set-badges">
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
          <ul className="muted small set-warnings">
            {warnings.slice(0, MAX_WARNINGS).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {warnings.length > MAX_WARNINGS && <p className="faint small">…and {warnings.length - MAX_WARNINGS} more.</p>}
        </div>
      )}

      <button type="button" className="btn primary block lg" onClick={() => dismissSheet()}>
        Done
      </button>
    </div>
  );
}

// ── Danger zone ────────────────────────────────────────────────────────────

function EraseSection() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Section title="Danger zone">
      <div className="group">
        <Row icon="trash" tone="danger" label="Erase all data" trail="none" onClick={() => setOpen(true)} />
      </div>
      {open && (
        <Sheet open onClose={close} title="Erase all data?" subtitle="This can't be undone.">
          <div className="stack lg">
            <ul className="set-erase-list">
              <li>Every workout, set and personal record</li>
              <li>Your gyms, custom exercises and favorites</li>
              <li>Your profile and AI coach key</li>
            </ul>
            <p className="muted small">Export a backup first if you might want your history back.</p>
            <ConfirmButton label="Erase all data" armedLabel="Tap again to erase everything" onConfirm={() => void eraseAll()} />
          </div>
        </Sheet>
      )}
    </Section>
  );
}

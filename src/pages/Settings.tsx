import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { cleanWeights, GymWeightsEditor } from '../components/GymWeights';
import { Sheet } from '../components/Sheet';
import { splitCadence, SplitSheet } from '../components/SplitSheet';
import { exportBackup, exportCsv, importWorkoutCsv, restoreBackup, type CsvImportSummary } from '../db/backup';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, GYM_PRESETS, db } from '../db/db';
import { eraseAll } from '../db/demo';
import { refreshPlan, saveSplit, saveTrainingDays } from '../db/repo';
import { splitDays, splitName } from '../engine/generator';
import { trainingDays, trainingDaysText, WEEKDAY_SHORT } from '../engine/schedule';
import { formatWeight, formatWeightWhole, fromDisplay } from '../engine/load';
import { goalScheme } from '../engine/progression';
import type { DropSetPolicy, Equipment, Experience, Goal, Gym, GymWeights, Profile, RestSound, Sex, Split, TrainingStyle, Units, WarmupPolicy } from '../engine/types';
import { dayKey, uid } from '../engine/util';
import { download, formatDate, useProfile } from '../hooks';
import { testSound } from '../audio/restAlert';
import { beginConnect, callbackDomain, codeFromPaste, disconnectStrava, finishConnect, isConnected, saveStravaApp, STRAVA_APPS_URL, syncStrava } from '../strava/client';
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

const SOUNDS: Option<RestSound>[] = [
  { value: 'ding', title: 'Ding', body: 'Plays over your music while Overload is open. On iPhone, the ringer switch has to be on.' },
  {
    value: 'lock',
    title: 'Ding, even when locked',
    body: 'Your rest counts down on the lock screen and dings on time, even on silent. Pauses music from other apps while you rest.',
  },
  { value: 'off', title: 'No sound', body: 'A vibration where the phone supports it, and a note on screen.' },
];
const SOUND_LABEL: Record<RestSound, string> = { ding: 'Ding', lock: 'Lock screen', off: 'Off' };

const WARMUPS: Option<WarmupPolicy>[] = [
  { value: 'main', title: 'Main lifts', body: 'Ramp-up sets before the first two heavy lifts, where they matter most.' },
  { value: 'first', title: 'First lift only', body: 'Ramp up once, on the first heavy lift of the session.' },
  { value: 'all', title: 'Every compound lift', body: 'Ramp up before every big lift. Adds a few minutes.' },
  { value: 'off', title: 'Off', body: 'Straight into working sets, for when you warm up your own way.' },
];

const DROPS: Option<DropSetPolicy>[] = [
  { value: 'off', title: 'Off', body: 'Straight sets only.' },
  { value: 'isolation', title: 'Isolation lifts', body: 'After the last set of curls, raises, flyes and extensions: strip about a quarter of the weight and keep going.' },
  { value: 'most', title: 'Isolation and machines', body: 'Also on machine, cable and dumbbell presses and rows. Never on barbell lifts.' },
];

const REST_COMPOUND = [60, 90, 120, 150, 180, 240];
const REST_ISOLATION = [45, 60, 75, 90, 120];

/** 1:30, 2:00. */
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

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

const FORMAT_LABEL: Record<string, string> = { gravl: 'Gravl', strong: 'Strong', hevy: 'Hevy', strava: 'Strava' };
const MAX_WARNINGS = 20;
const SOURCE_URL = 'https://github.com/fogz-lgtm/Overload';
const KEYS_URL = 'https://console.anthropic.com/settings/keys';

// ── Helpers ────────────────────────────────────────────────────────────────

const titleOf = <T,>(options: Option<T>[], value: T) => options.find((o) => o.value === value)?.title ?? String(value);
const modelName = (id: string) => MODELS.find((m) => m.id === id)?.name ?? id;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function splitText(days: number, split: Split | undefined): string {
  if (split?.days.length) return splitCadence(split.days.length, days);
  if (days <= 3) return 'Full-body sessions.';
  if (days === 4) return 'An upper / lower split.';
  return 'A push / pull / legs rotation.';
}

/** Merges into the lifter's workout style; unset fields fall back to the goal's defaults. */
async function saveStyle(current: TrainingStyle | undefined, patch: Partial<TrainingStyle>, message: string, rebuild = true): Promise<void> {
  const next: Record<string, unknown> = { ...current, ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await db.profile.update('me', { style: Object.keys(next).length ? (next as TrainingStyle) : undefined });
  haptics.tap();
  toast(message, { icon: 'check', tone: 'accent' });
  if (rebuild) void refreshPlan();
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

type Panel = 'profile' | 'goal' | 'experience' | 'days' | 'split' | 'length' | 'units' | 'rest' | 'sound' | 'warmups' | 'drops' | 'effort' | 'ai' | 'strava' | 'fresh';

export function Settings() {
  const profile = useProfile();
  const goBack = useGoBack('/');
  const [panel, setPanel] = useState<Panel | null>(null);
  const close = useCallback(() => setPanel(null), []);
  if (!profile) return null;

  const initial = profile.name.trim().charAt(0).toUpperCase();
  const style = schemeForSettings(profile);
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
          <Row icon="calendar" label="Training days" sub={trainingDaysText(trainingDays(profile))} value={<span className="num">{trainingDays(profile).length} a week</span>} onClick={() => setPanel('days')} />
          <Row
            icon="repeat"
            label="Split"
            sub={splitName(splitDays(profile))}
            value={!profile.split ? 'Automatic' : profile.split.order === 'rotate' ? 'In order' : 'Freshest first'}
            onClick={() => setPanel('split')}
          />
          <Row icon="clock" label="Session length" value={<span className="num">{profile.sessionMinutes} min</span>} onClick={() => setPanel('length')} />
          <Row icon="scale" label="Units" value={profile.units === 'kg' ? 'Kilograms' : 'Pounds'} onClick={() => setPanel('units')} />
        </div>
      </Section>

      <Section title="Workout style">
        <div className="group">
          <Row
            icon="timer"
            label="Rest between sets"
            sub={profile.style?.restCompoundSec === undefined && profile.style?.restIsolationSec === undefined ? 'Auto for your goal' : 'Your own times'}
            value={<span className="num">{`${clock(style.restCompound)} · ${clock(style.restIsolation)}`}</span>}
            onClick={() => setPanel('rest')}
          />
          <Row icon="flame" label="Warm-up sets" value={titleOf(WARMUPS, profile.style?.warmups ?? 'main')} onClick={() => setPanel('warmups')} />
          <Row icon="layers" label="Drop sets" value={profile.style?.dropSets && profile.style.dropSets !== 'off' ? titleOf(DROPS, profile.style.dropSets) : 'Off'} onClick={() => setPanel('drops')} />
          <Row icon="bolt" label="Effort" sub={`${style.rir} ${style.rir === 1 ? 'rep' : 'reps'} in reserve`} value={EFFORT_LABEL[String(profile.style?.effort ?? 0)]} onClick={() => setPanel('effort')} />
          <label className="group-row set-row toggle set-toggle-row">
            <span className="row-icon">
              <Icon name="play" size={17} />
            </span>
            <span className="set-row-text">
              <span className="set-row-label">Rest timer starts itself</span>
              <span className="set-row-sub">When you tick off a set</span>
            </span>
            <input
              type="checkbox"
              checked={profile.style?.autoRest !== false}
              onChange={(e) => void saveStyle(profile.style, { autoRest: e.target.checked ? undefined : false }, e.target.checked ? 'Rest timer starts itself' : 'Rest timer off — start it from the set', false)}
            />
          </label>
          <Row icon="bell" label="When rest ends" value={SOUND_LABEL[profile.style?.restSound ?? 'ding']} onClick={() => setPanel('sound')} />
          <label className="group-row set-row toggle set-toggle-row">
            <span className="row-icon">
              <Icon name="sun" size={17} />
            </span>
            <span className="set-row-text">
              <span className="set-row-label">Keep screen on</span>
              <span className="set-row-sub">While a workout is under way</span>
            </span>
            <input
              type="checkbox"
              checked={profile.style?.keepAwake !== false}
              onChange={(e) => void saveStyle(profile.style, { keepAwake: e.target.checked ? undefined : false }, e.target.checked ? 'Screen stays on during workouts' : 'Screen can sleep during workouts', false)}
            />
          </label>
        </div>
        <p className="set-footnote small">Today's plan is rebuilt to match. You can still change any set or rest during a workout.</p>
      </Section>

      <GymsSection activeGymId={profile.activeGymId} units={profile.units} />

      <Section title="Connections">
        <div className="group">
          <Row icon="run" label="Strava" sub={<StravaStatus profile={profile} />} onClick={() => setPanel('strava')} />
        </div>
      </Section>

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
      {panel === 'days' && <DaysSheet days={trainingDays(profile)} split={profile.split} onClose={close} />}
      {panel === 'split' && (
        <SplitSheet
          value={profile.split}
          daysPerWeek={profile.daysPerWeek}
          onSave={async (split) => {
            await saveSplit(split);
            haptics.tap();
            toast(split ? `Split set to ${splitName(split.days)}` : 'Split set to automatic', { icon: 'check', tone: 'accent' });
          }}
          onClose={close}
        />
      )}
      {panel === 'length' && <LengthSheet minutes={profile.sessionMinutes} onClose={close} />}
      {panel === 'rest' && <RestSheet profile={profile} onClose={close} />}
      {panel === 'sound' && <SoundSheet profile={profile} onClose={close} />}
      {panel === 'warmups' && (
        <Sheet open onClose={close} title="Warm-up sets" subtitle="Lighter ramp-up sets before heavy lifts. They don't count toward your volume.">
          <OptionCards
            options={WARMUPS}
            value={profile.style?.warmups ?? 'main'}
            onPick={(warmups) => {
              void saveStyle(profile.style, { warmups: warmups === 'main' ? undefined : warmups }, `Warm-ups: ${titleOf(WARMUPS, warmups).toLowerCase()}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
      {panel === 'drops' && (
        <Sheet open onClose={close} title="Drop sets" subtitle="A lighter set straight after the last one, taken close to failure. More work in less time.">
          <OptionCards
            options={DROPS}
            value={profile.style?.dropSets ?? 'off'}
            onPick={(dropSets) => {
              void saveStyle(profile.style, { dropSets: dropSets === 'off' ? undefined : dropSets }, dropSets === 'off' ? 'Drop sets off' : `Drop sets on ${titleOf(DROPS, dropSets).toLowerCase()}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
      {panel === 'effort' && (
        <Sheet open onClose={close} title="Effort" subtitle="How close to failure your working sets go. Reps in reserve = reps you could still have done.">
          <OptionCards
            options={effortOptions(profile)}
            value={String(profile.style?.effort ?? 0)}
            onPick={(v) => {
              const effort = Number(v) as -1 | 0 | 1;
              void saveStyle(profile.style, { effort: effort === 0 ? undefined : effort }, `Effort: ${EFFORT_LABEL[v]!.toLowerCase()}`);
              dismissSheet(260);
            }}
          />
        </Sheet>
      )}
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
      {panel === 'strava' && <StravaSheet profile={profile} onClose={close} />}
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

function DaysSheet({ days, split, onClose }: { days: number[]; split: Split | undefined; onClose: () => void }) {
  const [shown, setShown] = useState(days);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<number[] | null>(null);
  // Rebuilding the plan waits for a pause in tapping; closing the sheet does it at once.
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    void saveTrainingDays(next);
    toast(`Training ${trainingDaysText(next)}`, { icon: 'check', tone: 'accent' });
  }, []);
  useEffect(() => flush, [flush]);

  const toggle = (d: number) => {
    const next = shown.includes(d) ? shown.filter((x) => x !== d) : [...shown, d].sort((a, b) => a - b);
    if (!next.length) return;
    haptics.tap();
    setShown(next);
    void db.profile.update('me', { trainingDays: next, daysPerWeek: next.length });
    pending.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  return (
    <Sheet open onClose={onClose} title="Training days" subtitle="Pick the days you lift. The week view plans each one.">
      <div className="stack lg">
        <div className="set-days set-weekdays" role="group" aria-label="Training days">
          {WEEKDAY_SHORT.map((label, d) => (
            <button key={label} type="button" className="set-day" aria-pressed={shown.includes(d)} onClick={() => toggle(d)}>
              <span className="set-day-unit">{label}</span>
              <span className="set-day-check" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </button>
          ))}
        </div>
        <p className="muted center set-days-note" key={shown.join()}>
          <strong style={{ color: 'var(--text-1)' }}>{shown.length} days a week.</strong> {splitText(shown.length, split)}
        </p>
      </div>
    </Sheet>
  );
}

const EFFORT_LABEL: Record<string, string> = { '1': 'Easier', '0': 'Standard', '-1': 'Harder' };

function SoundSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const mode = profile.style?.restSound ?? 'ding';
  const [testing, setTesting] = useState(false);
  const test = () => {
    testSound(mode);
    if (mode === 'lock') {
      setTesting(true);
      setTimeout(() => setTesting(false), 11_000);
    }
  };
  return (
    <Sheet open onClose={onClose} title="When rest ends" subtitle="How Overload tells you the next set is up.">
      <div className="stack lg">
        <OptionCards
          options={SOUNDS}
          value={mode}
          onPick={(restSound) => void saveStyle(profile.style, { restSound: restSound === 'ding' ? undefined : restSound }, `When rest ends: ${titleOf(SOUNDS, restSound).toLowerCase()}`, false)}
        />
        {mode === 'lock' && (
          <p className="small muted">
            Your phone treats the rest timer like music, which is how it keeps playing with the screen off. Lock-screen buttons skip the rest or move the
            ding by 15 seconds. Some iPhones stop web-app audio when locked: run the test to check yours.
          </p>
        )}
        {mode !== 'off' && (
          <button type="button" className="btn block" onClick={test} disabled={testing}>
            <Icon name={mode === 'lock' ? 'timer' : 'bell'} size={18} />
            {mode === 'lock' ? (testing ? 'Lock your phone now · ding in 10 s' : 'Test it: lock your phone, ding in 10 s') : 'Play the ding'}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function schemeForSettings(profile: Profile) {
  const base = goalScheme(profile.goal, profile.experience);
  return {
    rir: Math.max(0, base.rir + (profile.style?.effort ?? 0)),
    restCompound: profile.style?.restCompoundSec ?? base.restCompound,
    restIsolation: profile.style?.restIsolationSec ?? base.restIsolation,
  };
}

function effortOptions(profile: Profile): Option<string>[] {
  const rir = goalScheme(profile.goal, profile.experience).rir;
  const reps = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`;
  return [
    { value: '1', title: 'Easier', body: `Stop about ${reps(rir + 1)} short of failure. Less fatigue, steadier technique.` },
    { value: '0', title: 'Standard', body: `About ${reps(rir)} in reserve: the sweet spot for your goal and experience.` },
    {
      value: '-1',
      title: 'Harder',
      body: rir - 1 <= 0 ? 'Working sets go to failure. Most stimulus per set, most fatigue.' : `About ${reps(rir - 1)} in reserve. More from each set, more fatigue.`,
    },
  ];
}

function RestSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const base = goalScheme(profile.goal, profile.experience);
  const compound = profile.style?.restCompoundSec;
  const isolation = profile.style?.restIsolationSec;
  const pick = (patch: Partial<TrainingStyle>, label: string) => void saveStyle(profile.style, patch, label);
  const block = (title: string, hint: string, value: number | undefined, auto: number, options: number[], key: 'restCompoundSec' | 'restIsolationSec') => (
    <div className="field">
      <span className="set-field-head">
        {title}
        <span className="faint">{hint}</span>
      </span>
      <div className="chips wrap" role="group" aria-label={`${title} rest`}>
        <button type="button" className="chip" aria-pressed={value === undefined} onClick={() => pick({ [key]: undefined }, `${title}: auto rest (${clock(auto)})`)}>
          Auto · <span className="num">{clock(auto)}</span>
        </button>
        {options.map((sec) => (
          <button key={sec} type="button" className="chip num" aria-pressed={value === sec} onClick={() => pick({ [key]: sec }, `${title}: ${clock(sec)} rest`)}>
            {clock(sec)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Sheet open onClose={onClose} title="Rest between sets" subtitle="What the timer counts down after each set. Auto follows your goal.">
      <div className="stack lg">
        {block('Compound lifts', 'Squats, presses, rows', compound, base.restCompound, REST_COMPOUND, 'restCompoundSec')}
        {block('Isolation lifts', 'Curls, raises, flyes', isolation, base.restIsolation, REST_ISOLATION, 'restIsolationSec')}
        <p className="small faint">Longer rests let you lift more on the next set, which is usually worth the time. Session plans are built around these, so shorter rests fit more into the same session.</p>
      </div>
    </Sheet>
  );
}

function LengthSheet({ minutes, onClose }: { minutes: number; onClose: () => void }) {
  const [value, setValue] = useState(minutes);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<number | null>(null);
  // Today's plan is rebuilt to the new length once the slider settles, or when the sheet closes.
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const v = pending.current;
    if (v === null) return;
    pending.current = null;
    void refreshPlan();
    toast(`Sessions set to ${v} min`, { icon: 'check', tone: 'accent' });
  }, []);
  useEffect(() => flush, [flush]);
  const pct = ((value - 20) / (90 - 20)) * 100;

  const change = (v: number) => {
    setValue(v);
    void db.profile.update('me', { sessionMinutes: v });
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
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

function GymsSection({ activeGymId, units }: { activeGymId: string; units: Units }) {
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
      <p className="set-footnote small">Workouts only use equipment at your active gym, and only weights you can load there. Tap a gym to switch.</p>

      {editing !== null && (
        <Sheet open onClose={close} title={editing === 'new' ? 'Add gym' : 'Edit gym'} subtitle={editing === 'new' ? 'Start from a preset, then fine-tune.' : undefined}>
          <GymEditor gym={editing === 'new' ? null : editing} gyms={gyms} activeGymId={activeGymId} units={units} />
        </Sheet>
      )}
    </Section>
  );
}

function GymEditor({ gym, gyms, activeGymId, units }: { gym: Gym | null; gyms: Gym[]; activeGymId: string; units: Units }) {
  const [name, setName] = useState(gym?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment[]>(gym?.equipment ?? []);
  const [weights, setWeights] = useState<GymWeights>(gym?.weights ?? {});
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
    const kit = cleanWeights(weights);
    if (gym) await db.gyms.update(gym.id, { name: trimmed, equipment: ordered, weights: kit });
    else await db.gyms.add({ id: uid(), name: trimmed, equipment: ordered, ...(kit && { weights: kit }) });
    // Today's plan should only use what this gym has.
    if (gym?.id === activeGymId) void refreshPlan();
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

      {equipment.some((e) => e !== 'squat_rack' && e !== 'bench' && e !== 'pullup_bar' && e !== 'dip_station' && e !== 'bands') && (
        <div className="field">
          <span className="set-field-head">Weights</span>
          <GymWeightsEditor equipment={equipment} units={units} value={weights} onChange={setWeights} />
          <p className="faint small">Workouts only prescribe loads you can make here. Leave anything you're unsure of; it assumes a well-stocked gym.</p>
        </div>
      )}

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

// ── Strava ─────────────────────────────────────────────────────────────────

function agoText(t: number, now = Date.now()): string {
  const min = Math.round((now - t) / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return formatDate(t, { month: 'short', day: 'numeric' });
}

function StravaStatus({ profile }: { profile: Profile }) {
  const link = profile.strava;
  if (!isConnected(link)) return <span className="set-status">Sync runs and rides into recovery</span>;
  if (link.lastError) return <span className="set-status set-warn">Needs a look · {link.athlete ?? 'connected'}</span>;
  return (
    <span className="set-status on">
      {link.athlete ? `${link.athlete} · ` : 'Connected · '}
      {link.lastSyncAt ? `synced ${agoText(link.lastSyncAt)}` : 'not synced yet'}
    </span>
  );
}

function StravaSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const link = profile.strava;
  return (
    <Sheet open onClose={onClose} title="Strava" subtitle="Runs, rides and hikes count toward recovery, so leg day waits when your legs are tired.">
      {isConnected(link) ? <StravaConnected link={link} /> : <StravaSetup clientId={link?.clientId ?? ''} clientSecret={link?.clientSecret ?? ''} />}
    </Sheet>
  );
}

function StravaConnected({ link }: { link: NonNullable<Profile['strava']> }) {
  const [busy, setBusy] = useState(false);
  const count = useLiveQuery(() => db.activities.filter((a) => a.source === 'strava').count(), []);

  const sync = async () => {
    setBusy(true);
    try {
      const { added } = await syncStrava();
      haptics.success();
      toast(added ? `${plural(added, 'new activity', 'new activities')} from Strava` : 'Up to date with Strava', { icon: 'check', tone: 'accent' });
    } catch {
      // Saved on the link and shown below.
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await disconnectStrava(false);
    toast('Strava disconnected', { icon: 'check' });
  };

  return (
    <div className="stack lg">
      <div className="set-file">
        <span className="row-icon set-strava-icon">
          <Icon name="run" size={17} />
        </span>
        <span className="grow">
          <span className="set-row-label truncate">{link.athlete ?? 'Connected'}</span>
          <span className="set-row-sub num">
            {link.lastSyncAt ? `Synced ${agoText(link.lastSyncAt)}` : 'Not synced yet'}
            {count !== undefined && ` · ${plural(count, 'activity', 'activities')}`}
          </span>
        </span>
      </div>
      <InlineError text={link.lastError ?? null} />
      <p className="muted small">
        New activities sync when you open Overload. Weight training and yoga are skipped, since you log lifting here.
      </p>
      <div className="stack">
        <button type="button" className="btn primary block lg" disabled={busy} onClick={() => void sync()}>
          {busy ? (
            <>
              <span className="set-spinner" aria-hidden="true" />
              Syncing…
            </>
          ) : (
            <>
              <Icon name="refresh" size={18} />
              Sync now
            </>
          )}
        </button>
        <ConfirmButton label="Disconnect" armedLabel="Tap again to disconnect" onConfirm={() => void disconnect()} />
        <p className="faint small set-center">Synced activities stay in your history.</p>
      </div>
    </div>
  );
}

function StravaSetup({ clientId: savedId, clientSecret: savedSecret }: { clientId: string; clientSecret: string }) {
  const idId = useId();
  const secretId = useId();
  const codeId = useId();
  const [clientId, setClientId] = useState(savedId);
  const [secret, setSecret] = useState(savedSecret);
  const [show, setShow] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const domain = callbackDomain();
  const id = clientId.trim();
  const sec = secret.trim();
  const ready = /^\d+$/.test(id) && sec.length >= 20;

  const connect = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    await saveStravaApp(id, sec);
    beginConnect(id);
  };

  const finish = async () => {
    const c = codeFromPaste(code);
    if (!c) {
      setError("That doesn't look like a Strava code. Paste the whole address Strava sent you to, or just the code in it.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (ready) await saveStravaApp(id, sec);
      const { athlete, added } = await finishConnect(c);
      haptics.success();
      toast(`Connected${athlete ? ` as ${athlete}` : ''} · ${plural(added, 'activity', 'activities')}`, { icon: 'check', tone: 'accent' });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const copyDomain = async () => {
    try {
      await navigator.clipboard.writeText(domain);
      toast('Copied', { icon: 'check' });
    } catch {
      // Clipboard blocked; the text is selectable.
    }
  };

  return (
    <form className="stack lg" onSubmit={connect}>
      <div className="set-privacy">
        <Icon name="shield" size={20} />
        <p className="small">
          Overload talks to Strava straight from this device through your own free Strava API app. Its keys and your sign-in stay here and are sent only to{' '}
          <span className="set-mono">strava.com</span>.
        </p>
      </div>

      <ol className="set-steps small muted">
        <li>
          <a className="set-link-inline" href={STRAVA_APPS_URL} target="_blank" rel="noopener noreferrer">
            Create an app on Strava
          </a>{' '}
          (takes two minutes). Any name and category will do; for the website, use this app's address.
        </li>
        <li>
          Set <strong>Authorization Callback Domain</strong> to{' '}
          <button type="button" className="set-copy set-mono" onClick={() => void copyDomain()}>
            {domain}
            <Icon name="copy" size={13} />
          </button>
        </li>
        <li>Copy the app's Client ID and Client Secret here, then connect.</li>
      </ol>

      <div className="field">
        <label htmlFor={idId}>Client ID</label>
        <input id={idId} className="input set-mono" inputMode="numeric" autoComplete="off" value={clientId} placeholder="12345" onChange={(e) => setClientId(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={secretId}>Client Secret</label>
        <span className="set-key">
          <input
            id={secretId}
            className="input set-mono"
            type={show ? 'text' : 'password'}
            value={secret}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setSecret(e.target.value)}
          />
          <button type="button" className="set-key-toggle" aria-pressed={show} aria-label={show ? 'Hide secret' : 'Show secret'} onClick={() => setShow((s) => !s)}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </span>
      </div>

      <InlineError text={error} />

      <div className="stack">
        <button type="submit" className="btn primary block lg set-strava-btn" disabled={!ready || busy}>
          <Icon name="external" size={18} />
          Connect with Strava
        </button>
        {!pasting ? (
          <button type="button" className="btn ghost block" onClick={() => setPasting(true)}>
            Have a code from Strava?
          </button>
        ) : (
          <div className="field">
            <label htmlFor={codeId}>Code from Strava</label>
            <input
              id={codeId}
              className="input set-mono"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Paste the code or the whole address"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button type="button" className="btn block" disabled={busy || !code.trim()} onClick={() => void finish()}>
              {busy ? 'Connecting…' : 'Finish connecting'}
            </button>
          </div>
        )}
      </div>
    </form>
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
        <Row icon="repeat" label="Import workouts" sub="Gravl, Strong or Hevy history" onClick={() => setImporting(true)} />
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
      const what = result.format === 'strava' ? plural(result.imported, 'activity', 'activities') : plural(result.imported, 'workout');
      toast(result.imported ? `Imported ${what}` : 'Nothing new: already imported', { icon: 'check', tone: 'accent' });
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
    <Sheet open onClose={onClose} title="Import workouts" subtitle="Bring your history from Gravl, Strong or Hevy.">
      <div className="stack lg">
        <ol className="set-steps small muted">
          <li>In Gravl, Strong or Hevy, export your workouts as a CSV file. It's in each app's settings.</li>
          <li>Choose the file here. Overload works out which app it came from.</li>
          <li>Re-importing is safe: workouts already here are skipped.</li>
        </ol>
        <p className="faint small">
          Cardio from Strava works too: the <span className="set-mono">activities.csv</span> in your Strava data download. Or connect Strava under
          Connections to sync it automatically.
        </p>
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
          <small className="small faint">Only Strong files leave the unit out. Gravl and Hevy files say, so this is ignored for them.</small>
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
  const cardio = summary.format === 'strava';
  return (
    <div className="stack lg">
      <div className="stats set-stats">
        <div className="stat">
          <span className="value accent-text">{imported}</span>
          <span className="label">{cardio ? 'activities' : 'imported'}</span>
        </div>
        <div className="stat">
          <span className="value">{skipped}</span>
          <span className="label">already here</span>
        </div>
        {!cardio && (
          <div className="stat">
            <span className="value">{newExercises.length}</span>
            <span className="label">new exercises</span>
          </div>
        )}
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

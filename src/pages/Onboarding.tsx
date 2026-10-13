import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, GYM_PRESETS, db } from '../db/db';
import { loadDemoData } from '../db/demo';
import { splitFor, type Focus } from '../engine/generator';
import { fromDisplay } from '../engine/load';
import type { Equipment, Experience, Goal, Sex, Units } from '../engine/types';
import { uid } from '../engine/util';
import { haptics } from '../ui/haptics';
import { Range } from '../ui/Range';
import { Ring } from '../ui/Ring';
import './Onboarding.css';

const GOALS: { id: Goal; title: string; body: string; icon: IconName }[] = [
  { id: 'hypertrophy', title: 'Build muscle', body: '6–15 reps and more weekly volume.', icon: 'muscle' },
  { id: 'strength', title: 'Get stronger', body: 'Heavy compounds, 3–6 reps, longer rest.', icon: 'dumbbell' },
  { id: 'general', title: 'General fitness', body: 'Balanced sessions that fit around life.', icon: 'heart' },
  { id: 'endurance', title: 'Muscular endurance', body: 'Higher reps, short rest. Pairs well with running.', icon: 'repeat' },
];

const LEVELS: { id: Experience; title: string; body: string }[] = [
  { id: 'beginner', title: 'New to lifting', body: 'Less than a year of consistent training.' },
  { id: 'intermediate', title: 'Some experience', body: '1–3 years. Comfortable with the main lifts.' },
  { id: 'advanced', title: 'Experienced', body: '3+ years. Progress now comes slowly.' },
];

const PRESET_INFO: Record<string, { icon: IconName; body: string }> = {
  'Commercial gym': { icon: 'gym', body: 'Racks, barbells, cables and machines.' },
  'Home gym': { icon: 'home', body: 'Barbell, rack, bench, dumbbells and a pull-up bar.' },
  'Dumbbells only': { icon: 'dumbbell', body: 'A set of dumbbells and a bench.' },
  'Hotel gym': { icon: 'suitcase', body: 'Dumbbells, a bench, cables and a few machines.' },
  Bodyweight: { icon: 'user', body: 'Just you and a pull-up bar.' },
};

const STANDARDS: { id: Sex; label: string; note: string }[] = [
  { id: 'male', label: 'Men’s', note: 'Your lifts are ranked against men’s strength standards at your bodyweight.' },
  { id: 'female', label: 'Women’s', note: 'Your lifts are ranked against women’s strength standards at your bodyweight.' },
  { id: 'unspecified', label: 'Blended', note: 'Your lifts are ranked against an average of men’s and women’s standards.' },
];

type Session = Exclude<Focus, 'auto'>;

const SESSION_SHORT: Partial<Record<Session, string>> = { full: 'Full', upper: 'Upper', lower: 'Lower', push: 'Push', pull: 'Pull', legs: 'Legs' };
const SESSION_TAG: Partial<Record<Session, string>> = {
  full: 'var(--tag-full)',
  upper: 'var(--tag-pull)',
  lower: 'var(--tag-legs)',
  push: 'var(--tag-push)',
  pull: 'var(--tag-pull)',
  legs: 'var(--tag-legs)',
};
// Training days spread across a Monday-first week so rest days fall between sessions.
const WEEK_DAYS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const BUILD_CHECKS: { text: string; icon: IconName }[] = [
  { text: 'Reading your schedule', icon: 'calendar' },
  { text: 'Matching your equipment', icon: 'dumbbell' },
  { text: 'Calibrating starting weights', icon: 'scale' },
];

const STEPS = 6;
const LAST = STEPS - 1;

function splitName(days: number): string {
  const split = splitFor(days);
  return split.length === 1 ? 'Full body' : split.map((s) => SESSION_SHORT[s]).join(' / ');
}

function splitDetail(days: number): string {
  const perWeek = days / splitFor(days).length;
  if (!Number.isInteger(perWeek)) return 'Each muscle trained 1–2 times a week';
  return `Each muscle trained ${perWeek === 2 ? 'twice' : perWeek === 3 ? 'three times' : `${perWeek} times`} a week`;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Onboarding() {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [name, setName] = useState('');
  const [units, setUnits] = useState<Units>(() => (navigator.language === 'en-US' ? 'lb' : 'kg'));
  const [goal, setGoal] = useState<Goal>('hypertrophy');
  const [experience, setExperience] = useState<Experience>('beginner');
  const [days, setDays] = useState(3);
  const [minutes, setMinutes] = useState(50);
  const [presetName, setPresetName] = useState(GYM_PRESETS[0]!.name);
  const [equipment, setEquipment] = useState<Equipment[]>(GYM_PRESETS[0]!.equipment);
  const [bodyweight, setBodyweight] = useState('');
  const [sex, setSex] = useState<Sex>('unspecified');
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const bw = Number(bodyweight);
  const valid = bw > 25 && bw < 700;

  useEffect(() => {
    // Move screen-reader focus to the new question, but not on first load.
    if (moved.current) heading.current?.focus({ preventScroll: true });
  }, [step]);

  function go(next: number) {
    moved.current = true;
    setDir(next > step ? 'fwd' : 'back');
    setStep(next);
    window.scrollTo(0, 0);
  }

  async function finish() {
    if (!valid || saving) return;
    setSaving(true);
    setBuilding(true);
    haptics.success();
    await wait(1700);
    const gymId = uid();
    await db.transaction('rw', db.gyms, db.profile, async () => {
      await db.gyms.put({ id: gymId, name: presetName, equipment });
      await db.profile.put({
        id: 'me',
        name: name.trim(),
        units,
        bodyweightKg: fromDisplay(bw, units),
        sex,
        experience,
        goal,
        daysPerWeek: days,
        sessionMinutes: minutes,
        activeGymId: gymId,
        onboarded: true,
        createdAt: Date.now(),
      });
    });
  }

  const toggleEquipment = (e: Equipment) =>
    setEquipment((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  if (building) return <Building tags={[splitName(days), `${days}× a week`, `${minutes} min`, presetName]} />;

  const question = (eyebrowText: string, title: string, sub?: string) => (
    <header className="ob-q">
      <div className="eyebrow">{eyebrowText}</div>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {sub && <p className="ob-sub">{sub}</p>}
    </header>
  );
  const eyebrow = `Step ${step + 1} of ${STEPS}`;
  const standard = STANDARDS.find((s) => s.id === sex)!;

  return (
    <div className="onboard ob">
      {step > 0 && (
        <div className="ob-top">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => go(step - 1)}>
            <Icon name="back" />
          </button>
          <div className="ob-progress" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={STEPS} aria-valuenow={step + 1}>
            {Array.from({ length: STEPS }, (_, i) => (
              <i key={i} className={i <= step ? 'on' : ''} />
            ))}
          </div>
        </div>
      )}

      <section key={step} className={`ob-step ${dir}${step === 0 ? ' welcome' : ''}`}>
        {step === 0 && (
          <>
            <div className="ob-hero">
              <Logo size={68} />
              <h1 className="ob-headline" ref={heading} tabIndex={-1}>
                Every rep,
                <br />
                <em>planned.</em>
              </h1>
              <p className="ob-lede">A strength coach that plans each workout around your recovery. Free, and private to this device.</p>
            </div>
            <div className="ob-form">
              <label className="field">
                <span>What should we call you?</span>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && go(1)}
                  placeholder="Your first name (optional)"
                  autoComplete="given-name"
                  enterKeyHint="next"
                />
              </label>
              <div className="field">
                <span>Units</span>
                <div className="segmented" role="group" aria-label="Units">
                  {(['kg', 'lb'] as Units[]).map((u) => (
                    <button key={u} type="button" aria-pressed={units === u} onClick={() => setUnits(u)}>
                      {u === 'kg' ? 'Kilograms' : 'Pounds'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            {question(eyebrow, 'What’s your main goal?', 'This sets your rep ranges, rest times and weekly volume.')}
            <div className="ob-options" role="group" aria-label="Goal">
              {GOALS.map((g) => (
                <Option key={g.id} title={g.title} body={g.body} selected={goal === g.id} onSelect={() => setGoal(g.id)}>
                  <Icon name={g.icon} />
                </Option>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            {question(eyebrow, 'How long have you been lifting?', 'We’ll choose exercises and starting loads to match.')}
            <div className="ob-options" role="group" aria-label="Experience">
              {LEVELS.map((l, i) => (
                <Option key={l.id} title={l.title} body={l.body} selected={experience === l.id} onSelect={() => setExperience(l.id)}>
                  <span className="ob-level" aria-hidden="true">
                    {[0, 1, 2].map((b) => (
                      <i key={b} className={b <= i ? 'on' : ''} />
                    ))}
                  </span>
                </Option>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {question(eyebrow, 'How often can you train?', 'Pick what you can keep up. Consistency beats ambition.')}
            <div className="ob-days" role="group" aria-label="Days per week">
              {[2, 3, 4, 5, 6].map((d) => (
                <button key={d} type="button" aria-pressed={days === d} aria-label={`${d} days`} onClick={() => setDays(d)}>
                  <span className="ob-days-n">{d}</span>
                  <span className="ob-days-l">days</span>
                </button>
              ))}
            </div>
            <WeekPreview days={days} />
            <div className="card tight ob-length">
              <Range label="Session length" value={minutes} min={20} max={90} step={5} onChange={setMinutes} format={(v) => `${v} min`} />
              <p className="small faint">Exercise count and rest times scale to fit.</p>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            {question(eyebrow, 'Where do you train?', 'Workouts only use equipment you have. You can add more gyms later.')}
            <div className="ob-options compact" role="group" aria-label="Gym type">
              {GYM_PRESETS.map((p) => {
                const info = PRESET_INFO[p.name];
                return (
                  <Option
                    key={p.name}
                    title={p.name}
                    body={info?.body ?? p.equipment.map((e) => EQUIPMENT_LABEL[e]).join(', ')}
                    selected={presetName === p.name}
                    onSelect={() => {
                      setPresetName(p.name);
                      setEquipment(p.equipment);
                    }}
                  >
                    <Icon name={info?.icon ?? 'gym'} />
                  </Option>
                );
              })}
            </div>
            <div className="ob-equip">
              <div className="row between">
                <h2 className="ob-equip-title">Fine-tune your equipment</h2>
                <span className="small faint num">
                  {equipment.length} of {ALL_EQUIPMENT.length}
                </span>
              </div>
              <div className="chips wrap" role="group" aria-label="Equipment">
                {ALL_EQUIPMENT.map((e) => (
                  <button key={e} type="button" className="chip" aria-pressed={equipment.includes(e)} onClick={() => toggleEquipment(e)}>
                    {equipment.includes(e) && <Icon name="check" size={14} />}
                    {EQUIPMENT_LABEL[e]}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            {question(eyebrow, 'Your starting point', 'Bodyweight seeds your first-session weights, conservatively. After one workout, your logs take over.')}
            <BodyweightInput value={bodyweight} units={units} onChange={setBodyweight} onSubmit={finish} />
            <div className="card ob-standards">
              <div className="row between">
                <h2 className="ob-equip-title">Strength standards</h2>
                <span className="badge">Optional</span>
              </div>
              <div className="segmented" role="group" aria-label="Strength standards">
                {STANDARDS.map((s) => (
                  <button key={s.id} type="button" aria-pressed={sex === s.id} onClick={() => setSex(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="small muted">{standard.note}</p>
            </div>
          </>
        )}
      </section>

      <div className="grow" />

      <footer className="ob-foot">
        {step < LAST ? (
          <button type="button" className="btn primary lg block" onClick={() => go(step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn primary lg block" disabled={!valid || saving} onClick={finish}>
            Build my first workout
          </button>
        )}
        {step === 0 && (
          <button
            type="button"
            className="btn ghost block ob-demo"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await loadDemoData(units);
            }}
          >
            {saving ? 'Loading sample data…' : 'Just looking? Explore with sample data'}
          </button>
        )}
        {step === LAST && !valid && <p className="ob-hint small faint">Enter your bodyweight to continue</p>}
      </footer>
    </div>
  );
}

/** Three ascending volt bars, as in the app icon. */
function Logo({ size }: { size: number }) {
  return (
    <span className="ob-logo" style={{ '--s': `${size}px` } as CSSProperties} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function Option({ title, body, selected, onSelect, children }: { title: string; body: string; selected: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="option-card ob-option"
      aria-pressed={selected}
      onClick={() => {
        if (!selected) haptics.tap();
        onSelect();
      }}
    >
      <span className="ob-option-icon">{children}</span>
      <span className="ob-option-text">
        <strong>{title}</strong>
        <span>{body}</span>
      </span>
      <span className="ob-radio" aria-hidden="true">
        <Icon name="check" size={14} />
      </span>
    </button>
  );
}

function WeekPreview({ days }: { days: number }) {
  const split = splitFor(days);
  const on = WEEK_DAYS[days] ?? [];
  return (
    <div className="card ob-week">
      <div className="ob-week-head">
        <strong>{splitName(days)}</strong>
        <span className="small muted">{splitDetail(days)}</span>
      </div>
      <ol className="ob-week-grid" aria-label={`${days} sessions a week`}>
        {WEEKDAYS.map((d, i) => {
          const n = on.indexOf(i);
          const session = n >= 0 ? split[n % split.length] : undefined;
          return (
            <li key={i} className={session ? 'on' : ''} style={session ? ({ '--tag': SESSION_TAG[session] } as CSSProperties) : undefined}>
              <span className="ob-week-day">{d}</span>
              <span className="ob-week-cell">{session && SESSION_SHORT[session]}</span>
            </li>
          );
        })}
      </ol>
      <p className="small faint">The order adapts to whatever you’ve recovered from.</p>
    </div>
  );
}

function BodyweightInput({ value, units, onChange, onSubmit }: { value: string; units: Units; onChange: (v: string) => void; onSubmit: () => void }) {
  const id = useId();
  const placeholder = units === 'kg' ? '75' : '165';
  return (
    <div className="ob-weight">
      <label htmlFor={id} className="eyebrow">
        Bodyweight
      </label>
      <div className="ob-weight-field">
        <input
          id={id}
          className="ob-weight-input"
          type="number"
          inputMode="decimal"
          enterKeyHint="done"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          placeholder={placeholder}
          style={{ width: `${Math.max(2, (value || placeholder).length) + 0.3}ch` }}
        />
        <span className="ob-weight-unit">{units}</span>
      </div>
    </div>
  );
}

function Building({ tags }: { tags: string[] }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const timers = [1, 2, 3].map((p) => setTimeout(() => setPhase(p), p * 450));
    return () => timers.forEach(clearTimeout);
  }, []);
  const done = phase >= BUILD_CHECKS.length;
  return (
    <div className="onboard ob ob-build" role="status" aria-live="polite">
      <div className="ob-build-ring">
        <Ring value={1} size={148} stroke={7} label="Building your first workout">
          <span className={`ob-build-mark${done ? ' done' : ''}`}>{done ? <Icon name="check" size={34} /> : <Logo size={60} />}</span>
        </Ring>
      </div>
      <div className="ob-build-copy">
        <h1>Building your first workout…</h1>
        <ul className="ob-build-tags">
          {tags.map((t) => (
            <li key={t} className="badge">
              {t}
            </li>
          ))}
        </ul>
      </div>
      <ul className="ob-checklist">
        {BUILD_CHECKS.slice(0, phase + 1).map((c, i) => (
          <li key={c.text} className={phase > i ? 'done' : ''}>
            <span className="ob-checklist-icon">
              <Icon name={c.icon} size={18} />
            </span>
            <span className="grow">{c.text}</span>
            <span className="ob-checklist-state">{phase > i ? <Icon name="check" size={14} /> : <span className="ob-spinner" />}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { useState } from 'react';
import { ALL_EQUIPMENT, EQUIPMENT_LABEL, GYM_PRESETS, db } from '../db/db';
import { fromDisplay } from '../engine/load';
import type { Equipment, Experience, Goal, Sex, Units } from '../engine/types';
import { uid } from '../engine/util';

const GOALS: { id: Goal; title: string; body: string }[] = [
  { id: 'hypertrophy', title: 'Build muscle', body: 'Moderate weights, 6–15 reps, more weekly volume.' },
  { id: 'strength', title: 'Get stronger', body: 'Heavier compounds, 3–6 reps, longer rest.' },
  { id: 'general', title: 'General fitness', body: 'Balanced, efficient sessions that fit around life.' },
  { id: 'endurance', title: 'Muscular endurance', body: 'Higher reps and short rest — great alongside running or sport.' },
];

const LEVELS: { id: Experience; title: string; body: string }[] = [
  { id: 'beginner', title: 'New to lifting', body: 'Less than ~1 year of consistent training.' },
  { id: 'intermediate', title: 'Some experience', body: '1–3 years; comfortable with the main lifts.' },
  { id: 'advanced', title: 'Experienced', body: '3+ years; progress now comes slowly.' },
];

const STEPS = 6;

export function Onboarding() {
  const [step, setStep] = useState(0);
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

  const bw = Number(bodyweight);
  const canNext = step !== 5 || (bw > 25 && bw < 700);

  async function finish() {
    setSaving(true);
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

  return (
    <div className="onboard">
      <div className="progress-dots" aria-label={`Step ${step + 1} of ${STEPS}`}>
        {Array.from({ length: STEPS }, (_, i) => (
          <i key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <div className="stack lg">
          <div className="stack">
            <h1>Overload</h1>
            <p className="muted">
              A free, open-source strength coach. It plans each workout around how recovered your muscles are, tells you exactly
              what to lift and why, and keeps every rep on this device.
            </p>
          </div>
          <label className="field">
            <span>What should we call you?</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" autoComplete="given-name" />
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
      )}

      {step === 1 && (
        <div className="stack lg">
          <h2>What's your main goal?</h2>
          <div className="stack">
            {GOALS.map((g) => (
              <button key={g.id} type="button" className="option-card" aria-pressed={goal === g.id} onClick={() => setGoal(g.id)}>
                <strong>{g.title}</strong>
                <span>{g.body}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack lg">
          <h2>How much lifting experience do you have?</h2>
          <div className="stack">
            {LEVELS.map((l) => (
              <button key={l.id} type="button" className="option-card" aria-pressed={experience === l.id} onClick={() => setExperience(l.id)}>
                <strong>{l.title}</strong>
                <span>{l.body}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="stack lg">
          <h2>How do you want to train?</h2>
          <div className="field">
            <span>Days per week</span>
            <div className="chips wrap" role="group" aria-label="Days per week">
              {[2, 3, 4, 5, 6].map((d) => (
                <button key={d} type="button" className="chip" aria-pressed={days === d} onClick={() => setDays(d)}>
                  {d} days
                </button>
              ))}
            </div>
            <p className="small faint">
              {days <= 3 ? 'Full-body sessions.' : days === 4 ? 'Upper / lower split.' : 'Push / pull / legs rotation.'} The order
              adapts to whatever you've recovered from.
            </p>
          </div>
          <label className="field">
            <span>
              Session length: <strong className="num">{minutes} min</strong>
            </span>
            <input type="range" min={20} max={90} step={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
          </label>
        </div>
      )}

      {step === 4 && (
        <div className="stack lg">
          <h2>Where do you train?</h2>
          <div className="chips wrap" role="group" aria-label="Gym type">
            {GYM_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                className="chip"
                aria-pressed={presetName === p.name}
                onClick={() => {
                  setPresetName(p.name);
                  setEquipment(p.equipment);
                }}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="field">
            <span>Fine-tune your equipment</span>
            <div className="chips wrap">
              {ALL_EQUIPMENT.map((e) => (
                <button key={e} type="button" className="chip" aria-pressed={equipment.includes(e)} onClick={() => toggleEquipment(e)}>
                  {EQUIPMENT_LABEL[e]}
                </button>
              ))}
            </div>
            <p className="small faint">You can add more gyms (home, hotel, office) later and switch between them.</p>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="stack lg">
          <h2>Last thing: a starting point</h2>
          <p className="muted">
            Bodyweight seeds your first-session weights (conservatively) and powers strength-standard comparisons. After one session,
            your logs take over.
          </p>
          <label className="field">
            <span>Bodyweight ({units})</span>
            <input
              className="input num"
              type="number"
              inputMode="decimal"
              value={bodyweight}
              onChange={(e) => setBodyweight(e.target.value)}
              placeholder={units === 'kg' ? '75' : '165'}
            />
          </label>
          <div className="field">
            <span>Strength standards (optional)</span>
            <div className="segmented" role="group" aria-label="Strength standards">
              {(
                [
                  ['male', 'Men’s'],
                  ['female', 'Women’s'],
                  ['unspecified', 'Blended'],
                ] as [Sex, string][]
              ).map(([v, label]) => (
                <button key={v} type="button" aria-pressed={sex === v} onClick={() => setSex(v)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grow" />
      <div className="row">
        {step > 0 && (
          <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        <div className="grow" />
        {step < STEPS - 1 ? (
          <button type="button" className="btn primary lg" onClick={() => setStep(step + 1)}>
            Continue
          </button>
        ) : (
          <button type="button" className="btn primary lg" disabled={!canNext || saving} onClick={finish}>
            Build my first workout
          </button>
        )}
      </div>
    </div>
  );
}

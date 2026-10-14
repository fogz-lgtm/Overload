import { useId, useState, type ReactNode } from 'react';
import { DEFAULT_BARS, kitFor, PLATE_SIZES, PLENTY } from '../engine/kit';
import { formatWeight, fromDisplay, toDisplay } from '../engine/load';
import type { Equipment, GymWeights, PlatePair, Units } from '../engine/types';
import { Icon } from './Icon';
import { NumField } from './NumField';
import './GymWeights.css';

const KETTLEBELLS: Record<Units, number[]> = {
  kg: [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 48],
  lb: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 53, 60, 70, 80, 90, 106],
};
const STACK_STEPS: Record<Units, number[]> = { kg: [1, 2.5, 5, 10], lb: [2.5, 5, 10, 15, 20] };
const DEFAULT_STACK: Record<Units, number> = { kg: 2.5, lb: 5 };
const DUMBBELL_PRESETS: Record<Units, { label: string; from: number; to: number; step: number }[]> = {
  kg: [
    { label: 'Rack 2–40', from: 2, to: 40, step: 2 },
    { label: 'Rack 2.5–50', from: 2.5, to: 50, step: 2.5 },
    { label: 'Adjustable 2–24', from: 2, to: 24, step: 2 },
    { label: 'Adjustable 4–40', from: 4, to: 40, step: 2 },
  ],
  lb: [
    { label: 'Rack 5–50', from: 5, to: 50, step: 5 },
    { label: 'Rack 5–100', from: 5, to: 100, step: 5 },
    { label: 'Adjustable 5–52.5', from: 5, to: 52.5, step: 2.5 },
    { label: 'Adjustable 10–90', from: 10, to: 90, step: 5 },
  ],
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const shown = (kg: number, units: Units) => round2(toDisplay(kg, units));
const list = (xs: number[], units: Units) => `${xs.map((x) => shown(x, units)).join(', ')} ${units}`;

function range(from: number, to: number, step: number): number[] {
  if (!(step > 0) || !(to >= from) || (to - from) / step > 80) return [];
  const out: number[] = [];
  for (let v = from; v <= to + 1e-6; v += step) out.push(round2(v));
  return out;
}

/** Drops empty fields so "unset" always means "a well-stocked gym". */
export function cleanWeights(w: GymWeights): GymWeights | undefined {
  const out: GymWeights = {};
  for (const [k, v] of Object.entries(w) as [keyof GymWeights, GymWeights[keyof GymWeights]][]) {
    if (v === undefined || (Array.isArray(v) && v.length === 0)) continue;
    (out as Record<string, unknown>)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

function platesSummary(plates: PlatePair[] | undefined, max: number | undefined, units: Units): string {
  if (!plates?.length) return 'Plenty of every plate';
  const limited = PLATE_SIZES[units]
    .map((s) => ({ s, pairs: plates.find((p) => Math.abs(shown(p.kg, units) - s) < 0.01)?.pairs ?? 0 }))
    .filter((p) => p.pairs < PLENTY);
  if (limited.length === PLATE_SIZES[units].length && max) return `The bar loads up to ${formatWeight(max, units)}`;
  return limited.map((p) => (p.pairs === 0 ? `no ${p.s}s` : `${p.pairs}×${p.s}`)).join(' · ');
}

/** The weights at a gym: plates and bars, dumbbells, kettlebells, machine stacks. */
export function GymWeightsEditor({
  equipment,
  units,
  value,
  onChange,
}: {
  equipment: Equipment[];
  units: Units;
  value: GymWeights;
  onChange: (w: GymWeights) => void;
}) {
  const has = (...e: Equipment[]) => e.some((x) => equipment.includes(x));
  const set = (patch: Partial<GymWeights>) => onChange({ ...value, ...patch });
  const bars = DEFAULT_BARS[units];
  const plateLoaded = has('barbell', 'ez_bar', 'trap_bar', 'smith_machine');

  if (!plateLoaded && !has('dumbbells', 'kettlebells', 'machines', 'cable')) return null;

  const plateMax = plateLoaded ? kitFor({ loading: 'barbell', equipment: ['barbell'] }, value, units).max : undefined;

  return (
    <div className="gw stack">
      {plateLoaded && (
        <Block
          title="Plates & bars"
          summary={platesSummary(value.plates, plateMax, units)}
        >
          <div className="gw-bars">
            {has('barbell') && <BarField label="Barbell" kg={value.barKg} fallback={bars.barbell} units={units} onChange={(barKg) => set({ barKg })} />}
            {has('ez_bar') && <BarField label="EZ bar" kg={value.ezBarKg} fallback={bars.ez_bar} units={units} onChange={(ezBarKg) => set({ ezBarKg })} />}
            {has('trap_bar') && <BarField label="Trap bar" kg={value.trapBarKg} fallback={bars.trap_bar} units={units} onChange={(trapBarKg) => set({ trapBarKg })} />}
            {has('smith_machine') && <BarField label="Smith bar" kg={value.smithBarKg} fallback={bars.smith} units={units} onChange={(smithBarKg) => set({ smithBarKg })} />}
          </div>
          <Plates value={value.plates} units={units} onChange={(plates) => set({ plates })} />
        </Block>
      )}
      {has('dumbbells') && (
        <Block title="Dumbbells" summary={value.dumbbells?.length ? list([...value.dumbbells].sort((a, b) => a - b), units) : 'A full rack'}>
          <Dumbbells value={value.dumbbells} units={units} onChange={(dumbbells) => set({ dumbbells })} />
        </Block>
      )}
      {has('kettlebells') && (
        <Block title="Kettlebells" summary={value.kettlebells?.length ? list([...value.kettlebells].sort((a, b) => a - b), units) : 'A full set'}>
          <Choices
            options={KETTLEBELLS[units]}
            units={units}
            value={value.kettlebells}
            allLabel="Full set"
            ownLabel="My kettlebells"
            onChange={(kettlebells) => set({ kettlebells })}
          />
        </Block>
      )}
      {has('machines', 'cable') && (
        <Block title="Machines & cables" summary={`Stack goes up in ${shown(value.stackStepKg ?? fromDisplay(DEFAULT_STACK[units], units), units)} ${units}`}>
          <div className="field">
            <span>The weight stack goes up in</span>
            <div className="chips wrap" role="group" aria-label="Stack step">
              {STACK_STEPS[units].map((s) => {
                const current = value.stackStepKg === undefined ? DEFAULT_STACK[units] : shown(value.stackStepKg, units);
                return (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={current === s}
                    onClick={() => set({ stackStepKg: s === DEFAULT_STACK[units] ? undefined : fromDisplay(s, units) })}
                  >
                    {s} {units}
                  </button>
                );
              })}
            </div>
          </div>
        </Block>
      )}
    </div>
  );
}

function Block({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`gw-block${open ? ' open' : ''}`}>
      <button type="button" className="gw-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span className="grow">
          <span className="gw-title">{title}</span>
          <span className="gw-summary">{summary}</span>
        </span>
        <Icon name="chevronDown" size={18} />
      </button>
      {open && (
        <div id={id} className="gw-body stack">
          {children}
        </div>
      )}
    </div>
  );
}

function BarField({ label, kg, fallback, units, onChange }: { label: string; kg?: number; fallback: number; units: Units; onChange: (kg: number | undefined) => void }) {
  return (
    <label className="gw-bar">
      <span>{label}</span>
      <span className="gw-bar-input">
        <NumField
          className="input num"
          label={`${label} weight in ${units}`}
          decimals={1}
          value={kg === undefined ? undefined : shown(kg, units)}
          placeholder={String(fallback)}
          onChange={(v) => onChange(v === undefined || v === fallback ? undefined : fromDisplay(v, units))}
        />
        <span className="gw-unit">{units}</span>
      </span>
    </label>
  );
}

const pairsText = (n: number) => (n >= PLENTY ? 'Plenty' : n === 0 ? 'None' : `${n} pair${n === 1 ? '' : 's'}`);

function Plates({ value, units, onChange }: { value?: PlatePair[]; units: Units; onChange: (p: PlatePair[] | undefined) => void }) {
  const sizes = PLATE_SIZES[units];
  const countFor = (size: number) => {
    if (!value?.length) return PLENTY;
    return value.find((p) => Math.abs(shown(p.kg, units) - size) < 0.01)?.pairs ?? 0;
  };
  const change = (size: number, pairs: number) => {
    const next = sizes.map((s) => ({ kg: fromDisplay(s, units), pairs: s === size ? pairs : countFor(s) })).filter((p) => p.pairs > 0);
    onChange(next.every((p) => p.pairs >= PLENTY) && next.length === sizes.length ? undefined : next);
  };
  const step = (n: number, dir: 1 | -1) => (dir > 0 ? (n >= 10 ? PLENTY : n + 1) : n >= PLENTY ? 10 : Math.max(0, n - 1));
  return (
    <div className="field">
      <span>Plates (pairs of each size)</span>
      <ul className="gw-plates">
        {sizes.map((s) => {
          const n = countFor(s);
          return (
            <li key={s}>
              <span className="gw-plate num">
                {s} {units}
              </span>
              <span className={`gw-count${n === 0 ? ' none' : ''}`}>{pairsText(n)}</span>
              <button type="button" className="icon-btn sm" aria-label={`Fewer ${s} ${units} plates`} disabled={n === 0} onClick={() => change(s, step(n, -1))}>
                <Icon name="minus" size={16} />
              </button>
              <button type="button" className="icon-btn sm" aria-label={`More ${s} ${units} plates`} disabled={n >= PLENTY} onClick={() => change(s, step(n, 1))}>
                <Icon name="plus" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Dumbbells({ value, units, onChange }: { value?: number[]; units: Units; onChange: (d: number[] | undefined) => void }) {
  const mine = !!value?.length;
  const current = (value ?? []).map((kg) => shown(kg, units)).sort((a, b) => a - b);
  const [from, setFrom] = useState<number | undefined>(current[0] ?? DUMBBELL_PRESETS[units][0]!.from);
  const [to, setTo] = useState<number | undefined>(current[current.length - 1] ?? DUMBBELL_PRESETS[units][0]!.to);
  const [step, setStep] = useState<number | undefined>(current.length > 1 ? round2(current[1]! - current[0]!) : DUMBBELL_PRESETS[units][0]!.step);
  const options = [...new Set([...range(from ?? 0, to ?? 0, step ?? 0), ...current])].sort((a, b) => a - b);

  const save = (display: number[]) => onChange(display.length ? display.map((d) => fromDisplay(d, units)) : undefined);
  const build = (f = from, t = to, s = step) => {
    const r = range(f ?? 0, t ?? 0, s ?? 0);
    if (r.length) save(r);
  };

  return (
    <>
      <div className="segmented" role="group" aria-label="Dumbbells">
        <button type="button" aria-pressed={!mine} onClick={() => onChange(undefined)}>
          Full rack
        </button>
        <button type="button" aria-pressed={mine} onClick={() => build()}>
          My dumbbells
        </button>
      </div>
      {mine && (
        <>
          <div className="chips wrap" role="group" aria-label="Common sets">
            {DUMBBELL_PRESETS[units].map((p) => (
              <button
                key={p.label}
                type="button"
                className="chip"
                onClick={() => {
                  setFrom(p.from);
                  setTo(p.to);
                  setStep(p.step);
                  build(p.from, p.to, p.step);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="gw-range">
            <label>
              <span>From</span>
              <NumField className="input num" label={`Lightest dumbbell in ${units}`} value={from} onChange={(v) => (setFrom(v), build(v, to, step))} />
            </label>
            <label>
              <span>To</span>
              <NumField className="input num" label={`Heaviest dumbbell in ${units}`} value={to} onChange={(v) => (setTo(v), build(from, v, step))} />
            </label>
            <label>
              <span>Steps of</span>
              <NumField className="input num" label={`Step between dumbbells in ${units}`} value={step} onChange={(v) => (setStep(v), build(from, to, v))} />
            </label>
          </div>
          <div className="field">
            <span>Tap any you don't have</span>
            <div className="chips wrap gw-weights" role="group" aria-label="Dumbbells you have">
              {options.map((d) => {
                const on = current.some((c) => Math.abs(c - d) < 0.01);
                return (
                  <button key={d} type="button" className="chip num" aria-pressed={on} onClick={() => save(on ? current.filter((c) => Math.abs(c - d) >= 0.01) : [...current, d])}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function Choices({
  options,
  units,
  value,
  allLabel,
  ownLabel,
  onChange,
}: {
  options: number[];
  units: Units;
  value?: number[];
  allLabel: string;
  ownLabel: string;
  onChange: (v: number[] | undefined) => void;
}) {
  const mine = !!value?.length;
  const current = (value ?? []).map((kg) => shown(kg, units));
  const save = (display: number[]) => onChange(display.length ? display.map((d) => fromDisplay(d, units)) : undefined);
  return (
    <>
      <div className="segmented" role="group" aria-label={ownLabel}>
        <button type="button" aria-pressed={!mine} onClick={() => onChange(undefined)}>
          {allLabel}
        </button>
        <button type="button" aria-pressed={mine} onClick={() => !mine && save(options.slice(2, 8))}>
          {ownLabel}
        </button>
      </div>
      {mine && (
        <div className="field">
          <span>Tap the ones you have ({units})</span>
          <div className="chips wrap gw-weights" role="group" aria-label={`${ownLabel} you have`}>
            {options.map((o) => {
              const on = current.some((c) => Math.abs(c - o) < 0.01);
              return (
                <button key={o} type="button" className="chip num" aria-pressed={on} onClick={() => save(on ? current.filter((c) => Math.abs(c - o) >= 0.01) : [...current, o])}>
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

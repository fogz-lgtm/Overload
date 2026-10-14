import { useState } from 'react';
import { DAY_TYPES, FOCUS_LABEL, FOCUS_MUSCLES, SPLIT_PRESETS, splitFor, splitName } from '../engine/generator';
import { MUSCLES } from '../engine/muscles';
import type { DayType, Split } from '../engine/types';
import { DAY_SHORT, dayStyle } from '../ui/days';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import './SplitSheet.css';

/** A row of coloured day pills: Push · Pull · Core. */
export function DayPills({ days, current }: { days: DayType[]; current?: number }) {
  return (
    <span className="split-pills">
      {days.map((d, i) => (
        <span key={i} className={`split-pill${i === current ? ' current' : ''}`} style={dayStyle(d)}>
          {DAY_SHORT[d]}
        </span>
      ))}
    </span>
  );
}

const TIMES: Record<number, string> = { 1: 'once', 2: 'twice', 3: 'three times' };

/** How often each day of a rotation comes round: "Each day comes round twice a week." */
export function splitCadence(days: number, daysPerWeek: number): string {
  if (days <= 1) return `The same session, ${TIMES[daysPerWeek] ?? `${daysPerWeek} times`} a week.`;
  const perWeek = daysPerWeek / days;
  if (Number.isInteger(perWeek)) return `Each day comes round ${TIMES[perWeek] ?? `${perWeek} times`} a week.`;
  return `Each day comes round about every ${Math.round(7 / perWeek)} days.`;
}

/**
 * Choose the routine: a preset, or a custom rotation built from day types,
 * run in order or by recovery. `value` undefined means automatic.
 */
export function SplitSheet({
  value,
  daysPerWeek,
  onSave,
  onClose,
}: {
  value: Split | undefined;
  daysPerWeek: number;
  onSave: (split: Split | undefined) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<DayType[]>(value?.days ?? []);
  const [order, setOrder] = useState<Split['order']>(value?.order ?? 'rotate');
  const [custom, setCustom] = useState(() => !!value?.days.length && !SPLIT_PRESETS.some((p) => p.days.join() === value.days.join()));

  const auto = days.length === 0 && !custom;
  const effective = auto ? splitFor(daysPerWeek) : days;
  const matches = (p: (typeof SPLIT_PRESETS)[number]) => !custom && p.days.join() === days.join();

  const move = (i: number, dir: -1 | 1) =>
    setDays((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  return (
    <Sheet open onClose={onClose} title="Your split" subtitle="Which days you rotate through. Weights and exercises still adapt to recovery.">
      {(close) => (
        <div className="stack lg">
          <div className="stack">
            {SPLIT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="option-card split-option"
                aria-pressed={matches(p)}
                onClick={() => {
                  setCustom(false);
                  setDays(p.days);
                }}
              >
                <span className="grow">
                  <strong>{p.name}</strong>
                  <span className="split-blurb">{p.blurb}</span>
                  <DayPills days={p.days.length ? p.days : splitFor(daysPerWeek)} />
                </span>
                <span className="split-radio" aria-hidden="true">
                  <Icon name="check" size={14} />
                </span>
              </button>
            ))}
            <button
              type="button"
              className="option-card split-option"
              aria-pressed={custom}
              onClick={() => {
                setCustom(true);
                if (!days.length) setDays(splitFor(daysPerWeek));
              }}
            >
              <span className="grow">
                <strong>Custom</strong>
                <span className="split-blurb">Build your own rotation from any days.</span>
              </span>
              <span className="split-radio" aria-hidden="true">
                <Icon name="check" size={14} />
              </span>
            </button>
          </div>

          {custom && (
            <section className="card split-builder" aria-label="Custom rotation">
              <ol className="split-days">
                {days.map((d, i) => (
                  <li key={i} className="split-day">
                    <span className="split-day-n display">{i + 1}</span>
                    <span className="grow">
                      <span className="tag" style={dayStyle(d)}>
                        {FOCUS_LABEL[d]}
                      </span>
                      <span className="small faint split-day-muscles">{FOCUS_MUSCLES[d].slice(0, 4).map((m) => MUSCLES[m].name).join(', ')}</span>
                    </span>
                    <button type="button" className="icon-btn sm plain" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move day ${i + 1} up`}>
                      <Icon name="chevronUp" size={17} />
                    </button>
                    <button type="button" className="icon-btn sm plain" onClick={() => move(i, 1)} disabled={i === days.length - 1} aria-label={`Move day ${i + 1} down`}>
                      <Icon name="chevronDown" size={17} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn sm plain"
                      onClick={() => setDays((cur) => cur.filter((_, j) => j !== i))}
                      disabled={days.length === 1}
                      aria-label={`Remove day ${i + 1}`}
                    >
                      <Icon name="x" size={17} />
                    </button>
                  </li>
                ))}
              </ol>
              <div className="field">
                <span>Add a day</span>
                <div className="chips wrap">
                  {DAY_TYPES.map((d) => (
                    <button key={d} type="button" className="chip" onClick={() => setDays((cur) => (cur.length < 7 ? [...cur, d] : cur))} disabled={days.length >= 7}>
                      <Icon name="plus" size={14} />
                      {FOCUS_LABEL[d]}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}

          {!auto && effective.length > 1 && (
            <div className="field">
              <span>Day order</span>
              <div className="segmented" role="group" aria-label="Day order">
                <button type="button" aria-pressed={order === 'rotate'} onClick={() => setOrder('rotate')}>
                  In order
                </button>
                <button type="button" aria-pressed={order === 'smart'} onClick={() => setOrder('smart')}>
                  Freshest first
                </button>
              </div>
              <p className="small faint">
                {order === 'rotate'
                  ? `Always the next day: ${effective.map((d) => DAY_SHORT[d]).join(' → ')} → repeat.`
                  : 'The coach picks whichever day your muscles are most ready for.'}
              </p>
            </div>
          )}

          <p className="small muted">
            <strong style={{ color: 'var(--text-1)' }}>{splitName(effective)}</strong> on {daysPerWeek} days a week. {splitCadence(effective.length, daysPerWeek)}
          </p>

          <button
            type="button"
            className="btn primary lg block"
            onClick={() => {
              onSave(auto ? undefined : { days, order });
              close();
            }}
          >
            Save split
          </button>
        </div>
      )}
    </Sheet>
  );
}

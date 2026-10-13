import type { CSSProperties } from 'react';

/** Labelled slider whose track fills up to the thumb. */
export function Range({ label, value, min, max, step = 1, onChange, format = String }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="field">
      <span className="row between">
        <span>{label}</span>
        <strong className="num" style={{ color: 'var(--text-1)' }}>
          {format(value)}
        </strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ '--fill': `${pct}%` } as CSSProperties} />
    </label>
  );
}

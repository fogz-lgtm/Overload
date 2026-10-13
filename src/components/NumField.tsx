import { useEffect, useRef, useState } from 'react';

/**
 * Numeric input that keeps its own text while focused, so partial input like
 * "82." isn't clobbered by re-renders, and reports parsed numbers upward.
 */
export function NumField({
  value,
  onChange,
  placeholder,
  label,
  decimals = 1,
  className = 'num-input',
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  label: string;
  decimals?: number;
  className?: string;
}) {
  const format = (v: number | undefined) => (v === undefined ? '' : String(Math.round(v * 10 ** decimals) / 10 ** decimals));
  const [text, setText] = useState(format(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value]);

  return (
    <input
      className={className}
      type="text"
      inputMode={decimals > 0 ? 'decimal' : 'numeric'}
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onBlur={() => {
        focused.current = false;
        setText(format(value));
      }}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.');
        if (!/^\d*\.?\d*$/.test(t)) return;
        setText(t);
        onChange(t === '' || t === '.' ? undefined : Number(t));
      }}
    />
  );
}

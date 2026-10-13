import { useEffect, useRef, useState } from 'react';

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `value` with an ease-out curve on first render. */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString(), duration = 900 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [n, setN] = useState(() => (reduced() ? value : 0));
  const from = useRef(0);
  useEffect(() => {
    if (reduced()) {
      setN(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(a + (value - a) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{format(n)}</>;
}

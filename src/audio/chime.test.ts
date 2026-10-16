import { describe, expect, it } from 'vitest';
import { CHIME_SECONDS, chimeSamples, restTrack } from './chime';

describe('chime', () => {
  it('rings without clipping and fades out clean', () => {
    const s = chimeSamples(44_100);
    expect(s.length).toBe(Math.round(CHIME_SECONDS * 44_100));
    let max = 0;
    for (const v of s) max = Math.max(max, Math.abs(v));
    expect(max).toBeCloseTo(0.85, 2);
    expect(s[0]).toBe(0);
    expect(Math.abs(s[s.length - 1]!)).toBeLessThan(1e-6);
    // Loud near the strikes, quiet by the end.
    const rms = (from: number, to: number) => Math.sqrt(s.slice(from, to).reduce((a, v) => a + v * v, 0) / (to - from));
    expect(rms(0.17 * 44_100, 0.3 * 44_100)).toBeGreaterThan(10 * rms(s.length - 4410, s.length));
  });

  it('stays below the limit of a low sample rate', () => {
    const s = chimeSamples(11_025);
    for (const v of s) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('restTrack', () => {
  it('is a valid WAV: silence for the rest, then the chime', () => {
    const rate = 11_025;
    const buf = restTrack(90, rate);
    const v = new DataView(buf);
    const text = (at: number, n: number) => String.fromCharCode(...new Uint8Array(buf, at, n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(rate);
    expect(v.getUint16(34, true)).toBe(16);
    const frames = v.getUint32(40, true) / 2;
    expect(frames).toBe(90 * rate + Math.round(CHIME_SECONDS * rate));
    expect(buf.byteLength).toBe(44 + frames * 2);
    // Nothing until the rest is over, then sound within the first strike.
    const sample = (i: number) => v.getInt16(44 + i * 2, true);
    let loudBefore = 0;
    for (let i = 0; i < 90 * rate; i += 97) loudBefore = Math.max(loudBefore, Math.abs(sample(i)));
    expect(loudBefore).toBe(0);
    let loudAfter = 0;
    for (let i = 90 * rate; i < 90 * rate + 0.3 * rate; i++) loudAfter = Math.max(loudAfter, Math.abs(sample(i)));
    expect(loudAfter).toBeGreaterThan(10_000);
  });

  it('handles a rest that has already run out', () => {
    const frames = new DataView(restTrack(-3, 8000)).getUint32(40, true) / 2;
    expect(frames).toBe(Math.round(CHIME_SECONDS * 8000));
  });
});

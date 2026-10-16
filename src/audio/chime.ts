// The rest-over chime, synthesized so the app ships no sound files, plus the
// audio track for the lock screen: silence for the rest, then the chime.
// Pure functions: samples and bytes in, no Web Audio.

/** Two bell strikes a fourth apart: "ding-DING". Times in seconds. */
const STRIKES = [
  { at: 0, hz: 987.77, gain: 0.8 }, // B5
  { at: 0.17, hz: 1318.51, gain: 1 }, // E6
];
/** Bell-like overtones: ratio to the note, level, and how fast each fades (per second). */
const PARTIALS = [
  { ratio: 1, level: 1, decay: 2.4 },
  { ratio: 2, level: 0.3, decay: 3.6 },
  { ratio: 3.01, level: 0.12, decay: 5.5 },
  { ratio: 4.17, level: 0.05, decay: 8 },
];
const ATTACK = 0.004;
/** Long enough for the second strike to ring out. */
export const CHIME_SECONDS = 1.7;
const PEAK = 0.85;

/** The chime as mono samples in [-1, 1] at `sampleRate`. Overtones above the rate's limit are left out. */
export function chimeSamples(sampleRate: number): Float32Array {
  const n = Math.round(CHIME_SECONDS * sampleRate);
  const out = new Float32Array(n);
  const nyquist = sampleRate * 0.45;
  for (const s of STRIKES) {
    const start = Math.round(s.at * sampleRate);
    for (const p of PARTIALS) {
      const hz = s.hz * p.ratio;
      if (hz >= nyquist) continue;
      const w = (2 * Math.PI * hz) / sampleRate;
      for (let i = start; i < n; i++) {
        const t = (i - start) / sampleRate;
        const env = Math.min(1, t / ATTACK) * Math.exp(-p.decay * t);
        out[i]! += s.gain * p.level * env * Math.sin(w * (i - start));
      }
    }
  }
  // Fade the very end so the track doesn't click.
  const fade = Math.round(0.05 * sampleRate);
  for (let i = 0; i < fade; i++) out[n - 1 - i]! *= i / fade;
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < n; i++) out[i]! *= PEAK / max;
  return out;
}

/**
 * A 16-bit mono WAV: `leadSeconds` of silence, then the chime. Played on the
 * lock screen, it dings at exactly the end of the rest with no code running.
 */
export function restTrack(leadSeconds: number, sampleRate: number): ArrayBuffer {
  const chime = chimeSamples(sampleRate);
  const lead = Math.max(0, Math.round(leadSeconds * sampleRate));
  const frames = lead + chime.length;
  const buf = new ArrayBuffer(44 + frames * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + frames * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  v.setUint32(40, frames * 2, true);
  // The silence is already zeros; only the chime needs writing.
  const at = 44 + lead * 2;
  for (let i = 0; i < chime.length; i++) v.setInt16(at + i * 2, Math.round(chime[i]! * 32767), true);
  return buf;
}

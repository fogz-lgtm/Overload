// Rest-over sound and the lock-screen rest timer.
//
// 'ding': a chime through Web Audio when the rest runs out with the app
// open. It mixes with music from other apps (on iPhone it's silent when the
// ringer switch is off).
//
// 'lock': each rest plays an audio track of silence ending in the chime, so
// it dings on time with the screen locked and no code running, and the lock
// screen's Now Playing card shows the countdown and the next set. Media
// playback takes over the phone's audio, so other apps' music pauses.

import { useSyncExternalStore } from 'react';
import type { RestSound } from '../engine/types';
import { CHIME_SECONDS, chimeSamples, restTrack } from './chime';

export type { RestSound };

export interface RestInfo {
  endsAt: number;
  total: number;
  /** The next set, as the workout screen shows it under the timer: "135 lb × 8". */
  next?: string;
  /** The same with the exercise named, for the lock screen: "Bench Press · 135 lb × 8". */
  detail?: string;
  /** The workout it belongs to. */
  workoutId?: string;
}

// ── The rest on the clock ──────────────────────────────────────────────────
// Kept here rather than in the workout screen, so it keeps running (and
// dings) while the lifter looks at another tab.

let current: RestInfo | null = null;
const listeners = new Set<() => void>();

export const getRest = () => current;

export function setRest(next: RestInfo | null | ((r: RestInfo | null) => RestInfo | null)): void {
  current = typeof next === 'function' ? next(current) : next;
  listeners.forEach((l) => l());
}

export function useRest(): RestInfo | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    getRest,
  );
}

/** Plenty for a chime; keeps a 3-minute rest's track around 4 MB. */
const TRACK_RATE = 11_025;
/** A rest track longer than this isn't worth building. */
const MAX_TRACK_SECONDS = 15 * 60;
/** Missed it by more than this (the app was in the background): no late ding. */
const LATE_MS = 3000;

// ── Web Audio chime ────────────────────────────────────────────────────────

interface AudioSession {
  type: string;
}

function setSessionType(type: 'ambient' | 'playback') {
  try {
    const s = (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
    if (s && s.type !== type) s.type = type;
  } catch {
    // Not supported; the browser picks.
  }
}

let ctx: AudioContext | undefined;
let chime: AudioBuffer | undefined;

function context(): AudioContext | undefined {
  if (ctx) return ctx;
  const AC = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return undefined;
  try {
    ctx = new AC();
  } catch {
    return undefined;
  }
  return ctx;
}

/**
 * Gets sound ready. Browsers (iPhone especially) only start audio from a
 * tap, so this runs whenever a set is ticked off.
 */
export function primeSound(mode: RestSound): void {
  if (mode === 'off') return;
  setSessionType(mode === 'lock' ? 'playback' : 'ambient');
  const c = context();
  if (!c) return;
  if (c.state !== 'running') void c.resume().catch(() => undefined);
  // A silent blip unlocks output on older iPhones.
  try {
    const blip = c.createBufferSource();
    blip.buffer = c.createBuffer(1, 1, c.sampleRate);
    blip.connect(c.destination);
    blip.start();
  } catch {
    // Nothing to unlock.
  }
}

/** Plays the chime now. */
export function playChime(): void {
  const c = context();
  if (!c) return;
  if (c.state !== 'running') void c.resume().catch(() => undefined);
  if (!chime || chime.sampleRate !== c.sampleRate) {
    const samples = chimeSamples(c.sampleRate);
    chime = c.createBuffer(1, samples.length, c.sampleRate);
    chime.getChannelData(0).set(samples);
  }
  const src = c.createBufferSource();
  src.buffer = chime;
  src.connect(c.destination);
  src.start();
}

// ── Lock-screen track ──────────────────────────────────────────────────────

let audio: HTMLAudioElement | undefined;
let trackUrl: string | undefined;
/** When the playing track's chime sounds, or 0 when no track is running. */
let chimeAt = 0;

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

function element(): HTMLAudioElement {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('ended', () => {
    chimeAt = 0;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  });
  audio.addEventListener('loadedmetadata', syncPosition);
  audio.addEventListener('seeked', syncPosition);
  bindLockScreenControls();
  return audio;
}

function syncPosition() {
  if (!audio || !('mediaSession' in navigator) || !Number.isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 });
  } catch {
    // Older browsers.
  }
}

function bindLockScreenControls() {
  if (!('mediaSession' in navigator)) return;
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch {
      // Action not supported here.
    }
  };
  // Pausing or skipping on the lock screen ends the rest; the skip buttons move the ding.
  const skip = () => {
    stopRestTrack();
    setRest(null);
  };
  set('pause', skip);
  set('stop', skip);
  set('nexttrack', skip);
  set('play', null);
  set('seekforward', () => nudge(-15));
  set('seekbackward', () => nudge(15));
}

/** Moves the ding by seeking within the track: `deltaSec` more (or less) rest. */
function nudge(deltaSec: number) {
  if (!audio || !chimeAt) return;
  const lead = audio.duration - CHIME_SECONDS;
  const at = Math.max(0, Math.min(lead, audio.currentTime - deltaSec));
  const moved = audio.currentTime - at;
  audio.currentTime = at;
  chimeAt += moved * 1000;
  setRest((r) => (r ? { ...r, endsAt: r.endsAt + moved * 1000, total: Math.max(5, r.total + moved) } : r));
  const r = getRest();
  if (r) describe(r);
}

/** The lock screen's Now Playing card: the rest and the set after it. */
function describe(rest: RestInfo) {
  if (!('mediaSession' in navigator) || !('MediaMetadata' in window)) return;
  const icon = (size: number) => ({ src: `${import.meta.env.BASE_URL}icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png' });
  const next = rest.detail ?? rest.next;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: `Rest · ${clock(rest.total)}`,
    artist: next ? `Next: ${next}` : 'Overload',
    album: 'Overload',
    artwork: [icon(192), icon(512)],
  });
}

/**
 * Starts (or restarts, after an adjustment) the lock-screen track for a rest.
 * Call from a tap. Returns false when the browser won't play it.
 */
export function startRestTrack(rest: RestInfo): boolean {
  const lead = Math.min(MAX_TRACK_SECONDS, (rest.endsAt - Date.now()) / 1000);
  if (lead <= 0) return false;
  const el = element();
  const old = trackUrl;
  trackUrl = URL.createObjectURL(new Blob([restTrack(lead, TRACK_RATE)], { type: 'audio/wav' }));
  el.src = trackUrl;
  if (old) URL.revokeObjectURL(old);
  chimeAt = Date.now() + lead * 1000;

  describe(rest);
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  const playing = el.play();
  playing?.catch(() => {
    chimeAt = 0;
  });
  return true;
}

/** Stops the lock-screen track: the rest was skipped, or the workout is over. */
export function stopRestTrack(): void {
  chimeAt = 0;
  if (!audio) return;
  audio.pause();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

/** Ends the lock-screen session entirely (leaving the workout). */
export function releaseRestAudio(): void {
  stopRestTrack();
  if (audio) {
    audio.removeAttribute('src');
    audio.load();
  }
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = undefined;
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
}

/**
 * The rest ran out with the app open. Chimes unless the lock-screen track is
 * already chiming, or the moment was missed while the app was in the background.
 */
export function restOver(mode: RestSound, endedAt: number): void {
  if (mode === 'off') return;
  const trackChiming = mode === 'lock' && chimeAt > 0 && audio && !audio.paused && Math.abs(chimeAt - endedAt) < 2500;
  if (trackChiming || Date.now() - endedAt > LATE_MS) return;
  playChime();
}

/** A rest is starting (from a tap): get sound ready and, in lock mode, start the track. */
export function restStarted(mode: RestSound, rest: RestInfo): void {
  primeSound(mode);
  if (mode === 'lock') startRestTrack(rest);
}

// ── Keep the screen on ─────────────────────────────────────────────────────

let wakeLock: WakeLockSentinel | null = null;

/** Asks the browser to keep the screen on. Released by the browser when the app is hidden; call again on return. */
export async function keepScreenOn(): Promise<boolean> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
  if (wakeLock && !wakeLock.released) return true;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    // Low battery mode, or not allowed.
    return false;
  }
}

export function letScreenSleep(): void {
  void wakeLock?.release().catch(() => undefined);
  wakeLock = null;
}

/** A test of the chosen sound: a ding now, or for the lock screen, a ten-second rest. */
export function testSound(mode: RestSound): void {
  primeSound(mode);
  if (mode === 'lock') startRestTrack({ endsAt: Date.now() + 10_000, total: 10, next: 'This is a test' });
  else if (mode === 'ding') playChime();
}

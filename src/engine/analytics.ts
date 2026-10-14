import { estimate1RM } from './load';
import { bestE1RM, groupSessions } from './progression';
import type { PerformedSet, Sex } from './types';

const DAY = 86_400_000;

// ── Strength score ──────────────────────────────────────────────────────────

export type LiftKey = 'squat' | 'bench' | 'deadlift' | 'press' | 'row';
export const LIFT_NAMES: Record<LiftKey, string> = {
  squat: 'Squat',
  bench: 'Bench press',
  deadlift: 'Deadlift',
  press: 'Overhead press',
  row: 'Row',
};

/**
 * Which logged exercises count toward each lift, and the factor that converts
 * their e1RM into a barbell-equivalent (dumbbell loads are per hand).
 */
const LIFT_SOURCES: Record<LiftKey, { id: string; factor: number }[]> = {
  squat: [
    { id: 'barbell-back-squat', factor: 1 },
    { id: 'front-squat', factor: 1 / 0.85 },
  ],
  bench: [
    { id: 'barbell-bench-press', factor: 1 },
    { id: 'dumbbell-bench-press', factor: 2 / 0.85 },
  ],
  deadlift: [
    { id: 'barbell-deadlift', factor: 1 },
    { id: 'trap-bar-deadlift', factor: 1 / 1.05 },
  ],
  press: [
    { id: 'barbell-overhead-press', factor: 1 },
    { id: 'dumbbell-shoulder-press', factor: 2 / 0.85 },
  ],
  row: [
    { id: 'barbell-row', factor: 1 },
    { id: 'dumbbell-row', factor: 1.9 },
  ],
};

/** 1RM ÷ bodyweight at beginner, novice, intermediate, advanced, elite. Approximate. */
const STANDARDS: Record<'male' | 'female', Record<LiftKey, number[]>> = {
  male: {
    squat: [0.75, 1.25, 1.5, 2.0, 2.5],
    bench: [0.5, 0.75, 1.0, 1.5, 1.9],
    deadlift: [1.0, 1.5, 2.0, 2.5, 3.0],
    press: [0.35, 0.55, 0.7, 0.95, 1.2],
    row: [0.5, 0.7, 0.9, 1.15, 1.4],
  },
  female: {
    squat: [0.5, 0.75, 1.0, 1.5, 1.9],
    bench: [0.25, 0.5, 0.65, 0.9, 1.15],
    deadlift: [0.6, 1.0, 1.3, 1.75, 2.2],
    press: [0.2, 0.35, 0.45, 0.65, 0.8],
    row: [0.3, 0.45, 0.6, 0.8, 1.0],
  },
};

export const LEVELS = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const;

function standardsFor(sex: Sex, lift: LiftKey): number[] {
  if (sex !== 'unspecified') return STANDARDS[sex][lift];
  return STANDARDS.male[lift].map((v, i) => (v + STANDARDS.female[lift][i]!) / 2);
}

/** Maps a bodyweight ratio onto 0–100: each level boundary is worth 20 points. */
export function ratioToScore(ratio: number, standards: number[]): number {
  if (ratio <= 0) return 0;
  if (ratio < standards[0]!) return (20 * ratio) / standards[0]!;
  for (let i = 0; i < standards.length - 1; i++) {
    const lo = standards[i]!;
    const hi = standards[i + 1]!;
    if (ratio < hi) return 20 * (i + 1) + (20 * (ratio - lo)) / (hi - lo);
  }
  return 100;
}

/** The highest standard reached (scores below the beginner standard still read "Beginner"). */
export function levelFor(score: number): (typeof LEVELS)[number] {
  return LEVELS[Math.min(4, Math.max(0, Math.floor(score / 20) - 1))]!;
}

export interface LiftScore {
  lift: LiftKey;
  e1rmKg: number;
  ratio: number;
  score: number;
  level: string;
  sourceId: string;
}

export function strengthScore(
  sets: PerformedSet[],
  bodyweightKg: number,
  sex: Sex,
  now: number,
  windowDays = 180,
): { overall: number; level: string; lifts: LiftScore[] } {
  const recent = sets.filter((s) => s.kind === 'working' && now - s.at <= windowDays * DAY);
  const lifts: LiftScore[] = [];
  for (const lift of Object.keys(LIFT_SOURCES) as LiftKey[]) {
    let best = 0;
    let sourceId = '';
    for (const src of LIFT_SOURCES[lift]) {
      const e = bestE1RM(recent.filter((s) => s.exerciseId === src.id)) * src.factor;
      if (e > best) {
        best = e;
        sourceId = src.id;
      }
    }
    if (best <= 0 || bodyweightKg <= 0) continue;
    const ratio = best / bodyweightKg;
    const score = ratioToScore(ratio, standardsFor(sex, lift));
    lifts.push({ lift, e1rmKg: best, ratio, score, level: levelFor(score), sourceId });
  }
  const overall = lifts.length ? lifts.reduce((a, l) => a + l.score, 0) / lifts.length : 0;
  return { overall, level: levelFor(overall), lifts };
}

// ── Personal records ───────────────────────────────────────────────────────

export interface PR {
  exerciseId: string;
  kind: 'e1rm' | 'weight' | 'reps';
  value: number;
  previous: number;
  /** For rep PRs, the weight they were achieved at. */
  weightKg?: number;
}

/** PRs set in `current` relative to everything in `prior`. First-ever logs aren't PRs. */
export function detectPRs(current: PerformedSet[], prior: PerformedSet[]): PR[] {
  const prs: PR[] = [];
  const ids = [...new Set(current.filter((s) => s.kind === 'working').map((s) => s.exerciseId))];
  for (const id of ids) {
    // Drop sets are light on purpose; a "rep record" at a drop weight is noise.
    const now = current.filter((s) => s.exerciseId === id && s.kind === 'working' && s.reps > 0 && !s.drop);
    const before = prior.filter((s) => s.exerciseId === id && s.kind === 'working' && s.reps > 0 && !s.drop);
    if (!before.length || !now.length) continue;

    const e1Now = Math.max(...now.map((s) => estimate1RM(s.weightKg, s.reps)));
    const e1Before = Math.max(...before.map((s) => estimate1RM(s.weightKg, s.reps)));
    if (e1Now > e1Before + 0.01 && e1Now > 0) prs.push({ exerciseId: id, kind: 'e1rm', value: e1Now, previous: e1Before });

    const wNow = Math.max(...now.map((s) => s.weightKg));
    const wBefore = Math.max(...before.map((s) => s.weightKg));
    if (wNow > wBefore + 0.01 && wNow > 0) prs.push({ exerciseId: id, kind: 'weight', value: wNow, previous: wBefore });

    // Most reps ever at this weight or heavier.
    let repPr: PR | undefined;
    for (const s of now) {
      const prev = Math.max(0, ...before.filter((b) => b.weightKg >= s.weightKg - 0.01).map((b) => b.reps));
      if (prev > 0 && s.reps > prev && (!repPr || s.reps - prev > repPr.value - repPr.previous)) {
        repPr = { exerciseId: id, kind: 'reps', value: s.reps, previous: prev, weightKg: s.weightKg };
      }
    }
    if (repPr) prs.push(repPr);
  }
  return prs;
}

// ── Trends ─────────────────────────────────────────────────────────────────

export interface SessionPoint {
  at: number;
  e1rmKg: number;
  topWeightKg: number;
  bestReps: number;
  volumeKg: number;
  sets: number;
}

export function exerciseTrend(sets: PerformedSet[]): SessionPoint[] {
  return groupSessions(sets)
    .map((s) => ({
      at: s.at,
      e1rmKg: bestE1RM(s.sets),
      topWeightKg: Math.max(...s.sets.map((x) => x.weightKg)),
      bestReps: Math.max(...s.sets.map((x) => x.reps)),
      volumeKg: s.sets.reduce((a, x) => a + x.weightKg * x.reps, 0),
      sets: s.sets.length,
    }))
    .reverse();
}

/** Consecutive weeks (Mon–Sun, counting back from this week) with at least one workout. */
export function weekStreak(workoutTimes: number[], now: number): number {
  const weekStart = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.getTime();
  };
  const weeks = new Set(workoutTimes.map(weekStart));
  let cursor = weekStart(now);
  // The current week doesn't break a streak until it's over.
  if (!weeks.has(cursor)) cursor = weekStart(cursor - DAY);
  let streak = 0;
  while (weeks.has(cursor)) {
    streak++;
    cursor = weekStart(cursor - DAY);
  }
  return streak;
}

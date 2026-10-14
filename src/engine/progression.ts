import { implementNoun, kitFor, type Kit } from './kit';
import { estimate1RM, formatWeight, toDisplay, weightForReps } from './load';
import type { Exercise, Experience, Goal, PerformedSet, Profile, SetEntry, Units } from './types';

const DAY = 86_400_000;

export interface GoalScheme {
  compound: [number, number];
  isolation: [number, number];
  rir: number;
  restCompound: number;
  restIsolation: number;
  setsCompound: number;
  setsIsolation: number;
}

export function goalScheme(goal: Goal, experience: Experience): GoalScheme {
  // Beginners keep an extra rep in reserve: technique first, fewer grinders.
  const rirBump = experience === 'beginner' ? 1 : 0;
  switch (goal) {
    case 'strength':
      return {
        compound: [3, 6],
        isolation: [8, 12],
        rir: 2 + rirBump,
        restCompound: 180,
        restIsolation: 90,
        setsCompound: experience === 'beginner' ? 3 : 4,
        setsIsolation: 3,
      };
    case 'hypertrophy':
      return {
        compound: [6, 10],
        isolation: [10, 15],
        rir: 1 + rirBump,
        restCompound: 120,
        restIsolation: 75,
        setsCompound: 3,
        setsIsolation: 3,
      };
    case 'general':
      return {
        compound: [6, 10],
        isolation: [10, 15],
        rir: 2 + rirBump,
        restCompound: 105,
        restIsolation: 60,
        setsCompound: 3,
        setsIsolation: 2,
      };
    case 'endurance':
      return {
        compound: [12, 15],
        isolation: [15, 20],
        rir: 2 + rirBump,
        restCompound: 60,
        restIsolation: 45,
        setsCompound: 3,
        setsIsolation: 2,
      };
  }
}

/** Holds, carries and hangs are prescribed in seconds rather than reps. */
export function isTimed(ex: Exercise): boolean {
  return /plank|\bhold\b|wall sit|carry|dead hang|l-sit|hollow/i.test(ex.name);
}

const isWeighted = (ex: Exercise) => ex.loading !== 'bodyweight' && ex.loading !== 'band';

export function repRangeFor(ex: Exercise, scheme: GoalScheme): [number, number] {
  if (isTimed(ex)) return [20, 60];
  if (!isWeighted(ex)) {
    // Very hard bodyweight moves live in low rep ranges no matter the goal.
    if (ex.skill === 3 || /nordic|pistol|handstand|muscle-up|dragon flag/i.test(ex.name)) return [3, 8];
    return ex.mechanic === 'compound' ? [5, 12] : [10, 20];
  }
  if (ex.pattern === 'calf_raise') return [Math.max(8, scheme.isolation[0]), Math.max(15, scheme.isolation[1])];
  return ex.mechanic === 'compound' ? scheme.compound : scheme.isolation;
}

export interface Prescription {
  weightKg: number;
  reps: number;
  rir: number;
  sets: number;
  repRange: [number, number];
  restSec: number;
  rationale: string;
  calibrating: boolean;
  deload: boolean;
}

export interface ProgressionInput {
  exercise: Exercise;
  /** Working sets previously performed for this exercise (any order). */
  history: PerformedSet[];
  profile: Pick<Profile, 'goal' | 'experience' | 'units' | 'bodyweightKg'>;
  sets: number;
  now: number;
  /** History of swap-compatible exercises, used to seed a first session. */
  related?: { exercise: Exercise; history: PerformedSet[] }[];
  /** The loads this gym can actually make; a well-stocked gym when absent. */
  kit?: Kit;
}

interface Session {
  workoutId: string;
  at: number;
  sets: PerformedSet[];
}

export function groupSessions(history: PerformedSet[]): Session[] {
  const by = new Map<string, Session>();
  for (const s of history) {
    if (s.kind !== 'working' || s.reps <= 0) continue;
    const sess = by.get(s.workoutId) ?? { workoutId: s.workoutId, at: s.at, sets: [] };
    sess.sets.push(s);
    sess.at = Math.max(sess.at, s.at);
    by.set(s.workoutId, sess);
  }
  for (const sess of by.values()) sess.sets.sort((a, b) => a.at - b.at);
  return [...by.values()].sort((a, b) => b.at - a.at);
}

/** Best estimated 1RM in a list of sets, counting logged reps in reserve. */
export function bestE1RM(sets: PerformedSet[]): number {
  let best = 0;
  for (const s of sets) {
    if (s.kind !== 'working') continue;
    best = Math.max(best, estimate1RM(s.weightKg, s.reps + (s.rir ?? 0)));
  }
  return best;
}

const EXPERIENCE_SEED: Record<Experience, number> = { beginner: 0.55, intermediate: 0.8, advanced: 1 };

/** Reps past the top of the range a lifter builds to when the next load up isn't there yet. */
const EXTRA_REPS = 5;

/** The next load up. Heavy barbell squats and hinges move two steps at a time. */
function nextUp(kit: Kit, ex: Exercise, weightKg: number): number | undefined {
  const one = kit.up(weightKg);
  const bigLowerBody =
    ex.loading === 'barbell' &&
    ex.mechanic === 'compound' &&
    (ex.pattern === 'squat' || ex.pattern === 'hinge') &&
    weightKg >= 60;
  return bigLowerBody && one !== undefined ? (kit.up(one) ?? one) : one;
}

/** A lighter load for backing off, within `maxCut` of the current one; undefined when the gym has none that close. */
function backOff(kit: Kit, weightKg: number, cut: number, maxCut = cut * 2): number | undefined {
  let w = kit.snap(weightKg * (1 - cut));
  if (w >= weightKg - 0.01) w = kit.down(weightKg) ?? weightKg;
  return w < weightKg - 0.01 && w >= weightKg * (1 - maxCut) - 0.01 ? w : undefined;
}

/** Inverse Epley: reps to failure at `weightKg` for a given e1RM. */
function repsAt(e1rm: number, weightKg: number): number {
  return weightKg > 0 ? 30 * (e1rm / weightKg - 1) : 0;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function describeSets(sets: PerformedSet[], units: Units, timed: boolean): string {
  const reps = sets.map((s) => s.reps);
  const allSame = reps.every((r) => r === reps[0]);
  const repText = allSame ? `${sets.length}×${reps[0]}${timed ? 's' : ''}` : reps.join('/') + (timed ? 's' : '');
  const w = sets[0]?.weightKg ?? 0;
  return w > 0 ? `${repText} @ ${formatWeight(w, units)}` : repText;
}

/** The empty implement: a barbell can't be loaded lighter than the bar itself. */
export function minLoadKg(ex: Exercise, units: Units): number {
  return kitFor(ex, undefined, units).bar ?? 0;
}

export function prescribe(input: ProgressionInput): Prescription {
  const kit = input.kit ?? kitFor(input.exercise, undefined, input.profile.units);
  return fitToKit(prescribeRaw(input, kit), kit, input.exercise, input.profile.units);
}

/**
 * Lands a prescription on a load the gym can actually make. When that moves
 * the weight noticeably (the heaviest dumbbell is lighter than ideal, or the
 * rack has gaps) the reps move with it so the effort stays the same.
 */
function fitToKit(rx: Prescription, kit: Kit, ex: Exercise, units: Units): Prescription {
  if (rx.weightKg <= 0 || kit.implement === 'band' || kit.implement === 'bodyweight') return rx;
  const fitted = kit.snap(rx.weightKg);
  if (Math.abs(fitted - rx.weightKg) < 0.05) return { ...rx, weightKg: fitted };
  if (fitted > rx.weightKg && fitted <= kit.min + 0.01) {
    const start = kit.bar !== undefined ? 'Starting with the empty bar.' : `Starting with the lightest ${implementNoun(kit.implement)} here.`;
    return { ...rx, weightKg: fitted, rationale: `${rx.rationale} ${start}` };
  }
  if (isTimed(ex) || Math.abs(fitted - rx.weightKg) / rx.weightKg < 0.05) return { ...rx, weightKg: fitted };

  // The loads either side of the ideal; take the nearer one that keeps the reps in range.
  const [lo, hi] = rx.repRange;
  const e1rm = estimate1RM(rx.weightKg, rx.reps + rx.rir);
  // Epley undersells high reps at light loads, so rounding never pushes reps below the range.
  const repsFor = (w: number) => Math.round(Math.min(hi + EXTRA_REPS, Math.max(lo, repsAt(e1rm, w) - rx.rir)));
  const below = fitted <= rx.weightKg ? fitted : kit.down(fitted);
  const above = fitted >= rx.weightKg ? fitted : kit.up(fitted);
  const options = [below, above].filter((w): w is number => w !== undefined && w > 0);
  const miss = (w: number) => {
    const r = repsAt(e1rm, w) - rx.rir;
    return r < lo ? lo - r : r > hi + EXTRA_REPS ? r - hi - EXTRA_REPS : 0;
  };
  options.sort((a, b) => miss(a) - miss(b) || Math.abs(a - rx.weightKg) - Math.abs(b - rx.weightKg));
  const weightKg = options[0] ?? fitted;
  const reps = repsFor(weightKg);
  const atMax = kit.max !== undefined && weightKg >= kit.max - 0.01 && weightKg < rx.weightKg;
  const why = atMax
    ? `${formatWeight(weightKg, units)} is the heaviest ${implementNoun(kit.implement)} here, so ${reps} reps instead.`
    : `${formatWeight(weightKg, units)} is the closest load here, so ${reps} reps.`;
  return { ...rx, weightKg, reps, rationale: `${rx.rationale} ${why}` };
}

function prescribeRaw(input: ProgressionInput, kit: Kit): Prescription {
  const { exercise: ex, profile, now } = input;
  const { units } = profile;
  const scheme = goalScheme(profile.goal, profile.experience);
  const range = repRangeFor(ex, scheme);
  const timed = isTimed(ex);
  const rir = timed ? 0 : scheme.rir;
  const restSec =
    (ex.mechanic === 'compound' ? scheme.restCompound : scheme.restIsolation) + (ex.fatigue === 3 ? 30 : 0);
  const base = { rir, sets: input.sets, repRange: range, restSec, calibrating: false, deload: false };
  const unit = timed ? 's' : ' reps';

  const sessions = groupSessions(input.history);
  const last = sessions[0];

  // ── First time on this exercise ────────────────────────────────────────
  if (!last) {
    const reps = timed ? range[0] + 10 : Math.round((range[0] + range[1]) / 2);
    if (!isWeighted(ex)) {
      return {
        ...base,
        weightKg: 0,
        reps,
        calibrating: true,
        rationale: `First time — aim for about ${reps}${unit}, stopping with ${rir || 1}–2 left in the tank. Next session is calibrated from what you log.`,
      };
    }
    for (const rel of input.related ?? []) {
      const relBest = bestE1RM(groupSessions(rel.history)[0]?.sets ?? []);
      if (relBest > 0 && rel.exercise.bwRatio && ex.bwRatio && isWeighted(rel.exercise)) {
        const e1rm = relBest * (ex.bwRatio / rel.exercise.bwRatio);
        const weightKg = weightForReps(e1rm, reps + rir) * 0.95;
        return {
          ...base,
          weightKg,
          reps,
          calibrating: true,
          rationale: `First time — estimated from your ${rel.exercise.name}. Log honestly and we'll fine-tune next session.`,
        };
      }
    }
    const ratio = ex.bwRatio ?? 0.25;
    const tenRm = ratio * profile.bodyweightKg * EXPERIENCE_SEED[profile.experience];
    const weightKg = weightForReps(estimate1RM(tenRm, 10), reps + rir);
    return {
      ...base,
      weightKg,
      reps,
      calibrating: true,
      rationale: `First time — a conservative starting estimate. If it feels light, add weight for later sets; next session is calibrated from what you log.`,
    };
  }

  // ── We have history ────────────────────────────────────────────────────
  const topWeight = Math.max(...last.sets.map((s) => s.weightKg));
  const working = last.sets.filter((s) => Math.abs(s.weightKg - topWeight) < 0.01);
  const minReps = Math.min(...working.map((s) => s.reps));
  const loggedRir = working.filter((s) => s.rir !== undefined).map((s) => s.rir!);
  const avgRir = loggedRir.length ? avg(loggedRir) : undefined;
  const lastText = describeSets(working, units, timed);
  const daysOff = (now - last.at) / DAY;

  // Long layoff: ease back in before applying normal progression rules.
  if (daysOff > 21 && isWeighted(ex)) {
    const cut = daysOff > 42 ? 0.8 : 0.9;
    const eased = backOff(kit, topWeight, 1 - cut);
    return {
      ...base,
      weightKg: eased ?? topWeight,
      reps: range[0] + (eased ? 1 : 0),
      rationale: eased
        ? `It's been ${Math.round(daysOff / 7)} weeks since you last did this (${lastText}). Easing back in at ${Math.round((eased / topWeight) * 100)}%.`
        : `It's been ${Math.round(daysOff / 7)} weeks since you last did this (${lastText}). Same weight, bottom of the range, to ease back in.`,
    };
  }

  const reachedTop = working.every((s) => s.reps >= range[1]);
  const effortOk = avgRir === undefined || avgRir >= rir - 0.5;
  const missed = working.filter((s) => s.reps < range[0]).length > working.length / 2;

  // Stall: best e1RM hasn't improved across the last three sessions.
  const e1rms = sessions.slice(0, 4).map((s) => bestE1RM(s.sets));
  const stalled =
    e1rms.length >= 4 && e1rms[3]! > 0 && Math.max(e1rms[0]!, e1rms[1]!, e1rms[2]!) <= e1rms[3]! * 1.005;

  if (!isWeighted(ex) && topWeight <= 0) {
    if (reachedTop && effortOk) {
      const reps = minReps + (timed ? 5 : 1);
      return {
        ...base,
        weightKg: 0,
        reps,
        rationale: `You hit the top of the range last time (${lastText}). Go for ${reps}${unit} — or add load / a harder variation to bring reps back down.`,
      };
    }
    const reps = Math.min(range[1], Math.max(range[0], minReps + (timed ? 5 : 1)));
    return {
      ...base,
      weightKg: 0,
      reps,
      rationale: `Last time: ${lastText}. Beat it — aim for ${reps}${unit} on every set.`,
    };
  }

  if (reachedTop && effortOk) {
    let next = nextUp(kit, ex, topWeight);
    const e1rm = bestE1RM(working);
    // Lots left in the tank: let the e1RM justify a bigger (capped) jump.
    if (next !== undefined && avgRir !== undefined && avgRir >= rir + 2) {
      const fromE1rm = kit.snap(Math.min(weightForReps(e1rm, range[0] + rir), topWeight * 1.1));
      if (fromE1rm > next) next = fromE1rm;
    }
    // No heavier load here, or the next one is too far to reach the rep range even to failure: build reps first.
    const fallsShort = next !== undefined && !timed && repsAt(e1rm, next) + 0.01 < range[0] - 1;
    if ((next === undefined || fallsShort) && minReps < range[1] + EXTRA_REPS) {
      const reps = Math.min(range[1] + EXTRA_REPS, minReps + (timed ? 5 : 1));
      const noun = implementNoun(kit.implement);
      return {
        ...base,
        weightKg: topWeight,
        reps,
        rationale:
          next === undefined
            ? `You hit ${lastText} — top of the range — and ${formatWeight(topWeight, units)} is the heaviest ${noun} here. Keep it and push for ${reps}${unit}.`
            : `You hit ${lastText}. The next ${noun} up is ${formatWeight(next, units)}, a big jump, so stay at ${formatWeight(topWeight, units)} and build to ${reps}${unit} first.`,
      };
    }
    if (next === undefined) {
      return {
        ...base,
        weightKg: topWeight,
        reps: minReps,
        rationale: `${lastText} on the heaviest ${implementNoun(kit.implement)} here. Hold it, slow the lowering down, and keep every rep clean.`,
      };
    }
    const weightKg = next;
    const startReps = fallsShort ? Math.max(1, Math.floor(repsAt(e1rm, weightKg) - rir)) : range[0];
    if (startReps < Math.max(3, range[0] - 3)) {
      return {
        ...base,
        weightKg: topWeight,
        reps: minReps,
        sets: Math.min(input.sets + 1, 5),
        rationale: `${lastText}, and the next ${implementNoun(kit.implement)} up (${formatWeight(weightKg, units)}) is still too big a jump. One more set at ${formatWeight(topWeight, units)} instead.`,
      };
    }
    const jump = toDisplay(weightKg - topWeight, units);
    return {
      ...base,
      weightKg,
      reps: startReps,
      rationale: `You hit ${lastText}${avgRir !== undefined ? ` with ~${Math.round(avgRir)} in reserve` : ''} — top of the range. +${Math.round(jump * 10) / 10} ${units}; reset to ${startReps}${unit} and build back up.`,
    };
  }

  if (missed && stalled) {
    const lighter = backOff(kit, topWeight, 0.1);
    return {
      ...base,
      weightKg: lighter ?? topWeight,
      reps: lighter ? range[0] + 1 : range[0],
      sets: Math.max(2, input.sets - 1),
      deload: true,
      rationale: lighter
        ? `No progress for 3 sessions (last: ${lastText}). Backing off to ${formatWeight(lighter, units)} with one fewer set to rebuild momentum — this is planned, not a step back.`
        : `No progress for 3 sessions (last: ${lastText}). One fewer set and the bottom of the range to rebuild momentum — this is planned, not a step back.`,
    };
  }

  if (missed) {
    const lastAvg = avg(working.map((s) => s.reps));
    if (lastAvg < range[0] - 2) {
      const e1rm = bestE1RM(working);
      let weightKg = kit.snap(weightForReps(e1rm, range[0] + rir));
      if (weightKg >= topWeight - 0.01) weightKg = kit.down(topWeight) ?? topWeight;
      return {
        ...base,
        weightKg,
        reps: range[0],
        rationale: `${formatWeight(topWeight, units)} was too heavy for the ${range[0]}–${range[1]} range (${lastText}). Adjusted to match your estimated strength.`,
      };
    }
    return {
      ...base,
      weightKg: topWeight,
      reps: range[0],
      rationale: `Stay at ${formatWeight(topWeight, units)} and own ${range[0]}${unit} on every set (last: ${lastText}).`,
    };
  }

  if (avgRir !== undefined && avgRir < rir - 1) {
    return {
      ...base,
      weightKg: topWeight,
      reps: minReps,
      rationale: `Last time was close to failure (${lastText}, ~${Math.round(avgRir)} RIR). Match ${minReps}${unit} with crisper reps before pushing on.`,
    };
  }

  const reps = Math.min(range[1], Math.max(range[0], minReps + 1));
  return {
    ...base,
    weightKg: topWeight,
    reps,
    rationale: `Same weight, one more rep: last time ${lastText}. Aim for ${reps}${unit} on every set.`,
  };
}

/**
 * In-session autoregulation: after a working set, nudge the targets of the
 * remaining sets when the set was clearly easier or harder than prescribed.
 * Sets the lifter already typed a weight into are left alone.
 */
export function autoregulate(
  sets: SetEntry[],
  doneIndex: number,
  ex: Exercise,
  units: Units,
  kit: Kit = kitFor(ex, undefined, units),
): { sets: SetEntry[]; note?: string } {
  const s = sets[doneIndex];
  if (!s || s.kind !== 'working' || !s.done || s.reps === undefined || !isWeighted(ex) || isTimed(ex)) return { sets };
  const used = s.weightKg ?? s.targetWeightKg;
  if (used <= 0) return { sets };

  const easy = s.reps >= s.targetReps + 3 || (s.rir !== undefined && s.rir >= s.targetRir + 2 && s.reps >= s.targetReps);
  const hard = s.reps <= s.targetReps - 3 || (s.rir === 0 && s.reps < s.targetReps - 1);
  if (!easy && !hard) return { sets };

  let next: number | undefined;
  if (easy) next = nextUp(kit, ex, used);
  else {
    next = kit.snap(used * 0.925);
    if (next >= used - 0.01) next = kit.down(used);
  }
  if (next === undefined || Math.abs(next - used) < 0.01) {
    if (!easy) return { sets };
    // Already on the heaviest load here: chase reps instead.
    let bumped = 0;
    const out = sets.map((x, i) => {
      if (i <= doneIndex || x.kind !== 'working' || x.done || x.weightKg !== undefined) return x;
      bumped++;
      return { ...x, targetReps: x.targetReps + 2 };
    });
    if (!bumped) return { sets };
    return { sets: out, note: `That looked easy, and ${formatWeight(used, units)} is the heaviest ${implementNoun(kit.implement)} here — +2 reps on the next ${bumped === 1 ? 'set' : 'sets'}.` };
  }

  let changed = 0;
  const out = sets.map((x, i) => {
    if (i <= doneIndex || x.kind !== 'working' || x.done || x.weightKg !== undefined) return x;
    changed++;
    return { ...x, targetWeightKg: next };
  });
  if (!changed) return { sets };
  return {
    sets: out,
    note: easy
      ? `That looked easy — next ${changed === 1 ? 'set' : 'sets'} bumped to ${formatWeight(next, units)}.`
      : `Tough set — next ${changed === 1 ? 'set' : 'sets'} dropped to ${formatWeight(next, units)} to stay in range.`,
  };
}

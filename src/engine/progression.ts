import { estimate1RM, formatWeight, loadIncrement, roundLoad, toDisplay, fromDisplay, weightForReps } from './load';
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

function stepKg(ex: Exercise, units: Units, weightKg: number): number {
  const inc = loadIncrement(ex.loading === 'bodyweight' ? 'bodyweight' : ex.loading, units);
  const bigLowerBody =
    ex.loading === 'barbell' &&
    ex.mechanic === 'compound' &&
    (ex.pattern === 'squat' || ex.pattern === 'hinge') &&
    weightKg >= 60;
  return fromDisplay(bigLowerBody ? inc * 2 : inc, units);
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

export function prescribe(input: ProgressionInput): Prescription {
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
        const weightKg = roundLoad(weightForReps(e1rm, reps + rir) * 0.95, ex.loading, units);
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
    const weightKg = roundLoad(weightForReps(estimate1RM(tenRm, 10), reps + rir), ex.loading, units);
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
    return {
      ...base,
      weightKg: roundLoad(topWeight * cut, ex.loading, units),
      reps: range[0] + 1,
      rationale: `It's been ${Math.round(daysOff / 7)} weeks since you last did this (${lastText}). Easing back in at ${Math.round(cut * 100)}%.`,
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
    const step = stepKg(ex, units, topWeight);
    let weightKg = roundLoad(topWeight + step, ex.loading, units);
    if (weightKg <= topWeight + 0.01) weightKg = topWeight + step;
    // Lots left in the tank: let the e1RM justify a bigger (capped) jump.
    if (avgRir !== undefined && avgRir >= rir + 2) {
      const e1rm = bestE1RM(working);
      const fromE1rm = roundLoad(Math.min(weightForReps(e1rm, range[0] + rir), topWeight * 1.1), ex.loading, units);
      weightKg = Math.max(weightKg, fromE1rm);
    }
    const jump = toDisplay(weightKg - topWeight, units);
    return {
      ...base,
      weightKg,
      reps: range[0],
      rationale: `You hit ${lastText}${avgRir !== undefined ? ` with ~${Math.round(avgRir)} in reserve` : ''} — top of the range. +${Math.round(jump * 10) / 10} ${units}; reset to ${range[0]}${unit} and build back up.`,
    };
  }

  if (missed && stalled) {
    return {
      ...base,
      weightKg: roundLoad(topWeight * 0.9, ex.loading, units),
      reps: range[0] + 1,
      sets: Math.max(2, input.sets - 1),
      deload: true,
      rationale: `No progress for 3 sessions (last: ${lastText}). Backing off 10% with one fewer set to rebuild momentum — this is planned, not a step back.`,
    };
  }

  if (missed) {
    const lastAvg = avg(working.map((s) => s.reps));
    if (lastAvg < range[0] - 2) {
      const e1rm = bestE1RM(working);
      const weightKg = roundLoad(weightForReps(e1rm, range[0] + rir), ex.loading, units);
      return {
        ...base,
        weightKg: Math.min(weightKg, topWeight),
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
): { sets: SetEntry[]; note?: string } {
  const s = sets[doneIndex];
  if (!s || s.kind !== 'working' || !s.done || s.reps === undefined || !isWeighted(ex) || isTimed(ex)) return { sets };
  const used = s.weightKg ?? s.targetWeightKg;
  if (used <= 0) return { sets };

  const easy = s.reps >= s.targetReps + 3 || (s.rir !== undefined && s.rir >= s.targetRir + 2 && s.reps >= s.targetReps);
  const hard = s.reps <= s.targetReps - 3 || (s.rir === 0 && s.reps < s.targetReps - 1);
  if (!easy && !hard) return { sets };

  let next = easy ? roundLoad(used + stepKg(ex, units, used), ex.loading, units) : roundLoad(used * 0.925, ex.loading, units);
  if (easy && next <= used) next = used + stepKg(ex, units, used);
  if (hard && next >= used) next = Math.max(0, used - stepKg(ex, units, used));

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

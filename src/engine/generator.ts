import { warmupSets } from './load';
import { MUSCLES, PRIORITY_MUSCLES, weeklySetTarget } from './muscles';
import { goalScheme, minLoadKg, prescribe, type Prescription } from './progression';
import type {
  Equipment,
  Exercise,
  ExercisePref,
  MovementPattern,
  MuscleId,
  PerformedSet,
  Profile,
  RecoveryMap,
  SetEntry,
  WorkoutExercise,
} from './types';
import { dayKey, hashString, listJoin, mulberry32, uid } from './util';
import { volumeDeficit } from './volume';

export type Focus = 'auto' | 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'arms' | 'core';

export const FOCUS_LABEL: Record<Focus, string> = {
  auto: 'Smart pick',
  full: 'Full body',
  upper: 'Upper body',
  lower: 'Lower body',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  arms: 'Arms & shoulders',
  core: 'Core',
};

export const FOCUS_MUSCLES: Record<Exclude<Focus, 'auto'>, MuscleId[]> = {
  full: ['quads', 'chest', 'lats', 'upper_back', 'hamstrings', 'glutes', 'side_delts', 'rear_delts', 'biceps', 'triceps', 'calves', 'abs'],
  upper: ['chest', 'lats', 'upper_back', 'side_delts', 'rear_delts', 'front_delts', 'biceps', 'triceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abs', 'obliques'],
  push: ['chest', 'side_delts', 'front_delts', 'triceps'],
  pull: ['lats', 'upper_back', 'rear_delts', 'biceps', 'traps', 'forearms'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'adductors'],
  arms: ['biceps', 'triceps', 'side_delts', 'rear_delts', 'forearms'],
  core: ['abs', 'obliques', 'lower_back'],
};

const LARGE = new Set<MuscleId>(['quads', 'glutes', 'hamstrings', 'chest', 'lats', 'upper_back']);
const LOADABLE = new Set<Equipment>(['barbell', 'dumbbells', 'kettlebells', 'cable', 'machines', 'leg_press', 'smith_machine']);

interface Slot {
  patterns: MovementPattern[];
  muscles: MuscleId[];
}

/**
 * The big movement patterns each session type is built around. Slots are filled
 * first; accessories then fill the remaining time by muscle-volume need.
 */
const ANCHORS: Record<Exclude<Focus, 'auto'>, Slot[]> = {
  full: [
    { patterns: ['squat', 'lunge'], muscles: ['quads'] },
    { patterns: ['horizontal_push', 'vertical_push'], muscles: ['chest', 'front_delts'] },
    { patterns: ['horizontal_pull', 'vertical_pull'], muscles: ['lats', 'upper_back'] },
    { patterns: ['hinge'], muscles: ['hamstrings', 'glutes'] },
  ],
  upper: [
    { patterns: ['horizontal_push'], muscles: ['chest'] },
    { patterns: ['vertical_pull', 'horizontal_pull'], muscles: ['lats', 'upper_back'] },
    { patterns: ['vertical_push'], muscles: ['front_delts', 'side_delts'] },
    { patterns: ['horizontal_pull', 'vertical_pull'], muscles: ['upper_back', 'lats'] },
  ],
  lower: [
    { patterns: ['squat'], muscles: ['quads'] },
    { patterns: ['hinge'], muscles: ['hamstrings', 'glutes'] },
    { patterns: ['lunge', 'knee_flexion'], muscles: ['quads', 'glutes', 'hamstrings'] },
  ],
  push: [
    { patterns: ['horizontal_push'], muscles: ['chest'] },
    { patterns: ['vertical_push'], muscles: ['front_delts', 'side_delts'] },
    { patterns: ['horizontal_push'], muscles: ['chest'] },
  ],
  pull: [
    { patterns: ['vertical_pull'], muscles: ['lats'] },
    { patterns: ['horizontal_pull'], muscles: ['upper_back', 'lats'] },
  ],
  legs: [
    { patterns: ['squat'], muscles: ['quads'] },
    { patterns: ['hinge'], muscles: ['hamstrings', 'glutes'] },
    { patterns: ['lunge', 'squat'], muscles: ['quads', 'glutes'] },
  ],
  arms: [],
  core: [],
};

/** The rotation a lifter with this many days per week follows. */
export function splitFor(daysPerWeek: number): Exclude<Focus, 'auto'>[] {
  if (daysPerWeek <= 3) return ['full'];
  if (daysPerWeek === 4) return ['upper', 'lower'];
  return ['push', 'pull', 'legs'];
}

/** Times per week each muscle gets trained under the lifter's split. */
function weeklyFrequency(daysPerWeek: number): number {
  const split = splitFor(daysPerWeek);
  return Math.max(1, daysPerWeek / split.length);
}

export interface GenerateInput {
  profile: Profile;
  equipment: Equipment[];
  exercises: Exercise[];
  /** Every working set in the log — drives progression and exercise continuity. */
  history: PerformedSet[];
  recovery: RecoveryMap;
  weekly: Record<MuscleId, number>;
  prefs: Record<string, ExercisePref>;
  now: number;
  focus?: Focus;
  minutes?: number;
  avoidMuscles?: MuscleId[];
  /** Change to get a different (but equally valid) workout. */
  seed?: number;
}

export interface GeneratedWorkout {
  name: string;
  focus: MuscleId[];
  focusKind: Exclude<Focus, 'auto'>;
  summary: string;
  estimatedMinutes: number;
  exercises: WorkoutExercise[];
}

export function isAvailable(ex: Exercise, equipment: Equipment[]): boolean {
  return ex.equipment.every((e) => equipment.includes(e));
}

export function pickFocus(input: GenerateInput): { focus: Exclude<Focus, 'auto'>; reason: string } {
  if (input.focus && input.focus !== 'auto') return { focus: input.focus, reason: 'You picked this focus.' };
  const options = splitFor(input.profile.daysPerWeek);
  if (options.length === 1) return { focus: options[0]!, reason: 'Full-body suits your schedule.' };
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const f of options) {
    const key = FOCUS_MUSCLES[f].filter((m) => PRIORITY_MUSCLES.includes(m));
    const score =
      key.reduce(
        (acc, m) => acc + input.recovery[m] * 0.6 + volumeDeficit(m, input.weekly[m], input.profile.goal) * 0.4,
        0,
      ) / key.length;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return { focus: best, reason: `${FOCUS_LABEL[best]} muscles are the freshest and furthest from this week's target.` };
}

interface Ctx {
  input: GenerateInput;
  lastUsed: Map<string, number>;
  useCount: Map<string, number>;
  rand: () => number;
}

function recentUsage(history: PerformedSet[], now: number) {
  const lastUsed = new Map<string, number>();
  const useCount = new Map<string, number>();
  const seen = new Set<string>();
  for (const s of history) {
    if (now - s.at > 42 * 86_400_000) continue;
    lastUsed.set(s.exerciseId, Math.max(lastUsed.get(s.exerciseId) ?? 0, s.at));
    const key = `${s.workoutId}:${s.exerciseId}`;
    if (!seen.has(key)) {
      seen.add(key);
      useCount.set(s.exerciseId, (useCount.get(s.exerciseId) ?? 0) + 1);
    }
  }
  return { lastUsed, useCount };
}

/** Higher is better. Exported so swap suggestions rank the same way. */
export function scoreExercise(
  ex: Exercise,
  muscle: MuscleId,
  ctx: Ctx,
  chosen: Exercise[],
): number {
  const { input } = ctx;
  const avoid = new Set(input.avoidMuscles ?? []);
  if (ex.primary.some((m) => avoid.has(m))) return -Infinity;

  let score = 0;
  const preferCompound = LARGE.has(muscle) && !chosen.some((c) => c.primary.includes(muscle));
  if (preferCompound) score += ex.mechanic === 'compound' ? 3 : 0;
  else score += ex.mechanic === 'isolation' ? 2 : 0.5;

  // Continuity: repeating exercises is what makes progressive overload work.
  const last = ctx.lastUsed.get(ex.id);
  if (last !== undefined) {
    const days = (input.now - last) / 86_400_000;
    score += 3 + Math.min(1.5, (ctx.useCount.get(ex.id) ?? 0) * 0.3);
    // ...but don't repeat the exact same movement within ~2 days.
    if (days < 2) score -= 2;
  }
  if (input.prefs[ex.id]?.favorite) score += 3;

  const skillPenalty = { beginner: 2, intermediate: 0.5, advanced: 0 }[input.profile.experience];
  score -= (ex.skill - 1) * skillPenalty;

  for (const m of ex.primary) if (input.recovery[m] < 0.5) score -= 2;
  for (const m of ex.secondary) {
    if (avoid.has(m)) score -= 3;
    else if (input.recovery[m] < 0.4) score -= 1;
  }
  if (ex.primary.length === 1 && ex.primary[0] === muscle) score += 0.5;
  // Loadable exercises progress more predictably than bodyweight or bands,
  // so only fall back to those when the gym has nothing better.
  const weighted = ex.loading !== 'bodyweight' && ex.loading !== 'band';
  const canLoad = input.equipment.some((e) => LOADABLE.has(e));
  if (weighted) score += 1.5;
  else if (canLoad && ex.mechanic === 'isolation') score -= 1.5;
  if (input.profile.goal === 'strength' && ex.loading === 'barbell' && ex.mechanic === 'compound') score += 1.5;
  // Kettlebells jump in big steps, which makes steady overload awkward.
  if (ex.loading === 'kettlebell' && input.equipment.some((e) => e === 'barbell' || e === 'dumbbells' || e === 'machines')) score -= 1;
  // Experienced lifters get more from leading with a big, heavy compound.
  if (chosen.length === 0 && input.profile.experience !== 'beginner') score += 0.75 * (ex.fatigue - 1);
  if (chosen.some((c) => c.pattern === ex.pattern && c.primary.some((m) => ex.primary.includes(m)))) score -= 4;
  else if (chosen.some((c) => c.pattern === ex.pattern)) score -= 1.5;
  score -= 0.4 * ex.fatigue * (chosen.length / 3);
  score += ctx.rand() * 1.5;
  return score;
}

/** Ramp-up sets pay off on heavy bilateral compounds, not lunges or swings. */
export function needsWarmup(ex: Exercise): boolean {
  return (
    ex.mechanic === 'compound' &&
    !ex.unilateral &&
    (ex.loading === 'barbell' || ex.loading === 'machine' || ex.loading === 'dumbbell') &&
    ex.pattern !== 'lunge' &&
    ex.pattern !== 'carry'
  );
}

function setTime(restSec: number): number {
  return 40 + restSec;
}

export function buildSets(
  ex: Exercise,
  rx: Prescription,
  units: Profile['units'],
  withWarmup: boolean,
  heavy: boolean,
): SetEntry[] {
  const sets: SetEntry[] = [];
  if (withWarmup && ex.mechanic === 'compound') {
    for (const w of warmupSets(rx.weightKg, ex.loading, units, heavy, minLoadKg(ex, units))) {
      sets.push({ id: uid(), kind: 'warmup', targetWeightKg: w.weightKg, targetReps: w.reps, targetRir: 5, done: false });
    }
  }
  for (let i = 0; i < rx.sets; i++) {
    sets.push({
      id: uid(),
      kind: 'working',
      targetWeightKg: rx.weightKg,
      targetReps: rx.reps,
      targetRir: rx.rir,
      done: false,
    });
  }
  return sets;
}

/** Prescribe a single exercise (used by the generator, swaps, and "add exercise"). */
export function planExercise(
  ex: Exercise,
  input: Pick<GenerateInput, 'profile' | 'history' | 'now' | 'exercises'>,
  sets: number,
  withWarmup: boolean,
): WorkoutExercise {
  const byId = new Map(input.exercises.map((e) => [e.id, e]));
  const related = (ex.aliases ?? [])
    .map((id) => byId.get(id))
    .filter((e): e is Exercise => !!e)
    .map((e) => ({ exercise: e, history: input.history.filter((s) => s.exerciseId === e.id) }))
    .filter((r) => r.history.length > 0);
  const rx = prescribe({
    exercise: ex,
    history: input.history.filter((s) => s.exerciseId === ex.id),
    profile: input.profile,
    sets,
    now: input.now,
    related,
  });
  return {
    id: uid(),
    exerciseId: ex.id,
    sets: buildSets(ex, rx, input.profile.units, withWarmup, input.profile.goal === 'strength' && ex.loading === 'barbell'),
    restSec: rx.restSec,
    repRange: rx.repRange,
    rationale: rx.rationale,
  };
}

export function generateWorkout(input: GenerateInput): GeneratedWorkout {
  const { profile } = input;
  const scheme = goalScheme(profile.goal, profile.experience);
  const minutes = input.minutes ?? profile.sessionMinutes;
  const seed = input.seed ?? hashString(dayKey(input.now));
  const ctx: Ctx = { input, rand: mulberry32(seed), ...recentUsage(input.history, input.now) };
  const avoid = new Set(input.avoidMuscles ?? []);

  const { focus, reason } = pickFocus(input);
  const freq = weeklyFrequency(profile.daysPerWeek);

  // Per-session set targets, trimmed for muscles that are still recovering or
  // have already hit their weekly ceiling.
  const skipped: string[] = [];
  const need = new Map<MuscleId, number>();
  for (const m of FOCUS_MUSCLES[focus]) {
    if (avoid.has(m)) continue;
    const { min, max } = weeklySetTarget(m, profile.goal);
    const cap = LARGE.has(m) ? 8 : 6;
    let target = Math.min(cap, Math.max(2, Math.round((min + max) / 2 / freq)));
    const done = input.weekly[m];
    if (done >= max && max > 0) {
      skipped.push(`${MUSCLES[m].name.toLowerCase()} (weekly volume met)`);
      continue;
    }
    target = Math.min(target, Math.max(2, Math.ceil(max - done)));
    const rec = input.recovery[m];
    if (rec < 0.5) {
      skipped.push(`${MUSCLES[m].name.toLowerCase()} (${Math.round(rec * 100)}% recovered)`);
      continue;
    }
    if (rec < 0.75) target = Math.max(2, Math.round(target * 0.6));
    need.set(m, target);
  }
  // If everything is beat up, still offer a light session on the freshest muscles.
  if (need.size === 0) {
    const fresh = FOCUS_MUSCLES[focus]
      .filter((m) => !avoid.has(m))
      .sort((a, b) => input.recovery[b] - input.recovery[a])
      .slice(0, 3);
    for (const m of fresh) need.set(m, 2);
  }

  const available = input.exercises.filter(
    (e) => isAvailable(e, input.equipment) && !input.prefs[e.id]?.excluded,
  );

  const planned = new Map<MuscleId, number>();
  const chosen: Exercise[] = [];
  const setsFor = new Map<string, number>();
  let budgetSec = Math.max(10, minutes - 5) * 60;
  const maxExercises = Math.min(9, Math.max(3, Math.round(minutes / 8)));

  const warmupCost = (ex: Exercise) =>
    chosen.length < 2 && ex.mechanic === 'compound' && ex.loading !== 'bodyweight' && ex.loading !== 'band' ? 150 : 0;
  const add = (pick: Exercise, sets: number) => {
    const rest = pick.mechanic === 'compound' ? scheme.restCompound : scheme.restIsolation;
    budgetSec -= sets * setTime(rest) + warmupCost(pick);
    chosen.push(pick);
    setsFor.set(pick.id, sets);
    for (const m of pick.primary) planned.set(m, (planned.get(m) ?? 0) + sets);
    for (const m of pick.secondary) planned.set(m, (planned.get(m) ?? 0) + sets / 2);
  };

  // The lead lift stays first; the other anchors rotate toward whatever is
  // furthest behind this week, so a lift squeezed out today leads next time.
  const [lead, ...rest] = ANCHORS[focus];
  const deficit = (slot: Slot) =>
    Math.max(0, ...slot.muscles.map((m) => volumeDeficit(m, input.weekly[m], profile.goal))) + ctx.rand() * 0.05;
  const slots = lead ? [lead, ...rest.map((s) => ({ s, d: deficit(s) })).sort((a, b) => b.d - a.d).map((x) => x.s)] : [];

  for (const slot of slots) {
    if (chosen.length >= maxExercises || budgetSec <= 0) break;
    const target = slot.muscles.find((m) => need.has(m));
    if (!target) continue;
    // A repeated slot (e.g. a second chest press) only fills if still needed.
    const repeat = chosen.some((c) => slot.patterns.includes(c.pattern) && c.primary.includes(target));
    if (repeat && (planned.get(target) ?? 0) >= need.get(target)!) continue;
    let pick: Exercise | undefined;
    let pickScore = -Infinity;
    for (const ex of available) {
      if (!slot.patterns.includes(ex.pattern) || chosen.includes(ex)) continue;
      if (ex.mechanic !== 'compound' || !ex.primary.some((m) => slot.muscles.includes(m))) continue;
      const s = scoreExercise(ex, target, ctx, chosen);
      if (s > pickScore) {
        pickScore = s;
        pick = ex;
      }
    }
    if (!pick || pickScore === -Infinity) continue;
    const recovering = pick.primary.some((m) => input.recovery[m] < 0.75);
    let sets = recovering ? Math.max(2, scheme.setsCompound - 1) : scheme.setsCompound;
    const perSet = setTime(scheme.restCompound + (pick.fatigue === 3 ? 30 : 0));
    while (sets > 2 && sets * perSet + warmupCost(pick) > budgetSec + 150) sets--;
    if (sets * perSet + warmupCost(pick) > budgetSec + 150 && chosen.length >= 2) continue;
    add(pick, sets);
  }

  while (chosen.length < maxExercises) {
    // The muscle furthest from its session target, weighted toward big, fresh muscles.
    let muscle: MuscleId | undefined;
    let bestGap = 0;
    for (const [m, target] of need) {
      const gap = (target - (planned.get(m) ?? 0)) / target;
      if (target - (planned.get(m) ?? 0) < 1) continue;
      const priority = LARGE.has(m) ? 1.3 : PRIORITY_MUSCLES.includes(m) ? 1 : 0.45;
      const weight = gap * priority * (0.5 + input.recovery[m] / 2);
      if (weight > bestGap) {
        bestGap = weight;
        muscle = m;
      }
    }
    if (!muscle) break;

    let pick: Exercise | undefined;
    let pickScore = -Infinity;
    for (const ex of available) {
      if (!ex.primary.includes(muscle) || chosen.includes(ex)) continue;
      const s = scoreExercise(ex, muscle, ctx, chosen);
      if (s > pickScore) {
        pickScore = s;
        pick = ex;
      }
    }
    if (!pick || pickScore === -Infinity) {
      need.delete(muscle);
      continue;
    }

    const remaining = need.get(muscle)! - (planned.get(muscle) ?? 0);
    const twin = chosen.find((c) => c.pattern === pick!.pattern && c.primary.some((m) => pick!.primary.includes(m)));
    if (twin) {
      // Another lateral raise is just more lateral raises: add a set to the one we have.
      const have = setsFor.get(twin.id)!;
      if (have >= 5) {
        need.delete(muscle);
        continue;
      }
      const extra = Math.min(5 - have, Math.max(1, Math.ceil(remaining)));
      const rest = twin.mechanic === 'compound' ? scheme.restCompound : scheme.restIsolation;
      if (extra * setTime(rest) > budgetSec + 150) break;
      budgetSec -= extra * setTime(rest);
      setsFor.set(twin.id, have + extra);
      for (const m of twin.primary) planned.set(m, (planned.get(m) ?? 0) + extra);
      for (const m of twin.secondary) planned.set(m, (planned.get(m) ?? 0) + extra / 2);
      continue;
    }
    const base = pick.mechanic === 'compound' ? scheme.setsCompound : scheme.setsIsolation;
    const sets = Math.max(2, Math.min(base, Math.ceil(remaining)));
    const rest = pick.mechanic === 'compound' ? scheme.restCompound : scheme.restIsolation;
    // Allow a small overrun rather than ending a session noticeably short.
    if (sets * setTime(rest) + warmupCost(pick) > budgetSec + 150 && chosen.length >= 2) break;
    add(pick, sets);
  }

  // Heavy, technical compounds first; core work last.
  const order = (e: Exercise) =>
    (e.pattern === 'core' || e.pattern === 'carry' ? 100 : 0) + (e.mechanic === 'compound' ? 0 : 10) - e.fatigue;
  chosen.sort((a, b) => order(a) - order(b));

  let warmups = 0;
  const exercises = chosen.map((ex) => {
    const withWarmup = warmups < 2 && needsWarmup(ex);
    if (withWarmup) warmups++;
    return planExercise(ex, input, setsFor.get(ex.id)!, withWarmup);
  });

  const focusMuscles = [...need.keys()].filter((m) => (planned.get(m) ?? 0) > 0);
  // Name the session after what it trains directly, not spill-over from presses and rows.
  const direct = new Map<MuscleId, number>();
  for (const ex of chosen) {
    const weight = setsFor.get(ex.id)! * (ex.mechanic === 'compound' ? 1.5 : 1);
    for (const m of ex.primary) direct.set(m, (direct.get(m) ?? 0) + weight * (LARGE.has(m) ? 1.2 : 1));
  }
  const top = [...direct.keys()]
    .sort((a, b) => direct.get(b)! - direct.get(a)!)
    .slice(0, 3)
    .map((m) => MUSCLES[m].name);

  const freshest = focusMuscles
    .filter((m) => PRIORITY_MUSCLES.includes(m))
    .slice(0, 2)
    .map(
      (m) =>
        `${MUSCLES[m].name} ${Math.round(input.recovery[m] * 100)}% fresh, ${round1(input.weekly[m])}/${weeklySetTarget(m, profile.goal).min || weeklySetTarget(m, profile.goal).max} sets this week`,
    );
  const summary = [reason, freshest.length ? `${freshest.join('; ')}.` : '', skipped.length ? `Skipping ${listJoin(skipped)}.` : '']
    .filter(Boolean)
    .join(' ');

  return {
    name: `${FOCUS_LABEL[focus]} · ${listJoin(top)}`,
    focus: focusMuscles,
    focusKind: focus,
    summary,
    estimatedMinutes: estimateMinutes(exercises),
    exercises,
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function estimateMinutes(exercises: WorkoutExercise[]): number {
  let sec = 5 * 60;
  for (const we of exercises) {
    for (const s of we.sets) sec += s.kind === 'warmup' ? 60 : setTime(we.restSec);
  }
  return Math.round(sec / 60);
}

/** Ranked alternatives for swapping an exercise mid-workout. */
export function swapOptions(
  current: Exercise,
  input: GenerateInput,
  inWorkout: string[],
  limit = 8,
): Exercise[] {
  const ctx: Ctx = { input, rand: mulberry32(1), ...recentUsage(input.history, input.now) };
  const muscle = current.primary[0]!;
  return input.exercises
    .filter(
      (e) =>
        e.id !== current.id &&
        !inWorkout.includes(e.id) &&
        isAvailable(e, input.equipment) &&
        !input.prefs[e.id]?.excluded &&
        e.primary.some((m) => current.primary.includes(m)),
    )
    .map((e) => ({
      e,
      s:
        scoreExercise(e, muscle, ctx, []) +
        (e.pattern === current.pattern ? 3 : 0) +
        (current.aliases?.includes(e.id) ? 2 : 0),
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.e);
}


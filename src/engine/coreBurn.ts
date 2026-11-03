// A core burn: a short ab circuit tacked onto the end of a workout. A few
// moves that each hit the trunk a different way, done round by round with
// barely a breath between them.

import { isAvailable, planExercise, type GenerateInput } from './generator';
import { isTimed } from './progression';
import type { CoreBurnEdit, Exercise, PerformedSet, SetEntry, WorkoutExercise } from './types';
import { dayKey, hashString, mulberry32, uid } from './util';

export const CORE_BURN_LENGTHS = [5, 8, 10] as const;
export const CORE_BURN = 'core-burn';
/** Time to get into the next move. */
export const TRANSITION_SEC = 10;
/** Breather after each full round. */
export const ROUND_REST_SEC = 30;

/** What a move asks of the trunk. A burn takes one of each it can, and finishes on a hold. */
export type CoreRole = 'flex' | 'rotate' | 'lateral' | 'brace';
const ROLE_ORDER: CoreRole[] = ['flex', 'rotate', 'lateral', 'brace'];
/** Which roles a short burn keeps first: it always gets a crunch and a hold. */
const PICK_ORDER: CoreRole[] = ['flex', 'brace', 'rotate', 'lateral'];

/** The move's role in a burn, or null if it isn't an ab or oblique move that suits one. */
export function coreRole(ex: Exercise): CoreRole | null {
  if (!ex.primary.some((m) => m === 'abs' || m === 'obliques')) return null;
  if (ex.pattern === 'carry' || ex.mechanic === 'compound' || ex.skill === 3) return null;
  const n = `${ex.id} ${ex.name}`.toLowerCase();
  if (/side.?plank|side.?bend|copenhagen|oblique crunch|heel tap/.test(n)) return 'lateral';
  if (/twist|chop|pallof|bicycle|windshield/.test(n)) return 'rotate';
  if (/plank|dead.?bug|hollow|mountain|bird.?dog|rollout|body.?saw/.test(n)) return 'brace';
  return 'flex';
}

/** A fresh lifter's target per move: reps, or seconds for holds (per side where it's one-sided). */
function defaultTarget(ex: Exercise): number {
  const n = ex.id;
  if (isTimed(ex)) return ex.unilateral ? 20 : 30;
  if (/mountain/.test(n)) return 30;
  if (/bicycle|twist/.test(n)) return 20;
  if (/v-up|hanging|vertical/.test(n)) return 10;
  if (/dead-bug/.test(n)) return 16;
  if (/leg-raise|reverse/.test(n)) return 12;
  return 15;
}

/** Seconds a set takes, for sizing the burn to the time asked for. */
function workSeconds(ex: Exercise, target: number): number {
  if (isTimed(ex)) return target * (ex.unilateral ? 2 : 1);
  const perRep = /mountain|bicycle|twist/.test(ex.id) ? 1.2 : 2.5;
  return target * perRep * (ex.unilateral ? 2 : 1);
}

/** Last time's best on this move, nudged up: a burn should still get a little harder. */
function progressed(ex: Exercise, history: PerformedSet[], fallback: number): number {
  const past = history.filter((s) => s.exerciseId === ex.id && s.kind === 'working');
  if (!past.length) return fallback;
  const last = Math.max(...past.map((s) => s.at));
  const best = Math.max(...past.filter((s) => last - s.at < 3 * 3600_000).map((s) => s.reps));
  const step = isTimed(ex) ? 5 : best >= 20 ? 2 : 1;
  return Math.min(Math.round(fallback * 1.8), best + step);
}

type BurnInput = Pick<GenerateInput, 'profile' | 'exercises' | 'equipment' | 'prefs' | 'history' | 'now' | 'weights'>;

/** One move of a burn: `rounds` sets, no warm-up, near failure, short rests. */
export function burnMove(ex: Exercise, input: BurnInput, rounds: number, circuit = CORE_BURN): WorkoutExercise {
  const scale = input.profile.experience === 'beginner' ? 0.8 : input.profile.experience === 'advanced' ? 1.2 : 1;
  const target = progressed(ex, input.history, Math.round(defaultTarget(ex) * scale));
  // Loaded moves (cable crunch, side bend) take their weight from the usual prescription.
  const weightKg = ex.loading === 'bodyweight' || ex.loading === 'band' ? 0 : (planExercise(ex, input, 1, false).sets.find((s) => s.kind === 'working')?.targetWeightKg ?? 0);
  const sets: SetEntry[] = Array.from({ length: rounds }, () => ({ id: uid(), kind: 'working', targetWeightKg: weightKg, targetReps: target, targetRir: 1, done: false }));
  const unit = isTimed(ex) ? ' seconds' : ' reps';
  const each = ex.unilateral ? ' each side' : /bicycle|twist|mountain|dead-bug/.test(ex.id) ? ', counting both sides' : '';
  return {
    id: uid(),
    exerciseId: ex.id,
    sets,
    restSec: TRANSITION_SEC,
    repRange: [Math.max(1, target - 5), target + 5],
    rationale: `Core burn: ${target}${unit}${each}, then straight into the next move. ${ROUND_REST_SEC} seconds' rest after each round.`,
    circuit,
  };
}

export interface CoreBurnPlan {
  minutes: number;
  rounds: number;
  exercises: WorkoutExercise[];
  /** Roughly how long it runs, in minutes. */
  estimate: number;
}

/** Ab and oblique moves this gym can do, ranked for a burn: favourites, quick to set up, then a bit of chance. */
function candidates(input: BurnInput, exclude: Set<string>, rand: () => number) {
  const beginner = input.profile.experience === 'beginner';
  return input.exercises
    .filter((e) => !exclude.has(e.id) && !input.prefs[e.id]?.excluded && isAvailable(e, input.equipment))
    .map((e) => ({ e, role: coreRole(e) }))
    .filter((x): x is { e: Exercise; role: CoreRole } => x.role !== null)
    .map((x) => {
      let score = rand() * 2;
      if (input.prefs[x.e.id]?.favorite) score += 3;
      if (x.e.loading === 'bodyweight') score += 1; // no setup between moves
      if (x.e.loading === 'cable') score -= 0.5;
      if (beginner && x.e.skill > 1) score -= 2;
      return { ...x, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Builds a core burn of about `minutes`. Keeps `moves` (from an earlier pick)
 * where this gym can still do them; fills the rest by role, one of each first.
 */
export function buildCoreBurn(input: BurnInput, minutes: number, opts: { exclude?: string[]; moves?: string[]; rounds?: number; seed?: number } = {}): CoreBurnPlan {
  const rand = mulberry32(opts.seed ?? 1);
  const exclude = new Set(opts.exclude ?? []);
  const ranked = candidates(input, exclude, rand);
  const byId = new Map(ranked.map((x) => [x.e.id, x]));
  const kept = (opts.moves ?? []).map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);

  // A burn picked before comes back as it was, as long as the gym still has its moves.
  const rebuild = kept.length > 0;
  // Otherwise up to five moves: the best of each role, then the best of the rest.
  const picked = [...kept];
  if (!rebuild) {
    for (const role of PICK_ORDER) {
      if (picked.some((p) => p.role === role)) continue;
      const best = ranked.find((x) => x.role === role && !picked.includes(x));
      if (best) picked.push(best);
    }
    for (const x of ranked) if (picked.length < 5 && !picked.includes(x)) picked.push(x);
  }

  if (!picked.length) return { minutes, rounds: 0, exercises: [], estimate: 0 };

  // Pick the size that lands closest to the time asked for. Kept moves stay in; extra slots go to whatever ranks next.
  const target = minutes * 60;
  const sizes = rebuild ? [picked.length] : [3, 4, 5].filter((n) => n <= picked.length);
  let best = { n: picked.length, rounds: 2, sec: Infinity };
  for (const n of sizes.length ? sizes : [picked.length]) {
    const moves = picked.slice(0, n);
    for (const rounds of opts.rounds && rebuild ? [opts.rounds] : [2, 3]) {
      const perRound = moves.reduce((a, m) => a + workSeconds(m.e, progressed(m.e, input.history, defaultTarget(m.e))) + TRANSITION_SEC, 0);
      const sec = perRound * rounds + ROUND_REST_SEC * (rounds - 1);
      if (Math.abs(sec - target) < Math.abs(best.sec - target)) best = { n, rounds, sec };
    }
  }
  const moves = picked.slice(0, best.n).sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  const exercises = moves.map((m) => burnMove(m.e, input, best.rounds));
  return { minutes, rounds: best.rounds, exercises, estimate: Math.max(1, Math.round(best.sec / 60)) };
}

// ── Running a circuit ──────────────────────────────────────────────────────

/** Every set in the order it's done: straight through, except circuits go round by round. */
export function setOrder(exercises: WorkoutExercise[]): { we: WorkoutExercise; index: number }[] {
  const out: { we: WorkoutExercise; index: number }[] = [];
  for (let i = 0; i < exercises.length; ) {
    const we = exercises[i]!;
    if (!we.circuit) {
      we.sets.forEach((_, index) => out.push({ we, index }));
      i++;
      continue;
    }
    let j = i;
    while (j < exercises.length && exercises[j]!.circuit === we.circuit) j++;
    const group = exercises.slice(i, j);
    const rounds = Math.max(...group.map((g) => g.sets.length));
    for (let r = 0; r < rounds; r++) for (const g of group) if (r < g.sets.length) out.push({ we: g, index: r });
    i = j;
  }
  return out;
}

/**
 * The set to do after this one: the next one not done in order, wrapping
 * round to anything skipped earlier. `pause` is the rest before it.
 */
export function nextAfter(exercises: WorkoutExercise[], weId: string, index: number): { we: WorkoutExercise; index: number; pause?: number } | null {
  const order = setOrder(exercises);
  const at = order.findIndex((o) => o.we.id === weId && o.index === index);
  const open = (o: { we: WorkoutExercise; index: number }) => !o.we.sets[o.index]!.done;
  const next = order.slice(at + 1).find(open) ?? order.slice(0, Math.max(0, at)).find(open);
  if (!next) return null;
  const from = order[at]?.we;
  if (from?.circuit && next.we.circuit === from.circuit) {
    // Same round: just switch moves. A new round: a short breather.
    return { ...next, pause: next.index === index ? from.restSec : ROUND_REST_SEC };
  }
  return next;
}

/** The exercise whose set is up next. */
export function currentExercise(exercises: WorkoutExercise[]): WorkoutExercise | undefined {
  return setOrder(exercises).find((o) => !o.we.sets[o.index]!.done)?.we;
}

// ── On a planned day ───────────────────────────────────────────────────────

/**
 * The day's core burn: one the lifter added or shaped, none if they took it
 * off, otherwise the everyday one from their settings.
 */
export function burnFor(edit: CoreBurnEdit | null | undefined, profile: BurnInput['profile']): CoreBurnEdit | undefined {
  const minutes = profile.style?.coreBurn;
  if (edit === null) return undefined;
  if (edit) return edit.auto && !minutes ? undefined : edit;
  return minutes ? { minutes, moves: [] } : undefined;
}

/** Adds the day's core burn (if there is one) to a freshly built session. */
export function withCoreBurn<T extends { exercises: WorkoutExercise[]; estimatedMinutes: number }>(
  gen: T,
  edit: CoreBurnEdit | null | undefined,
  input: BurnInput,
  estimate: (exercises: WorkoutExercise[]) => number,
): T {
  const burn = burnFor(edit, input.profile);
  if (!burn || gen.exercises.some((e) => e.circuit)) return gen;
  // Seeded by the day alone, so the forecast and the day itself pick the same moves, and a re-roll keeps them.
  const seed = hashString(`${dayKey(input.now)}:${CORE_BURN}`);
  const added = buildCoreBurn(input, burn.minutes, { moves: burn.moves, rounds: burn.rounds, exclude: gen.exercises.map((e) => e.exerciseId), seed }).exercises;
  if (!added.length) return gen;
  const exercises = [...gen.exercises, ...added];
  return { ...gen, exercises, estimatedMinutes: estimate(exercises) };
}

/** The burn's moves after one is swapped (or, with `to` null, dropped). */
export function swapBurnMove<B extends { moves: string[] }>(burn: B, from: string, to: string | null): B {
  return { ...burn, moves: to ? burn.moves.map((m) => (m === from ? to : m)) : burn.moves.filter((m) => m !== from) };
}

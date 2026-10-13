import { describe, expect, it } from 'vitest';
import { detectPRs, exerciseTrend, levelFor, ratioToScore, strengthScore, weekStreak } from './analytics';
import type { PerformedSet } from './types';

const DAY = 86_400_000;
const NOW = new Date(2026, 5, 3, 12).getTime(); // a Wednesday

const set = (exerciseId: string, daysAgo: number, weightKg: number, reps: number, workoutId = `w${daysAgo}`): PerformedSet => ({
  workoutId,
  exerciseId,
  at: NOW - daysAgo * DAY,
  weightKg,
  reps,
  kind: 'working',
});

describe('strength score', () => {
  it('maps level boundaries to multiples of 20', () => {
    const std = [1, 1.5, 2, 2.5, 3];
    expect(ratioToScore(1, std)).toBe(20);
    expect(ratioToScore(2, std)).toBe(60);
    expect(ratioToScore(1.75, std)).toBe(50);
    expect(ratioToScore(4, std)).toBe(100);
    expect(levelFor(10)).toBe('Beginner');
    expect(levelFor(65)).toBe('Intermediate');
    expect(levelFor(100)).toBe('Elite');
  });

  it('scores lifts relative to bodyweight', () => {
    const sets = [set('barbell-bench-press', 5, 80, 5), set('barbell-back-squat', 4, 120, 5)];
    const s = strengthScore(sets, 80, 'male', NOW);
    expect(s.lifts.map((l) => l.lift).sort()).toEqual(['bench', 'squat']);
    const benchScore = s.lifts.find((l) => l.lift === 'bench')!;
    expect(benchScore.level).toBe('Intermediate');
  });

  it('converts dumbbell lifts to barbell equivalents', () => {
    const s = strengthScore([set('dumbbell-bench-press', 2, 30, 8)], 80, 'unspecified', NOW);
    expect(s.lifts[0]!.e1rmKg).toBeGreaterThan(80);
  });
});

describe('PRs', () => {
  it('finds e1RM, weight and rep PRs', () => {
    const prior = [set('bench', 7, 80, 8), set('bench', 7, 85, 5)];
    const current = [set('bench', 0, 87.5, 5, 'now'), set('bench', 0, 80, 10, 'now')];
    const kinds = detectPRs(current, prior).map((p) => p.kind).sort();
    expect(kinds).toEqual(['e1rm', 'reps', 'weight']);
  });
  it('does not call a first-ever log a PR', () => {
    expect(detectPRs([set('bench', 0, 100, 5)], [])).toEqual([]);
  });
});

describe('trends', () => {
  it('returns one point per session, oldest first', () => {
    const t = exerciseTrend([set('x', 7, 80, 8, 'a'), set('x', 7, 80, 7, 'a'), set('x', 0, 82.5, 8, 'b')]);
    expect(t).toHaveLength(2);
    expect(t[0]!.topWeightKg).toBe(80);
    expect(t[0]!.volumeKg).toBe(1200);
    expect(t[1]!.topWeightKg).toBe(82.5);
  });

  it('counts consecutive training weeks', () => {
    expect(weekStreak([NOW - 1 * DAY, NOW - 8 * DAY, NOW - 15 * DAY], NOW)).toBe(3);
    expect(weekStreak([NOW - 8 * DAY, NOW - 15 * DAY], NOW)).toBe(2);
    expect(weekStreak([NOW - 22 * DAY], NOW)).toBe(0);
  });
});

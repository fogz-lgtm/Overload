import { describe, expect, it } from 'vitest';
import { estimate1RM, formatWeight, lbToKg, platesPerSide, roundLoad, warmupSets, weightForReps } from './load';

describe('e1RM', () => {
  it('is the load itself for a single', () => {
    expect(estimate1RM(100, 1)).toBe(100);
  });
  it('follows Epley and inverts cleanly', () => {
    const e = estimate1RM(100, 10);
    expect(e).toBeCloseTo(133.33, 1);
    expect(weightForReps(e, 10)).toBeCloseTo(100, 5);
  });
  it('returns 0 for empty sets', () => {
    expect(estimate1RM(0, 5)).toBe(0);
    expect(estimate1RM(50, 0)).toBe(0);
  });
});

describe('rounding', () => {
  it('rounds barbell loads to 2.5 kg', () => {
    expect(roundLoad(61.2, 'barbell', 'kg')).toBe(60);
    expect(roundLoad(63.8, 'barbell', 'kg')).toBe(65);
  });
  it('rounds in pounds when the lifter uses pounds', () => {
    const kg = roundLoad(lbToKg(137), 'barbell', 'lb');
    expect(formatWeight(kg, 'lb')).toBe('135 lb');
  });
  it('never rounds a positive load down to zero', () => {
    expect(roundLoad(0.4, 'dumbbell', 'kg')).toBe(2);
  });
});

describe('plates', () => {
  it('loads 100 kg as 25+15 per side', () => {
    expect(platesPerSide(100, 'kg')).toEqual({ plates: [25, 15], remainder: 0 });
  });
  it('loads 225 lb as two 45s per side', () => {
    expect(platesPerSide(lbToKg(225), 'lb').plates).toEqual([45, 45]);
  });
});

describe('warm-ups', () => {
  it('ramps up with strictly increasing loads below the working weight', () => {
    const sets = warmupSets(140, 'barbell', 'kg', true);
    expect(sets[0]).toEqual({ weightKg: 20, reps: 10 });
    for (let i = 1; i < sets.length; i++) {
      expect(sets[i]!.weightKg).toBeGreaterThan(sets[i - 1]!.weightKg);
      expect(sets[i]!.weightKg).toBeLessThan(140);
    }
  });
  it('skips bodyweight work', () => {
    expect(warmupSets(0, 'bodyweight', 'kg', true)).toEqual([]);
  });
});

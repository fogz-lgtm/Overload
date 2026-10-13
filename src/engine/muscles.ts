import type { Goal, MuscleId } from './types';

export interface MuscleInfo {
  id: MuscleId;
  name: string;
  region: 'push' | 'pull' | 'legs' | 'core';
  /** Hours for accumulated fatigue to halve. Bigger muscles recover slower. */
  halfLifeHours: number;
  /** Fatigue units (≈ hard sets) that drain the muscle to 0% fresh. */
  capacity: number;
  /**
   * Weekly hard-set landmarks for hypertrophy-focused training:
   * minimum effective volume and the top of the productive range.
   * Loosely based on published volume-landmark guidelines; scaled per goal.
   */
  mev: number;
  mav: number;
}

export const MUSCLES: Record<MuscleId, MuscleInfo> = {
  chest: { id: 'chest', name: 'Chest', region: 'push', halfLifeHours: 24, capacity: 10, mev: 8, mav: 18 },
  front_delts: { id: 'front_delts', name: 'Front delts', region: 'push', halfLifeHours: 20, capacity: 8, mev: 0, mav: 8 },
  side_delts: { id: 'side_delts', name: 'Side delts', region: 'push', halfLifeHours: 18, capacity: 8, mev: 8, mav: 20 },
  rear_delts: { id: 'rear_delts', name: 'Rear delts', region: 'pull', halfLifeHours: 18, capacity: 8, mev: 6, mav: 16 },
  biceps: { id: 'biceps', name: 'Biceps', region: 'pull', halfLifeHours: 18, capacity: 8, mev: 8, mav: 18 },
  triceps: { id: 'triceps', name: 'Triceps', region: 'push', halfLifeHours: 20, capacity: 8, mev: 6, mav: 14 },
  forearms: { id: 'forearms', name: 'Forearms', region: 'pull', halfLifeHours: 16, capacity: 8, mev: 2, mav: 10 },
  traps: { id: 'traps', name: 'Traps', region: 'pull', halfLifeHours: 20, capacity: 9, mev: 0, mav: 14 },
  lats: { id: 'lats', name: 'Lats', region: 'pull', halfLifeHours: 24, capacity: 10, mev: 8, mav: 18 },
  upper_back: { id: 'upper_back', name: 'Upper back', region: 'pull', halfLifeHours: 24, capacity: 10, mev: 6, mav: 16 },
  lower_back: { id: 'lower_back', name: 'Lower back', region: 'core', halfLifeHours: 30, capacity: 8, mev: 0, mav: 8 },
  abs: { id: 'abs', name: 'Abs', region: 'core', halfLifeHours: 16, capacity: 10, mev: 0, mav: 16 },
  obliques: { id: 'obliques', name: 'Obliques', region: 'core', halfLifeHours: 16, capacity: 8, mev: 0, mav: 10 },
  glutes: { id: 'glutes', name: 'Glutes', region: 'legs', halfLifeHours: 28, capacity: 12, mev: 4, mav: 14 },
  quads: { id: 'quads', name: 'Quads', region: 'legs', halfLifeHours: 30, capacity: 12, mev: 8, mav: 18 },
  hamstrings: { id: 'hamstrings', name: 'Hamstrings', region: 'legs', halfLifeHours: 30, capacity: 10, mev: 6, mav: 14 },
  adductors: { id: 'adductors', name: 'Adductors', region: 'legs', halfLifeHours: 24, capacity: 8, mev: 0, mav: 10 },
  calves: { id: 'calves', name: 'Calves', region: 'legs', halfLifeHours: 18, capacity: 10, mev: 8, mav: 16 },
};

export const MUSCLE_IDS = Object.keys(MUSCLES) as MuscleId[];

/** Muscles worth programming directly; the rest get enough work indirectly. */
export const PRIORITY_MUSCLES: MuscleId[] = [
  'chest',
  'lats',
  'upper_back',
  'quads',
  'hamstrings',
  'glutes',
  'side_delts',
  'rear_delts',
  'biceps',
  'triceps',
  'calves',
  'abs',
];

const GOAL_VOLUME_SCALE: Record<Goal, number> = {
  hypertrophy: 1,
  strength: 0.7,
  general: 0.6,
  endurance: 0.5,
};

/** Weekly hard-set target range for a muscle, scaled to goal. */
export function weeklySetTarget(muscle: MuscleId, goal: Goal): { min: number; max: number } {
  const info = MUSCLES[muscle];
  const scale = GOAL_VOLUME_SCALE[goal];
  return { min: Math.round(info.mev * scale), max: Math.max(1, Math.round(info.mav * scale)) };
}

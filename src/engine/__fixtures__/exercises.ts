import type { Exercise } from '../types';

const base: Pick<Exercise, 'secondary' | 'cues' | 'skill' | 'fatigue'> = { secondary: [], cues: [], skill: 1, fatigue: 2 };

export const squat: Exercise = {
  ...base,
  id: 'barbell-back-squat',
  name: 'Barbell Back Squat',
  primary: ['quads', 'glutes'],
  secondary: ['adductors', 'lower_back'],
  equipment: ['barbell', 'squat_rack'],
  pattern: 'squat',
  mechanic: 'compound',
  loading: 'barbell',
  fatigue: 3,
  skill: 2,
  bwRatio: 1,
};

export const bench: Exercise = {
  ...base,
  id: 'barbell-bench-press',
  name: 'Barbell Bench Press',
  primary: ['chest'],
  secondary: ['triceps', 'front_delts'],
  equipment: ['barbell', 'bench'],
  pattern: 'horizontal_push',
  mechanic: 'compound',
  loading: 'barbell',
  bwRatio: 0.75,
  aliases: ['dumbbell-bench-press'],
};

export const dbBench: Exercise = {
  ...base,
  id: 'dumbbell-bench-press',
  name: 'Dumbbell Bench Press',
  primary: ['chest'],
  secondary: ['triceps', 'front_delts'],
  equipment: ['dumbbells', 'bench'],
  pattern: 'horizontal_push',
  mechanic: 'compound',
  loading: 'dumbbell',
  bwRatio: 0.3,
  aliases: ['barbell-bench-press'],
};

export const curl: Exercise = {
  ...base,
  id: 'dumbbell-curl',
  name: 'Dumbbell Curl',
  primary: ['biceps'],
  equipment: ['dumbbells'],
  pattern: 'elbow_flexion',
  mechanic: 'isolation',
  loading: 'dumbbell',
  fatigue: 1,
  bwRatio: 0.15,
};

export const pullUp: Exercise = {
  ...base,
  id: 'pull-up',
  name: 'Pull-Up',
  primary: ['lats'],
  secondary: ['biceps', 'upper_back'],
  equipment: ['pullup_bar'],
  pattern: 'vertical_pull',
  mechanic: 'compound',
  loading: 'bodyweight',
};

export const plank: Exercise = {
  ...base,
  id: 'plank',
  name: 'Plank',
  primary: ['abs'],
  equipment: [],
  pattern: 'core',
  mechanic: 'isolation',
  loading: 'bodyweight',
  fatigue: 1,
};

export const FIXTURE: Record<string, Exercise> = Object.fromEntries(
  [squat, bench, dbBench, curl, pullUp, plank].map((e) => [e.id, e]),
);

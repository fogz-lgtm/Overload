// Core domain types. The engine is pure TypeScript with no browser or React
// dependencies, so everything here can be unit-tested and reused (CLI, server,
// another UI) without modification.

export type MuscleId =
  | 'chest'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'traps'
  | 'lats'
  | 'upper_back'
  | 'lower_back'
  | 'abs'
  | 'obliques'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

export type Equipment =
  | 'barbell'
  | 'squat_rack'
  | 'bench'
  | 'dumbbells'
  | 'kettlebells'
  | 'cable'
  | 'machines'
  | 'leg_press'
  | 'smith_machine'
  | 'pullup_bar'
  | 'dip_station'
  | 'bands'
  | 'ez_bar'
  | 'trap_bar';

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'elbow_flexion'
  | 'elbow_extension'
  | 'shoulder_isolation'
  | 'chest_isolation'
  | 'knee_extension'
  | 'knee_flexion'
  | 'hip_isolation'
  | 'calf_raise'
  | 'core'
  | 'carry'
  | 'shrug';

/** How load is applied — drives weight rounding and progression increments. */
export type Loading =
  | 'barbell' // total bar weight
  | 'dumbbell' // weight per hand / per dumbbell
  | 'kettlebell'
  | 'machine' // pin-loaded or plate-loaded machine
  | 'cable'
  | 'bodyweight' // reps only; weight field is optional added load
  | 'band';

export interface Exercise {
  id: string;
  name: string;
  primary: MuscleId[];
  secondary: MuscleId[];
  /** Every item listed is required to perform the exercise. Empty = bodyweight. */
  equipment: Equipment[];
  pattern: MovementPattern;
  mechanic: 'compound' | 'isolation';
  loading: Loading;
  /** 1 = easy to learn, 3 = technical (e.g. snatch-grip deadlift). */
  skill: 1 | 2 | 3;
  /** Systemic fatigue cost per set, 1 (curl) – 3 (deadlift). */
  fatigue: 1 | 2 | 3;
  unilateral?: boolean;
  /**
   * Typical working weight for ~10 reps for an intermediate lifter, as a
   * fraction of bodyweight (per hand for dumbbells). Used only to seed the
   * very first session before we have any history.
   */
  bwRatio?: number;
  cues: string[];
  /** Exercises a user can safely swap in (same pattern, similar demands). */
  aliases?: string[];
  custom?: boolean;
}

export type Goal = 'strength' | 'hypertrophy' | 'general' | 'endurance';

/** A kind of training day a split rotates through. */
export type DayType = 'full' | 'upper' | 'lower' | 'push' | 'pull' | 'legs' | 'chest' | 'back' | 'shoulders' | 'arms' | 'core';

/** The lifter's chosen routine. */
export interface Split {
  days: DayType[];
  /** 'rotate': always the next day in order. 'smart': whichever day is freshest. */
  order: 'rotate' | 'smart';
}
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type Units = 'kg' | 'lb';
export type Sex = 'male' | 'female' | 'unspecified';

export interface Profile {
  id: 'me';
  name: string;
  units: Units;
  bodyweightKg: number;
  sex: Sex;
  experience: Experience;
  goal: Goal;
  daysPerWeek: number;
  sessionMinutes: number;
  activeGymId: string;
  onboarded: boolean;
  createdAt: number;
  /** Exploring generated sample data rather than a real log. */
  demo?: boolean;
  /** Chosen split; when absent the split follows days per week. */
  split?: Split;
  ai?: { apiKey: string; model: string };
}

export interface Gym {
  id: string;
  name: string;
  equipment: Equipment[];
}

export type SetKind = 'warmup' | 'working';

export interface SetEntry {
  id: string;
  kind: SetKind;
  /** Prescribed load in kg (0 for bodyweight with no added load). */
  targetWeightKg: number;
  targetReps: number;
  targetRir: number;
  /** Logged values; undefined until the set is performed. */
  weightKg?: number;
  reps?: number;
  /** Reps in reserve the lifter reported (0 = failure). */
  rir?: number;
  done: boolean;
  completedAt?: number;
}

export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  sets: SetEntry[];
  restSec: number;
  repRange: [number, number];
  /** Plain-language reason for the prescription. */
  rationale: string;
  notes?: string;
}

export interface Workout {
  id: string;
  name: string;
  status: 'planned' | 'active' | 'done';
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  gymId: string;
  /** Which day of the split this was (absent for freestyle and imported workouts). */
  dayType?: DayType;
  focus: string[];
  /** Why the generator chose this session. */
  summary: string;
  estimatedMinutes: number;
  exercises: WorkoutExercise[];
  notes?: string;
}

export type ActivityKind = 'run' | 'ride' | 'hike' | 'swim' | 'sport' | 'other';
export type Intensity = 'easy' | 'moderate' | 'hard';

/** Non-lifting training (runs, rides, sport) that still taxes muscles. */
export interface Activity {
  id: string;
  kind: ActivityKind;
  at: number;
  minutes: number;
  intensity: Intensity;
  note?: string;
}

export interface ExercisePref {
  exerciseId: string;
  favorite?: boolean;
  excluded?: boolean;
  /** YouTube id of the lifter's own form video, replacing the built-in one. */
  video?: string;
}

/** One performed working set, flattened for analysis. */
export interface PerformedSet {
  workoutId: string;
  exerciseId: string;
  at: number;
  weightKg: number;
  reps: number;
  rir?: number;
  kind: SetKind;
  targetReps?: number;
  repRange?: [number, number];
}

/** Recovery state per muscle: 0 = fully fatigued, 1 = fully fresh. */
export type RecoveryMap = Record<MuscleId, number>;

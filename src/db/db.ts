import type Anthropic from '@anthropic-ai/sdk';
import Dexie, { type Table } from 'dexie';
import type { Activity, Equipment, Exercise, ExercisePref, Gym, Profile, Workout } from '../engine/types';

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Workout the coach built in this turn, offered as a one-tap start. */
  workoutId?: string;
  at: number;
}

export interface ChatThread {
  id: string;
  updatedAt: number;
  /** What the chat screen shows. */
  messages: ChatMessage[];
  /** The exact API transcript, replayed unchanged (append-only) on each turn. */
  api: Anthropic.Beta.BetaMessageParam[];
  model?: string;
}

class OverloadDB extends Dexie {
  profile!: Table<Profile, string>;
  gyms!: Table<Gym, string>;
  workouts!: Table<Workout, string>;
  activities!: Table<Activity, string>;
  customExercises!: Table<Exercise, string>;
  prefs!: Table<ExercisePref, string>;
  chats!: Table<ChatThread, string>;

  constructor(name = 'overload') {
    super(name);
    this.version(1).stores({
      profile: 'id',
      gyms: 'id',
      workouts: 'id, status, createdAt, finishedAt',
      activities: 'id, at',
      customExercises: 'id',
      prefs: 'exerciseId',
      chats: 'id, updatedAt',
    });
  }
}

export const db = new OverloadDB();

export const ALL_EQUIPMENT: Equipment[] = [
  'barbell',
  'squat_rack',
  'bench',
  'dumbbells',
  'kettlebells',
  'cable',
  'machines',
  'leg_press',
  'smith_machine',
  'pullup_bar',
  'dip_station',
  'bands',
  'ez_bar',
  'trap_bar',
];

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barbell',
  squat_rack: 'Squat rack',
  bench: 'Bench',
  dumbbells: 'Dumbbells',
  kettlebells: 'Kettlebells',
  cable: 'Cable station',
  machines: 'Machines',
  leg_press: 'Leg press',
  smith_machine: 'Smith machine',
  pullup_bar: 'Pull-up bar',
  dip_station: 'Dip station',
  bands: 'Resistance bands',
  ez_bar: 'EZ bar',
  trap_bar: 'Trap bar',
};

export const GYM_PRESETS: { name: string; equipment: Equipment[] }[] = [
  { name: 'Commercial gym', equipment: ALL_EQUIPMENT },
  { name: 'Home gym', equipment: ['barbell', 'squat_rack', 'bench', 'dumbbells', 'pullup_bar', 'bands'] },
  { name: 'Dumbbells only', equipment: ['dumbbells', 'bench'] },
  { name: 'Hotel gym', equipment: ['dumbbells', 'bench', 'cable', 'machines'] },
  { name: 'Bodyweight', equipment: ['pullup_bar'] },
];

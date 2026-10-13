import { EXERCISES } from '../engine/exercises';
import { simulateHistory } from '../engine/simulate';
import type { Profile, Units } from '../engine/types';
import { uid } from '../engine/util';
import { ALL_EQUIPMENT, db } from './db';

/** Fills the app with eight weeks of simulated training so people can look around first. */
export async function loadDemoData(units: Units): Promise<void> {
  const gymId = uid();
  const profile: Profile = {
    id: 'me',
    name: 'Alex',
    units,
    bodyweightKg: 80,
    sex: 'unspecified',
    experience: 'intermediate',
    goal: 'hypertrophy',
    daysPerWeek: 4,
    sessionMinutes: 60,
    activeGymId: gymId,
    onboarded: true,
    createdAt: Date.now(),
    demo: true,
  };
  const { workouts, activities } = simulateHistory({
    profile,
    gymId,
    equipment: ALL_EQUIPMENT,
    exercises: EXERCISES,
    weeks: 8,
    now: Date.now(),
    seed: Math.floor(Math.random() * 1e9),
  });
  await db.transaction('rw', [db.profile, db.gyms, db.workouts, db.activities], async () => {
    await db.gyms.put({ id: gymId, name: 'Commercial gym', equipment: ALL_EQUIPMENT });
    await db.workouts.bulkPut(workouts);
    await db.activities.bulkPut(activities);
    await db.profile.put(profile);
  });
}

/** Wipes everything (demo or real) and returns to onboarding. */
export async function eraseAll(): Promise<void> {
  await db.delete();
  location.reload();
}

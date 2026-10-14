// Turns Strava activities (from the API or a Strava data export) into
// Overload activities, so runs, rides and hikes count toward recovery.
// Pure functions: no network, no database.

import { cell, columnIndex, normKey, parseCsv, parseDateTime, parseNumber } from './importers';
import type { Activity, ActivityKind, Intensity } from './types';

/** The fields Overload reads from a Strava activity (GET /athlete/activities). */
export interface StravaActivity {
  id: number | string;
  name?: string;
  type?: string;
  sport_type?: string;
  /** ISO time with a Z. */
  start_date: string;
  moving_time?: number;
  elapsed_time?: number;
  distance?: number;
  average_heartrate?: number;
  suffer_score?: number | null;
  perceived_exertion?: number | null;
  workout_type?: number | null;
}

// Keys are Strava sport types with spaces, dashes and case removed, so the
// API's "EBikeRide" and the export's "E-Bike Ride" land on the same entry.
// null: strength and mobility sessions, which belong in Overload's own log.
const KINDS: Record<string, ActivityKind | null> = {
  run: 'run',
  trailrun: 'run',
  virtualrun: 'run',
  ride: 'ride',
  mountainbikeride: 'ride',
  gravelride: 'ride',
  virtualride: 'ride',
  ebikeride: 'ride',
  emountainbikeride: 'ride',
  velomobile: 'ride',
  handcycle: 'ride',
  hike: 'hike',
  walk: 'hike',
  snowshoe: 'hike',
  stairstepper: 'hike',
  swim: 'swim',
  soccer: 'sport',
  football: 'sport',
  tennis: 'sport',
  badminton: 'sport',
  pickleball: 'sport',
  racquetball: 'sport',
  squash: 'sport',
  tabletennis: 'sport',
  basketball: 'sport',
  volleyball: 'sport',
  cricket: 'sport',
  golf: 'sport',
  rockclimbing: 'sport',
  alpineski: 'sport',
  backcountryski: 'sport',
  nordicski: 'sport',
  snowboard: 'sport',
  iceskate: 'sport',
  inlineskate: 'sport',
  rollerski: 'sport',
  skateboard: 'sport',
  surfing: 'sport',
  kitesurf: 'sport',
  windsurf: 'sport',
  crossfit: 'sport',
  highintensityintervaltraining: 'sport',
  hiit: 'sport',
  weighttraining: null,
  yoga: null,
  pilates: null,
};

const sportKey = (t: string) => t.toLowerCase().replace(/[^a-z]/g, '');

/** Overload's kind for a Strava sport type; null for sessions Overload skips (weights, yoga). */
export function kindForSport(sportType: string): ActivityKind | null {
  const k = sportKey(sportType);
  return k in KINDS ? KINDS[k]! : 'other';
}

/** Sports that are easy unless the numbers say otherwise. */
const GENTLE = new Set(['walk', 'ebikeride', 'emountainbikeride', 'golf']);

export interface IntensityInput {
  sportType: string;
  minutes: number;
  perceivedExertion?: number | null;
  /** Strava's Relative Effort. */
  sufferScore?: number | null;
  averageHeartrate?: number | null;
  workoutType?: number | null;
}

/**
 * How hard it was, from the best signal there is: the athlete's own
 * perceived exertion (1–10), Relative Effort per hour, average heart rate,
 * then whether it was a race or workout.
 */
export function intensityOf(a: IntensityInput): Intensity {
  const rpe = a.perceivedExertion ?? undefined;
  if (rpe !== undefined && rpe > 0) return rpe <= 4 ? 'easy' : rpe <= 7 ? 'moderate' : 'hard';
  const hours = Math.max(a.minutes, 1) / 60;
  if (a.sufferScore && a.sufferScore > 0) {
    const perHour = a.sufferScore / hours;
    return perHour < 50 ? 'easy' : perHour < 110 ? 'moderate' : 'hard';
  }
  const hr = a.averageHeartrate ?? undefined;
  if (hr !== undefined && hr > 0) return hr < 125 ? 'easy' : hr < 155 ? 'moderate' : 'hard';
  // Runs: 1 = race, 3 = workout. Rides: 11 = race, 12 = workout.
  if (a.workoutType === 1 || a.workoutType === 3 || a.workoutType === 11 || a.workoutType === 12) return 'hard';
  return GENTLE.has(sportKey(a.sportType)) ? 'easy' : 'moderate';
}

/** Activities under this long don't tax anything worth tracking. */
const MIN_MINUTES = 5;

export const stravaActivityId = (id: number | string) => `strava-${id}`;

/** An Overload activity for a Strava one, or null when it's too short or a session Overload skips. */
export function fromStrava(s: StravaActivity): Activity | null {
  const sportType = s.sport_type || s.type || '';
  const kind = kindForSport(sportType);
  if (kind === null) return null;
  const at = Date.parse(s.start_date);
  const seconds = s.moving_time || s.elapsed_time || 0;
  const minutes = Math.round(seconds / 60);
  if (!Number.isFinite(at) || minutes < MIN_MINUTES) return null;
  const activity: Activity = {
    id: stravaActivityId(s.id),
    kind,
    at,
    minutes,
    intensity: intensityOf({
      sportType,
      minutes,
      perceivedExertion: s.perceived_exertion,
      sufferScore: s.suffer_score,
      averageHeartrate: s.average_heartrate,
      workoutType: s.workout_type,
    }),
    source: 'strava',
  };
  const name = s.name?.trim();
  if (name) activity.note = name;
  if (s.distance && s.distance > 0) activity.distanceKm = Math.round(s.distance / 10) / 100;
  return activity;
}

/** The code from a pasted return URL, or the pasted text itself if it's a bare code. */
export function codeFromPaste(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = /[?&]code=([^&#\s]+)/.exec(t);
  if (m) return decodeURIComponent(m[1]!);
  return /^[A-Za-z0-9]{20,}$/.test(t) ? t : null;
}

// ---------------------------------------------------------------------------
// Strava data export (activities.csv)

/** True for the activities.csv in a Strava "Download your data" archive. */
export function isStravaCsv(header: string[]): boolean {
  const keys = new Set(header.map(normKey));
  return keys.has('activity id') && keys.has('activity type') && keys.has('activity date');
}

export interface StravaCsvResult {
  activities: Activity[];
  /** Weight training, yoga and the like, left to Overload's own log. */
  skipped: number;
  warnings: string[];
}

/** Times in the export are UTC but carry no zone. */
function utc(local: number): number {
  return local - new Date(local).getTimezoneOffset() * 60_000;
}

/** Reads a Strava activities.csv. Columns repeat in it; the first of each name is used. */
export function parseStravaCsv(text: string): StravaCsvResult {
  const [header, ...rows] = parseCsv(text);
  if (!header || !isStravaCsv(header)) throw new Error("This isn't a Strava activities.csv file.");
  const keys = header.map(normKey);
  const col = {
    id: columnIndex(keys, 'activity id'),
    date: columnIndex(keys, 'activity date'),
    name: columnIndex(keys, 'activity name'),
    type: columnIndex(keys, 'activity type'),
    elapsed: columnIndex(keys, 'elapsed time'),
    moving: columnIndex(keys, 'moving time'),
    // Distance is left out: the export's first Distance column is in the athlete's own unit.
    effort: columnIndex(keys, 'relative effort'),
    heartrate: columnIndex(keys, 'average heart rate'),
    exertion: columnIndex(keys, 'perceived exertion'),
  };

  const activities: Activity[] = [];
  let skipped = 0;
  let badDates = 0;
  for (const row of rows) {
    const id = cell(row, col.id);
    if (!id) continue;
    const local = parseDateTime(cell(row, col.date));
    if (local === null) {
      badDates++;
      continue;
    }
    const seconds = parseNumber(cell(row, col.moving)) || parseNumber(cell(row, col.elapsed)) || 0;
    const a = fromStrava({
      id,
      name: cell(row, col.name),
      sport_type: cell(row, col.type),
      start_date: new Date(utc(local)).toISOString(),
      moving_time: seconds,
      suffer_score: parseNumber(cell(row, col.effort)),
      average_heartrate: parseNumber(cell(row, col.heartrate)),
      perceived_exertion: parseNumber(cell(row, col.exertion)),
    });
    if (!a) {
      skipped++;
      continue;
    }
    activities.push(a);
  }
  const warnings: string[] = [];
  if (badDates > 0) warnings.push(`${badDates} row(s) had an unreadable date and were skipped.`);
  return { activities, skipped, warnings };
}

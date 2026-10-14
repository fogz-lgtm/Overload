// Importers for workout history exported from other apps (Gravl, Strong, Hevy).
// Pure functions: text in, plain data out. Persisting the result and mapping
// exercises onto the library is left to the caller (see matchExercise).

import type { Exercise, SetKind } from './types';

export type ImportFormat = 'gravl' | 'strong' | 'hevy';

export interface ImportedSet {
  weightKg: number;
  reps: number;
  rir?: number;
  kind: SetKind;
  /** A lighter set straight after the top set, as in a drop set. */
  drop?: boolean;
}

export interface ImportedExercise {
  name: string;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  name: string;
  startedAt: number;
  finishedAt?: number;
  exercises: ImportedExercise[];
  notes?: string;
}

export interface ImportResult {
  format: ImportFormat;
  workouts: ImportedWorkout[];
  warnings: string[];
  /** Weights on bodyweight moves include the lifter's bodyweight (Gravl logs a pull-up at bodyweight). */
  bodyweightIncluded?: boolean;
}

const LB_TO_KG = 0.45359237;

// ---------------------------------------------------------------------------
// CSV

/** RFC-4180-ish CSV parser: quoted fields, escaped quotes (""), commas/newlines inside quotes, CRLF, optional BOM, optional ';' delimiter auto-detect. */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delim = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row); // drop blank lines
    row = [];
    field = '';
  };

  for (let i = 0; i < src.length; i++) {
    const c = src.charAt(i);
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (src.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else inQuotes = false;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src.charAt(i + 1) === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Picks ';' when the first line has more semicolons than commas (outside quotes). */
function detectDelimiter(text: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\n' || c === '\r') break;
      if (c === ',') commas++;
      else if (c === ';') semis++;
    }
  }
  return semis > commas ? ';' : ',';
}

// ---------------------------------------------------------------------------
// Format detection & shared helpers

/** "Workout Name" / "workout_name" / "Weight (kg)" → "workout name" / "weight kg". */
export const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Detects Gravl, Strong or Hevy from the header row; returns null if none. */
export function detectFormat(header: string[]): ImportFormat | null {
  const keys = new Set(header.map(normKey));
  if (keys.has('exercise title') && keys.has('start time')) return 'hevy';
  if (keys.has('exercise') && keys.has('workout') && keys.has('set type') && keys.has('date')) return 'gravl';
  if (keys.has('exercise name') && keys.has('date') && (keys.has('set order') || keys.has('reps'))) return 'strong';
  return null;
}

export function columnIndex(keys: string[], ...names: string[]): number {
  for (const n of names) {
    const i = keys.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

/** First column named `prefix` or `prefix <unit>`, e.g. "weight" or "weight kg". */
const columnByPrefix = (keys: string[], prefix: string) =>
  keys.findIndex((k) => k === prefix || k.startsWith(prefix + ' '));

export const cell = (row: string[], i: number) => (i < 0 ? '' : (row[i] ?? '').trim());

/** Number from a cell; accepts a decimal comma ("62,5"). Undefined when blank or invalid. */
export function parseNumber(raw: string): number | undefined {
  const t = raw.replace(/\s+/g, '');
  if (!t) return undefined;
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : undefined;
}

function rirFromRpe(rpe: number | undefined): number | undefined {
  if (rpe === undefined || rpe <= 0 || rpe > 10) return undefined;
  return Math.max(0, Math.round(10 - rpe));
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function localTime(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number | null {
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 59) return null;
  const date = new Date(y, mo - 1, d, h, mi, s);
  return date.getDate() === d ? date.getTime() : null; // rejects e.g. 31 Feb
}

function to24h(h: number, meridiem: string | undefined): number {
  if (!meridiem) return h;
  const pm = meridiem.toLowerCase().startsWith('p');
  return (h % 12) + (pm ? 12 : 0);
}

/**
 * Parses ISO-like ("2024-03-05 18:02:11", "2024-03-05T18:02:00Z") and
 * written dates ("5 Mar 2024, 18:02", "Mar 5, 2024, 6:02 PM"). Times without
 * an offset are local. Never hands non-ISO strings to Date.parse.
 */
export function parseDateTime(raw: string): number | null {
  // iOS writes "9:11 PM" with a narrow no-break space.
  const s = raw.replace(/[\u00a0\u202f]/g, ' ').trim().replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+/i, '');

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(z|[+-]\d{2}:?\d{2}|[ap]\.?m\.?)?$/i.exec(s);
  if (iso) {
    const n = (i: number) => Number(iso[i] ?? 0);
    const [y, mo, d, mi, sec] = [n(1), n(2), n(3), n(5), n(6)];
    const zone = iso[8];
    const meridiem = zone && /^[ap]/i.test(zone) ? zone : undefined;
    const h = to24h(n(4), meridiem);
    const local = localTime(y, mo, d, h, mi, sec);
    if (local === null || !zone || meridiem) return local;
    const ms = Number(((iso[7] ?? '') + '000').slice(0, 3));
    const offsetMin = /z/i.test(zone)
      ? 0
      : (zone.startsWith('-') ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)));
    return Date.UTC(y, mo - 1, d, h, mi, sec, ms) - offsetMin * 60_000;
  }

  const time = String.raw`(?:,?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?m\.?)?)?`;
  const dayFirst = new RegExp(String.raw`^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})${time}$`, 'i').exec(s);
  const monthFirst = new RegExp(String.raw`^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})${time}$`, 'i').exec(s);
  const m = dayFirst ?? monthFirst;
  if (!m) return null;
  const [dayStr, monthStr] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
  const month = MONTHS.indexOf((monthStr ?? '').slice(0, 3).toLowerCase()) + 1;
  if (month === 0) return null;
  return localTime(
    Number(m[3]),
    month,
    Number(dayStr),
    to24h(Number(m[4] ?? 0), m[7]),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
}

/** "1h 5m", "45m", "1h 5m 30s", "1:05:00"; a bare number uses `plainUnitMs`. */
function parseDurationMs(raw: string, plainUnitMs: number): number | undefined {
  const s = raw.trim().toLowerCase();
  if (!s) return undefined;
  const plain = parseNumber(s);
  if (plain !== undefined) return plain > 0 ? plain * plainUnitMs : undefined;

  const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (clock) {
    const n = (i: number) => Number(clock[i] ?? 0);
    return ((n(1) * 60 + n(2)) * 60 + n(3)) * 1000 || undefined;
  }

  const unitMs: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000 };
  let total = 0;
  for (const part of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g)) {
    total += (parseNumber(part[1] ?? '') ?? 0) * (unitMs[(part[2] ?? '').charAt(0)] ?? 0);
  }
  return total > 0 ? total : undefined;
}

// Rows are grouped into workouts by key; exercises keep first-appearance order.
interface Group {
  workout: ImportedWorkout;
  exercises: Map<string, ImportedExercise>;
}

class Collector {
  private readonly groups = new Map<string, Group>();
  readonly warnings = new Set<string>();
  private badDates = 0;

  workout(key: string, make: () => ImportedWorkout, notes: string): Group {
    let g = this.groups.get(key);
    if (!g) {
      g = { workout: make(), exercises: new Map() };
      this.groups.set(key, g);
    }
    if (notes && !g.workout.notes) g.workout.notes = notes;
    return g;
  }

  addSet(g: Group, exerciseName: string, set: ImportedSet) {
    let ex = g.exercises.get(exerciseName);
    if (!ex) {
      ex = { name: exerciseName, sets: [] };
      g.exercises.set(exerciseName, ex);
      g.workout.exercises.push(ex);
    }
    ex.sets.push(set);
  }

  /** Records a set row that has no reps; timed/distance sets get a warning. */
  skipRepless(exerciseName: string, distance: string, seconds: string) {
    if ((parseNumber(distance) ?? 0) > 0 || (parseNumber(seconds) ?? 0) > 0) {
      this.warnings.add(`"${exerciseName}": timed or distance sets aren't supported yet and were skipped.`);
    }
  }

  badDate() {
    this.badDates++;
  }

  finish(format: ImportFormat): ImportResult {
    const all = [...this.groups.values()].map((g) => g.workout);
    const workouts = all.filter((w) => w.exercises.length > 0).sort((a, b) => a.startedAt - b.startedAt);
    const empty = all.length - workouts.length;
    if (empty > 0) this.warnings.add(`${empty} workout(s) had no weight/rep sets and were skipped.`);
    if (this.badDates > 0) this.warnings.add(`${this.badDates} row(s) had an unreadable date and were skipped.`);
    return { format, workouts, warnings: [...this.warnings] };
  }
}

function makeSet(weight: number | undefined, factor: number, reps: number, rpe: string, kind: SetKind): ImportedSet {
  const set: ImportedSet = { weightKg: (weight ?? 0) * factor, reps: Math.round(reps), kind };
  const rir = rirFromRpe(parseNumber(rpe));
  if (rir !== undefined) set.rir = rir;
  return set;
}

// ---------------------------------------------------------------------------
// Strong

/** Set Order: number → working, W → warm-up, D/F (drop/failure) → working; anything else (rest timers, notes) → skip. */
function strongSetKind(order: string): SetKind | null {
  const o = order.toLowerCase();
  if (o === '' || /^\d+$/.test(o)) return 'working';
  if (o === 'w' || o.startsWith('warm')) return 'warmup';
  if (o === 'd' || o === 'f' || o.startsWith('drop') || o.startsWith('fail')) return 'working';
  return null;
}

function parseStrong(header: string[], rows: string[][], defaultUnit: 'kg' | 'lb'): ImportResult {
  const keys = header.map(normKey);
  const col = {
    date: columnIndex(keys, 'date'),
    name: columnIndex(keys, 'workout name'),
    duration: columnByPrefix(keys, 'duration'),
    exercise: columnIndex(keys, 'exercise name'),
    order: columnIndex(keys, 'set order'),
    weight: columnByPrefix(keys, 'weight'),
    reps: columnIndex(keys, 'reps'),
    distance: columnByPrefix(keys, 'distance'),
    seconds: columnIndex(keys, 'seconds'),
    workoutNotes: columnIndex(keys, 'workout notes'),
    rpe: columnIndex(keys, 'rpe'),
  };
  // Some Strong versions put the unit in the header ("Weight (lbs)"); trust it over the option.
  const weightKey = keys[col.weight] ?? '';
  const unit = /\blbs?\b/.test(weightKey) ? 'lb' : /\bkgs?\b/.test(weightKey) ? 'kg' : defaultUnit;
  const factor = unit === 'lb' ? LB_TO_KG : 1;
  const plainDurationMs = /\bsec/.test(keys[col.duration] ?? '') ? 1000 : 60_000;

  const out = new Collector();
  for (const row of rows) {
    const exercise = cell(row, col.exercise);
    if (!exercise) continue;
    const dateRaw = cell(row, col.date);
    const startedAt = parseDateTime(dateRaw);
    if (startedAt === null) {
      out.badDate();
      continue;
    }
    const name = cell(row, col.name) || 'Imported workout';
    const group = out.workout(
      `${dateRaw}\u0000${name}`,
      () => {
        const w: ImportedWorkout = { name, startedAt, exercises: [] };
        const duration = parseDurationMs(cell(row, col.duration), plainDurationMs);
        if (duration !== undefined) w.finishedAt = startedAt + duration;
        return w;
      },
      cell(row, col.workoutNotes),
    );

    const kind = strongSetKind(cell(row, col.order));
    if (kind === null) continue;
    const reps = parseNumber(cell(row, col.reps)) ?? 0;
    if (reps <= 0) {
      out.skipRepless(exercise, cell(row, col.distance), cell(row, col.seconds));
      continue;
    }
    out.addSet(group, exercise, makeSet(parseNumber(cell(row, col.weight)), factor, reps, cell(row, col.rpe), kind));
  }
  return out.finish('strong');
}

// ---------------------------------------------------------------------------
// Hevy

function parseHevy(header: string[], rows: string[][]): ImportResult {
  const keys = header.map(normKey);
  const kgCol = columnIndex(keys, 'weight kg', 'weight');
  const lbCol = columnIndex(keys, 'weight lbs', 'weight lb');
  const col = {
    title: columnIndex(keys, 'title'),
    start: columnIndex(keys, 'start time'),
    end: columnIndex(keys, 'end time'),
    description: columnIndex(keys, 'description'),
    exercise: columnIndex(keys, 'exercise title'),
    setType: columnIndex(keys, 'set type'),
    weight: kgCol >= 0 ? kgCol : lbCol,
    reps: columnIndex(keys, 'reps'),
    distance: columnByPrefix(keys, 'distance'),
    duration: columnByPrefix(keys, 'duration'),
    rpe: columnIndex(keys, 'rpe'),
  };
  const factor = kgCol < 0 && lbCol >= 0 ? LB_TO_KG : 1;

  const out = new Collector();
  for (const row of rows) {
    const exercise = cell(row, col.exercise);
    if (!exercise) continue;
    const startRaw = cell(row, col.start);
    const startedAt = parseDateTime(startRaw);
    if (startedAt === null) {
      out.badDate();
      continue;
    }
    const title = cell(row, col.title) || 'Imported workout';
    const group = out.workout(
      `${startRaw}\u0000${title}`,
      () => {
        const w: ImportedWorkout = { name: title, startedAt, exercises: [] };
        const end = parseDateTime(cell(row, col.end));
        if (end !== null && end >= startedAt) w.finishedAt = end;
        return w;
      },
      cell(row, col.description),
    );

    const reps = parseNumber(cell(row, col.reps)) ?? 0;
    if (reps <= 0) {
      out.skipRepless(exercise, cell(row, col.distance), cell(row, col.duration));
      continue;
    }
    const kind: SetKind = /^warm/i.test(cell(row, col.setType)) ? 'warmup' : 'working';
    out.addSet(group, exercise, makeSet(parseNumber(cell(row, col.weight)), factor, reps, cell(row, col.rpe), kind));
  }
  return out.finish('hevy');
}

// ---------------------------------------------------------------------------
// Gravl

/** Gravl's per-set effort rating, as reps in reserve. */
function rirFromEffort(effort: string): number | undefined {
  const e = effort.toLowerCase();
  if (!e) return undefined;
  if (/too easy/.test(e)) return 4;
  if (/too hard|fail|max/.test(e)) return 0;
  if (/easy|light/.test(e)) return 3;
  if (/hard|tough/.test(e)) return 1;
  if (/ideal|good|right|perfect|moderate|medium|ok/.test(e)) return 2;
  return undefined;
}

function parseGravl(header: string[], rows: string[][], defaultUnit: 'kg' | 'lb'): ImportResult {
  const keys = header.map(normKey);
  const col = {
    date: columnIndex(keys, 'date'),
    time: columnIndex(keys, 'start date', 'start time'),
    name: columnIndex(keys, 'workout'),
    duration: columnByPrefix(keys, 'workout duration'),
    exercise: columnIndex(keys, 'exercise'),
    setType: columnIndex(keys, 'set type'),
    weight: columnByPrefix(keys, 'weight'),
    reps: columnIndex(keys, 'reps'),
    distance: columnByPrefix(keys, 'distance'),
    seconds: columnByPrefix(keys, 'set duration'),
    effort: columnIndex(keys, 'effort'),
    rpe: columnIndex(keys, 'rpe'),
    notes: columnIndex(keys, 'workout notes', 'notes'),
  };
  const weightKey = keys[col.weight] ?? '';
  const unit = /\blbs?\b/.test(weightKey) ? 'lb' : /\bkgs?\b/.test(weightKey) ? 'kg' : defaultUnit;
  const factor = unit === 'lb' ? LB_TO_KG : 1;
  const plainDurationMs = /\bsec/.test(keys[col.duration] ?? '') ? 1000 : 60_000;
  // Gravl marks every set of a drop set "Dropset": the first is the top set, the rest are the drops.
  const lastType = new Map<string, string>();

  const out = new Collector();
  for (const row of rows) {
    const exercise = cell(row, col.exercise);
    if (!exercise) continue;
    const dateRaw = cell(row, col.date);
    const timeRaw = cell(row, col.time);
    const startedAt = parseDateTime(`${dateRaw} ${timeRaw}`) ?? parseDateTime(dateRaw);
    if (startedAt === null) {
      out.badDate();
      continue;
    }
    const name = cell(row, col.name) || 'Imported workout';
    const key = `${dateRaw}\u0000${timeRaw}\u0000${name}`;
    const group = out.workout(
      key,
      () => {
        const w: ImportedWorkout = { name, startedAt, exercises: [] };
        const duration = parseDurationMs(cell(row, col.duration), plainDurationMs);
        if (duration !== undefined) w.finishedAt = startedAt + duration;
        return w;
      },
      cell(row, col.notes),
    );

    const type = cell(row, col.setType).toLowerCase();
    const chain = `${key}\u0000${exercise}`;
    const continuesDrop = /drop/.test(type) && /drop/.test(lastType.get(chain) ?? '');
    lastType.set(chain, type);
    const reps = parseNumber(cell(row, col.reps)) ?? 0;
    if (reps <= 0) {
      out.skipRepless(exercise, cell(row, col.distance), cell(row, col.seconds));
      continue;
    }
    const set = makeSet(parseNumber(cell(row, col.weight)), factor, reps, cell(row, col.rpe), /warm/.test(type) ? 'warmup' : 'working');
    if (set.rir === undefined) {
      const rir = rirFromEffort(cell(row, col.effort));
      if (rir !== undefined) set.rir = rir;
    }
    if (continuesDrop) set.drop = true;
    out.addSet(group, exercise, set);
  }
  return { ...out.finish('gravl'), bodyweightIncluded: true };
}

/**
 * Gravl logs a pull-up at the lifter's bodyweight; Overload logs the load added to it.
 * Anything under half of bodyweight is taken as added load already.
 */
export function addedLoad(kg: number, bodyweightKg: number | undefined): number {
  if (!bodyweightKg || kg < bodyweightKg * 0.5) return kg;
  const added = kg - bodyweightKg;
  // Within 10% is the same bodyweight, weighed on a different day.
  return added < bodyweightKg * 0.1 ? 0 : added;
}

/**
 * Parse an export. `strongUnit` is the unit Strong's Weight column is in (Strong exports don't say).
 * @throws Error when the file is empty or is not a Gravl, Strong or Hevy export.
 */
export function parseWorkoutCsv(text: string, opts: { strongUnit?: 'kg' | 'lb' } = {}): ImportResult {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('The file is empty.');
  const format = detectFormat(header);
  if (format === 'strong') return parseStrong(header, rows, opts.strongUnit ?? 'kg');
  if (format === 'hevy') return parseHevy(header, rows);
  if (format === 'gravl') return parseGravl(header, rows, opts.strongUnit ?? 'kg');
  throw new Error("This doesn't look like a workout export from Gravl, Strong or Hevy.");
}

// ---------------------------------------------------------------------------
// Exercise matching

const EQUIPMENT_WORDS = new Set(['barbell', 'dumbbell', 'kettlebell', 'cable', 'machine', 'smith', 'band', 'ezbar', 'trapbar', 'bodyweight']);

const WORD_SYNONYMS: Record<string, string> = {
  db: 'dumbbell',
  bb: 'barbell',
  kb: 'kettlebell',
  ez: 'ezbar',
  bw: 'bodyweight',
  lever: 'machine',
  ohp: 'overhead press',
  rdl: 'romanian deadlift',
  flye: 'fly',
};

// Applied in order to the space-separated, singularized text. Implicit
// defaults ("back" squat, "bent over" row, "biceps" curl) are dropped so the
// plain name matches the default variant.
const PHRASES: Array<[RegExp, string]> = [
  [/\b(chin|pull|push|sit|step) ?up\b/g, '$1up'],
  [/\b(pull|push) ?down\b/g, '$1down'],
  [/\bskull ?crusher\b/g, 'skull crusher'],
  [/\b(military|shoulder) press\b/g, 'overhead press'],
  [/\bback squat\b/g, 'squat'],
  [/\b(incline|decline) bench press\b/g, '$1 press'],
  [/\bbent over\b/g, ''],
  [/\bbicep curl\b/g, 'curl'],
  [/\btricep pushdown\b/g, 'pushdown'],
  [/\bsmith machine\b/g, 'smith'],
  [/\bezbar bar\b/g, 'ezbar'],
  [/\b(trap|hex) bar\b/g, 'trapbar'],
  [/\bbody ?weight\b/g, 'bodyweight'],
  [/\bresistance band\b/g, 'band'],
  [/\bv bar\b/g, ''],
  [/\bincline dumbbell row\b/g, 'chest supported dumbbell row'],
];

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'with', 'of', 'on', 'to', 'in', 'for',
  'straight', 'bar', 'rope', 'handle', 'attachment', 'flat', 'standard', 'regular', 'conventional', 'exercise',
  // Stance and side change the setup, not the movement.
  'seated', 'standing', 'alternating', 'alternate',
]);

// Words that make it a different movement: on one side only, it's probably not the same exercise.
const DEFINING = new Set(['upright', 'incline', 'decline', 'reverse', 'sumo', 'close', 'wide', 'front', 'rear', 'hanging', 'skull', 'preacher', 'spider', 'floor', 'low', 'high', 'hip', 'halo']);
const DEFINING_PENALTY = 0.3;

function definingMismatch(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (DEFINING.has(t) && !b.has(t)) n++;
  for (const t of b) if (DEFINING.has(t) && !a.has(t)) n++;
  return n;
}

// "Curl to Press", "Squat to Row": two lifts in one, so no single library match.
const COMBO = /\b(curl|squat|lunge|deadlift|row|press|raise|clean)s?\b.*\bto\b.*\b(curl|squat|lunge|deadlift|row|press|raise|thruster)s?\b/i;

function singular(w: string): string {
  if (w.length <= 3 || !w.endsWith('s') || /(ss|us|is)$/.test(w)) return w;
  return /(ch|sh|ss|x)es$/.test(w) ? w.slice(0, -2) : w.slice(0, -1);
}

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ');
  let s = words.map((w) => WORD_SYNONYMS[singular(w)] ?? singular(w)).join(' ');
  for (const [re, rep] of PHRASES) s = s.replace(re, rep);
  return new Set(s.split(' ').filter((w) => w && !STOPWORDS.has(w)));
}

const FIELD_EQUIPMENT: Record<string, string> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  dumbbells: 'dumbbell',
  kettlebell: 'kettlebell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  machines: 'machine',
  leg_press: 'machine',
  smith_machine: 'smith',
  band: 'band',
  bands: 'band',
  ez_bar: 'ezbar',
  trap_bar: 'trapbar',
  bodyweight: 'bodyweight',
};

// Equipment that is close enough to fall back on when the exact kind isn't in the library.
const SOFT_EQUIPMENT = new Set(
  [
    ['barbell', 'ezbar'],
    ['barbell', 'trapbar'],
    ['barbell', 'smith'],
    ['machine', 'cable'],
    ['machine', 'smith'],
    ['dumbbell', 'kettlebell'],
  ].map((p) => [...p].sort().join('|')),
);

interface Profile {
  /** Token sets of the name and the id. */
  candidates: Set<string>[];
  equipment: Set<string>;
}

const profiles = new WeakMap<Exercise, Profile>();

function profileOf(ex: Exercise): Profile {
  const cached = profiles.get(ex);
  if (cached) return cached;
  const nameTokens = tokenize(ex.name);
  const idTokens = tokenize(ex.id);
  // Equipment named in the name/id wins; otherwise fall back to the structured fields.
  let equipment = new Set([...nameTokens, ...idTokens].filter((t) => EQUIPMENT_WORDS.has(t)));
  if (equipment.size === 0) {
    equipment = new Set(
      [...ex.equipment, ex.loading].map((e) => FIELD_EQUIPMENT[e]).filter((e): e is string => e !== undefined),
    );
  }
  const profile = { candidates: [nameTokens, idTokens], equipment };
  profiles.set(ex, profile);
  return profile;
}

const withoutEquipment = (s: Set<string>) => new Set([...s].filter((t) => !EQUIPMENT_WORDS.has(t)));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((t) => b.has(t));

/** +0.1 when equipment agrees, small penalty for a close substitute, disqualifying penalty otherwise. */
function equipmentScore(ext: Set<string>, lib: Set<string>): number {
  if (ext.size === 0 || lib.size === 0) return 0;
  let soft = false;
  for (const e of ext) {
    if (lib.has(e)) return 0.1;
    for (const l of lib) if (SOFT_EQUIPMENT.has([e, l].sort().join('|'))) soft = true;
  }
  return soft ? -0.15 : -0.6;
}

const EXACT_BONUS = 0.5;
const BARBELL_DEFAULT_BONUS = 0.02;
// A bare 50% token overlap isn't enough on its own; it needs agreeing equipment.
const MIN_SCORE = 0.55;

/** Fuzzy-match an external exercise name to a library exercise id, or null. */
export function matchExercise(name: string, library: Exercise[]): string | null {
  if (COMBO.test(name)) return null;
  const ext = tokenize(name);
  const extCore = withoutEquipment(ext);
  if (extCore.size === 0) return null;
  const extEquipment = new Set([...ext].filter((t) => EQUIPMENT_WORDS.has(t)));

  let bestId: string | null = null;
  let bestScore = MIN_SCORE - 1e-9;
  for (const ex of library) {
    const p = profileOf(ex);
    let score = Math.max(
      ...p.candidates.map((c) => {
        const core = withoutEquipment(c);
        return jaccard(extCore, core) + (sameSet(ext, c) ? EXACT_BONUS : 0) - DEFINING_PENALTY * definingMismatch(extCore, core);
      }),
    );
    score += equipmentScore(extEquipment, p.equipment);
    // No equipment given: default to the barbell variant ("Squat" → back squat).
    if (extEquipment.size === 0 && p.equipment.has('barbell')) score += BARBELL_DEFAULT_BONUS;
    if (score > bestScore) {
      bestScore = score;
      bestId = ex.id;
    }
  }
  return bestId;
}

import { describe, expect, it } from 'vitest';
import { detectFormat, matchExercise, parseCsv, parseWorkoutCsv } from './importers';
import type { Equipment, Exercise, Loading, MovementPattern, MuscleId } from './types';

function ex(
  id: string,
  name: string,
  equipment: Equipment[],
  loading: Loading,
  pattern: MovementPattern,
  primary: MuscleId[],
): Exercise {
  return {
    id,
    name,
    primary,
    secondary: [],
    equipment,
    pattern,
    mechanic: 'compound',
    loading,
    skill: 2,
    fatigue: 2,
    cues: [],
  };
}

// Small stand-in for the real library, with deliberately confusable neighbours.
const LIBRARY: Exercise[] = [
  ex('barbell-bench-press', 'Barbell Bench Press', ['barbell', 'bench'], 'barbell', 'horizontal_push', ['chest']),
  ex('dumbbell-bench-press', 'Dumbbell Bench Press', ['dumbbells', 'bench'], 'dumbbell', 'horizontal_push', ['chest']),
  ex('incline-dumbbell-press', 'Incline Dumbbell Press', ['dumbbells', 'bench'], 'dumbbell', 'horizontal_push', ['chest']),
  ex('barbell-back-squat', 'Barbell Back Squat', ['barbell', 'squat_rack'], 'barbell', 'squat', ['quads']),
  ex('barbell-front-squat', 'Barbell Front Squat', ['barbell', 'squat_rack'], 'barbell', 'squat', ['quads']),
  ex('goblet-squat', 'Goblet Squat', ['dumbbells'], 'dumbbell', 'squat', ['quads']),
  ex('barbell-deadlift', 'Barbell Deadlift', ['barbell'], 'barbell', 'hinge', ['hamstrings', 'glutes']),
  ex('romanian-deadlift', 'Romanian Deadlift', ['barbell'], 'barbell', 'hinge', ['hamstrings']),
  ex('trap-bar-deadlift', 'Trap Bar Deadlift', ['trap_bar'], 'barbell', 'hinge', ['quads', 'glutes']),
  ex('barbell-overhead-press', 'Barbell Overhead Press', ['barbell'], 'barbell', 'vertical_push', ['front_delts']),
  ex('dumbbell-shoulder-press', 'Dumbbell Shoulder Press', ['dumbbells'], 'dumbbell', 'vertical_push', ['front_delts']),
  ex('lat-pulldown', 'Lat Pulldown', ['cable'], 'cable', 'vertical_pull', ['lats']),
  ex('pull-up', 'Pull-Up', ['pullup_bar'], 'bodyweight', 'vertical_pull', ['lats']),
  ex('chin-up', 'Chin-Up', ['pullup_bar'], 'bodyweight', 'vertical_pull', ['lats', 'biceps']),
  ex('skull-crusher', 'Skull Crusher', ['ez_bar', 'bench'], 'barbell', 'elbow_extension', ['triceps']),
  ex('triceps-pushdown', 'Triceps Pushdown', ['cable'], 'cable', 'elbow_extension', ['triceps']),
  ex('dumbbell-curl', 'Dumbbell Curl', ['dumbbells'], 'dumbbell', 'elbow_flexion', ['biceps']),
  ex('barbell-curl', 'Barbell Curl', ['barbell'], 'barbell', 'elbow_flexion', ['biceps']),
  ex('leg-press', 'Leg Press', ['leg_press'], 'machine', 'squat', ['quads']),
  ex('hip-thrust', 'Barbell Hip Thrust', ['barbell', 'bench'], 'barbell', 'hinge', ['glutes']),
];

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const MIN = 60_000;

describe('parseCsv', () => {
  it('splits simple rows and keeps empty fields', () => {
    expect(parseCsv('a,b,c\n1,,3\nx,y,')).toEqual([
      ['a', 'b', 'c'],
      ['1', '', '3'],
      ['x', 'y', ''],
    ]);
  });

  it('handles quoted delimiters, escaped quotes and newlines inside quotes', () => {
    const text = 'name,note\n"Bench Press (Barbell)","felt ""easy"", go up"\n"Squat","line one\nline two"\n"",x';
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Bench Press (Barbell)', 'felt "easy", go up'],
      ['Squat', 'line one\nline two'],
      ['', 'x'],
    ]);
  });

  it('handles CRLF, a trailing newline and blank lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n3,"4\r\n5"\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4\r\n5'],
    ]);
  });

  it('strips a UTF-8 BOM', () => {
    const rows = parseCsv('﻿Date,Reps\n2024-01-01,5');
    expect(rows[0]).toEqual(['Date', 'Reps']);
  });

  it('auto-detects semicolon delimiters and leaves commas inside fields alone', () => {
    expect(parseCsv('Date;Weight;Notes\n2024-01-01;62,5;"a;b"')).toEqual([
      ['Date', 'Weight', 'Notes'],
      ['2024-01-01', '62,5', 'a;b'],
    ]);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\n\n')).toEqual([]);
  });

  it('treats quotes in the middle of an unquoted field literally', () => {
    expect(parseCsv('a,5\'10" tall,b')).toEqual([['a', '5\'10" tall', 'b']]);
  });
});

const STRONG_HEADER = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';
const HEVY_HEADER =
  '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"';

describe('detectFormat', () => {
  it('recognises Strong headers regardless of case', () => {
    expect(detectFormat(STRONG_HEADER.split(','))).toBe('strong');
    expect(detectFormat(STRONG_HEADER.toLowerCase().split(','))).toBe('strong');
  });

  it('recognises Hevy headers, including the pounds variant', () => {
    const header = parseCsv(HEVY_HEADER)[0]!;
    expect(detectFormat(header)).toBe('hevy');
    expect(detectFormat(header.map((h) => (h === 'weight_kg' ? 'weight_lbs' : h)))).toBe('hevy');
  });

  it('returns null for anything else', () => {
    expect(detectFormat(['date', 'distance', 'pace'])).toBeNull();
    expect(detectFormat([])).toBeNull();
  });
});

describe('parseWorkoutCsv — Strong', () => {
  const csv = [
    STRONG_HEADER,
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Bench Press (Barbell)",W,40,10,0,0,"","Felt strong",',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Bench Press (Barbell)",1,80,8,0,0,"","Felt strong",8',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Bench Press (Barbell)",2,80,7,0,0,"paused","Felt strong",9.5',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Triceps Pushdown (Cable - Straight Bar)",1,30,12,0,0,"","Felt strong",',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Bench Press (Barbell)",D,60,12,0,0,"","Felt strong",',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Pull Up",F,,9,0,0,"","Felt strong",10',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Plank",1,,,0,60,"","Felt strong",',
    '2024-03-05 18:02:11,"Push Day",1h 5m,"Pull Up",2,,0,0,0,"","Felt strong",',
    '2024-03-07 07:30:00,"Legs",45m,"Squat (Barbell)",1,100,5,0,0,"","",',
    '2024-03-07 07:30:00,"Legs",45m,"Running (Treadmill)",1,,,5,1800,"","",',
    '2024-03-07 07:30:00,"Legs",45m,"Plank",1,,,0,45,"","",',
    '2024-03-01 12:00:00,"Push Day",,"Bench Press (Barbell)",1,75,8,0,0,"","",',
    '2024-03-02 09:00:00,"Morning Run",30m,"Running (Treadmill)",1,,,5,1800,"","",',
  ].join('\n');

  const result = parseWorkoutCsv(csv);

  it('groups rows into workouts by date + name, sorted by start time', () => {
    expect(result.format).toBe('strong');
    expect(result.workouts.map((w) => [w.name, w.startedAt])).toEqual([
      ['Push Day', at(2024, 3, 1, 12)],
      ['Push Day', at(2024, 3, 5, 18, 2, 11)],
      ['Legs', at(2024, 3, 7, 7, 30)],
    ]);
  });

  it('keeps exercises in first-appearance order and merges repeated ones', () => {
    const push = result.workouts[1]!;
    expect(push.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Triceps Pushdown (Cable - Straight Bar)', 'Pull Up']);
    expect(push.exercises[0]!.sets.map((s) => s.weightKg)).toEqual([40, 80, 80, 60]);
    expect(push.notes).toBe('Felt strong');
  });

  it('maps set order to warm-up/working and RPE to RIR', () => {
    const [warmup, s1, s2, drop] = result.workouts[1]!.exercises[0]!.sets;
    expect(warmup).toEqual({ weightKg: 40, reps: 10, kind: 'warmup' });
    expect(s1).toEqual({ weightKg: 80, reps: 8, rir: 2, kind: 'working' });
    expect(s2?.rir).toBe(1); // round(10 - 9.5) = round(0.5) = 1
    expect(drop?.kind).toBe('working');
    const failure = result.workouts[1]!.exercises[2]!.sets;
    expect(failure).toEqual([{ weightKg: 0, reps: 9, rir: 0, kind: 'working' }]); // F set, bodyweight, zero-rep row dropped
  });

  it('derives finishedAt from Duration', () => {
    const [early, push, legs] = result.workouts;
    expect(early?.finishedAt).toBeUndefined();
    expect(push!.finishedAt! - push!.startedAt).toBe(65 * MIN);
    expect(legs!.finishedAt! - legs!.startedAt).toBe(45 * MIN);
  });

  it('skips timed/cardio sets with one warning per exercise, and workouts left empty', () => {
    expect(result.workouts[2]!.exercises.map((e) => e.name)).toEqual(['Squat (Barbell)']);
    const cardio = result.warnings.filter((w) => w.includes('timed or distance'));
    expect(cardio).toHaveLength(2);
    expect(cardio.some((w) => w.includes('"Plank"'))).toBe(true);
    expect(cardio.some((w) => w.includes('"Running (Treadmill)"'))).toBe(true);
    expect(result.warnings.some((w) => w.startsWith('1 workout(s) had no weight/rep sets'))).toBe(true);
  });

  it('converts pounds when told the export is in lb', () => {
    const lb = parseWorkoutCsv(csv, { strongUnit: 'lb' });
    expect(lb.workouts[0]!.exercises[0]!.sets[0]!.weightKg).toBeCloseTo(75 * 0.45359237, 6);
    const squat = lb.workouts[2]!.exercises[0]!.sets[0]!;
    expect(squat.weightKg).toBeCloseTo(45.359, 3);
    expect(squat.reps).toBe(5);
  });

  it('reads semicolon exports with a BOM, lower-case headers and decimal commas', () => {
    const text = [
      '﻿date;workout name;duration;exercise name;set order;weight;reps;distance;seconds;notes;workout notes;rpe',
      '2024-04-10 06:15:00;Upper;1h;Overhead Press (Barbell);1;42,5;6;;;;;7,5',
    ].join('\r\n');
    const r = parseWorkoutCsv(text);
    expect(r.format).toBe('strong');
    const w = r.workouts[0]!;
    expect(w.startedAt).toBe(at(2024, 4, 10, 6, 15));
    expect(w.finishedAt! - w.startedAt).toBe(60 * MIN);
    expect(w.exercises[0]!.sets[0]).toEqual({ weightKg: 42.5, reps: 6, rir: 3, kind: 'working' });
  });

  it('trusts a unit written in the Weight header over the option', () => {
    const text = 'Date,Workout Name,Exercise Name,Set Order,Weight (lbs),Reps\n2024-01-02 10:00:00,A,Deadlift (Barbell),1,315,3';
    const r = parseWorkoutCsv(text, { strongUnit: 'kg' });
    expect(r.workouts[0]!.exercises[0]!.sets[0]!.weightKg).toBeCloseTo(142.88, 2);
  });

  it('ignores rest-timer rows and reports unreadable dates', () => {
    const text = [
      STRONG_HEADER,
      '2024-01-02 10:00:00,A,30m,Squat (Barbell),Rest Timer,,,,90,,,',
      '2024-01-02 10:00:00,A,30m,Squat (Barbell),1,100,5,,,,,',
      'yesterday,A,30m,Squat (Barbell),1,100,5,,,,,',
    ].join('\n');
    const r = parseWorkoutCsv(text);
    expect(r.workouts).toHaveLength(1);
    expect(r.workouts[0]!.exercises[0]!.sets).toHaveLength(1);
    expect(r.warnings).toEqual(['1 row(s) had an unreadable date and were skipped.']);
  });
});

describe('parseWorkoutCsv — Hevy', () => {
  const row = (title: string, start: string, end: string, exercise: string, type: string, weight: string, reps: string, extra = ',,') =>
    `"${title}","${start}","${end}","","${exercise}",,"",0,"${type}",${weight},${reps},${extra}`;

  const csv = [
    HEVY_HEADER,
    `"Upper A","5 Mar 2024, 18:02","5 Mar 2024, 19:10","Good session","Bench Press (Barbell)",,"",0,"warmup",40,10,,,`,
    row('Upper A', '5 Mar 2024, 18:02', '5 Mar 2024, 19:10', 'Bench Press (Barbell)', 'normal', '80', '8', ',,8'),
    row('Upper A', '5 Mar 2024, 18:02', '5 Mar 2024, 19:10', 'Bench Press (Barbell)', 'failure', '80', '6', ',,10'),
    row('Upper A', '5 Mar 2024, 18:02', '5 Mar 2024, 19:10', 'Pull Up', 'normal', '', '10'),
    row('Upper A', '5 Mar 2024, 18:02', '5 Mar 2024, 19:10', 'Bench Press (Barbell)', 'dropset', '60', '10'),
    row('Upper A', '5 Mar 2024, 18:02', '5 Mar 2024, 19:10', 'Plank', 'normal', '', '', ',60,'),
    row('Lower A', '3 Mar 2024, 09:15', '3 Mar 2024, 10:00', 'Squat (Barbell)', 'normal', '100', '5', ',,8.5'),
    row('Upper A', '7 Mar 2024, 18:00', '', 'Bench Press (Barbell)', 'normal', '82.5', '8'),
  ].join('\n');

  const result = parseWorkoutCsv(csv);

  it('groups by title + start time and sorts ascending', () => {
    expect(result.format).toBe('hevy');
    expect(result.workouts.map((w) => [w.name, w.startedAt])).toEqual([
      ['Lower A', at(2024, 3, 3, 9, 15)],
      ['Upper A', at(2024, 3, 5, 18, 2)],
      ['Upper A', at(2024, 3, 7, 18, 0)],
    ]);
  });

  it('parses end time and description', () => {
    const upper = result.workouts[1]!;
    expect(upper.finishedAt).toBe(at(2024, 3, 5, 19, 10));
    expect(upper.notes).toBe('Good session');
    expect(result.workouts[2]!.finishedAt).toBeUndefined();
    expect(result.workouts[0]!.notes).toBeUndefined();
  });

  it('maps set types and RPE', () => {
    const bench = result.workouts[1]!.exercises[0]!;
    expect(bench.sets.map((s) => s.kind)).toEqual(['warmup', 'working', 'working', 'working']);
    expect(bench.sets.map((s) => s.rir)).toEqual([undefined, 2, 0, undefined]);
    expect(result.workouts[0]!.exercises[0]!.sets[0]!.rir).toBe(2); // round(1.5)
  });

  it('treats empty weight as bodyweight and skips timed sets with a warning', () => {
    const upper = result.workouts[1]!;
    expect(upper.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Pull Up']);
    expect(upper.exercises[1]!.sets).toEqual([{ weightKg: 0, reps: 10, kind: 'working' }]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('"Plank"');
  });

  it('converts weight_lbs exports', () => {
    const text = csv.replace('"weight_kg"', '"weight_lbs"');
    const r = parseWorkoutCsv(text);
    expect(r.workouts[0]!.exercises[0]!.sets[0]!.weightKg).toBeCloseTo(45.359237, 6);
  });

  it('accepts ISO, US-style and 12-hour times', () => {
    const text = [
      HEVY_HEADER,
      row('Iso local', '2024-03-05 18:02:00', '2024-03-05T19:00:00', 'Squat (Barbell)', 'normal', '100', '5'),
      row('Iso UTC', '2024-03-06T18:02:00Z', '2024-03-06T19:02:00+01:00', 'Squat (Barbell)', 'normal', '100', '5'),
      row('US', 'Mar 8, 2024, 6:02 PM', 'Mar 8, 2024 7:15 pm', 'Squat (Barbell)', 'normal', '100', '5'),
      row('Weekday', 'Sat, 9 Mar 2024, 12:05 AM', '', 'Squat (Barbell)', 'normal', '100', '5'),
      row('Bad', '31 Feb 2024, 10:00', '', 'Squat (Barbell)', 'normal', '100', '5'),
    ].join('\n');
    const r = parseWorkoutCsv(text);
    const byName = Object.fromEntries(r.workouts.map((w) => [w.name, w]));
    expect(byName['Iso local']!.startedAt).toBe(at(2024, 3, 5, 18, 2));
    expect(byName['Iso local']!.finishedAt).toBe(at(2024, 3, 5, 19));
    expect(byName['Iso UTC']!.startedAt).toBe(Date.UTC(2024, 2, 6, 18, 2));
    expect(byName['Iso UTC']!.finishedAt).toBe(Date.UTC(2024, 2, 6, 18, 2));
    expect(byName['US']!.startedAt).toBe(at(2024, 3, 8, 18, 2));
    expect(byName['US']!.finishedAt).toBe(at(2024, 3, 8, 19, 15));
    expect(byName['Weekday']!.startedAt).toBe(at(2024, 3, 9, 0, 5));
    expect(byName['Bad']).toBeUndefined();
    expect(r.warnings).toEqual(['1 row(s) had an unreadable date and were skipped.']);
  });
});

describe('parseWorkoutCsv — errors', () => {
  it('throws on empty or unrecognised files', () => {
    expect(() => parseWorkoutCsv('')).toThrow(/empty/);
    expect(() => parseWorkoutCsv('date,distance,pace\n2024-01-01,5,5:00')).toThrow(/Strong or Hevy/);
  });
});

describe('matchExercise', () => {
  const cases: Array<[string, string]> = [
    ['Bench Press (Barbell)', 'barbell-bench-press'],
    ['Bench Press (Dumbbell)', 'dumbbell-bench-press'],
    ['Bench Press', 'barbell-bench-press'],
    ['Incline Bench Press (Dumbbell)', 'incline-dumbbell-press'],
    ['Squat (Barbell)', 'barbell-back-squat'],
    ['Squat', 'barbell-back-squat'],
    ['Front Squat (Barbell)', 'barbell-front-squat'],
    ['Goblet Squat (Kettlebell)', 'goblet-squat'],
    ['Deadlift (Barbell)', 'barbell-deadlift'],
    ['Deadlift', 'barbell-deadlift'],
    ['Deadlift (Trap bar)', 'trap-bar-deadlift'],
    ['Romanian Deadlift (Barbell)', 'romanian-deadlift'],
    ['RDL', 'romanian-deadlift'],
    ['Overhead Press (Barbell)', 'barbell-overhead-press'],
    ['Military Press', 'barbell-overhead-press'],
    ['OHP', 'barbell-overhead-press'],
    ['Overhead Press (Dumbbell)', 'dumbbell-shoulder-press'],
    ['Lat Pulldown (Cable)', 'lat-pulldown'],
    ['Lat Pull Down (Machine)', 'lat-pulldown'],
    ['Pull Up', 'pull-up'],
    ['Pullups', 'pull-up'],
    ['Chin Up', 'chin-up'],
    ['Chinup', 'chin-up'],
    ['Bicep Curl (Dumbbell)', 'dumbbell-curl'],
    ['Bicep Curl (Barbell)', 'barbell-curl'],
    ['DB Curl', 'dumbbell-curl'],
    ['Triceps Pushdown', 'triceps-pushdown'],
    ['Triceps Pushdown (Cable - Straight Bar)', 'triceps-pushdown'],
    ['Skullcrusher (Barbell)', 'skull-crusher'],
    ['Skullcrushers (EZ Bar)', 'skull-crusher'],
    ['Leg Press', 'leg-press'],
    ['Leg Press (Machine)', 'leg-press'],
    ['Hip Thrust (Barbell)', 'hip-thrust'],
  ];

  it.each(cases)('matches %s → %s', (name, id) => {
    expect(matchExercise(name, LIBRARY)).toBe(id);
  });

  it('returns null for names with nothing close enough', () => {
    expect(matchExercise('Zercher Flamingo Twist', LIBRARY)).toBeNull();
    expect(matchExercise('', LIBRARY)).toBeNull();
    expect(matchExercise('(Barbell)', LIBRARY)).toBeNull();
    expect(matchExercise('Hack Squat', LIBRARY)).toBeNull();
    expect(matchExercise('Bench Press', [])).toBeNull();
  });

  it('refuses to map onto a different free-weight implement', () => {
    const noDumbbellBench = LIBRARY.filter((e) => e.id !== 'dumbbell-bench-press');
    expect(matchExercise('Bench Press (Dumbbell)', noDumbbellBench)).toBeNull();
    expect(matchExercise('Bench Press (Barbell)', noDumbbellBench)).toBe('barbell-bench-press');
  });
});

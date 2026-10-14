import { describe, expect, it } from 'vitest';
import { codeFromPaste, fromStrava, intensityOf, kindForSport, parseStravaCsv } from './strava';

describe('kindForSport', () => {
  it('maps API and export spellings alike', () => {
    expect(kindForSport('TrailRun')).toBe('run');
    expect(kindForSport('Trail Run')).toBe('run');
    expect(kindForSport('EBikeRide')).toBe('ride');
    expect(kindForSport('E-Bike Ride')).toBe('ride');
    expect(kindForSport('Walk')).toBe('hike');
    expect(kindForSport('Swim')).toBe('swim');
    expect(kindForSport('AlpineSki')).toBe('sport');
    expect(kindForSport('Rowing')).toBe('other');
    expect(kindForSport('SomethingNew')).toBe('other');
  });

  it('leaves lifting and yoga to Overload', () => {
    expect(kindForSport('WeightTraining')).toBeNull();
    expect(kindForSport('Weight Training')).toBeNull();
    expect(kindForSport('Yoga')).toBeNull();
  });
});

describe('intensityOf', () => {
  const base = { sportType: 'Run', minutes: 60 };
  it("trusts the athlete's perceived exertion first", () => {
    expect(intensityOf({ ...base, perceivedExertion: 3, sufferScore: 300 })).toBe('easy');
    expect(intensityOf({ ...base, perceivedExertion: 6 })).toBe('moderate');
    expect(intensityOf({ ...base, perceivedExertion: 9 })).toBe('hard');
  });

  it('reads Relative Effort per hour, then heart rate', () => {
    expect(intensityOf({ ...base, sufferScore: 30 })).toBe('easy');
    expect(intensityOf({ ...base, minutes: 30, sufferScore: 40 })).toBe('moderate');
    expect(intensityOf({ ...base, sufferScore: 180 })).toBe('hard');
    expect(intensityOf({ ...base, averageHeartrate: 118 })).toBe('easy');
    expect(intensityOf({ ...base, averageHeartrate: 165 })).toBe('hard');
  });

  it('falls back on what kind of session it was', () => {
    expect(intensityOf({ ...base, workoutType: 1 })).toBe('hard');
    expect(intensityOf(base)).toBe('moderate');
    expect(intensityOf({ sportType: 'Walk', minutes: 40 })).toBe('easy');
  });
});

describe('fromStrava', () => {
  it('turns an API activity into a recovery activity', () => {
    const a = fromStrava({
      id: 123,
      name: 'Morning Run',
      sport_type: 'Run',
      start_date: '2026-10-12T13:05:00Z',
      moving_time: 2730,
      elapsed_time: 2900,
      distance: 8046.7,
      average_heartrate: 150,
    });
    expect(a).toEqual({
      id: 'strava-123',
      kind: 'run',
      at: Date.UTC(2026, 9, 12, 13, 5),
      minutes: 46,
      intensity: 'moderate',
      source: 'strava',
      note: 'Morning Run',
      distanceKm: 8.05,
    });
  });

  it('skips lifting and anything under five minutes', () => {
    expect(fromStrava({ id: 1, sport_type: 'WeightTraining', start_date: '2026-10-12T13:05:00Z', moving_time: 3600 })).toBeNull();
    expect(fromStrava({ id: 2, type: 'Run', start_date: '2026-10-12T13:05:00Z', moving_time: 200 })).toBeNull();
  });
});

describe('parseStravaCsv', () => {
  // Real exports repeat columns (Elapsed Time, Distance, Relative Effort…); the first of each is read.
  const header =
    'Activity ID,Activity Date,Activity Name,Activity Type,Activity Description,Elapsed Time,Distance,Max Heart Rate,Relative Effort,Commute,Elapsed Time,Moving Time,Distance,Average Heart Rate,Relative Effort,Perceived Exertion';
  const csv = [
    header,
    '111,"Oct 1, 2026, 12:30:00 PM",Lunch Run,Run,,1900,5.2,172,62,false,1900,1800.0,5200.0,151,62,',
    '112,"Oct 2, 2026, 6:00:00 PM",Gym,Weight Training,,3600,0,,,false,3600,3600.0,0,,,',
    '113,"Oct 3, 2026, 7:15:00 AM","Hilly ride, part 2",Ride,,5400,40.1,,,false,5400,5000.0,40100.0,,,8',
    '114,not a date,Broken,Run,,600,1,,,false,600,600,1000,,,',
  ].join('\n');

  it('reads activities, times in UTC', () => {
    const r = parseStravaCsv(csv);
    expect(r.activities.map((a) => [a.id, a.kind, a.minutes, a.intensity, a.note])).toEqual([
      ['strava-111', 'run', 30, 'hard', 'Lunch Run'], // Relative Effort 62 in half an hour
      ['strava-113', 'ride', 83, 'hard', 'Hilly ride, part 2'],
    ]);
    expect(r.activities[0]!.at).toBe(Date.UTC(2026, 9, 1, 12, 30));
    expect(r.skipped).toBe(1);
    expect(r.warnings).toEqual(['1 row(s) had an unreadable date and were skipped.']);
  });

  it('rejects other files', () => {
    expect(() => parseStravaCsv('Date,Exercise\n2026-01-01,Squat')).toThrow(/Strava/);
  });
});

describe('codeFromPaste', () => {
  it('takes the code out of a pasted address, or a bare code', () => {
    expect(codeFromPaste('https://fogz-lgtm.github.io/Overload/?state=abc&code=0123456789abcdef0123456789abcdef01234567&scope=read,activity:read_all')).toBe(
      '0123456789abcdef0123456789abcdef01234567',
    );
    expect(codeFromPaste('  0123456789abcdef0123456789abcdef01234567 ')).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(codeFromPaste('hello there')).toBeNull();
  });
});

import { Icon } from '../components/Icon';

export interface DayMark {
  date: Date;
  lifted: boolean;
  cardio: boolean;
}

/** Monday–Sunday strip of the current week: filled = lifted, dot = cardio, ring = today. */
export function WeekStrip({ days, now }: { days: DayMark[]; now: number }) {
  const today = new Date(now).toDateString();
  return (
    <div className="week-strip" role="list" aria-label="This week">
      {days.map((d) => {
        const isToday = d.date.toDateString() === today;
        const future = d.date.getTime() > now && !isToday;
        const label = d.date.toLocaleDateString(undefined, { weekday: 'narrow' });
        const full = d.date.toLocaleDateString(undefined, { weekday: 'long' });
        return (
          <div
            key={d.date.toISOString()}
            role="listitem"
            className={`wday${d.lifted ? ' lifted' : ''}${isToday ? ' today' : ''}${future ? ' future' : ''}`}
            aria-label={`${full}: ${d.lifted ? 'lifted' : d.cardio ? 'cardio' : future ? 'upcoming' : 'rest'}`}
          >
            <span className="wday-label">{label}</span>
            <span className="wday-dot">
              {d.lifted ? <Icon name="check" size={16} /> : <span>{d.date.getDate()}</span>}
            </span>
            <span className={`wday-cardio${d.cardio ? ' on' : ''}`} />
          </div>
        );
      })}
    </div>
  );
}

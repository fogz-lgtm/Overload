import { Icon } from '../components/Icon';
import type { DayType } from '../engine/types';
import { DAY_SHORT, dayStyle } from './days';

export interface DayMark {
  /** Midnight at the start of the day. */
  day: number;
  lifted: boolean;
  cardio: boolean;
  /** Session type done that day, or planned for it. */
  type?: DayType;
  planned?: boolean;
}

/**
 * Monday–Sunday strip: filled = lifted, ring = today, label = the session
 * done or planned that day. Tap a day to see it.
 */
export function WeekStrip({ days, today, selected, onSelect }: { days: DayMark[]; today: number; selected?: number; onSelect?: (day: number) => void }) {
  return (
    <div className="week-strip" role="group" aria-label="Week">
      {days.map((d) => {
        const date = new Date(d.day);
        const isToday = d.day === today;
        const future = d.day > today;
        const full = date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
        const status = d.lifted ? 'done' : d.planned ? 'planned' : d.cardio ? 'cardio' : 'rest';
        const className = `wday${d.lifted ? ' lifted' : ''}${isToday ? ' today' : ''}${future ? ' future' : ''}${d.planned ? ' planned' : ''}${selected === d.day ? ' selected' : ''}`;
        // Screen readers hear "Today, Wednesday, October 14 Push planned"; the visible letters stay decorative.
        const body = (
          <>
            <span className="wday-label" aria-hidden="true">
              {date.toLocaleDateString(undefined, { weekday: 'narrow' })}
            </span>
            <span className="sr-only">{`${isToday ? 'Today, ' : ''}${full} `}</span>
            <span className="wday-dot" aria-hidden="true">
              {d.lifted ? <Icon name="check" size={16} /> : <span>{date.getDate()}</span>}
            </span>
            <span className="wday-type" style={d.type ? dayStyle(d.type) : undefined}>
              {d.type ? DAY_SHORT[d.type] : ''}
            </span>
            <span className="sr-only">{` ${status}`}</span>
            <span className={`wday-cardio${d.cardio ? ' on' : ''}`} aria-hidden="true" />
          </>
        );
        return onSelect ? (
          <button key={d.day} type="button" className={className} aria-pressed={selected === d.day} onClick={() => onSelect(d.day)}>
            {body}
          </button>
        ) : (
          <div key={d.day} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

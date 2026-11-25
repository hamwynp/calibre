import type { CalEvent } from "./types";
import { addDays, fmtKey, startOfDay } from "./dates";

/** One stop of the Tab cursor: an event as drawn on a particular day. */
export interface NavItem {
  ev: CalEvent;
  day: Date;
  key: string;
}

/** Identity of an event on a day (multi-day events are separate stops, occurrences have their own start). */
export const navKey = (ev: CalEvent, day: Date): string => `${ev.id}|${ev.start.getTime()}|${fmtKey(day)}`;

/**
 * Every event stop in reading order: day by day, all-day events first, then by start time.
 * This is the order Tab walks through in the week, day and month views.
 */
export function navItems(events: CalEvent[], days: Date[]): NavItem[] {
  const out: NavItem[] = [];
  for (const d of days) {
    const ds = startOfDay(d);
    const de = addDays(ds, 1);
    const today = events
      .filter((ev) => (ev.allDay ? ev.start <= ds && ev.end > ds : ev.end > ds && ev.start < de))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    for (const ev of today) out.push({ ev, day: ds, key: navKey(ev, ds) });
  }
  return out;
}

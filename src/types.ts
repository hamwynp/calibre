export interface Calendar {
  id: string;
  name: string;
  color: string;
  /** false for read-only calendars (holidays, subscribed...). */
  writable: boolean;
}

export type Freq = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export interface Recurrence {
  freq: Freq;
  /** Repeat every N days/weeks/months/years (ignored for weekdays). */
  interval: number;
  /** Last day (inclusive) an occurrence may start on. */
  until?: Date | null;
  /** Total number of occurrences. */
  count?: number | null;
}

export interface CalEvent {
  id: string;
  title: string;
  calendarId: string;
  start: Date;
  /** For all-day events `end` is exclusive (the day after the last day). */
  end: Date;
  allDay: boolean;
  /** True when this is one occurrence of a repeating event. */
  recurring?: boolean;
}

export interface NewEvent {
  title: string;
  calendarId: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrence?: Recurrence;
}

export type Priority = "H" | "M" | "L" | "";

/** A Taskwarrior task (read-only here). */
export interface Task {
  id: string;
  title: string;
  due: Date | null;
  priority: Priority;
}

/** Anything that can supply calendars/events. */
export interface CalendarProvider {
  readonly name: string;
  listCalendars(): Promise<Calendar[]>;
  listEvents(from: Date, to: Date): Promise<CalEvent[]>;
  createEvent(ev: NewEvent): Promise<CalEvent>;
  /** Register a callback for when fresher data arrived in the background. */
  onUpdate?(cb: () => void): void;
}

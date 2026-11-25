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
  /** The provider's own id for this event (Google: without the calendar prefix). */
  eventId?: string;
}

export interface NewEvent {
  title: string;
  calendarId: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrence?: Recurrence;
}

/** A repeat rule as read back from the provider. */
export interface ParsedRule {
  /** The rule in calibre's terms; null = does not repeat. */
  rec: Recurrence | null;
  /** True when the rule has parts calibre can't show (e.g. "every 3 days", BYMONTHDAY): it is kept unless changed. */
  exotic: boolean;
}

/** What the edit form needs to know about an event. */
export interface EditSource {
  /** This exact event / occurrence. */
  one: { start: Date; end: Date; allDay: boolean };
  /** Present when the event repeats: the whole series (its first start and rule). */
  series?: { id: string; start: Date; end: Date; allDay: boolean; rule: ParsedRule };
}

export type EditScope = "one" | "all";

export interface EditPatch {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** "keep" leaves the repeat rule alone; otherwise it is replaced (null = stop repeating). */
  recurrence: "keep" | { rec: Recurrence | null };
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
  /** Fetch what the edit form needs (for repeating events: the series too). */
  loadForEdit(ev: CalEvent): Promise<EditSource>;
  /** Change an event; scope "one" = just this occurrence, "all" = the whole series. */
  updateEvent(ev: CalEvent, src: EditSource, patch: EditPatch, scope: EditScope): Promise<void>;
  /** Register a callback for when fresher data arrived in the background. */
  onUpdate?(cb: () => void): void;
  /** Present for providers that need a sign-in (Google). */
  auth?: {
    signedIn(): Promise<boolean>;
    signIn(): Promise<void>;
    signOut(): Promise<void>;
  };
}

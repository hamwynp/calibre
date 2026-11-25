import type { CalEvent, Calendar, CalendarProvider, EditPatch, EditScope, EditSource, NewEvent, Recurrence } from "./types";
import { occurrenceStarts } from "./recurrence";
import { addDays, mondayOf } from "./dates";

const KEY = "calibre.demo.events";

const CALENDARS: Calendar[] = [
  { id: "personal", name: "Personal", color: "#8bd5ca", writable: true },
  { id: "university", name: "University", color: "#a2cffe", writable: true },
  { id: "exams", name: "Exams", color: "#ed8796", writable: true },
  { id: "birthdays", name: "Birthdays", color: "#f5bde6", writable: true },
];

interface Stored {
  id: string;
  title: string;
  calendarId: string;
  start: string;
  end: string;
  allDay: boolean;
  recurrence?: { freq: Recurrence["freq"]; interval: number; until?: string | null; count?: number | null };
  /** Start times (ms) of occurrences that were edited on their own or removed. */
  exceptions?: number[];
}

type Base = CalEvent & { recurrence?: Recurrence; exceptions?: number[] };

function at(day: Date, h: number, m = 0): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

function seed(): CalEvent[] {
  const mon = mondayOf(new Date());
  const d = (n: number) => addDays(mon, n);
  const ev = (id: string, title: string, calendarId: string, start: Date, end: Date, allDay = false): CalEvent => ({ id, title, calendarId, start, end, allDay });
  return [
    ev("s1", "Signals lecture", "university", at(d(0), 9), at(d(0), 10, 30)),
    ev("s2", "Gym", "personal", at(d(0), 18), at(d(0), 19)),
    ev("s3", "Study group", "university", at(d(1), 9, 30), at(d(1), 11)),
    ev("s4", "Lab report due", "university", d(1), d(2), true),
    ev("s5", "Circuits midterm", "exams", at(d(2), 9), at(d(2), 10, 30)),
    ev("s6", "Review session", "university", at(d(2), 9, 45), at(d(2), 11)),
    ev("s7", "Coffee with Sam", "personal", at(d(2), 15), at(d(2), 16)),
    ev("s8", "Sam's birthday", "birthdays", d(4), d(5), true),
    ev("s9", "Project week", "university", d(3), d(6), true),
    ev("s10", "Dinner", "personal", at(d(4), 19), at(d(4), 21)),
    ev("s11", "Hike", "personal", at(d(5), 8), at(d(5), 13)),
  ];
}

/** Offline demo data stored in localStorage - lets the UI run with no Google account. */
export class DemoProvider implements CalendarProvider {
  readonly name = "Demo data";
  private events: Base[];

  constructor() {
    this.events = this.load() ?? seed();
  }

  private load(): Base[] | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return (JSON.parse(raw) as Stored[]).map((s) => ({
        ...s,
        start: new Date(s.start),
        end: new Date(s.end),
        recurrence: s.recurrence && { ...s.recurrence, until: s.recurrence.until ? new Date(s.recurrence.until) : null },
      }));
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      const out: Stored[] = this.events.map((e) => ({
        ...e,
        start: e.start.toISOString(),
        end: e.end.toISOString(),
        recurrence: e.recurrence && { ...e.recurrence, until: e.recurrence.until ? e.recurrence.until.toISOString() : null },
      }));
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* storage unavailable - demo data just won't persist */
    }
  }

  async listCalendars(): Promise<Calendar[]> {
    return CALENDARS;
  }

  async listEvents(from: Date, to: Date): Promise<CalEvent[]> {
    const out: CalEvent[] = [];
    for (const e of this.events) {
      if (!e.recurrence) {
        if (e.end > from && e.start < to) out.push(e);
        continue;
      }
      const len = e.end.getTime() - e.start.getTime();
      for (const st of occurrenceStarts(e.recurrence, e.start, from, to)) {
        const end = e.allDay ? new Date(st.getFullYear(), st.getMonth(), st.getDate(), 0, 0) : new Date(st.getTime() + len);
        const dayLen = e.allDay ? Math.round(len / 86_400_000) : 0;
        const finish = e.allDay ? addDays(end, dayLen) : end;
        if (e.exceptions?.includes(st.getTime())) continue;
        if (finish > from && st < to) out.push({ ...e, id: e.id + "@" + st.getTime(), start: st, end: finish, recurring: true });
      }
    }
    return out;
  }

  async createEvent(ev: NewEvent): Promise<CalEvent> {
    const created: Base = { ...ev, id: "d" + Date.now() + Math.random().toString(36).slice(2, 6) };
    this.events.push(created);
    this.save();
    return created;
  }

  private baseOf(ev: CalEvent): Base | undefined {
    return this.events.find((e) => e.id === ev.id.split("@")[0]);
  }

  async loadForEdit(ev: CalEvent): Promise<EditSource> {
    const one = { start: ev.start, end: ev.end, allDay: ev.allDay };
    const base = this.baseOf(ev);
    if (!base?.recurrence) return { one };
    return { one, series: { id: base.id, start: base.start, end: base.end, allDay: base.allDay, rule: { rec: base.recurrence, exotic: false } } };
  }

  async updateEvent(ev: CalEvent, src: EditSource, patch: EditPatch, scope: EditScope): Promise<void> {
    const base = this.baseOf(ev);
    if (!base) throw new Error("That event no longer exists");
    if (src.series && scope === "one") {
      // detach this occurrence: skip it in the series and add it as its own event
      (base.exceptions ??= []).push(ev.start.getTime());
      this.events.push({ id: "d" + Date.now() + Math.random().toString(36).slice(2, 6), title: patch.title, calendarId: patch.calendarId, start: patch.start, end: patch.end, allDay: patch.allDay });
    } else {
      Object.assign(base, { title: patch.title, calendarId: patch.calendarId, start: patch.start, end: patch.end, allDay: patch.allDay });
      if (patch.recurrence !== "keep") {
        const rec = patch.recurrence.rec;
        if (rec) base.recurrence = rec;
        else delete base.recurrence;
      }
    }
    this.save();
  }

  async deleteEvent(ev: CalEvent, scope: EditScope): Promise<void> {
    const base = this.baseOf(ev);
    if (!base) return;
    if (base.recurrence && scope === "one") (base.exceptions ??= []).push(ev.start.getTime());
    else this.events = this.events.filter((e) => e !== base);
    this.save();
  }
}

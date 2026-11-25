import { invoke } from "@tauri-apps/api/core";
import type { CalEvent, Calendar, CalendarProvider, NewEvent } from "./types";
import { addDays, fmtKey, pad2 } from "./dates";
import { toRRule } from "./recurrence";

interface CalDto {
  id: string;
  name: string;
  color: string;
  writable: boolean;
}
interface EventDto {
  id: string;
  title: string;
  calendarId: string;
  start: string;
  end: string;
  allDay: boolean;
  recurring: boolean;
}

const SNAPSHOT = "calibre.google.snapshot";
const FRESH_MS = 2 * 60_000;
const PAD_DAYS = 45;

/** "2026-11-23" -> local midnight; RFC 3339 -> Date. */
function parse(s: string, allDay: boolean): Date {
  if (allDay) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y!, m! - 1, d!);
  }
  return new Date(s);
}

const toEvent = (d: EventDto): CalEvent => ({
  id: d.calendarId + ":" + d.id,
  title: d.title,
  calendarId: d.calendarId,
  start: parse(d.start, d.allDay),
  end: parse(d.end, d.allDay),
  allDay: d.allDay,
  recurring: d.recurring,
});

interface Win {
  from: Date;
  to: Date;
  at: number;
  events: CalEvent[];
}

/**
 * Google Calendar via the Rust side. Fetches a padded window of events and serves
 * navigation from it; refreshes in the background (stale-while-revalidate) and keeps
 * the last window in localStorage so the app opens instantly, even offline.
 */
export class GoogleProvider implements CalendarProvider {
  readonly name = "Google Calendar";
  private cals: Calendar[] = [];
  private win: Win | null = null;
  private inflight: Promise<void> | null = null;
  private cb: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(SNAPSHOT);
      if (raw) {
        const s = JSON.parse(raw) as { from: string; to: string; at: number; events: (Omit<CalEvent, "start" | "end"> & { start: string; end: string })[] };
        this.win = {
          from: new Date(s.from),
          to: new Date(s.to),
          at: 0, // treat as stale: show it now, refresh right away
          events: s.events.map((e) => ({ ...e, start: new Date(e.start), end: new Date(e.end) })),
        };
      }
    } catch {
      /* no snapshot */
    }
  }

  onUpdate(cb: () => void): void {
    this.cb = cb;
  }

  readonly auth = {
    signedIn: () => invoke<boolean>("google_signed_in"),
    signIn: async () => {
      await invoke("google_sign_in");
    },
    signOut: async () => {
      await invoke("google_sign_out");
      this.win = null;
      this.cals = [];
      try {
        localStorage.removeItem(SNAPSHOT);
      } catch {
        /* ignore */
      }
    },
  };

  async listCalendars(): Promise<Calendar[]> {
    this.cals = await invoke<CalDto[]>("google_calendars");
    return this.cals;
  }

  private async fetchWindow(from: Date, to: Date): Promise<void> {
    const ids = this.cals.map((c) => c.id);
    const dtos = await invoke<EventDto[]>("google_events", { timeMin: from.toISOString(), timeMax: to.toISOString(), calendarIds: ids });
    this.win = { from, to, at: Date.now(), events: dtos.map(toEvent) };
    try {
      localStorage.setItem(SNAPSHOT, JSON.stringify({ ...this.win, from: from.toISOString(), to: to.toISOString() }));
    } catch {
      /* ignore */
    }
  }

  private refreshInBackground(from: Date, to: Date): void {
    if (this.inflight) return;
    this.inflight = this.fetchWindow(from, to)
      .then(() => this.cb?.())
      .catch(() => {
        /* keep showing what we have */
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  async listEvents(from: Date, to: Date): Promise<CalEvent[]> {
    const w = this.win;
    if (w && w.from <= from && w.to >= to) {
      if (Date.now() - w.at > FRESH_MS) this.refreshInBackground(w.from, w.to);
      return this.slice(from, to);
    }
    await this.fetchWindow(addDays(from, -PAD_DAYS), addDays(to, PAD_DAYS));
    return this.slice(from, to);
  }

  private slice(from: Date, to: Date): CalEvent[] {
    return (this.win?.events ?? []).filter((e) => e.end > from && e.start < to);
  }

  async createEvent(ev: NewEvent): Promise<CalEvent> {
    const local = (d: Date) => `${fmtKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
    const dto = await invoke<EventDto>("google_create", {
      args: {
        calendarId: ev.calendarId,
        title: ev.title,
        allDay: ev.allDay,
        start: ev.allDay ? fmtKey(ev.start) : local(ev.start),
        end: ev.allDay ? fmtKey(ev.end) : local(ev.end),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        recurrence: ev.recurrence ? toRRule(ev.recurrence, ev.allDay) : null,
      },
    });
    if (this.win) await this.fetchWindow(this.win.from, this.win.to);
    return toEvent(dto);
  }
}

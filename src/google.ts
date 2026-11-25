import { invoke } from "@tauri-apps/api/core";
import type { CalEvent, Calendar, CalendarProvider, EditPatch, EditScope, EditSource, NewEvent } from "./types";
import { addDays, fmtKey, pad2 } from "./dates";
import { parseRRule, toRRule } from "./recurrence";

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
  recurringEventId?: string | null;
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
  eventId: d.id,
  seriesId: d.recurringEventId ?? undefined,
});

interface DetailDto {
  start: string;
  end: string;
  allDay: boolean;
  series: { id: string; start: string; end: string; allDay: boolean; recurrence: string | null } | null;
}

/** Local wall-clock time Google's API takes alongside a timeZone. */
const localStamp = (d: Date): string => `${fmtKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;

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
    const local = localStamp;
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

  async loadForEdit(ev: CalEvent): Promise<EditSource> {
    const d = await invoke<DetailDto>("google_event_detail", { calendarId: ev.calendarId, eventId: ev.eventId });
    const one = { start: parse(d.start, d.allDay), end: parse(d.end, d.allDay), allDay: d.allDay };
    if (!d.series) return { one };
    const sStart = parse(d.series.start, d.series.allDay);
    return {
      one,
      series: { id: d.series.id, start: sStart, end: parse(d.series.end, d.series.allDay), allDay: d.series.allDay, rule: parseRRule(d.series.recurrence, sStart) },
    };
  }

  async updateEvent(ev: CalEvent, src: EditSource, patch: EditPatch, scope: EditScope): Promise<void> {
    const whole = scope === "all" && !!src.series;
    const setRule = whole || !src.series; // a single occurrence can't change its repeat rule
    const rec = patch.recurrence === "keep" ? null : patch.recurrence.rec;
    await invoke("google_update", {
      args: {
        calendarId: ev.calendarId,
        eventId: whole ? src.series!.id : ev.eventId,
        title: patch.title,
        allDay: patch.allDay,
        start: patch.allDay ? fmtKey(patch.start) : localStamp(patch.start),
        end: patch.allDay ? fmtKey(patch.end) : localStamp(patch.end),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        setRecurrence: setRule && patch.recurrence !== "keep",
        recurrence: rec ? toRRule(rec, patch.allDay) : null,
      },
    });
    if (patch.calendarId !== ev.calendarId) {
      try {
        await invoke("google_move", { calendarId: ev.calendarId, eventId: whole ? src.series!.id : ev.eventId, destination: patch.calendarId });
      } catch (e) {
        if (this.win) await this.fetchWindow(this.win.from, this.win.to).catch(() => {});
        throw new Error("Saved, but could not move it to the other calendar: " + (e instanceof Error ? e.message : String(e)));
      }
    }
    if (this.win) await this.fetchWindow(this.win.from, this.win.to);
  }

  async deleteEvent(ev: CalEvent, scope: EditScope): Promise<void> {
    let id = ev.eventId ?? "";
    if (scope === "all" && ev.recurring) {
      // events cached before series ids were tracked: ask Google
      id = ev.seriesId ?? (await this.loadForEdit(ev)).series?.id ?? id;
    }
    await invoke("google_delete", { calendarId: ev.calendarId, eventId: id });
    if (this.win) await this.fetchWindow(this.win.from, this.win.to);
  }
}

import type { CalEvent } from "./types";
import { fmtKey } from "./dates";

const KEY = "calibre.dismissed";

/** Stable-ish key for an event in the list view (dismiss / select). */
export const eventKey = (ev: CalEvent): string =>
  `c:${fmtKey(ev.start)}|${ev.allDay ? "" : ev.start.getHours() + ":" + ev.start.getMinutes()}|${ev.title}`;

export function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function saveDismissed(s: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

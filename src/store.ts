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

const HIDDEN_KEY = "calibre.hiddenCalendars";
const COLLAPSED_KEY = "calibre.sideCollapsed";
const SIDE_KEY = "calibre.sidebar";

function loadSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
function saveSet(key: string, s: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* ignore */
  }
}

/** Calendars the user switched off (their events are hidden everywhere). */
export const loadHiddenCalendars = (): Set<string> => loadSet(HIDDEN_KEY);
export const saveHiddenCalendars = (s: Set<string>): void => saveSet(HIDDEN_KEY, s);
/** Sidebar sections that are folded. */
export const loadCollapsed = (): Set<string> => loadSet(COLLAPSED_KEY);
export const saveCollapsed = (s: Set<string>): void => saveSet(COLLAPSED_KEY, s);

export function loadSidebarShown(): boolean {
  try {
    return localStorage.getItem(SIDE_KEY) !== "0";
  } catch {
    return true;
  }
}
export function saveSidebarShown(v: boolean): void {
  try {
    localStorage.setItem(SIDE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// ---------- settings (Ctrl+I) ----------
const SETTINGS_KEY = "calibre.settings";

export interface Settings {
  /** Show Shamsi (Jalali) dates next to the Gregorian ones. */
  shamsi: boolean;
}

export const DEFAULT_SETTINGS: Settings = { shamsi: true };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<Settings>;
    return { shamsi: typeof raw.shamsi === "boolean" ? raw.shamsi : DEFAULT_SETTINGS.shamsi };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

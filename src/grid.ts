import type { CalEvent, Task } from "./types";
import { DAYS, fmtTime, hoursOf, sameDay } from "./dates";
import { stripItems, timedItems } from "./layout";
import { $, el } from "./ui";

/** Zoom levels for the time grid (px per hour). Default is 20px per hour (whole day at a glance). */
export const ZOOM_LEVELS = [14, 20, 28, 36, 44, 52, 60, 72, 86, 102, 120, 140];
const ZOOM_KEY = "calibre.zoom.px"; // stores px per hour (not an index), so changing the levels never breaks it
const DEFAULT_PX = 20;
let zoomIdx = (() => {
  let px = DEFAULT_PX;
  try {
    const v = parseInt(localStorage.getItem(ZOOM_KEY) ?? "", 10);
    if (ZOOM_LEVELS.includes(v)) px = v;
  } catch {
    /* use the default */
  }
  return ZOOM_LEVELS.indexOf(px);
})();

/** Current px per hour. */
export const hourPx = (): number => ZOOM_LEVELS[zoomIdx]!;

/** Zoom one level in (+1) or out (-1); returns false when already at the limit. */
export function stepZoom(dir: 1 | -1): boolean {
  const n = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoomIdx + dir));
  if (n === zoomIdx) return false;
  zoomIdx = n;
  try {
    localStorage.setItem(ZOOM_KEY, String(ZOOM_LEVELS[zoomIdx]));
  } catch {
    /* ignore */
  }
  return true;
}

/** Back to the default zoom; returns false when already there. */
export function resetZoom(): boolean {
  const n = ZOOM_LEVELS.indexOf(DEFAULT_PX);
  if (n === zoomIdx) return false;
  zoomIdx = n;
  try {
    localStorage.setItem(ZOOM_KEY, String(DEFAULT_PX));
  } catch {
    /* ignore */
  }
  return true;
}

let lastStripH = 0;
/** Height (px) of the all-day strip in the last render. */
export const stripHeight = (): number => lastStripH;
const STRIP_ROW = 19;
const STRIP_MAX = 4;

export interface GridCtx {
  days: Date[];
  events: CalEvent[];
  tasks: Task[];
  colorOf: (ev: CalEvent) => string;
  now: Date;
}

/**
 * The time grid shared by the week view (7 days) and the day view (1 day): day headers,
 * an all-day/task strip above 12am, a 24h grid with lane-packed events and tasks, and
 * the "now" line. Returns the strip height (px) so callers can scroll to "now".
 */
export function renderGrid(ctx: GridCtx): number {
  const { days, events, tasks, colorOf, now } = ctx;
  const dayhead = $<HTMLDivElement>("dayhead");
  const inner = $<HTMLDivElement>("inner");
  const HOUR = hourPx();
  const cols = String(days.length);
  dayhead.style.setProperty("--cols", cols);
  inner.style.setProperty("--cols", cols);
  inner.style.setProperty("--hour", HOUR + "px");

  dayhead.replaceChildren(el("div"));
  for (const d of days) {
    const h = el("div", "dh" + (sameDay(d, now) ? " today" : ""), DAYS[d.getDay()]);
    h.append(el("b", "", String(d.getDate())));
    dayhead.append(h);
  }

  const strips = days.map((d) => stripItems(events, tasks, d, colorOf));
  const rows = Math.min(STRIP_MAX, Math.max(0, ...strips.map((a) => a.length)));
  const stripH = rows > 0 ? rows * STRIP_ROW + 8 : 0;

  inner.replaceChildren();
  if (rows > 0) {
    const strip = el("div", "strip");
    strip.style.height = stripH + "px";
    strip.append(el("div", "lbl", "all-day"));
    for (const list of strips) {
      const cell = el("div", "sc");
      const over = list.length > STRIP_MAX;
      for (const it of over ? list.slice(0, STRIP_MAX - 1) : list) {
        const c = el("div", "chip " + (it.kind === "task" ? "task" : "evt"));
        c.title = it.title;
        if (it.kind === "task") {
          c.style.borderColor = it.color;
          const bar = el("i");
          bar.style.background = it.color;
          c.append(bar, it.title);
        } else {
          c.style.background = it.color;
          c.textContent = (it.recurring ? "↻ " : "") + it.title;
        }
        cell.append(c);
      }
      if (over) cell.append(el("div", "more", `+${list.length - (STRIP_MAX - 1)} more`));
      strip.append(cell);
    }
    inner.append(strip);
  }

  const hours = el("div", "hours");
  const labels = el("div", "glabels");
  for (let h = 0; h < 24; h++) {
    const line = el("div", "hl");
    line.style.top = h * HOUR + "px";
    hours.append(line);
    if (h > 0) {
      const lab = el("div", "hlab", `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`);
      lab.style.top = h * HOUR + "px";
      labels.append(lab);
    }
  }
  hours.prepend(labels);

  for (const d of days) {
    const col = el("div", "col" + (sameDay(d, now) ? " today" : ""));
    for (const it of timedItems(events, tasks, d, colorOf, fmtTime, 22 / HOUR)) {
      const b = el("div", "ev" + (it.kind === "task" ? " tk" : ""));
      b.style.top = it.s * HOUR + "px";
      b.style.height = (it.kind === "task" ? 20 : Math.max(20, (it.e - it.s) * HOUR - 2)) + "px";
      b.style.left = `calc(${(it.lane / it.lanes) * 100}% + 2px)`;
      b.style.width = `calc(${100 / it.lanes}% - 4px)`;
      b.style.borderColor = it.color;
      if (it.kind === "ev") b.style.background = `color-mix(in srgb, ${it.color} 26%, transparent)`;
      b.title = it.title + (it.sub ? "\n" + it.sub : "");
      if (it.kind === "task") {
        const bar = el("i");
        bar.style.background = it.color;
        b.append(bar, el("b", "", it.title));
      } else {
        b.append(el("b", "", (it.recurring ? "↻ " : "") + it.title));
        if ((it.e - it.s) * HOUR >= 34) b.append(el("small", "", it.sub));
      }
      col.append(b);
    }
    if (sameDay(d, now)) {
      const line = el("div", "now");
      line.style.top = hoursOf(now) * HOUR + "px";
      col.append(line);
    }
    hours.append(col);
  }
  inner.append(hours);
  lastStripH = stripH;
  return stripH;
}


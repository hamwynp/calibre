import "./styles.css";
import type { CalEvent, Calendar, CalendarProvider } from "./types";
import { DAYS, addDays, fmtTime, hoursOf, mondayOf, sameDay, startOfDay, weekTitle } from "./dates";
import { allDayFor, timedSegments } from "./layout";
import { DemoProvider } from "./demo";
import { initForm } from "./form";
import { createHelp } from "./help";

const HOUR = 48; // px, keep in sync with --hour
const STRIP_ROW = 19;
const STRIP_MAX = 4;

const provider: CalendarProvider = new DemoProvider();

let weekStart = mondayOf(new Date());
let events: CalEvent[] = [];
let calendars: Calendar[] = [];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const scroller = $<HTMLDivElement>("scroll");
const inner = $<HTMLDivElement>("inner");
const dayhead = $<HTMLDivElement>("dayhead");

const calById = (id: string): Calendar | undefined => calendars.find((c) => c.id === id);
const colorOf = (ev: CalEvent): string => calById(ev.calendarId)?.color ?? "#8b93a7";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function weekOffset(): number {
  return Math.round((weekStart.getTime() - mondayOf(new Date()).getTime()) / (7 * 86_400_000));
}

type ScrollMode = "keep" | "top" | "now";

function render(mode: ScrollMode): void {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const keepTop = scroller.scrollTop;

  $("title").textContent = weekTitle(weekStart);
  const off = weekOffset();
  const hint = $("weekhint");
  hint.hidden = off === 0;
  hint.textContent = `${off > 0 ? "+" : ""}${off}w`;

  // day header
  dayhead.replaceChildren(el("div"));
  for (const d of days) {
    const h = el("div", "dh" + (sameDay(d, now) ? " today" : ""), DAYS[d.getDay()]);
    h.append(el("b", "", String(d.getDate())));
    dayhead.append(h);
  }

  // top strip: all-day events, stacked, only visible when scrolled to the top
  const allDay = days.map((d) => allDayFor(events, d));
  const rows = Math.min(STRIP_MAX, Math.max(0, ...allDay.map((a) => a.length)));
  const stripH = rows > 0 ? rows * STRIP_ROW + 8 : 0;

  inner.replaceChildren();
  if (rows > 0) {
    const strip = el("div", "strip");
    strip.style.height = stripH + "px";
    strip.append(el("div", "lbl", "all-day"));
    allDay.forEach((list) => {
      const cell = el("div", "sc");
      const over = list.length > STRIP_MAX;
      for (const ev of over ? list.slice(0, STRIP_MAX - 1) : list) {
        const c = el("div", "chip", (ev.recurring ? "\u21bb " : "") + ev.title);
        c.style.background = colorOf(ev);
        c.title = ev.title;
        cell.append(c);
      }
      if (over) cell.append(el("div", "more", `+${list.length - (STRIP_MAX - 1)} more`));
      strip.append(cell);
    });
    inner.append(strip);
  }

  // 24h grid
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

  days.forEach((d) => {
    const col = el("div", "col" + (sameDay(d, now) ? " today" : ""));
    for (const sg of timedSegments(events, d)) {
      const color = colorOf(sg.ev);
      const b = el("div", "ev");
      b.style.top = sg.s * HOUR + "px";
      b.style.height = Math.max(20, (sg.e - sg.s) * HOUR - 2) + "px";
      b.style.left = `calc(${(sg.lane / sg.lanes) * 100}% + 2px)`;
      b.style.width = `calc(${100 / sg.lanes}% - 4px)`;
      b.style.background = `color-mix(in srgb, ${color} 26%, transparent)`;
      b.style.borderColor = color;
      b.title = `${sg.ev.title}\n${fmtTime(sg.ev.start)} – ${fmtTime(sg.ev.end)}`;
      b.append(el("b", "", (sg.ev.recurring ? "\u21bb " : "") + sg.ev.title));
      if ((sg.e - sg.s) * HOUR >= 34) b.append(el("small", "", `${fmtTime(sg.ev.start)} – ${fmtTime(sg.ev.end)}`));
      col.append(b);
    }
    if (sameDay(d, now)) {
      const line = el("div", "now");
      line.style.top = hoursOf(now) * HOUR + "px";
      col.append(line);
    }
    hours.append(col);
  });
  inner.append(hours);

  // scrolling: current week -> centred on now; other weeks -> 12am (strip visible)
  if (mode === "top") scroller.scrollTop = 0;
  else if (mode === "now") scroller.scrollTop = Math.max(0, stripH + hoursOf(now) * HOUR - scroller.clientHeight / 2);
  else scroller.scrollTop = keepTop;
}

async function load(mode: ScrollMode): Promise<void> {
  try {
    $("calerr").textContent = "";
    events = await provider.listEvents(weekStart, addDays(weekStart, 7));
  } catch (e) {
    $("calerr").textContent = "⚠ " + (e instanceof Error ? e.message : String(e));
  }
  render(mode);
}

function gotoWeek(delta: number): void {
  weekStart = addDays(weekStart, delta * 7);
  void load(weekOffset() === 0 ? "now" : "top");
}

function gotoToday(): void {
  weekStart = mondayOf(new Date());
  void load("now");
}

const form = initForm({
  provider,
  calendars: () => calendars,
  defaultDate: () => (weekOffset() === 0 ? startOfDay(new Date()) : weekStart),
  onCreated: () => void load("keep"),
});

const help = createHelp(() => (form.isOpen() ? "form" : "week"));

// Ctrl+/ toggles the help; Esc closes it first. Capture phase so it works inside inputs too.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey && (e.key === "?" || e.key === "/")) {
      help.toggle();
    } else if (help.isOpen() && e.key === "Escape") {
      help.close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

document.addEventListener("keydown", (e) => {
  if (form.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  switch (e.key) {
    case "h": case "ArrowLeft": gotoWeek(-1); break;
    case "l": case "ArrowRight": gotoWeek(1); break;
    case "t": case "0": gotoToday(); break;
    case "j": case "ArrowDown": scroller.scrollBy({ top: 60 }); break;
    case "k": case "ArrowUp": scroller.scrollBy({ top: -60 }); break;
    case "J": scroller.scrollTop = scroller.scrollHeight; break;
    case "K": scroller.scrollTop = 0; break;
    case "a": form.open(); break;
    default: return;
  }
  e.preventDefault();
});

// keep the "now" line moving
setInterval(() => {
  if (!form.isOpen()) render("keep");
}, 60_000);
window.addEventListener("resize", () => render("keep"));

void (async () => {
  calendars = await provider.listCalendars();
  await load("now");
})();


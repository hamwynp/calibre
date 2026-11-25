import type { Calendar } from "./types";
import { addDays, monthName, sameDay, startOfDay } from "./dates";
import { $, el } from "./ui";

export interface SideCtx {
  /** The date the main view is showing. */
  anchor: Date;
  /** "week" highlights the whole week row, "day" a single day. */
  view: "week" | "day" | "month" | "list";
  /** The month the mini calendar shows (browsable on its own). */
  mini: Date;
  now: Date;
  calendars: Calendar[];
  hidden: Set<string>;
  collapsed: Set<string>;
  onPickDate: (d: Date) => void;
  onMiniStep: (delta: number) => void;
  onToggleCalendar: (id: string) => void;
  onToggleSection: (name: string) => void;
}

const CHECK = '<svg viewBox="0 0 12 12"><path d="M2.5 6.2l2.4 2.4 4.6-5"/></svg>';

/** The colored checkbox used in the sidebar and the calendar picker. */
export function calBox(color: string, on: boolean): HTMLElement {
  const b = el("span", "box");
  b.style.borderColor = color;
  if (on) {
    b.style.background = color;
    b.innerHTML = CHECK;
  }
  return b;
}

function sectionHead(ctx: SideCtx, name: string, label: string): HTMLElement {
  const h = el("div", "sec-head");
  h.append(el("i", "", ctx.collapsed.has(name) ? "▸" : "▾"), el("b", "", label));
  h.addEventListener("click", () => ctx.onToggleSection(name));
  return h;
}

/** Left strip: small month calendar, booking pages, and "My calendars" with what's shown. */
export function renderSidebar(ctx: SideCtx): void {
  const root = $<HTMLElement>("side");

  // ---- mini month ----
  const head = el("div", "mini-head");
  const prev = el("button", "", "‹");
  const next = el("button", "", "›");
  prev.title = "Previous month";
  next.title = "Next month";
  prev.addEventListener("click", () => ctx.onMiniStep(-1));
  next.addEventListener("click", () => ctx.onMiniStep(1));
  head.append(el("b", "", `${monthName(ctx.mini.getMonth())} ${ctx.mini.getFullYear()}`), prev, next);

  const grid = el("div", "mini");
  for (const d of ["S", "M", "T", "W", "T", "F", "S"]) grid.append(el("div", "dow", d));
  const first = new Date(ctx.mini.getFullYear(), ctx.mini.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  const aDay = startOfDay(ctx.anchor);
  const weekStart = addDays(aDay, -aDay.getDay());
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const inWeek = ctx.view === "week" && d >= weekStart && d < addDays(weekStart, 7);
    let cls = "d";
    if (d.getMonth() !== ctx.mini.getMonth()) cls += " out";
    if (inWeek) cls += " inweek" + (d.getDay() === 0 ? " wl" : "") + (d.getDay() === 6 ? " wr" : "");
    if (sameDay(d, ctx.now)) cls += " today";
    else if (ctx.view !== "list" && ctx.view !== "month" && sameDay(d, aDay)) cls += " sel";
    const cell = el("div", cls);
    cell.append(el("span", "", String(d.getDate())));
    cell.addEventListener("click", () => ctx.onPickDate(d));
    grid.append(cell);
  }
  const mini = el("div");
  mini.append(head, grid);

  // ---- booking pages ----
  const booking = el("div");
  booking.append(sectionHead(ctx, "booking", "Booking pages"));
  if (!ctx.collapsed.has("booking")) {
    const body = el("div", "sec-body");
    body.append(el("div", "sec-note", "Google doesn't share booking pages with other apps yet."));
    booking.append(body);
  }

  // ---- my calendars ----
  const mine = el("div");
  mine.append(sectionHead(ctx, "calendars", "My calendars"));
  if (!ctx.collapsed.has("calendars")) {
    const body = el("div", "sec-body");
    if (!ctx.calendars.length) body.append(el("div", "sec-note", "No calendars loaded"));
    for (const c of ctx.calendars) {
      const on = !ctx.hidden.has(c.id);
      const row = el("div", "cal-row" + (on ? "" : " off"));
      row.title = on ? "Hide " + c.name : "Show " + c.name;
      row.append(calBox(c.color, on), el("span", "n", c.name));
      row.addEventListener("click", () => ctx.onToggleCalendar(c.id));
      body.append(row);
    }
    mine.append(body);
  }

  root.replaceChildren(mini, booking, mine);
}

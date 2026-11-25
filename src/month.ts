import type { CalEvent, Task } from "./types";
import { addDays, fmtTime, sameDay, startOfDay } from "./dates";
import { dayBalls, dayKey, tasksByDay } from "./tasks";
import { jalaliOf } from "./jalali";
import { navKey } from "./nav";
import { $, el } from "./ui";

export interface MonthCtx {
  /** Any date in the month to show. */
  anchor: Date;
  events: CalEvent[];
  tasks: Task[];
  colorOf: (ev: CalEvent) => string;
  now: Date;
  shamsi: boolean;
  /** Key (see nav.ts) of the event the keyboard cursor is on. */
  cursor?: string | null;
  /** Right-click on an event chip. */
  onEventMenu?: (ev: CalEvent, x: number, y: number) => void;
  /** Clicking a day cell. */
  onPick: (d: Date) => void;
}

/** First visible cell (Sunday on/before the 1st) and the 42 cells of a month grid. */
export function monthCells(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Monthly overview, like the dashboard's: date number + small Shamsi day, task priority
 * balls (main = highest priority, lower ones peek out, hollow ring = overdue), a today pill.
 * Events show as chips (all-day solid, timed tinted with their start time) that fill the cell;
 * what does not fit becomes "+N more". Right-click a chip to edit it.
 */
export function renderMonth(ctx: MonthCtx): void {
  const root = $<HTMLDivElement>("monthview");
  const byDay = tasksByDay(ctx.tasks);
  const month = ctx.anchor.getMonth();

  const head = el("div", "mhead");
  for (const d of DOW) head.append(el("span", "", d));

  const grid = el("div", "mgrid");
  for (const d of monthCells(ctx.anchor)) {
    const today = sameDay(d, ctx.now);
    const cell = el("div", "mc" + (d.getMonth() === month ? "" : " out"));
    cell.addEventListener("click", () => ctx.onPick(d));

    const stack = el("div", "mstack" + (today ? " today" : ""));
    stack.append(el("span", "mnum", String(d.getDate())));
    if (ctx.shamsi) stack.append(el("span", "msham", String(jalaliOf(d)[2])));
    cell.append(stack);

    const balls = dayBalls(byDay.get(dayKey(d)), ctx.now).reverse();
    if (balls.length) {
      const row = el("div", "balls");
      balls.forEach((b, i) => {
        const last = balls.length - 1;
        const ball = el("i", i === last ? "b0" : i === last - 1 ? "b1" : "b2");
        if (b.overdue) {
          ball.style.border = `1.5px solid ${b.color}`;
        } else {
          ball.style.background = b.color;
        }
        row.append(ball);
      });
      cell.append(row);
    }

    const day = startOfDay(d);
    const next = addDays(day, 1);
    const todays = ctx.events
      .filter((ev) => ev.end > day && ev.start < next)
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime());
    if (todays.length) {
      const list = el("div", "mevs");
      for (const ev of todays) {
        const color = ctx.colorOf(ev);
        const chip = el("div", "mev" + (ev.allDay ? " allday" : "") + (ctx.cursor && navKey(ev, day) === ctx.cursor ? " kcur" : ""));
        chip.title = ev.title + (ev.allDay ? "" : "\n" + fmtTime(ev.start) + " – " + fmtTime(ev.end));
        if (ev.allDay) chip.style.background = color;
        else {
          chip.style.background = `color-mix(in srgb, ${color} 24%, transparent)`;
          chip.style.borderLeftColor = color;
          chip.append(el("small", "", fmtTime(ev.start)));
        }
        chip.append((ev.recurring ? "↻ " : "") + ev.title);
        chip.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.onEventMenu?.(ev, e.clientX, e.clientY);
        });
        list.append(chip);
      }
      cell.append(list);
    }
    grid.append(cell);
  }
  root.classList.toggle("hascur", !!ctx.cursor);
  root.replaceChildren(head, grid);
  fitChips(grid);
}

const CHIP_H = 15; // chip height + gap, px

/** Hide the chips that do not fit in each cell and replace the last visible one with "+N more". */
function fitChips(grid: HTMLElement): void {
  for (const list of grid.querySelectorAll<HTMLElement>(".mevs")) {
    const cell = list.parentElement!;
    const room = cell.getBoundingClientRect().bottom - list.getBoundingClientRect().top;
    const cap = Math.max(1, Math.floor(room / CHIP_H));
    const chips = [...list.children] as HTMLElement[];
    if (chips.length <= cap) continue;
    const keep = Math.max(0, cap - 1);
    let shown = chips.slice(0, keep);
    // the cursor's chip must never hide behind "+N more": it takes the last visible slot
    const sel = chips.find((c) => c.classList.contains("kcur"));
    if (sel && !shown.includes(sel)) shown = [...shown.slice(0, Math.max(0, keep - 1)), sel];
    for (const c of chips) if (!shown.includes(c)) c.remove();
    list.replaceChildren(...shown, el("div", "mmore", `+${chips.length - shown.length} more`));
  }
}
import type { CalEvent, Task } from "./types";
import { addDays, sameDay, startOfDay } from "./dates";
import { dayBalls, dayKey, tasksByDay } from "./tasks";
import { jalaliOf } from "./jalali";
import { $, el } from "./ui";

export interface MonthCtx {
  /** Any date in the month to show. */
  anchor: Date;
  events: CalEvent[];
  tasks: Task[];
  colorOf: (ev: CalEvent) => string;
  now: Date;
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
 * Events show as small calendar-coloured dots.
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
    stack.append(el("span", "mnum", String(d.getDate())), el("span", "msham", String(jalaliOf(d)[2])));
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
    const colors: string[] = [];
    for (const ev of ctx.events) {
      if (ev.end > day && ev.start < next) {
        const c = ctx.colorOf(ev);
        if (colors.length < 12) colors.push(c);
      }
    }
    if (colors.length) {
      const dots = el("div", "dots");
      for (const c of colors.slice(0, 4)) {
        const dot = el("i");
        dot.style.background = c;
        dots.append(dot);
      }
      if (colors.length > 4) dots.append(el("small", "", "+" + (colors.length - 4)));
      cell.append(dots);
    }
    grid.append(cell);
  }
  root.replaceChildren(head, grid);
}

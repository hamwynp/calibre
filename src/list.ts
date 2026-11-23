import type { CalEvent, Task } from "./types";
import { fmtKey, fmtTime, monthShort, startOfDay } from "./dates";
import { dayBalls, tasksByDay } from "./tasks";
import { eventKey } from "./store";
import { $, el } from "./ui";

export interface ListRow {
  key: string;
  date: Date;
  title: string;
  sub: string;
  color: string;
  allDay: boolean;
  taskOnly: boolean;
  ev?: CalEvent;
  dayKey: string;
}

/**
 * Upcoming events (today onward, minus dismissed ones), with a "N tasks due" row for every
 * day that has tasks but no events - the dashboard's calendar list.
 */
export function buildRows(events: CalEvent[], tasks: Task[], dismissed: Set<string>, now: Date, colorOf: (ev: CalEvent) => string, accent: string): ListRow[] {
  const todayKey = fmtKey(startOfDay(now));
  const evs = events
    .filter((ev) => fmtKey(ev.start) >= todayKey && !dismissed.has(eventKey(ev)))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const evDates = new Set(evs.map((e) => fmtKey(e.start)));
  const maxDate = evs.length ? fmtKey(evs[evs.length - 1]!.start) : "9999-99-99";
  const byDay = tasksByDay(tasks);
  const taskKeys = [...byDay.keys()].filter((k) => !evDates.has(k) && k >= todayKey && k <= maxDate).sort();

  const taskRow = (k: string): ListRow => {
    const ts = byDay.get(k)!;
    const top = ts.reduce((a, b) => (dayBalls([b])[0]!.rank > dayBalls([a])[0]!.rank ? b : a));
    const [y, m, d] = k.split("-").map(Number);
    return {
      key: "t:" + k,
      date: new Date(y!, m! - 1, d!),
      title: `${ts.length} task${ts.length === 1 ? "" : "s"} due`,
      sub: top.title,
      color: dayBalls(ts, now)[0]?.color ?? accent,
      allDay: false,
      taskOnly: true,
      dayKey: k,
    };
  };

  const out: ListRow[] = [];
  let ti = 0;
  for (const ev of evs) {
    const k = fmtKey(ev.start);
    while (ti < taskKeys.length && taskKeys[ti]! < k) out.push(taskRow(taskKeys[ti++]!));
    out.push({
      key: eventKey(ev),
      date: startOfDay(ev.start),
      title: ev.title,
      sub: ev.allDay ? "All day" : fmtTime(ev.start),
      color: colorOf(ev),
      allDay: ev.allDay,
      taskOnly: false,
      ev,
      dayKey: k,
    });
  }
  while (ti < taskKeys.length) out.push(taskRow(taskKeys[ti++]!));
  return out;
}

export interface ListState {
  rows: ListRow[];
  cursor: number;
  selected: Set<string>;
  tasks: Task[];
  now: Date;
  onClick: (i: number) => void;
}

export function renderList(st: ListState): void {
  const root = $<HTMLDivElement>("listview");
  if (!st.rows.length) {
    root.replaceChildren(el("div", "empty", "No upcoming events or task days"));
    return;
  }
  const byDay = tasksByDay(st.tasks);
  let cursorEl: HTMLElement | null = null;
  const nodes = st.rows.map((r, i) => {
    const row = el("div", "lr" + (i === st.cursor ? " cur" : "") + (st.selected.has(r.key) ? " sel" : ""));
    const bar = el("i", "lbar");
    bar.style.background = r.color;
    const date = el("div", "ldate");
    const mon = el("span", "lmon", monthShort(r.date.getMonth()));
    mon.style.color = r.color;
    date.append(mon, el("b", "", String(r.date.getDate())));
    if (i === 0 || st.rows[i - 1]!.dayKey !== r.dayKey) {
      const balls = dayBalls(byDay.get(r.dayKey), st.now).reverse();
      if (balls.length) {
        const bl = el("div", "balls");
        balls.forEach((b, bi) => {
          const last = balls.length - 1;
          const ball = el("i", bi === last ? "b0" : bi === last - 1 ? "b1" : "b2");
          if (b.overdue) ball.style.border = `1.5px solid ${b.color}`;
          else ball.style.background = b.color;
          bl.append(ball);
        });
        date.append(bl);
      }
    }
    const body = el("div", "lbody");
    body.append(el("b", "", r.title), el("span", "", r.sub));
    row.append(bar, date, body);
    row.addEventListener("click", () => st.onClick(i));
    if (i === st.cursor) cursorEl = row;
    return row;
  });
  root.replaceChildren(...nodes);
  (cursorEl as HTMLElement | null)?.scrollIntoView({ block: "nearest" });
}

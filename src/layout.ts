import type { CalEvent, Task } from "./types";
import { addDays, hoursOf, startOfDay } from "./dates";
import { ballRank, taskColor } from "./tasks";

/** One thing drawn on the time grid: a timed event or a task with a due time. */
export interface TimedItem {
  kind: "ev" | "task";
  title: string;
  sub: string;
  color: string;
  recurring: boolean;
  /** start / end hour within the day */
  s: number;
  e: number;
  lane: number;
  lanes: number;
  ev?: CalEvent;
}

/** An all-day event, or a task with a date but no time (due at local midnight). */
export interface StripItem {
  kind: "ev" | "task";
  title: string;
  color: string;
  recurring: boolean;
  rank: number;
}

const MIN_LEN = 0.45; // hours; keeps tiny items tall enough to read

const isDateOnly = (d: Date): boolean => d.getHours() === 0 && d.getMinutes() === 0;

export function timedItems(
  events: CalEvent[],
  tasks: Task[],
  day: Date,
  colorOf: (ev: CalEvent) => string,
  fmt: (d: Date) => string,
): TimedItem[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const items: TimedItem[] = [];
  for (const ev of events) {
    if (ev.allDay || ev.end <= dayStart || ev.start >= dayEnd) continue;
    const s = ev.start < dayStart ? 0 : hoursOf(ev.start);
    const e = ev.end >= dayEnd ? 24 : hoursOf(ev.end);
    items.push({ kind: "ev", title: ev.title, sub: `${fmt(ev.start)} – ${fmt(ev.end)}`, color: colorOf(ev), recurring: !!ev.recurring, s, e: Math.max(e, s + MIN_LEN), lane: 0, lanes: 1, ev });
  }
  for (const t of tasks) {
    if (!t.due || isDateOnly(t.due) || t.due < dayStart || t.due >= dayEnd) continue;
    const s = hoursOf(t.due);
    items.push({ kind: "task", title: t.title, sub: "", color: taskColor(t.priority), recurring: false, s, e: s + MIN_LEN, lane: 0, lanes: 1 });
  }
  assignLanes(items);
  return items;
}

/** Side-by-side lanes wherever items overlap in time. */
function assignLanes(items: TimedItem[]): void {
  items.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));
  let cluster: TimedItem[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) c.lanes = laneEnds.length;
  };
  for (const it of items) {
    if (it.s >= clusterEnd) {
      flush();
      cluster = [];
      laneEnds = [];
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= it.s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = it.e;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  }
  flush();
}


export function stripItems(events: CalEvent[], tasks: Task[], day: Date, colorOf: (ev: CalEvent) => string): StripItem[] {
  const d = startOfDay(day);
  const out: StripItem[] = [];
  for (const ev of events) {
    if (ev.allDay && ev.start <= d && ev.end > d) out.push({ kind: "ev", title: ev.title, color: colorOf(ev), recurring: !!ev.recurring, rank: 0 });
  }
  for (const t of tasks) {
    if (t.due && isDateOnly(t.due) && startOfDay(t.due).getTime() === d.getTime())
      out.push({ kind: "task", title: t.title, color: taskColor(t.priority), recurring: false, rank: 3 - ballRank(t.priority) });
  }
  // events first, then tasks by priority (high first)
  return out.sort((a, b) => (a.kind === b.kind ? a.rank - b.rank : a.kind === "ev" ? -1 : 1));
}

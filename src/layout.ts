import type { CalEvent } from "./types";
import { addDays, hoursOf, startOfDay } from "./dates";

export interface Segment {
  ev: CalEvent;
  s: number; // start hour within the day
  e: number; // end hour within the day
  lane: number;
  lanes: number;
}

const MIN_LEN = 0.45; // hours; keeps tiny events tall enough to read

/** Timed events overlapping `day`, packed into side-by-side lanes where they collide. */
export function timedSegments(events: CalEvent[], day: Date): Segment[] {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  const segs: Segment[] = [];
  for (const ev of events) {
    if (ev.allDay || ev.end <= dayStart || ev.start >= dayEnd) continue;
    const s = ev.start < dayStart ? 0 : hoursOf(ev.start);
    const e = ev.end >= dayEnd ? 24 : hoursOf(ev.end);
    segs.push({ ev, s, e: Math.max(e, s + MIN_LEN), lane: 0, lanes: 1 });
  }
  segs.sort((a, b) => a.s - b.s || b.e - b.s - (a.e - a.s));

  let cluster: Segment[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const c of cluster) c.lanes = laneEnds.length;
  };
  for (const sg of segs) {
    if (sg.s >= clusterEnd) {
      flush();
      cluster = [];
      laneEnds = [];
      clusterEnd = -1;
    }
    let lane = laneEnds.findIndex((end) => end <= sg.s);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = sg.e;
    sg.lane = lane;
    cluster.push(sg);
    clusterEnd = Math.max(clusterEnd, sg.e);
  }
  flush();
  return segs;
}

/** All-day events covering `day` (end is exclusive). */
export function allDayFor(events: CalEvent[], day: Date): CalEvent[] {
  const d = startOfDay(day);
  return events.filter((ev) => ev.allDay && ev.start <= d && ev.end > d);
}

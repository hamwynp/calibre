import type { Recurrence } from "./types";
import { addDays, startOfDay } from "./dates";

const MAX_DAYS = 36_600; // safety cap: ~100 years of day-by-day scanning

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Does an occurrence of a rule that starts on `start` fall on `day`? */
function matches(rec: Recurrence, start: Date, day: Date): boolean {
  const n = daysBetween(start, day);
  if (n < 0) return false;
  const k = Math.max(1, rec.interval);
  switch (rec.freq) {
    case "daily":
      return n % k === 0;
    case "weekdays":
      return day.getDay() >= 1 && day.getDay() <= 5;
    case "weekly":
      return n % (7 * k) === 0;
    case "monthly": {
      const months = (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth();
      return day.getDate() === start.getDate() && months % k === 0;
    }
    case "yearly":
      return day.getMonth() === start.getMonth() && day.getDate() === start.getDate() && (day.getFullYear() - start.getFullYear()) % k === 0;
  }
}

/**
 * Start times of every occurrence that begins in [from, to). `start` is the
 * first occurrence (always included, even if the rule would skip it).
 */
export function occurrenceStarts(rec: Recurrence, start: Date, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const first = startOfDay(start);
  const limit = rec.until ? addDays(startOfDay(rec.until), 1) : null;
  let seen = 0;
  for (let i = 0; i < MAX_DAYS; i++) {
    const day = addDays(first, i);
    if (day >= to) break;
    if (limit && day >= limit) break;
    if (i !== 0 && !matches(rec, start, day)) continue;
    seen++;
    if (rec.count && seen > rec.count) break;
    const st = new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes());
    if (st >= from || addDays(st, 1) > from) out.push(st);
  }
  return out;
}

/**
 * RFC 5545 RRULE (what Google Calendar expects), e.g. "RRULE:FREQ=WEEKLY;COUNT=10".
 * For timed events an UNTIL date is converted to the end of that local day in UTC.
 */
export function toRRule(rec: Recurrence, allDay: boolean): string {
  const parts: string[] = [];
  if (rec.freq === "weekdays") parts.push("FREQ=WEEKLY", "BYDAY=MO,TU,WE,TH,FR");
  else parts.push("FREQ=" + rec.freq.toUpperCase());
  if (rec.freq !== "weekdays" && rec.interval > 1) parts.push("INTERVAL=" + rec.interval);
  if (rec.count) parts.push("COUNT=" + rec.count);
  else if (rec.until) {
    const u = rec.until;
    if (allDay) parts.push(`UNTIL=${u.getFullYear()}${pad(u.getMonth() + 1)}${pad(u.getDate())}`);
    else {
      const e = new Date(u.getFullYear(), u.getMonth(), u.getDate(), 23, 59, 59);
      parts.push(`UNTIL=${e.getUTCFullYear()}${pad(e.getUTCMonth() + 1)}${pad(e.getUTCDate())}T${pad(e.getUTCHours())}${pad(e.getUTCMinutes())}${pad(e.getUTCSeconds())}Z`);
    }
  }
  return "RRULE:" + parts.join(";");
}

const pad = (n: number): string => String(n).padStart(2, "0");

export const REPEAT_OPTIONS: { label: string; rec: Pick<Recurrence, "freq" | "interval"> | null }[] = [
  { label: "Does not repeat", rec: null },
  { label: "Every day", rec: { freq: "daily", interval: 1 } },
  { label: "Every weekday (Mon–Fri)", rec: { freq: "weekdays", interval: 1 } },
  { label: "Every week", rec: { freq: "weekly", interval: 1 } },
  { label: "Every 2 weeks", rec: { freq: "weekly", interval: 2 } },
  { label: "Every month", rec: { freq: "monthly", interval: 1 } },
  { label: "Every year", rec: { freq: "yearly", interval: 1 } },
];

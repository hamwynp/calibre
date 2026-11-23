export const DAY = 86_400_000;

export const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
/** Monday 00:00 of the week containing `d`. */
export const mondayOf = (d: Date): Date => addDays(startOfDay(d), -((d.getDay() + 6) % 7));
export const pad2 = (n: number): string => (n < 10 ? "0" : "") + n;
export const fmtKey = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const hoursOf = (d: Date): number => d.getHours() + d.getMinutes() / 60;
export const sameDay = (a: Date, b: Date): boolean => fmtKey(a) === fmtKey(b);

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number): string => MONTHS[m] ?? "";
export const monthShort = (m: number): string => monthName(m).slice(0, 3);
export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function fmtTime(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? ":" + pad2(m) : ""}${h < 12 ? "am" : "pm"}`;
}

export function weekTitle(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const a = `${monthShort(weekStart.getMonth())} ${weekStart.getDate()}`;
  const b = (end.getMonth() === weekStart.getMonth() ? "" : monthShort(end.getMonth()) + " ") + end.getDate();
  return `${a} – ${b}, ${end.getFullYear()}`;
}

// ---- form input parsing ----

/** "", today, tomorrow, +N, mm-dd, yyyy-mm-dd -> Date (local midnight) or null if invalid. */
export function parseDate(input: string, fallback: Date, today: Date): Date | null {
  const s = input.trim().toLowerCase();
  if (s === "") return fallback;
  if (s === "today") return startOfDay(today);
  if (s === "tomorrow" || s === "tmr") return addDays(startOfDay(today), 1);
  let m = s.match(/^\+(\d+)$/);
  if (m) return addDays(startOfDay(today), parseInt(m[1]!, 10));
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    let d = validDate(today.getFullYear(), +m[1]!, +m[2]!);
    if (d && d < startOfDay(today)) d = validDate(today.getFullYear() + 1, +m[1]!, +m[2]!);
    return d;
  }
  return null;
}

function validDate(y: number, mo: number, d: number): Date | null {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

/** "" / "allday" -> "" (all-day), 14:30 / 2:30pm / 1430 -> {h,m}, else null. */
export function parseTime(input: string): { h: number; m: number } | "" | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "" || s === "allday") return "";
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1]!, 10);
  const mi = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

/** "", 90, 45m, 1h, 1h30 -> minutes (or `fallback`), -1 if invalid. */
export function parseDuration(input: string, fallback: number): number {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (s === "") return fallback;
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m?)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return -1;
  const mins = (m[1] ? parseInt(m[1], 10) * 60 : 0) + (m[2] ? parseInt(m[2], 10) : 0);
  return mins > 0 ? mins : -1;
}

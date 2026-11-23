/** Gregorian -> Jalali (Shamsi) [year, month, day] (jalaali-js algorithm, same as the dashboard). */
export function toJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const div = (a: number, b: number) => Math.floor(a / b);
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) + gd + gdm[gm - 1]!;
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + div(days, 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + div(days - 186, 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

export const PERSIAN_MONTHS = ["", "Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"];

export const jalaliOf = (d: Date): [number, number, number] => toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());

/** "Aban–Azar" style label for the Jalali month(s) a Gregorian month covers. */
export function jalaliMonthLabel(first: Date, last: Date): string {
  const a = jalaliOf(first)[1];
  const b = jalaliOf(last)[1];
  return PERSIAN_MONTHS[a] + (a !== b ? "–" + PERSIAN_MONTHS[b] : "");
}

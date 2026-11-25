import "./styles.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CalEvent, Calendar, CalendarProvider, Task } from "./types";
import { addDays, hoursOf, mondayOf, monthName, startOfDay, weekTitle, DAYS, sameDay } from "./dates";
import { hourPx, renderGrid, resetZoom, stepZoom, stripHeight } from "./grid";
import { renderSidebar } from "./sidebar";
import { createPicker } from "./picker";
import { createSignIn } from "./signin";
import { monthCells, renderMonth } from "./month";
import { buildRows, renderList, type ListRow } from "./list";
import { DemoProvider } from "./demo";
import { GoogleProvider } from "./google";
import { inTauri, loadTasks } from "./tasks";
import { jalaliMonthLabel } from "./jalali";
import { createSettings } from "./settings";
import { loadCollapsed, loadDismissed, loadHiddenCalendars, loadSettings, loadSidebarShown, saveCollapsed, saveDismissed, saveHiddenCalendars, saveSettings, saveSidebarShown } from "./store";
import { initForm } from "./form";
import { createHelp } from "./help";
import { menuOpen, showMenu } from "./contextmenu";
import { navItems, type NavItem } from "./nav";
import { createConfirm } from "./confirm";
import { $ } from "./ui";

type View = "week" | "day" | "month" | "list";

const provider: CalendarProvider = inTauri() ? new GoogleProvider() : new DemoProvider();

let view: View = "week";
/** The date being looked at: week = the week containing it, day = that day, month = its month. */
let anchor = startOfDay(new Date());
let events: CalEvent[] = [];
let tasks: Task[] = [];
let calendars: Calendar[] = [];
let syncing = 0;

// list view state (same model as the dashboard: one cursor, multi-select, dismiss + undo)
let dismissed = loadDismissed();
let undoStack: string[][] = [];
let cursor = 0;
let selected = new Set<string>();
let rows: ListRow[] = [];

// keyboard cursor over events (Tab) in the week / day / month views: key of the current stop, see nav.ts
let kcur: string | null = null;

// which calendars are shown, sidebar state
let hidden = loadHiddenCalendars();
let collapsed = loadCollapsed();
let sidebarShown = loadSidebarShown();
let settings = loadSettings();
let miniMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
let lastAnchorMonth = `${anchor.getFullYear()}-${anchor.getMonth()}`;

const scroller = $<HTMLDivElement>("scroll");
const colorOf = (ev: CalEvent): string => calendars.find((c) => c.id === ev.calendarId)?.color ?? "#8b93a7";
const today = (): Date => startOfDay(new Date());

// ---------- errors / sign-in ----------
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Errors starting with "SIGN_IN:" open the sign-in card; everything else shows in the header. */
function showError(e: unknown): void {
  const m = msgOf(e);
  if (m.startsWith("SIGN_IN: ")) {
    $("calerr").textContent = "";
    signin.open(m);
    return;
  }
  $("calerr").textContent = "⚠ " + m;
}

const signin = createSignIn({
  signIn: async () => provider.auth?.signIn(),
  onDone: () => void refreshAll(),
});

let confirmSignOut = false;
let confirmTimer = 0;
function signOutClicked(): void {
  if (!confirmSignOut) {
    confirmSignOut = true;
    clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => {
      confirmSignOut = false;
      render("keep");
    }, 3000);
    render("keep");
    return;
  }
  confirmSignOut = false;
  clearTimeout(confirmTimer);
  void provider.auth?.signOut().then(() => {
    events = [];
    calendars = [];
    render("keep");
    signin.open("You're signed out. Sign in again to see your calendar.");
  });
}

// ---------- what range does each view need? ----------
function weekDays(): Date[] {
  const m = mondayOf(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(m, i));
}

function range(): { from: Date; to: Date } {
  if (view === "week") {
    const m = mondayOf(anchor);
    return { from: m, to: addDays(m, 7) };
  }
  if (view === "day") return { from: anchor, to: addDays(anchor, 1) };
  if (view === "month") {
    const c = monthCells(anchor);
    return { from: c[0]!, to: addDays(c[41]!, 1) };
  }
  return { from: today(), to: addDays(today(), 120) };
}

/** How far (in the view's own unit) the anchor is from now: shown in the header pill. */
function offsetLabel(): string {
  const t = today();
  let n = 0;
  let unit = "w";
  if (view === "week") n = Math.round((mondayOf(anchor).getTime() - mondayOf(t).getTime()) / (7 * 86_400_000));
  else if (view === "day") {
    n = Math.round((anchor.getTime() - t.getTime()) / 86_400_000);
    unit = "d";
  } else if (view === "month") {
    n = (anchor.getFullYear() - t.getFullYear()) * 12 + anchor.getMonth() - t.getMonth();
    unit = "mo";
  }
  return n === 0 ? "" : `${n > 0 ? "+" : ""}${n}${unit}`;
}

/** Shamsi month name(s) the visible range covers. */
function subtitleFor(): string {
  if (view === "month") return jalaliMonthLabel(new Date(anchor.getFullYear(), anchor.getMonth(), 1), new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
  if (view === "week") return jalaliMonthLabel(mondayOf(anchor), addDays(mondayOf(anchor), 6));
  if (view === "day") return jalaliMonthLabel(anchor, anchor);
  return "";
}

function titleFor(): string {
  if (view === "week") return weekTitle(mondayOf(anchor));
  if (view === "day") return `${DAYS[anchor.getDay()]}, ${monthName(anchor.getMonth())} ${anchor.getDate()}, ${anchor.getFullYear()}`;
  if (view === "month") return `${monthName(anchor.getMonth())} ${anchor.getFullYear()}`;
  return "Upcoming";
}

// ---------- rendering ----------
type ScrollMode = "keep" | "top" | "now";

function render(mode: ScrollMode): void {
  const now = new Date();
  const shown = events.filter((e) => !hidden.has(e.calendarId));
  const grid = view === "week" || view === "day";
  $("dayhead").hidden = !grid;
  scroller.hidden = !grid;
  $("monthview").hidden = view !== "month";
  $("listview").hidden = view !== "list";
  $("title").textContent = titleFor();
  $("subtitle").textContent = settings.shamsi ? subtitleFor() : "";
  const off = offsetLabel();
  const pill = $("weekhint");
  pill.hidden = off === "";
  pill.textContent = off;
  $("sync").textContent = syncing > 0 ? "Syncing…" : "";

  // sidebar: the mini calendar follows the main view's month unless you browsed it yourself
  const am = `${anchor.getFullYear()}-${anchor.getMonth()}`;
  if (am !== lastAnchorMonth) {
    lastAnchorMonth = am;
    miniMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  }
  $("side").hidden = !sidebarShown;
  if (sidebarShown)
    renderSidebar({
      anchor,
      view,
      mini: miniMonth,
      now,
      shamsi: settings.shamsi,
      calendars,
      hidden,
      collapsed,
      onPickDate: pickDate,
      onMiniStep: (d) => {
        miniMonth = new Date(miniMonth.getFullYear(), miniMonth.getMonth() + d, 1);
        render("keep");
      },
      onToggleCalendar: toggleCalendar,
      onSignOut: provider.auth ? signOutClicked : undefined,
      accountLabel: provider.name,
      confirmSignOut,
      onToggleSection: (name) => {
        if (collapsed.has(name)) collapsed.delete(name);
        else collapsed.add(name);
        saveCollapsed(collapsed);
        render("keep");
      },
    });
  picker.refresh();

  if (grid) {
    const keepTop = scroller.scrollTop;
    const days = view === "week" ? weekDays() : [anchor];
    const stripH = renderGrid({ days, events: shown, tasks, colorOf, now, shamsi: settings.shamsi, cursor: kcur, onEventMenu: eventMenu });
    if (mode === "top") scroller.scrollTop = 0;
    else if (mode === "now") scroller.scrollTop = Math.max(0, stripH + hoursOf(now) * hourPx() - scroller.clientHeight / 2);
    else scroller.scrollTop = keepTop;
  } else if (view === "month") {
    renderMonth({ anchor, events: shown, tasks, colorOf, now, shamsi: settings.shamsi, cursor: kcur, onEventMenu: eventMenu, onPick: (d) => setView("day", d) });
  } else {
    rows = buildRows(shown, tasks, dismissed, now, colorOf, "#a2cffe");
    cursor = Math.max(0, Math.min(cursor, rows.length - 1));
    renderList({ rows, cursor, selected, tasks, now, onClick: (i) => ((cursor = i), render("keep")), onMenu: eventMenu });
  }
}

/** Does the visible range contain today? (then we centre on "now", otherwise show 12am) */
function showsToday(): boolean {
  const r = range();
  const t = today();
  return r.from <= t && t < r.to;
}

let loadSeq = 0;
async function load(mode: ScrollMode): Promise<void> {
  const seq = ++loadSeq;
  syncing++;
  render("keep");
  try {
    const r = range();
    const evs = await provider.listEvents(r.from, r.to);
    if (seq !== loadSeq) return; // a newer navigation superseded this one
    events = evs;
    $("calerr").textContent = "";
  } catch (e) {
    if (seq === loadSeq) showError(e);
  } finally {
    syncing--;
  }
  if (seq === loadSeq) render(mode);
  else render("keep");
}

function modeForNav(): ScrollMode {
  return (view === "week" || view === "day") && showsToday() ? "now" : "top";
}

// ---------- navigation ----------
function step(dir: -1 | 1): void {
  kcur = null;
  if (view === "week") anchor = addDays(anchor, 7 * dir);
  else if (view === "day") anchor = addDays(anchor, dir);
  else if (view === "month") anchor = new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  else return;
  void load(modeForNav());
}

function goToday(): void {
  kcur = null;
  anchor = today();
  if (view === "list") cursor = 0;
  void load("now");
}

function setView(v: View, date?: Date): void {
  kcur = null;
  if (date) anchor = startOfDay(date);
  // leaving month for week/day: if we're in the current month, land on today
  else if (v !== "month" && view === "month" && sameDay(new Date(anchor.getFullYear(), anchor.getMonth(), 1), new Date(today().getFullYear(), today().getMonth(), 1))) anchor = today();
  view = v;
  if (v === "list") {
    cursor = 0;
    selected = new Set();
  }
  void load(modeForNav());
}

// ---------- calendars shown / sidebar ----------
function toggleCalendar(id: string): void {
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  saveHiddenCalendars(hidden);
  render("keep");
}

/** A day was clicked in the mini calendar: show it in the current view (list -> week). */
function pickDate(d: Date): void {
  kcur = null;
  anchor = startOfDay(d);
  if (view === "list") view = "week";
  void load(modeForNav());
}

// ---------- zoom (week / day) ----------
/** Zoom the time grid, keeping the hour at the middle of the view where it is. */
function zoom(dir: 1 | -1 | 0): void {
  if (view !== "week" && view !== "day") return;
  const centerHour = (scroller.scrollTop + scroller.clientHeight / 2 - stripHeight()) / hourPx();
  if (!(dir === 0 ? resetZoom() : stepZoom(dir))) return;
  render("keep");
  scroller.scrollTop = Math.max(0, stripHeight() + centerHour * hourPx() - scroller.clientHeight / 2);
}

// ---------- list actions ----------
function dismissSelectionOrCursor(): void {
  const keys = selected.size ? [...selected] : rows[cursor] && !rows[cursor]!.taskOnly ? [rows[cursor]!.key] : [];
  if (!keys.length) return;
  for (const k of keys) dismissed.add(k);
  undoStack.push(keys);
  saveDismissed(dismissed);
  selected = new Set();
  render("keep");
}

function undoDismiss(): void {
  const keys = undoStack.pop();
  if (!keys) return;
  for (const k of keys) dismissed.delete(k);
  saveDismissed(dismissed);
  render("keep");
}

function openRowInGoogle(): void {
  const r = rows[cursor];
  if (!r) return;
  const url = `https://calendar.google.com/calendar/u/0/r/day/${r.date.getFullYear()}/${r.date.getMonth() + 1}/${r.date.getDate()}`;
  if (inTauri()) void openUrl(url);
  else window.open(url, "_blank");
}

function toggleSelect(): void {
  const r = rows[cursor];
  if (!r) return;
  if (selected.has(r.key)) selected.delete(r.key);
  else selected.add(r.key);
  cursor = Math.min(rows.length - 1, cursor + 1);
  render("keep");
}

// ---------- calendar picker (v), form, help ----------
const picker = createPicker({
  calendars: () => calendars,
  hidden: () => hidden,
  onToggle: toggleCalendar,
  onShowAll: () => {
    hidden = new Set();
    saveHiddenCalendars(hidden);
    render("keep");
  },
});

const form = initForm({
  provider,
  calendars: () => calendars.filter((c) => c.writable),
  defaultDate: () => {
    if (view === "list") return today();
    return showsToday() ? today() : view === "week" ? mondayOf(anchor) : anchor;
  },
  onCreated: () => void load("keep"),
});

const settingsPanel = createSettings({
  get: () => settings,
  set: (patch) => {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    render("keep");
  },
  sidebar: () => sidebarShown,
  toggleSidebar: () => {
    sidebarShown = !sidebarShown;
    saveSidebarShown(sidebarShown);
    render("keep");
  },
});

// ---------- Tab cursor, edit / duplicate / delete ----------
const confirm = createConfirm();

function visibleDays(): Date[] {
  if (view === "week") return weekDays();
  if (view === "day") return [anchor];
  if (view === "month") return monthCells(anchor);
  return [];
}
const stops = (): NavItem[] => navItems(events.filter((e) => !hidden.has(e.calendarId)), visibleDays());

/** The event the keyboard is on: the Tab cursor, or the highlighted row in the list view. */
function cursorEvent(): CalEvent | null {
  if (view === "list") return rows[cursor]?.ev ?? null;
  return kcur ? (stops().find((s) => s.key === kcur)?.ev ?? null) : null;
}

/** Tab / Shift+Tab: next / previous event in reading order, wrapping around. */
function moveCursor(dir: 1 | -1): void {
  const all = stops();
  if (!all.length) return;
  const i = all.findIndex((s) => s.key === kcur);
  kcur = all[i < 0 ? (dir === 1 ? 0 : all.length - 1) : (i + dir + all.length) % all.length]!.key;
  render("keep");
  document.querySelector(".kcur")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

const isReadOnly = (ev: CalEvent): boolean => calendars.find((c) => c.id === ev.calendarId)?.writable === false;
const readOnlyNote = (): void => {
  $("calerr").textContent = "⚠ That calendar is read-only";
};

/** Load what the form needs, then open it prefilled. */
async function startEdit(ev: CalEvent): Promise<void> {
  if (isReadOnly(ev)) return readOnlyNote();
  try {
    form.openEdit(ev, await provider.loadForEdit(ev));
  } catch (e) {
    showError(e);
  }
}

/** y: the add form with a copy of the event's details, ready to change. */
async function startDuplicate(ev: CalEvent): Promise<void> {
  try {
    form.openDuplicate(ev, await provider.loadForEdit(ev));
  } catch (e) {
    showError(e);
  }
}

/** d: ask first; for a repeating event also whether it is this one or the whole series. */
async function startDelete(ev: CalEvent): Promise<void> {
  if (isReadOnly(ev)) return readOnlyNote();
  const scope = await confirm.askDelete(ev.title, !!ev.recurring);
  if (!scope) return;
  const at = kcur ? stops().findIndex((s) => s.key === kcur) : -1;
  try {
    await provider.deleteEvent(ev, scope);
  } catch (e) {
    return showError(e);
  }
  await load("keep");
  if (at >= 0) {
    // keep the cursor where it was: on whatever moved up into that spot
    const all = stops();
    kcur = all.length ? all[Math.min(at, all.length - 1)]!.key : null;
    render("keep");
  }
}

function eventMenu(ev: CalEvent, x: number, y: number): void {
  const ro = isReadOnly(ev);
  showMenu(x, y, [
    { label: ro ? "Edit (read-only calendar)" : "Edit event…", disabled: ro, run: () => void startEdit(ev) },
    { label: "Duplicate…", run: () => void startDuplicate(ev) },
    { label: "Delete…", disabled: ro, run: () => void startDelete(ev) },
  ]);
}

const help = createHelp(() => (form.isOpen() ? "form" : picker.isOpen() ? "calendars" : view));

// Ctrl+/ (or Ctrl+?) toggles the help; Esc closes it first. Capture phase so it works inside inputs too.
document.addEventListener(
  "keydown",
  (e) => {
    if (e.ctrlKey && (e.key === "i" || e.key === "I")) {
      if (form.isOpen() || picker.isOpen() || signin.isOpen()) return;
      settingsPanel.toggle();
    } else if (e.ctrlKey && (e.key === "/" || e.key === "?")) help.toggle();
    else if (help.isOpen() && e.key === "Escape") help.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

document.addEventListener("keydown", (e) => {
  if (form.isOpen() || picker.isOpen() || signin.isOpen() || settingsPanel.isOpen() || menuOpen() || confirm.isOpen() || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  const scrollable = view === "week" || view === "day";
  // WebKitGTK reports Shift+Tab as key "Unidentified" (code "Tab"): go by the physical key
  const k = e.code === "Tab" || e.key === "ISO_Left_Tab" ? "Tab" : e.key;
  switch (k) {
    case "h": case "ArrowLeft": step(-1); break;
    case "l": case "ArrowRight": step(1); break;
    case "t": goToday(); break;
    case "0": if (scrollable) zoom(0); else goToday(); break;
    case "j": case "ArrowDown":
      if (view === "list") (cursor = Math.min(rows.length - 1, cursor + 1), render("keep"));
      else if (scrollable) scroller.scrollBy({ top: 60 });
      break;
    case "k": case "ArrowUp":
      if (view === "list") (cursor = Math.max(0, cursor - 1), render("keep"));
      else if (scrollable) scroller.scrollBy({ top: -60 });
      break;
    case "-": case "_": zoom(-1); break;
    case "=": case "+": zoom(1); break;
    case "J": if (scrollable) scroller.scrollTop = scroller.scrollHeight; break;
    case "K": if (scrollable) scroller.scrollTop = 0; break;
    case " ": if (view === "list") toggleSelect(); break;
    case "x": {
      // list view: hide the row; week / day / month: delete the selected event (asks first)
      if (view === "list") dismissSelectionOrCursor();
      else {
        const ev = cursorEvent();
        if (ev) void startDelete(ev);
      }
      break;
    }
    case "u": if (view === "list") undoDismiss(); break;
    case "Enter": if (view === "list") openRowInGoogle(); break;
    case "Tab": if (view === "list") return; moveCursor(e.shiftKey || e.key === "ISO_Left_Tab" ? -1 : 1); break;
    case "Escape": if (!kcur) return; kcur = null; render("keep"); break;
    case "e": { const ev = cursorEvent(); if (ev) void startEdit(ev); break; }
    case "y": { const ev = cursorEvent(); if (ev) void startDuplicate(ev); break; }
    case "Delete": { const ev = cursorEvent(); if (ev) void startDelete(ev); break; }
    case "d":
      if (view === "list") dismissSelectionOrCursor();
      else setView(view === "day" ? "week" : "day");
      break;
    case "m": setView(view === "month" ? "week" : "month"); break;
    case "w": setView("week"); break;
    case "s": setView(view === "list" ? "week" : "list"); break;
    case "v": picker.open(); break;
    case "b": sidebarShown = !sidebarShown; saveSidebarShown(sidebarShown); render("keep"); break;
    case "a": form.open(); break;
    case "r": void refreshAll(); break;
    default: return;
  }
  e.preventDefault();
});

// ---------- data ----------
async function refreshTasks(): Promise<void> {
  tasks = await loadTasks();
  render("keep");
}

async function refreshAll(): Promise<void> {
  void refreshTasks();
  try {
    calendars = await provider.listCalendars();
  } catch (e) {
    showError(e);
  }
  await load("keep");
}

provider.onUpdate?.(() => void load("keep")); // fresher data arrived in the background

// keep the "now" line moving, refresh tasks now and then
setInterval(() => {
  if (!form.isOpen()) render("keep");
}, 60_000);
setInterval(() => void refreshTasks(), 5 * 60_000);
window.addEventListener("resize", () => render("keep"));
window.addEventListener("focus", () => void refreshTasks());

// Re-centre on "now" a few times right after launch: the window may not have its real size
// yet on the first render. Stops as soon as you scroll or press a key yourself.
let touched = false;
for (const ev of ["wheel", "keydown", "mousedown"]) document.addEventListener(ev, () => (touched = true), { capture: true, once: true });

void (async () => {
  void refreshTasks();
  if (provider.auth && !(await provider.auth.signedIn())) {
    signin.open();
    render("now");
    return;
  }
  try {
    calendars = await provider.listCalendars();
  } catch (e) {
    showError(e);
  }
  await load("now");
  for (const ms of [60, 250, 700]) setTimeout(() => !touched && view === "week" && showsToday() && render("now"), ms);
})();

import type { CalEvent, Calendar, CalendarProvider, EditPatch, EditSource, NewEvent, Recurrence } from "./types";
import { addDays, fmtKey, pad2, parseDate, parseDuration, parseTime, startOfDay } from "./dates";
import { REPEAT_OPTIONS } from "./recurrence";

const DRAFT_KEY = "calibre.draft";

interface Draft {
  title: string;
  date: string;
  start: string;
  len: string;
  until: string;
}

const EMPTY: Draft = { title: "", date: "", start: "", len: "", until: "" };

/** The calendar the last event was successfully added to (not just browsed past in the list). */
const LAST_CAL_KEY = "calibre.lastCalendar";
const loadLastCal = (): string => {
  try {
    return localStorage.getItem(LAST_CAL_KEY) ?? "";
  } catch {
    return "";
  }
};
const saveLastCal = (id: string): void => {
  try {
    localStorage.setItem(LAST_CAL_KEY, id);
  } catch {
    /* ignore */
  }
};

/** Length as the form shows it: days for all-day events, else "45m" / "2h" / "1h30". */
function fmtLen(start: Date, end: Date, allDay: boolean): string {
  if (allDay) return String(Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000)));
  const m = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
  if (m < 60) return m + "m";
  return Math.floor(m / 60) + "h" + (m % 60 ? pad2(m % 60) : "");
}

/** Index in REPEAT_OPTIONS of a rule (0 = does not repeat). */
function repeatIndex(rec: Recurrence | null): number {
  if (!rec) return 0;
  return Math.max(0, REPEAT_OPTIONS.findIndex((o) => o.rec && o.rec.freq === rec.freq && o.rec.interval === rec.interval));
}

/** The "Until" field text for a rule: "10x", a date, or blank. */
const untilText = (rec: Recurrence | null): string => (rec?.count ? `${rec.count}x` : rec?.until ? fmtKey(rec.until) : "");

export interface FormDeps {
  provider: CalendarProvider;
  calendars: () => Calendar[];
  /** Date to prefill when there is no saved draft date. */
  defaultDate: () => Date;
  /** An event was added or changed. */
  onCreated: () => void;
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function loadDraft(): Draft {
  try {
    return { ...EMPTY, ...(JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<Draft>) };
  } catch {
    return { ...EMPTY };
  }
}

function saveDraft(d: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable */
  }
}

interface Item {
  label: string;
  color?: string;
}

/** A keyboard-friendly select: Space opens, j/k move, Enter/Space choose, h/l change while closed. */
class Dropdown {
  idx = 0;
  private readonly list: HTMLUListElement;
  private readonly name: HTMLElement;
  private readonly caret: HTMLElement;

  constructor(
    readonly box: HTMLElement,
    prefix: string,
    private readonly items: () => Item[],
    private readonly onChange: (i: number) => void,
  ) {
    this.list = $<HTMLUListElement>(prefix + "-list");
    this.name = $(prefix + "-name");
    this.caret = $(prefix + "-caret");

    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      box.focus();
      this.isOpen() ? this.close() : this.open();
    });
    box.addEventListener("blur", () => this.close());
    box.addEventListener("keydown", (e) => {
      const k = e.key;
      if (this.isOpen()) {
        if (k === "ArrowDown" || k === "j") this.set(this.idx + 1);
        else if (k === "ArrowUp" || k === "k") this.set(this.idx - 1);
        else if (k === "Enter" || k === " " || k === "Escape") this.close();
        else return;
      } else if (k === " ") this.open();
      else if (k === "ArrowRight" || k === "l") this.set(this.idx + 1);
      else if (k === "ArrowLeft" || k === "h") this.set(this.idx - 1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
  }

  isOpen(): boolean {
    return !this.list.hidden;
  }
  open(): void {
    if (!this.items().length) return;
    this.list.hidden = false;
    this.caret.textContent = "▴";
  }
  close(): void {
    this.list.hidden = true;
    this.caret.textContent = "▾";
  }
  set(i: number): void {
    const n = this.items().length;
    if (!n) return;
    this.idx = (i + n) % n;
    this.render();
    this.onChange(this.idx);
  }
  /** Redraw the closed label and the option list (after items or idx changed). */
  render(): void {
    const items = this.items();
    this.name.textContent = items[this.idx]?.label ?? "None";
    this.list.replaceChildren(
      ...items.map((it, i) => {
        const li = document.createElement("li");
        li.className = i === this.idx ? "sel" : "";
        if (it.color) {
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.background = it.color;
          li.append(dot);
        }
        li.append(it.label);
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.set(i);
          this.close();
          this.box.focus();
        });
        return li;
      }),
    );
  }
}

/**
 * The event form: title / date / start / length / calendar / repeat / until.
 * Adding: the draft is saved on every edit and only cleared after the event is created (or with
 * Ctrl+L); it always starts at "Does not repeat" and on the calendar last added to.
 * Editing (right-click an event): the same fields prefilled; repeating events also ask whether the
 * change is for this occurrence or the whole series.
 */
export function initForm(deps: FormDeps): { open: () => void; openEdit: (ev: CalEvent, src: EditSource) => void; isOpen: () => boolean } {
  const overlay = $<HTMLDivElement>("overlay");
  const form = $<HTMLFormElement>("form");
  const heading = $<HTMLElement>("f-heading");
  const fTitle = $<HTMLInputElement>("f-title");
  const fDate = $<HTMLInputElement>("f-date");
  const fStart = $<HTMLInputElement>("f-start");
  const fLen = $<HTMLInputElement>("f-len");
  const fUntil = $<HTMLInputElement>("f-until");
  const untilRow = $<HTMLElement>("f-until-row");
  const repRow = $<HTMLElement>("f-rep-row");
  const scopeRow = $<HTMLElement>("f-scope-row");
  const status = $<HTMLParagraphElement>("f-status");

  let draft = loadDraft();
  let busy = false;
  /** Set while editing an existing event. */
  let edit: { ev: CalEvent; src: EditSource; initialRep: number; initialUntil: string } | null = null;
  /** Editing a series whose rule calibre can't show: an extra "keep" entry is offered and preselected. */
  let customRule = false;

  const persist = () => {
    if (!edit) saveDraft(draft);
  };
  /** Calendars the form can pick from (the writable ones; when editing, choosing another one moves the event). */
  const calList = (): Calendar[] => deps.calendars();
  const KEEP = REPEAT_OPTIONS.length; // index of the "keep current rule" entry

  const cal = new Dropdown($("f-cal"), "f-cal", () => calList().map((c) => ({ label: c.name, color: c.color })), () => {});
  const rep = new Dropdown(
    $("f-rep"),
    "f-rep",
    () => [...REPEAT_OPTIONS.map((o) => ({ label: o.label })), ...(customRule ? [{ label: "Keep current rule (custom)" }] : [])],
    () => syncRows(),
  );
  const scope = new Dropdown($("f-scope"), "f-scope", () => [{ label: "This event only" }, { label: "All events in the series" }], () => {
    fillTimes();
    syncRows();
  });

  const isSeries = (): boolean => !!edit?.src.series;
  /** Editing just one occurrence of a series: its repeat rule can't change. */
  const oneOfSeries = (): boolean => isSeries() && scope.idx === 0;

  function syncRows(): void {
    scopeRow.hidden = !isSeries();
    repRow.hidden = oneOfSeries();
    untilRow.hidden = repRow.hidden || rep.idx === 0 || rep.idx >= KEEP;
  }

  function setStatus(msg: string, err = false): void {
    status.textContent = msg;
    status.classList.toggle("err", err);
  }

  /** Fill date / start / length from the event (or, for "all events", from the series). */
  function fillTimes(): void {
    const e = edit!;
    const src = scope.idx === 1 && e.src.series ? e.src.series : e.src.one;
    fDate.value = fmtKey(src.start);
    fStart.value = src.allDay ? "" : `${pad2(src.start.getHours())}:${pad2(src.start.getMinutes())}`;
    fLen.value = fmtLen(src.start, src.end, src.allDay);
  }

  function showAll(): void {
    cal.render();
    rep.render();
    scope.render();
    cal.close();
    rep.close();
    scope.close();
    syncRows();
    setStatus("");
    overlay.hidden = false;
    fTitle.focus();
  }

  function open(): void {
    edit = null;
    customRule = false;
    heading.textContent = "New event";
    draft = loadDraft();
    fTitle.value = draft.title;
    fDate.value = draft.date || fmtKey(deps.defaultDate());
    fStart.value = draft.start;
    fLen.value = draft.len;
    fUntil.value = draft.until;
    const last = loadLastCal();
    const ci = deps.calendars().findIndex((c) => c.id === last);
    cal.idx = ci < 0 ? 0 : ci;
    rep.idx = 0; // a new event never repeats unless you say so
    showAll();
  }

  function openEdit(ev: CalEvent, src: EditSource): void {
    const rule = src.series?.rule;
    customRule = !!rule?.exotic;
    edit = { ev, src, initialRep: customRule ? KEEP : repeatIndex(rule?.rec ?? null), initialUntil: rule && !rule.exotic ? untilText(rule.rec) : "" };
    heading.textContent = "Edit event";
    fTitle.value = ev.title;
    fUntil.value = edit.initialUntil;
    scope.idx = 0;
    rep.idx = edit.initialRep;
    cal.idx = Math.max(0, calList().findIndex((c) => c.id === ev.calendarId));
    fillTimes();
    showAll();
  }

  function close(): void {
    cal.close();
    rep.close();
    scope.close();
    overlay.hidden = true;
    busy = false;
    edit = null;
  }

  function clearForm(): void {
    if (edit) return;
    draft = { ...EMPTY };
    fTitle.value = fDate.value = fStart.value = fLen.value = fUntil.value = "";
    rep.idx = 0;
    rep.render();
    syncRows();
    persist();
    setStatus("Draft cleared");
    fTitle.focus();
  }

  function fail(msg: string, el: HTMLElement): void {
    setStatus(msg, true);
    el.focus();
  }

  async function submit(): Promise<void> {
    if (busy) return;
    const title = fTitle.value.trim();
    if (!title) return fail("Give it a title", fTitle);
    const today = new Date();
    const date = parseDate(fDate.value, startOfDay(today), today);
    if (!date) return fail("Date: yyyy-mm-dd, mm-dd, +N, tomorrow", fDate);
    const time = parseTime(fStart.value);
    if (time === null) return fail("Time: 14:30 or 2:30pm (blank = all day)", fStart);
    const allDay = time === "";
    const dur = parseDuration(fLen.value, allDay ? 1 : 60);
    if (dur < 0) return fail("Length: 90, 45m, 1h30" + (allDay ? " (days when all day)" : ""), fLen);
    const calendar = calList()[cal.idx];
    if (!calendar) return fail("No calendar to add to", cal.box);

    if (edit && calendar.id !== edit.ev.calendarId && isSeries() && scope.idx === 0) {
      return fail("A repeating event moves as a whole: set Change to \"All events in the series\"", scope.box);
    }

    let recurrence: Recurrence | undefined;
    const opt = rep.idx < KEEP ? REPEAT_OPTIONS[rep.idx]?.rec : null;
    if (opt && !repRow.hidden) {
      recurrence = { ...opt };
      const u = fUntil.value.trim().toLowerCase();
      const count = u.match(/^(\d+)x$/);
      if (count) recurrence.count = parseInt(count[1]!, 10);
      else if (u !== "") {
        const until = parseDate(u, date, today);
        if (!until) return fail("Until: a date, 10x for 10 times, or blank", fUntil);
        if (until < date) return fail("Until is before the start date", fUntil);
        recurrence.until = until;
      }
    }

    let start: Date;
    let end: Date;
    if (time === "") {
      start = date;
      end = addDays(date, dur);
    } else {
      start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.h, time.m);
      end = new Date(start.getTime() + dur * 60_000);
    }

    busy = true;
    try {
      if (edit) {
        const e = edit;
        // only send a repeat rule when it was actually changed: re-sending would drop the series' skipped dates
        const changed = rep.idx !== e.initialRep || (rep.idx > 0 && rep.idx < KEEP && fUntil.value.trim() !== e.initialUntil);
        const patch: EditPatch = { title, calendarId: calendar.id, start, end, allDay, recurrence: changed && !oneOfSeries() && rep.idx < KEEP ? { rec: recurrence ?? null } : "keep" };
        setStatus("Saving...");
        await deps.provider.updateEvent(e.ev, e.src, patch, e.src.series && scope.idx === 1 ? "all" : "one");
      } else {
        const ev: NewEvent = { title, calendarId: calendar.id, start, end, allDay, recurrence };
        setStatus(`Adding to ${calendar.name}...`);
        await deps.provider.createEvent(ev);
        saveLastCal(calendar.id);
        draft = { ...EMPTY };
        persist();
      }
      close();
      deps.onCreated();
    } catch (err) {
      busy = false;
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  }

  const bind = (el: HTMLInputElement, key: "title" | "date" | "start" | "len" | "until") =>
    el.addEventListener("input", () => {
      draft[key] = el.value;
      persist();
    });
  bind(fTitle, "title");
  bind(fDate, "date");
  bind(fStart, "start");
  bind(fLen, "len");
  bind(fUntil, "until");

  form.addEventListener("submit", (e) => e.preventDefault());
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  overlay.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "?" || e.key === "/")) return; // handled globally (help)
    if (e.key === "Escape") {
      close();
    } else if (e.ctrlKey && e.key.toLowerCase() === "l") {
      clearForm();
    } else if (e.key === "Enter") {
      void submit();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const order: HTMLElement[] = [];
      if (!scopeRow.hidden) order.push(scope.box);
      order.push(fTitle, fDate, fStart, fLen, cal.box);
      if (!repRow.hidden) order.push(rep.box);
      if (!untilRow.hidden) order.push(fUntil);
      const i = order.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      order[(i + (e.key === "ArrowDown" ? 1 : order.length - 1)) % order.length]!.focus();
    } else return;
    e.preventDefault();
  });

  return { open, openEdit, isOpen: () => !overlay.hidden };
}

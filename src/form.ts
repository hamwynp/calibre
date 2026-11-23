import type { Calendar, CalendarProvider, NewEvent, Recurrence } from "./types";
import { addDays, fmtKey, parseDate, parseDuration, parseTime, startOfDay } from "./dates";
import { REPEAT_OPTIONS } from "./recurrence";

const DRAFT_KEY = "calibre.draft";

interface Draft {
  title: string;
  date: string;
  start: string;
  len: string;
  until: string;
  cal: string; // calendar id, remembered as "last used"
  rep: number; // index into REPEAT_OPTIONS
}

const EMPTY: Draft = { title: "", date: "", start: "", len: "", until: "", cal: "", rep: 0 };

export interface FormDeps {
  provider: CalendarProvider;
  calendars: () => Calendar[];
  /** Date to prefill when there is no saved draft date. */
  defaultDate: () => Date;
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
 * The add-event form: title / date / start / length / calendar / repeat / until.
 * The draft is saved on every edit and only cleared after the event is created
 * (or with Ctrl+L). The last-used calendar is remembered.
 */
export function initForm(deps: FormDeps): { open: () => void; isOpen: () => boolean } {
  const overlay = $<HTMLDivElement>("overlay");
  const form = $<HTMLFormElement>("form");
  const fTitle = $<HTMLInputElement>("f-title");
  const fDate = $<HTMLInputElement>("f-date");
  const fStart = $<HTMLInputElement>("f-start");
  const fLen = $<HTMLInputElement>("f-len");
  const fUntil = $<HTMLInputElement>("f-until");
  const untilRow = $<HTMLElement>("f-until-row");
  const status = $<HTMLParagraphElement>("f-status");

  let draft = loadDraft();
  let busy = false;

  const persist = () => saveDraft(draft);
  const calItems = (): Item[] => deps.calendars().map((c) => ({ label: c.name, color: c.color }));

  const cal = new Dropdown($("f-cal"), "f-cal", calItems, (i) => {
    const c = deps.calendars()[i];
    if (c) draft.cal = c.id;
    persist();
  });
  const rep = new Dropdown($("f-rep"), "f-rep", () => REPEAT_OPTIONS.map((o) => ({ label: o.label })), (i) => {
    draft.rep = i;
    untilRow.hidden = i === 0;
    persist();
  });

  function setStatus(msg: string, err = false): void {
    status.textContent = msg;
    status.classList.toggle("err", err);
  }

  function open(): void {
    draft = loadDraft();
    fTitle.value = draft.title;
    fDate.value = draft.date || fmtKey(deps.defaultDate());
    fStart.value = draft.start;
    fLen.value = draft.len;
    fUntil.value = draft.until;
    const ci = deps.calendars().findIndex((c) => c.id === draft.cal);
    cal.idx = ci < 0 ? 0 : ci;
    rep.idx = Math.min(Math.max(draft.rep, 0), REPEAT_OPTIONS.length - 1);
    untilRow.hidden = rep.idx === 0;
    cal.render();
    rep.render();
    cal.close();
    rep.close();
    setStatus("");
    overlay.hidden = false;
    fTitle.focus();
  }

  function close(): void {
    cal.close();
    rep.close();
    overlay.hidden = true;
    busy = false;
  }

  function clearForm(): void {
    draft = { ...EMPTY, cal: draft.cal };
    fTitle.value = fDate.value = fStart.value = fLen.value = fUntil.value = "";
    rep.idx = 0;
    rep.render();
    untilRow.hidden = true;
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
    const calendar = deps.calendars()[cal.idx];
    if (!calendar) return fail("No calendar to add to", cal.box);

    let recurrence: Recurrence | undefined;
    const opt = REPEAT_OPTIONS[rep.idx]?.rec;
    if (opt) {
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
    const ev: NewEvent = { title, calendarId: calendar.id, start, end, allDay, recurrence };

    busy = true;
    setStatus(`Adding to ${calendar.name}...`);
    try {
      await deps.provider.createEvent(ev);
      draft = { ...EMPTY, cal: draft.cal };
      persist();
      close();
      deps.onCreated();
    } catch (e) {
      busy = false;
      setStatus(e instanceof Error ? e.message : String(e), true);
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
      const order: HTMLElement[] = [fTitle, fDate, fStart, fLen, cal.box, rep.box];
      if (!untilRow.hidden) order.push(fUntil);
      const i = order.indexOf(document.activeElement as HTMLElement);
      if (i < 0) return;
      order[(i + (e.key === "ArrowDown" ? 1 : order.length - 1)) % order.length]!.focus();
    } else return;
    e.preventDefault();
  });

  return { open, isOpen: () => !overlay.hidden };
}

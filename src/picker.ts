import type { Calendar } from "./types";
import { calBox } from "./sidebar";
import { $, el } from "./ui";

export interface PickerDeps {
  calendars: () => Calendar[];
  hidden: () => Set<string>;
  onToggle: (id: string) => void;
  onShowAll: () => void;
}

/**
 * The "v" menu: every calendar with its color; choose which ones are shown.
 * j/k or arrows move, Space/Enter toggles, a = show all, Esc or v closes.
 */
export function createPicker(deps: PickerDeps): { open: () => void; close: () => void; isOpen: () => boolean; refresh: () => void } {
  const overlay = $<HTMLDivElement>("picker");
  const list = $<HTMLDivElement>("picker-list");
  let cursor = 0;

  const isOpen = () => !overlay.hidden;

  function refresh(): void {
    const cals = deps.calendars();
    cursor = Math.max(0, Math.min(cursor, cals.length - 1));
    list.replaceChildren(
      ...cals.map((c, i) => {
        const on = !deps.hidden().has(c.id);
        const row = el("div", "cal-row" + (on ? "" : " off") + (i === cursor ? " cur" : ""));
        row.append(calBox(c.color, on), el("span", "n", c.name));
        row.addEventListener("click", () => {
          cursor = i;
          deps.onToggle(c.id);
        });
        return row;
      }),
    );
    if (!cals.length) list.replaceChildren(el("div", "sec-note", "No calendars loaded"));
  }

  function open(): void {
    cursor = 0;
    overlay.hidden = false;
    refresh();
    overlay.focus();
  }
  function close(): void {
    overlay.hidden = true;
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "/" || e.key === "?")) return; // help is handled globally
    const n = deps.calendars().length;
    switch (e.key) {
      case "Escape": case "v": close(); break;
      case "j": case "ArrowDown": cursor = Math.min(n - 1, cursor + 1); refresh(); break;
      case "k": case "ArrowUp": cursor = Math.max(0, cursor - 1); refresh(); break;
      case " ": case "Enter": {
        const c = deps.calendars()[cursor];
        if (c) deps.onToggle(c.id);
        break;
      }
      case "a": deps.onShowAll(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  return { open, close, isOpen, refresh };
}

import { $, el } from "./ui";
import type { Settings } from "./store";

export interface SettingsDeps {
  get: () => Settings;
  set: (patch: Partial<Settings>) => void;
  /** Sidebar visibility lives outside Settings (the `b` key), so it is passed separately. */
  sidebar: () => boolean;
  toggleSidebar: () => void;
}

interface Option {
  label: string;
  hint: string;
  on: () => boolean;
  toggle: () => void;
}

/**
 * The Ctrl+I panel. j/k or arrows move, Space/Enter flips the option, Esc or Ctrl+I closes.
 */
export function createSettings(deps: SettingsDeps): { toggle: () => void; close: () => void; isOpen: () => boolean } {
  const overlay = $<HTMLDivElement>("settings");
  const list = $<HTMLDivElement>("settings-list");
  let cursor = 0;

  const options: Option[] = [
    {
      label: "Shamsi calendar",
      hint: "Show Jalali dates next to the Gregorian ones (week, day, month and the mini calendar)",
      on: () => deps.get().shamsi,
      toggle: () => deps.set({ shamsi: !deps.get().shamsi }),
    },
    {
      label: "Sidebar",
      hint: "Mini calendar and calendar list (same as the b key)",
      on: deps.sidebar,
      toggle: deps.toggleSidebar,
    },
  ];

  const isOpen = () => !overlay.hidden;

  function refresh(): void {
    list.replaceChildren(
      ...options.map((o, i) => {
        const row = el("div", "opt" + (i === cursor ? " cur" : ""));
        const sw = el("span", "switch" + (o.on() ? " on" : ""));
        sw.append(el("i"));
        const text = el("div", "opt-text");
        text.append(el("b", "", o.label), el("small", "", o.hint));
        row.append(text, sw);
        row.addEventListener("click", () => {
          cursor = i;
          o.toggle();
          refresh();
        });
        return row;
      }),
    );
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
  const toggle = () => (isOpen() ? close() : open());

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "/" || e.key === "?" || e.key === "i")) return; // handled globally
    switch (e.key) {
      case "Escape": close(); break;
      case "j": case "ArrowDown": cursor = Math.min(options.length - 1, cursor + 1); refresh(); break;
      case "k": case "ArrowUp": cursor = Math.max(0, cursor - 1); refresh(); break;
      case " ": case "Enter": options[cursor]!.toggle(); refresh(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  });

  return { toggle, close, isOpen };
}

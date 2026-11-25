import type { EditScope } from "./types";
import { $, el } from "./ui";

/**
 * The "Delete this event?" box. For a repeating event it also asks which part to delete.
 * j/k pick, Enter deletes, Esc cancels. Resolves with the chosen scope, or null when cancelled.
 */
export function createConfirm(): { askDelete: (title: string, recurring: boolean) => Promise<EditScope | null>; isOpen: () => boolean } {
  const overlay = $<HTMLDivElement>("confirm");
  const heading = $<HTMLElement>("confirm-title");
  const msg = $<HTMLElement>("confirm-msg");
  const opts = $<HTMLDivElement>("confirm-opts");
  const ok = $<HTMLButtonElement>("confirm-ok");
  const cancel = $<HTMLButtonElement>("confirm-cancel");

  let done: ((v: EditScope | null) => void) | null = null;
  let idx = 0;
  let recurring = false;

  const isOpen = () => !overlay.hidden;

  function finish(v: EditScope | null): void {
    overlay.hidden = true;
    const d = done;
    done = null;
    d?.(v);
  }

  function renderOpts(): void {
    opts.hidden = !recurring;
    opts.replaceChildren(
      ...["This event", "All events in the series"].map((label, i) => {
        const row = el("div", "opt" + (i === idx ? " cur" : ""));
        const text = el("div", "opt-text");
        text.append(el("b", "", label));
        row.append(text);
        row.addEventListener("click", () => {
          idx = i;
          renderOpts();
        });
        return row;
      }),
    );
  }

  ok.addEventListener("click", () => finish(recurring && idx === 1 ? "all" : "one"));
  cancel.addEventListener("click", () => finish(null));
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) finish(null);
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "/" || e.key === "?")) return; // help is handled globally
    if (e.key === "Escape") finish(null);
    else if (e.key === "Enter") finish(recurring && idx === 1 ? "all" : "one");
    else if (recurring && (e.key === "j" || e.key === "ArrowDown")) (idx = 1), renderOpts();
    else if (recurring && (e.key === "k" || e.key === "ArrowUp")) (idx = 0), renderOpts();
    else if (e.key === "Tab") {
      // keep focus inside the box: toggle between the two buttons
      (document.activeElement === ok ? cancel : ok).focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  });

  return {
    isOpen,
    askDelete(title, isRecurring) {
      finish(null); // never leave an earlier question hanging
      recurring = isRecurring;
      idx = 0;
      heading.textContent = "Delete event?";
      msg.textContent = isRecurring ? `"${title}" is part of a repeating series.` : `"${title}" will be removed from your calendar.`;
      renderOpts();
      overlay.hidden = false;
      overlay.focus();
      return new Promise((resolve) => {
        done = resolve;
      });
    },
  };
}

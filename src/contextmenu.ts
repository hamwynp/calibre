import { el } from "./ui";

export interface MenuItem {
  label: string;
  disabled?: boolean;
  run: () => void;
}

let current: { menu: HTMLDivElement; stop: AbortController } | null = null;

export const menuOpen = (): boolean => current !== null;

export function closeMenu(): void {
  if (!current) return;
  current.stop.abort();
  current.menu.remove();
  current = null;
}

/** A small right-click menu at (x, y). Arrow keys / Tab move, Enter picks, Esc or a click elsewhere closes. */
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = el("div", "ctxmenu");
  menu.setAttribute("role", "menu");
  const buttons = items.map((it) => {
    const b = el("button", "", it.label);
    b.type = "button";
    b.disabled = !!it.disabled;
    b.addEventListener("click", () => {
      closeMenu();
      it.run();
    });
    menu.append(b);
    return b;
  });
  document.body.append(menu);

  // keep it inside the window
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + "px";

  const stop = new AbortController();
  const opts = { capture: true, signal: stop.signal };
  document.addEventListener("mousedown", (e) => !menu.contains(e.target as Node) && closeMenu(), opts);
  document.addEventListener("contextmenu", (e) => !menu.contains(e.target as Node) && closeMenu(), opts);
  window.addEventListener("blur", closeMenu, { signal: stop.signal });
  window.addEventListener("resize", closeMenu, { signal: stop.signal });
  document.addEventListener(
    "keydown",
    (e) => {
      const enabled = buttons.filter((b) => !b.disabled);
      const i = enabled.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") closeMenu();
      else if (e.key === "ArrowDown" || e.key === "j") enabled[(i + 1) % enabled.length]?.focus();
      else if (e.key === "ArrowUp" || e.key === "k") enabled[(i - 1 + enabled.length) % enabled.length]?.focus();
      else if (e.key === "Enter") enabled[Math.max(i, 0)]?.click();
      else return;
      e.preventDefault();
      e.stopPropagation();
    },
    opts,
  );
  buttons.find((b) => !b.disabled)?.focus();
  current = { menu, stop };
}

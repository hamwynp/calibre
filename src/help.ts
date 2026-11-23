export type HelpContext = "week" | "form";

type Row = [keys: string, what: string];
interface Section {
  title: string;
  rows: Row[];
}

const HELP: Record<HelpContext, Section[]> = {
  week: [
    {
      title: "Week",
      rows: [
        ["h · ←", "Previous week"],
        ["l · →", "Next week"],
        ["t · 0", "Jump to today"],
        ["j · ↓", "Scroll down"],
        ["k · ↑", "Scroll up"],
        ["J", "Scroll to the bottom"],
        ["K", "Scroll to the top (all-day items)"],
        ["a", "Add an event"],
        ["Ctrl+?", "Show / hide this help"],
      ],
    },
  ],
  form: [
    {
      title: "Add event",
      rows: [
        ["Enter", "Add the event"],
        ["Tab · Shift+Tab", "Next / previous field"],
        ["↑ ↓", "Move between fields"],
        ["Esc", "Close (draft is kept)"],
        ["Ctrl+L", "Clear the draft"],
        ["Ctrl+?", "Show / hide this help"],
      ],
    },
    {
      title: "Calendar & Repeat lists",
      rows: [
        ["Space", "Open the list"],
        ["j k · ↑ ↓", "Move in the open list"],
        ["Enter · Space", "Choose"],
        ["h l · ← →", "Change without opening"],
      ],
    },
    {
      title: "Field formats",
      rows: [
        ["Date", "2026-12-08 · 12-08 · +3 · today · tomorrow"],
        ["Start", "14:30 · 2:30pm · blank = all day"],
        ["Length", "60 · 45m · 1h30 (days if all day)"],
        ["Until", "blank = forever · a date · 10x = 10 times"],
      ],
    },
  ],
};

function build(ctx: HelpContext): DocumentFragment {
  const frag = document.createDocumentFragment();
  const h3 = document.createElement("h3");
  h3.textContent = ctx === "form" ? "Shortcuts – add event" : "Shortcuts – week";
  frag.append(h3);
  for (const sec of HELP[ctx]) {
    if (HELP[ctx].length > 1) {
      const h4 = document.createElement("h4");
      h4.textContent = sec.title;
      frag.append(h4);
    }
    const dl = document.createElement("dl");
    for (const [keys, what] of sec.rows) {
      const dt = document.createElement("dt");
      if (sec.title === "Field formats") {
        dt.textContent = keys;
      } else {
        for (const k of keys.split(" · ")) {
          const kbd = document.createElement("kbd");
          kbd.textContent = k;
          dt.append(kbd);
        }
      }
      const dd = document.createElement("dd");
      dd.textContent = what;
      dl.append(dt, dd);
    }
    frag.append(dl);
  }
  return frag;
}

/** A small floating cheat-sheet for whichever screen is showing. */
export function createHelp(getContext: () => HelpContext): { toggle: () => void; close: () => void; isOpen: () => boolean } {
  const box = document.getElementById("help") as HTMLDivElement;
  const isOpen = () => !box.hidden;
  const close = () => {
    box.hidden = true;
  };
  const toggle = () => {
    if (isOpen()) return close();
    box.replaceChildren(build(getContext()));
    box.hidden = false;
  };
  box.addEventListener("mousedown", close);
  return { toggle, close, isOpen };
}

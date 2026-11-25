export type HelpContext = "week" | "day" | "month" | "list" | "form" | "calendars";

type Row = [keys: string, what: string];
interface Section {
  title: string;
  rows: Row[];
}

/** The Tab cursor keys (week, day, month). */
const EVENT_KEYS: Row[] = [
  ["Tab · Shift+Tab", "Select next / previous event"],
  ["e", "Edit the selected event"],
  ["y", "Duplicate it (opens the add form, filled in)"],
  ["x · Delete", "Delete it (asks first)"],
  ["Esc", "Clear the selection"],
];

const COMMON: Row[] = [
  ["v", "Choose which calendars to show"],
  ["b", "Show / hide the sidebar"],
  ["a", "Add an event"],
  ["Right-click", "Edit / Duplicate / Delete an event"],
  ["Ctrl+I", "Settings (Shamsi calendar, sidebar)"],
  ["r", "Refresh from Google"],
  ["Ctrl+/", "Show / hide this help"],
];

const HELP: Record<HelpContext, Section[]> = {
  week: [
    {
      title: "Week",
      rows: [
        ["h \u00b7 \u2190", "Previous week"],
        ["l \u00b7 \u2192", "Next week"],
        ["t", "Jump to today"],
        ["j \u00b7 \u2193", "Scroll down"],
        ["k \u00b7 \u2191", "Scroll up"],
        ["J", "Scroll to the bottom"],
        ["K", "Scroll to the top (all-day items)"],
        ["- \u00b7 =", "Zoom out / in"],
        ["0", "Reset zoom"],
        ["d", "Day view"],
        ["m", "Month view"],
        ["s", "List (schedule) view"],
        ...EVENT_KEYS,
        ...COMMON,
      ],
    },
  ],
  day: [
    {
      title: "Day",
      rows: [
        ["h \u00b7 \u2190", "Previous day"],
        ["l \u00b7 \u2192", "Next day"],
        ["t", "Jump to today"],
        ["j k \u00b7 \u2193 \u2191", "Scroll"],
        ["J \u00b7 K", "Bottom / top (all-day items)"],
        ["- \u00b7 =", "Zoom out / in"],
        ["0", "Reset zoom"],
        ["w \u00b7 d", "Week view"],
        ["m", "Month view"],
        ["s", "List (schedule) view"],
        ...EVENT_KEYS,
        ...COMMON,
      ],
    },
  ],
  month: [
    {
      title: "Month",
      rows: [
        ["h \u00b7 \u2190", "Previous month"],
        ["l \u00b7 \u2192", "Next month"],
        ["t \u00b7 0", "Current month"],
        ["d", "Day view"],
        ["w \u00b7 m", "Week view"],
        ["s", "List (schedule) view"],
        ["Click", "Open that day"],
        ...EVENT_KEYS,
        ...COMMON,
      ],
    },
  ],
  list: [
    {
      title: "List",
      rows: [
        ["j k \u00b7 \u2193 \u2191", "Move the cursor"],
        ["Space", "Select (moves down)"],
        ["x \u00b7 d", "Dismiss selected / current"],
        ["u", "Undo dismiss"],
        ["Enter", "Open in Google Calendar"],
        ["e", "Edit the event"],
        ["y", "Duplicate the event"],
        ["Delete", "Delete the event (asks first)"],
        ["w \u00b7 s", "Week view"],
        ["m", "Month view"],
        ...COMMON,
      ],
    },
  ],
  calendars: [
    {
      title: "Calendars",
      rows: [
        ["j k \u00b7 \u2193 \u2191", "Move"],
        ["Space \u00b7 Enter", "Show / hide the calendar"],
        ["a", "Show all calendars"],
        ["Esc \u00b7 v", "Close"],
        ["Ctrl+/", "Show / hide this help"],
      ],
    },
  ],
  form: [
    {
      title: "Add / edit event",
      rows: [
        ["Enter", "Add / save the event"],
        ["Tab · Shift+Tab", "Next / previous field"],
        ["↑ ↓", "Move between fields"],
        ["Esc", "Close (draft is kept)"],
        ["Ctrl+L", "Clear the draft"],
        ["Ctrl+/", "Show / hide this help"],
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
  h3.textContent = "Shortcuts – " + (ctx === "form" ? "add / edit event" : ctx);
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
  const stamp = document.createElement("h4");
  stamp.textContent = "calibre " + __BUILD__;
  frag.append(stamp);
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

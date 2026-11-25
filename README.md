# calibre

An open-source, keyboard-first Google Calendar app that runs on any OS.

> Status: early prototype. Week, day, month and list views, Google Calendar sync, an add-event form with recurring events, and Taskwarrior tasks (see [docs/PLAN.md](docs/PLAN.md)).

## Goals

- **Fast and keyboard-driven**: vim-style keys (`h`/`l` week, `j`/`k` scroll, `a` add, `t` today).
- **Google Calendar sync**: read and write events, across all your calendars
  (Exams, University, Birthdays, ...).
- **Tasks alongside events**: all-day items and dated tasks stack at the top of the week.
- **Looks good**: clean, macOS-inspired, crisp at any display scale.
- **Cross-platform**: Linux, macOS, Windows.
- **Offline-friendly**: cache events, keep drafts, and sync when Google is reachable
  (works behind a VPN-only network).
- **Open source** (GPL-3.0).

## Origin

This grows out of a Quickshell calendar widget (week grid, add-event form with a
calendar picker, draft saving). Its behaviour is the reference for v0.1.

## Run it

Requires Node 20+, Rust, and [Tauri's system dependencies](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run tauri dev     # desktop app
npm run dev           # just the UI in a browser (http://localhost:1420)
```

Press `Ctrl+/` in the app for the keyboard shortcuts of the current screen.

## Stack

Tauri 2 (Rust shell) + TypeScript UI (Vite, no framework). Google Calendar sync will
be implemented in the Rust side behind the `CalendarProvider` interface (`src/types.ts`);
the UI currently runs on `DemoProvider` (`src/demo.ts`).

## Google sync

For now calibre reuses the login that [gcalcli](https://github.com/insanum/gcalcli) already has
(`gcalcli init`): on first launch it copies the OAuth client and refresh token into its own data
folder (`~/.local/share/dev.calibre.app/google-token.json`, owner-only) and talks to the Google
Calendar API directly from then on. A built-in sign-in flow will replace this. Without a login (for
example in a plain browser during development) the app shows demo data instead.

If Google is blocked on your network, turn your VPN on. The header shows why a sync failed.

## Views and keys

| View | Key | Notes |
| --- | --- | --- |
| Week | `w` (default) | `h`/`l` week, `t` today, `j`/`k` scroll, `J`/`K` bottom/top, `-`/`=` zoom, `0` reset zoom |
| Day | `d` | `h`/`l` day; `w` or `d` again returns to the week |
| Month | `m` | `h`/`l` month, Shamsi day numbers, task priority balls, click a day to open it |
| List | `s` | `j`/`k` move, `Space` select, `x`/`d` dismiss, `u` undo, `Enter` open in Google Calendar |

`v` opens the calendar picker: every calendar with its color, and you choose which ones are shown
(`Space` toggles, `a` shows all). The left sidebar (`b` hides it) has a small month calendar and
"My calendars" with a checkbox per calendar.

`a` adds an event (with calendar picker, repeat rules and a saved draft), `r` refreshes, and
`Ctrl+/` shows the shortcuts for the current screen. Pending [Taskwarrior](https://taskwarrior.org)
tasks (if `task` is installed) show up in the all-day strip, on the grid, and as balls in the month.

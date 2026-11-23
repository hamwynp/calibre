# gcal

An open-source, keyboard-first Google Calendar app that runs on any OS.

> Status: early prototype - week view, add-event form and recurring events run on demo data. Google sync is next (see [docs/PLAN.md](docs/PLAN.md)).

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

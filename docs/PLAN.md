# Plan

## v0.1 - "the dashboard, as its own app"
- [ ] Week grid (Mon-Sun, 24h) with a "now" line
- [ ] All-day strip at the top of the scroll area
- [ ] Lane-packed overlapping events
- [ ] `h`/`l` change week (jumps to 12am), `t` today, `j`/`k` scroll
- [ ] Google login (OAuth, desktop flow) and event fetch
- [ ] `a` add-event form: title, date, start, length, calendar dropdown
- [ ] Draft saved to disk until the event is added

## Later
- Month and list views, edit/delete events, tasks, reminders, themes, packaging.

## Open decisions
- UI stack (see conversation): Tauri / Flutter / Qt-QML (PySide6) / Electron
- Where tokens are stored (OS keychain vs file)

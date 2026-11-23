# Plan

## v0.1 - "the dashboard, as its own app"
- [x] Week grid (Mon-Sun, 24h) with a "now" line
- [x] All-day strip at the top of the scroll area
- [x] Lane-packed overlapping events
- [x] `h`/`l` change week (jumps to 12am), `t` today, `j`/`k` scroll
- [x] Recurring events (daily / weekdays / weekly / monthly / yearly, until or N times)
- [x] `Ctrl+/` help for each screen
- [ ] Google login (OAuth, desktop flow) and event fetch
- [x] `a` add-event form: title, date, start, length, calendar dropdown, repeat
- [x] Draft saved to disk until the event is added

## Later
- Month and list views, edit/delete events, tasks, reminders, themes, packaging.

## Open decisions
- UI stack: decided - Tauri + TypeScript
- Where tokens are stored (OS keychain vs file)

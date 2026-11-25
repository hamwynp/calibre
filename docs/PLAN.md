# Plan

## v0.1 - "the dashboard, as its own app"
- [x] Week grid (Mon-Sun, 24h) with a "now" line
- [x] All-day strip at the top of the scroll area
- [x] Lane-packed overlapping events
- [x] `h`/`l` change week (jumps to 12am), `t` today, `j`/`k` scroll
- [x] Recurring events (daily / weekdays / weekly / monthly / yearly, until or N times)
- [x] `Ctrl+/` help for each screen
- [x] Google sync: calendars, events, create incl. repeats
- [x] Built-in Google sign-in (OAuth loopback + PKCE), sign-out; setup in docs/GOOGLE_SETUP.md
- [x] `a` add-event form: title, date, start, length, calendar dropdown, repeat
- [x] Draft saved to disk until the event is added

## Done since v0.1
- [x] Day view (`d`), month view (`m`) with Shamsi dates and task balls, list view (`v`)
- [x] Taskwarrior tasks in the strip, grid, month and list

## Later
- Edit/delete events, event details, reminders, themes, built-in sign-in, offline create queue.

## Open decisions
- UI stack: decided - Tauri + TypeScript
- Where tokens are stored (OS keychain vs file)

# PATCH: HR "Today" view

HR workbench gets a new first tab, **Today**: what to update, run, confirm and chase right now.
No migration, no new env vars, no new permissions.

## What HR sees

| Section | Shows | Row actions |
|---|---|---|
| Needs update | A lineup/interview date has passed, the candidate hasn't moved on, and nobody has said what happened | Next-stage button (e.g. Mark Reached), Not coming, Reschedule, WhatsApp |
| Today | Lineups and interviews dated today (time order, untimed last) | same |
| Tomorrow | Lineups/interviews tomorrow | Confirm on WhatsApp, Confirmed, Not coming, Reschedule |
| Gone quiet | No stage movement for 5+ days and nothing dated coming up (top 10 shown) | Nudge on WhatsApp |

Rules (all in `frontend/src/lib/today.js`, 19 tests):
- One row per candidate. Missed beats today beats tomorrow.
- A lineup date counts until the candidate reaches Turn up; an interview date until Offer. Decided from the stable `stageKey`. A custom stage with another key never raises a missed-date alarm.
- "Day" is the HR's own device calendar day, like the rest of the workbench (not the org timezone).
- Rescheduled candidates carry a "Rescheduled Nx" tag.
- Scope toggle: My candidates / Whole team, same as Pipeline.
- Reloads when the tab regains focus, so a tab left open overnight doesn't show yesterday.

## Backend

- `POST /api/v1/trackers/:id/outcome` `{ outcome: 'not_coming' | 'confirmed', field?, forDate? }`. Permission `trackers:write`. Records the answer only; the candidate stays at their stage. Refused for anyone not active.
- Moving an existing lineup/interview date (single PATCH or bulk dates) now leaves an action row (`metadata.kind = 'reschedule'`). A first-time set, a clear, or the same value does not count.
- `GET /trackers` rows gain `rescheduleCount`, `notComingAt`, `confirmedFor` (one extra batched query).
- All stored as `candidate_tracker_action` rows with `metadata.kind`; no schema change.
- "Latest word wins": a later confirmation clears not-coming and the other way round.

## Files

Backend: `trackers.today.js` (new, pure helpers), `trackers.service.js`, `trackers.bulk.service.js`, `trackers.schema.js`, `trackers.controller.js`, `trackers.routes.js`
Frontend: `TodayTab.jsx`, `useStagesByTemplate.js`, `today.js`, `today.test.js` (new), `HrPage.jsx`, `package.json` (test script)
Tests: `trackers.today.test.js`, `trackers.today.live.test.js` (new)

## Apply (PowerShell, from the repo root)

    Expand-Archive -Force -Path .\jopup-today-view.zip -DestinationPath .
    cd backend; npm test; cd ..\frontend; npm test; npm run build

Optional, against the seeded demo database:

    cd backend
    $env:JOPUP_LIVE_TESTS = "1"; node --test test/trackers.today.live.test.js

## Verified

- Backend: 397 tests, 0 failures (51 live tests skipped without the flag).
- Live, against a real Postgres seeded with the demo data: the 8 new tests plus the 24 existing data-import live tests pass.
- Frontend: 39 tests pass, production build succeeds, lint clean on the new files.
- Not done: I did not open the screen in a browser. Please look at it on a phone and a desktop.

## Choices made where nothing was specified

- Not coming keeps the candidate in the pipeline (they surface under Gone quiet later). Say if it should reject or hold instead.
- Quiet threshold is 5 days, a constant (`QUIET_DAYS`). A manager setting is not built.
- Today is the default tab.
- WhatsApp messages use the first name and role only, never the client name.
- "Asked on WhatsApp" is remembered for the session only; Confirmed and Not coming are saved.
- Reschedule counts start from this patch. Earlier date changes were never logged.
- The reschedule trail is best-effort: if logging fails the date change still goes through.

# Patch: data import 6 — new teams, and scheduler errors you can read

Apply **after** `patch-data-import-5.zip` (the service file here already contains patch 5's changes, so applying 6 alone is also safe).

## 1. "This team has no default workflow yet" when importing
**What happened:** a new organisation's `General` team is created with no workflow. Creating a tracker provisions the standard
pipeline the first time a team needs one (`trackers.service › resolveWorkflowTemplateId`); the import looked for a default and,
finding none, refused with "Set one up first" — and there is no screen that sets one up.

**Fix:** the import now resolves the team's workflow the same way creating a tracker does: use the default, else create the standard
one (Applied, Screening, Line-up, Turn up, Interview, Offer, Joined), handling two requests racing to do it. Teams that already have a
default are untouched. Nothing else changes: it is the same pipeline HR would have got on their first tracker.
Note this writes one workflow template at *preview* time (not only at import), exactly once per team.

## 2. `[daily-tracker] tick failed: Failed query: update "daily_tracker_run" …`
That line only tells you which statement failed; the reason is in the error's `cause`, which the scheduler never printed.
The statement itself is correct (it matches `19-daily-tracker.ts` and migration `0002`), so this is almost certainly the database
not answering at that moment (connection reset by a pooler or idle timeout, database restarting or paused), not a code bug.
- New `utils/describeError.js`; the daily-tracker, performance-sync and import-cleanup schedulers now log
  `… ← caused by: connect ECONNREFUSED … [ECONNREFUSED]` (or the timeout / missing-column message).
- Behaviour is unchanged: a failed tick is logged and the next minute tries again, so a single occurrence needs no action.
- If it repeats, send the line after the next failure; it will now name the cause.

## Files
backend: `src/features/data-import/data-import.service.js`, `src/utils/describeError.js` (new),
`src/features/{daily-trackers/daily-trackers,performance/performance,data-import/data-import}.scheduler.js`,
`test/dataImport.live.test.js`, `test/describeError.test.js` (new)
No migration, no frontend change.

## Tests
- New live test: a team whose default workflow is removed gets the 7-stage pipeline on preview (batch points at it), then cleanup. The old test titled
  "…a team with no workflow are refused clearly" never actually tested that; it is renamed to what it does.
- Live import suites (seeded DB): 24 of 24 pass. `describeError`: 2 tests. Whole backend suite: see the reply.

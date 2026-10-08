# Patch: Phase 2A — client isolation, bulk dates, bulk status (backend)

Applies on top of GitHub main 77ef8ca. Full files, extract with -Force. No migration.

## New
- backend/src/features/trackers/trackers.bulk.service.js   planners (pure) + bulk execution
- backend/src/features/mail/clientScope.js                 one-client-per-mail guard
- backend/test/trackers.bulk.test.js, backend/test/mail.isolation.test.js

## Changed
- trackers.schema.js / controller / routes   POST /api/v1/trackers/bulk/dates, POST /api/v1/trackers/bulk/status
- trackers.service.js                         enriched trackers now carry clientId (additive)
- mail.schema.js / mail.service.js            compose accepts clientId (uuid | null = internal)

## Behaviour
- Dates: field lineupDate|interviewDate; mode same | stagger (start + gapMinutes, in the order sent) | clear.
  One transaction for the applied rows; joined/rejected/withdrawn are skipped with a reason; one audit row each.
- Status: advance (nextStageId, optional note) | hold | resume | block (reason). Each tracker is its own
  transaction; a candidate on another workflow moves to the stage with the same stageKey, else is skipped.
- Both accept dryRun:true (preview: same result shape, nothing written). Max 200 ids.
- Result: { applied: [...], skipped: [{ id, candidateName, reason }] }. Unknown / other-tenant / not-visible ids all read "Not found".
- Permissions: dates = trackers:write; status = workflow_actions advance|block|hold (resume uses hold),
  and the caller must hold that permission for each tracker's team (canActOnTeam), not just see it.
- Mail: when compose names a clientId, any tracker from another client is refused (400), not dropped.
  Without clientId, mail is still built one client at a time (tests assert no name crosses).

## Not done / open
- Not run against a live database; planners, schemas, auth and mail isolation are unit tested (full suite passes).
- No frontend yet (row selection, bulk bar, preview sheet).
- Automation rules (2D) not started; stage-log movedBy is nullable, so a system actor is possible.
- Client/location profiles wait on the location-source decision.

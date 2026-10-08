# Patch: Phase 2B — bulk selection in the HR pipeline (frontend)

Needs jopup-phase2a-bulk.zip applied first (the /trackers/bulk/* endpoints). Full files, extract with -Force. No migration.

## New (frontend/src/components/hr/)
- BulkBar.jsx          floating bar: "n selected", Select all / Clear, Dates, Status, stop
- BulkDatesSheet.jsx   lineup/interview date: same time | one after another (start + gap) | clear
- BulkStatusSheet.jsx  move to stage (+ status note, e.g. Reached) | hold | resume | reject (reason)
- BulkResult.jsx       who changes / who is skipped and why (shared)

## Changed
- frontend/src/pages/HrPage.jsx   "Select" button in the filter row, checkbox on each card, ring on selected cards,
                                  Add-candidate button hidden while selecting

## Behaviour
- Only active / on-hold candidates can be selected. Only what is on screen counts: change a filter and the
  hidden ones drop out of the selection. "Select all n" = everything currently shown.
- Both sheets are two-step: Preview (server dry run, nothing written) then Apply to n. Editing the form
  discards a stale preview. After Apply the result stays on screen (updated / skipped with reasons), the list reloads
  and selection mode ends.
- "One after another" follows the order on screen.
- Buttons follow permissions: Dates needs trackers:write; Status shows only the actions the role has
  (advance / hold+resume / block).
- Stage list for a bulk move comes from the workflow most of the selection is on; others map by stage key (server).

## Checked / not checked
- vite build passes; oxlint: 0 errors (warnings are the existing set-state-in-effect pattern used across the app).
- Not tried in a browser or on a phone, and not against a live backend.
- Not included yet: a combined group-chat text for a bulk move, and bulk "Email lineup" from the selection.

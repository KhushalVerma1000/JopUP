# Cleanup patch (apply first)

1. Removes `HrClassicPage.jsx` (unrouted; Phase 3 meant to delete it, but Expand-Archive can't delete).
2. Removes the four orphaned `portal.*` job-portal files (not wired into app.js; `job-portal.*` is the live set).
3. Removes five migration `.sql` files that are NOT in `_journal.json` (never ran) and the five stale snapshots.
4. Adds `meta/0006_snapshot.json`, a snapshot of the current schema. Before this, `npm run db:generate`
   diffed against the 0004 snapshot (older than the daily-tracker and mail tables) and tried to re-create
   enums and tables. Verified: it now reports no drift.

Journal and the six real migrations are untouched, so existing and fresh databases migrate exactly as before.

Apply (PowerShell, repo root):
    git checkout -b dev
    Expand-Archive jopup-cleanup.zip -DestinationPath . -Force
    ./apply-cleanup.ps1
    Remove-Item apply-cleanup.ps1
    git add -A; git commit -m "chore: remove dead files, rebuild drizzle snapshot"
    git push -u origin dev

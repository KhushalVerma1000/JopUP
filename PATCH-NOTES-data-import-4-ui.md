# Patch: data import 4 — Import data page, several files at once

Builds on `eea49a4` (data import parts 1–3).

## What it does
- New page **Import data** (`/import`, sidebar for managers and org admins).
- Three steps: **1 Check files › 2 Review › 3 Import**.
- Pick up to **10 files** (10 MB each, 25 MB in total). They are checked and imported **together as one batch**:
  a person in two files is one candidate, a client in two files is one client, and **one undo covers everything**.
- Per file: status (Ready / Check / Skipped), its own column table with dropdowns, remove button.
  Mapping and status-word answers apply to every file with the same heading / word.
- The same file added twice is counted once (detected by content hash, not name).
- Review: totals, by-file table, questions for near-name clients and positions (import is blocked until answered),
  left-out rows with reasons and a CSV download, "already mailed" option, plan-limit notice.
- Import: progress bar, then result, links, and **Undo** (14 days).

## Backend changes (small)
- `POST /data-import/preview` accepts `files` (repeat the field, max 10) as well as the old single `file`.
- New `combine.js`: file labels, sheet qualifying (`lineups_oct › Oct 13`), combined hash, limits.
- `createPreview` reads every file, skips repeats, names the file in any error, and stores `options.files`
  (name, hash, size, rows) on the batch. A single file is planned exactly as before (plain sheet names).
- `previouslyImported` is now checked per file (`files[].previouslyImported`); the old top-level field still works.
- `POST /data-import/analyse` also returns `fileHash` and `size`.
- No migration.

## Files
backend: `src/features/data-import/{combine.js (new), data-import.service.js, data-import.controller.js, data-import.routes.js}`,
`test/dataImport.multi.test.js (new)`
frontend: `src/pages/ImportPage.jsx`, `src/components/import/{FilesStep,ReviewStep,ImportStep}.jsx`, `src/lib/dataImport.js`,
`src/lib/dataImport.test.js`, `src/App.jsx`, `src/components/AppLayout.jsx`, `package.json` (test script)

## Tests
- `cd backend && node --test test/dataImport.multi.test.js` (9 tests, no database). With the other import unit tests: 61 pass.
- `cd frontend && npm test` (17 pass). `vite build` and `oxlint` are clean on the new files.
- NOT run: the live suites (need the seeded database) and a real browser. See "Known gaps".

## Known gaps (honest list)
1. **Recruiter names are not assigned.** The matcher records them, but the commit step never reads them, so imported
   trackers are created under the importer. The Review screen says so. Fixing it is a small change in `commit.service.js`.
2. **No way back into a running import.** There is no "list my batches" endpoint, so closing the page mid-import
   leaves it half done (rows already written stay, nothing is written twice on resume via the API, but the screen cannot resume).
3. Adding a file re-reads all files already in the list (simple, a little slow with 10 big files).
4. The multi-file preview is covered by unit tests and an upload-middleware check, not by a live database test.
5. Left-out rows list and CSV are capped at 1,000 rows.

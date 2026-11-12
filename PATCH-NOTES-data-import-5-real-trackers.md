# Patch: data import 5 — fixes from importing real trackers

Builds on `f85e227` (data import parts 1–4). Found by importing three real staffing trackers (an 8-tab client tracker with
909 rows, a 1-tab daily tracker, a 3-tab per-client tracker) through preview, commit and undo on a seeded database.

## What was wrong, and what changed

| # | Problem seen on the real files | Fix |
|---|--------------------------------|-----|
| 1 | **No client, no open position.** These trackers have no Client column; the client is the tab name or the file name. Every lineup was imported with no client. | New per-file **Client for this file** choice on the Import page: *each tab is a client* / *one client for the whole file* / *no client*. We suggest one from the tab and file names and say it is a guess. New `clientHint.js`. |
| 2 | **Interview Time saved as an alternate phone** (`Sat Dec 30 1899 11:00…` in 591 of 687 candidates). A time cell's digits passed the "looks like a phone" test; "Sourcing Date" did the same in another file. | A phone must be digits and phone punctuation: dates, times and sentences no longer qualify. Interview Time is now its own field (kept in the tracker notes as `Interview time 11:00`); Sourcing Date is kept as an extra detail. |
| 3 | **Rescheduled interviews dropped as "duplicates".** The duplicate test ignored the interview date, so 98 of the 105 rows skipped as repeats were the same person on a different day. | An exact repeat now needs the same client, position **and all three dates**. |
| 4 | **Statuses lost.** Reached / No show / Rejected were typed in columns headed Expected CTC, Remarks or Recruiter, so every tracker was "active" and "Reached" became a recruiter name. | Values are sorted by what they are: status words under Remarks / Expected CTC feed the status, salaries under Status go to Expected CTC, a status word under Recruiter is a status, not a person. Unheaded columns next to a moved column are recognised (recruiter names, remarks) and shown as **Check** with a note. |
| 5 | **A second table in the same sheet was lost** (9 candidates errored: its headings differ, so every column shifted). | A sheet can hold several tables; each is read with its own headings. A repeat of the same heading row is still just skipped. |
| 6 | A **2002** interview date imported silently. | Dates more than 6 years back or 2 years ahead get a warning (the date is kept). |
| 7 | "Dates could be read two ways" shown for sheets with real Excel dates. | Shown only when a written-out date really is ambiguous. |
| 8 | Result said **791 rows done** when 925 were. | `progressOf` now counts inside the commit transaction; the last chunk was invisible to it. |

## API
- `POST /data-import/analyse`: new optional `clientMode` (`none`|`sheet`|`name`|`auto`) and `clientName`. Response gains `client`
  (`mode`, `name`, `source`, `needed`, `sheetNames`, `suggestion`) and sheets gain `tables` when there is more than one table.
- `POST /data-import/preview`: new optional `fileClients` JSON, `{ "<file name>": { "mode", "name" } }`.
- **Callers that send nothing behave exactly as before** (mode `none`). The Import page sends `auto` first, then what the user picks.
- A sheet that has its own Client column is never changed and shows no choice.
- No migration. Existing batches are untouched.

## Files
backend `src/features/data-import/`: `clientHint.js` (new), `analyse.js`, `headers.js`, `normalize.js`, `match.js`, `commit.service.js`,
`data-import.service.js`, `data-import.controller.js`; `test/dataImport.patch5.test.js` (new)
frontend: `src/lib/dataImport.js`, `src/lib/dataImport.test.js`, `src/pages/ImportPage.jsx`, `src/components/import/FilesStep.jsx`

## Tests
- Backend, whole suite: **337 pass, 0 fail, 42 skipped** (live-only). New `dataImport.patch5.test.js`: 26 tests, all invented data in the shapes the real files had.
- Live suites (`JOPUP_LIVE_TESTS=1`, seeded DB): **23 of 23 pass**.
- Frontend: `npm test` 20 pass; `vite build` and `oxlint` clean on the changed files.
- End to end on the real files (3 files, auto client): 934 rows, 0 blocked, 3 clients, 11 positions, 690 candidates, 712 trackers,
  statuses now spread over active / rejected / on hold / withdrawn, no stray alternate phones; Undo removed all of it, including the clients and positions.
- NOT run: a real browser. The client control and the column notes are covered by unit tests and a build, not by eye.

## Decisions for you
1. **Reschedules and positions.** With a client and position set, two *live* rows for the same person and position hit the existing rule
   "keep only the first" (a database constraint allows one live tracker per person per position). On the real files that skips **210**
   later interview dates and keeps the earliest. Keeping the **latest** is probably what HR wants, but an existing test pins "first wins",
   so I left it. Say the word and it becomes a small change in `match.js` (with the earlier dates added to the tracker notes).
2. **Default client choice.** The page starts on our suggestion (marked as a guess) rather than "No client". To flip it, change `clientOptsFor` in `lib/dataImport.js` to default to `none`.
3. **Hiring location.** HDFC's tab names are regions and its "Location" column is the branch. Today that goes to the candidate's location. Not changed.

## Known gaps
1. Tab names are only a guess: a file whose tabs are regions (not clients) with no generic tab such as "Sheet2" will be suggested as "each tab is a client". The control makes it one click to change.
2. The "Recruiter" notice is correct but easy to miss: names are assigned only when they match a team member (none matched in the demo data).
3. A tab named after a person (a heading such as "Nidhi" above recruiter values) is still just an extra column.
4. Changing the client re-reads all files (same as every other control on the page).

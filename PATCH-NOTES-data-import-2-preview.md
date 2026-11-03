# Patch: data import, part 2 — matching and the staged preview

Part 1 read a spreadsheet. Part 2 compares it with what the team already has and stages a reviewable plan.
**Still nothing is written to candidates, clients, positions or trackers.** A live test asserts this (row counts identical before and after a preview).

## New endpoints (`/api/v1/data-import`, `candidates:write`)

| Call | Does |
|---|---|
| `POST /preview` (multipart: `file`, `teamId`, optional `defaultCountry`, `dateOrder`, `statusOverrides`, `mappingOverrides`) | Analyse + match + stage. Returns the batch: summary, matched entities, plan-limit headroom, first 25 rows. `previouslyImported` is set if this exact file was already imported. |
| `GET /batches/:id` | The batch again (summary, entities, limits). |
| `GET /batches/:id/rows?filter=&page=&limit=` | Rows with their plan. Filters: `all`, `issues`, `errors`, `blocked`, `skipped`, `existing`. |
| `PATCH /batches/:id/decisions` | HR's answers; the plan is re-matched from the stored rows. `null` clears an answer. |
| `DELETE /batches/:id` | Discard the batch and its rows. |

## What the plan decides

- **Clients:** exact name match (ignoring case, `Pvt Ltd`, `&`/`and`) is used. A near name ("Reliance" vs "Reliance Retail") is **only suggested**: it defaults to creating a new client and is marked `needsReview`, because a wrong merge sends mail to the wrong people while a duplicate client is only untidy. Only clients the team can use are considered (own, shared org-wide, or granted).
- **Locations:** matched by name or alias within the client; otherwise new.
- **Open positions:** an open or on-hold position with the same client, role and place is reused; cancelled/filled ones are never matched; ambiguous cases list their options.
- **Recruiters:** matched to active users by name or email; unmatched ones fall back to whoever imports.
- **Candidates:** found by phone, then email. One person across several rows is one candidate with several trackers. Default for an existing person is to reuse them. A candidate who exists in a team the importer cannot see is **skipped and not named**.
- **Trackers:** stage and status from the sheet, falling back to the nearest earlier stage if the team's pipeline lacks one (warned). An exact repeated row, a second live row for the same person and position, and a person already live for that position in the database are skipped, with the reason. `historic` marks lineups already in the past.
- **Permissions:** new clients/locations need `clients:write` for the team and new positions `open_positions:write`; otherwise those rows are `blocked` with a message (the demo HR role, which has clients read-only, hits this).
- **Plan limits:** reported (new candidates, new clients vs allowance) but not yet enforced.

## Schema (migration `0012_data_import.sql`)

`import_batch` (options, decisions, entities, summary, `expires_at`) and `import_row` (normalised record, issues, plan, status, result). Rows hold normalised values, not the original file. Batches expire after 7 days. Verified on Postgres 16: after applying the SQL, `drizzle-kit push` reports no differences for these tables.

## Files

New: `src/schema/24-data-import.ts`, `drizzle/migrations/0012_data_import.sql`, `src/features/data-import/match.js`, `data-import.schema.js`;
`test/dataImport.match.test.js` (19 tests), `test/dataImport.live.test.js` (12 tests, opt-in).
Changed: `src/schema/index.ts`, `drizzle/migrations/meta/_journal.json`, and the service, controller and routes under `src/features/data-import/`.

## Apply (PowerShell, repo root)

```powershell
Expand-Archive -Path .\jopup-data-import-2.zip -DestinationPath . -Force
cd backend
npm run db:migrate
npm test
```

The live suite (needs the demo seed): `$env:JOPUP_LIVE_TESTS=1; node --test test/dataImport.live.test.js`

Results here: all pure tests pass; live import tests 12/12. Running the whole suite with live tests on gives 324/325: the one failure is `performance.live` "plans without the module get a clear 403", which **fails identically without this patch**.

## Gaps and decisions — read these

- **Still not run on real HR sheets.** Matching rules are tested on synthetic data.
- **Journal numbering:** the repo has no `0010`; I followed the existing gap (`0009` → `0011` → `0012`).
- **Purge is not scheduled.** `purgeExpired()` exists and is tested; hooking it to the scheduler comes with the commit patch. Until then expired batches are refused (410) but remain in the table.
- **Access to a batch:** its creator, or an org-wide admin. A teammate in the same team gets 404.
- **Decisions accepted but acted on later:** `fill_empty` (update blanks on an existing candidate) and entity creation defaults (new clients: name only; new positions: 1 vacancy) are applied by the commit step.
- Historic lineups are only *flagged* here; suppressing their side effects (automation, "needs sending" mail list, KPIs) is part 3.

## Next: part 3 — the commit

Chunked, resumable, idempotent writes in the order clients → locations → positions → candidates → trackers with backfilled stage history; side effects suppressed for historic rows; limits enforced; `import` candidate source; dedicated `data_import` permission; undo; scheduled purge.

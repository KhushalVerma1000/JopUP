# Patch: data import, part 3 — the commit, and undo

Parts 1–2 read, matched and staged a sheet. Part 3 **writes it**: clients, hiring locations, open positions, candidates and trackers with their stage history. It can be undone.

## Endpoints (`/api/v1/data-import`, need `candidates:write` and `trackers:write`)

| Call | Does |
|---|---|
| `POST /batches/:id/commit` `{ skipBlocked, options: { alreadyMailed, useJobLocationForMail } }` | Checks, enforces plan limits, creates the clients / locations / positions the rows need (one transaction), and starts the import. Refuses with `BLOCKED_ROWS` unless `skipBlocked: true` when some rows cannot be imported. |
| `POST /batches/:id/commit/next` | Writes the next 200 rows (each row in its own savepoint). Call until `status` is `done`. Safe to repeat or resume after a crash; finished rows are never redone. |
| `POST /batches/:id/undo` | Within 14 days of finishing: removes what the import created and nobody has touched. |
| `GET /batches/:id` | Now includes `progress`, `result`, and (after undo) what was removed or kept. |

## How rows are written

- **Candidates:** new ones get `source = 'import'`, `source_ref = import:<batch>`. People who already exist are reused (checked again at write time, in case someone added them since the preview). One who exists in a team you cannot see fails that row only. Sheet extras use the field names the rest of the app reads (`experience`, `current_ctc`, `expected_ctc`, `notice_period`). A new candidate with no location of their own takes the job location, because that is what routes lineups to the client's hiring location in mail (option `useJobLocationForMail`, default on).
- **Trackers and history:** written the way live use would write them: one stage log per stage walked, each closed as "advanced", the last one open (or blocked / withdrawn / held for those endings). Stages are dated from the sheet (lineup date, interview date, joining date), in the organisation's timezone, never in the future. Tracker `created_at` is the first stage's date, so time-to-place and "stage entered" numbers land in the right period. Rejections keep the sheet's own words as the reason. A "placed" row in a pipeline with no final stage is downgraded to active and reported.
- **Silent:** no events, no automation rules, no mail, no credits. Past lineups never reach the "needs sending" list (it only looks from today). For lineups **today or later** that HR already mailed, `alreadyMailed: true` logs them as sent so they are not offered again.
- **Plan limits:** new candidates and new clients are checked up front; a batch that does not fit is refused whole with `PLAN_LIMIT` and the headroom, and the batch stays reviewable.
- **Failures:** a row that fails is marked `failed` with the reason and the rest continue.

## Undo

Removes mail logs, trackers, candidates, positions, locations and clients the import created, **only if untouched since**: a tracker that was advanced, edited or had an action logged is kept (and so is its candidate); a created client with positions, contacts or mail added later is kept. Fields filled on existing candidates are restored if still as the import left them. The response lists what was kept.

## Housekeeping

- Migration `0013_data_import_commit.sql`: `candidate_source` gains `import`; `import_batch` gains `commit_options`, `ledger`, `result`, `started_at`, `finished_at`, `undone_at`. Needs PostgreSQL 12+.
- Hourly purge of expired batches (`data-import.scheduler.js`, started in `server.js`; off with `DATA_IMPORT_SCHEDULER=off`). A batch expires 7 days after preview, 3 days after starting, and 15 days after finishing (the undo window plus a day).
- `scripts/apply-sql.js`: applies a single migration file in a transaction when drizzle's runner cannot.
- Matching now only considers the destination team's **open** positions (the same rule the tracker service enforces when tagging).

## Apply

```powershell
Expand-Archive -Path .\JopUP-full-project.zip -DestinationPath D:\codzen\jopup-full -Force
cd D:\codzen\jopup-full\JopUP\backend
copy "D:\codzen\job project\backend\.env" .env
npm install
npm run db:migrate
```

**Check the migration really ran** (drizzle skips any migration dated earlier than the last one applied, and your `0012` was dated when you ran it). In psql, or via `node -e` with your DATABASE_URL:

```sql
select 1 from information_schema.columns where table_name='import_batch' and column_name='ledger';
```

No row means 0013 was skipped. Run `node scripts/apply-sql.js drizzle/migrations/0013_data_import_commit.sql`.

Then `npm test`. Live suites: `$env:JOPUP_LIVE_TESTS=1; node --test test/dataImport.commit.live.test.js`.

## Results here

75 import tests pass: pure matching and stage-history tests, plus 22 live tests on a real Postgres 16 (preview, chunked commit and resume, history and dates, silence of events, mail marking, undo, undo keeping touched work, row failures, permissions, plan limits). The whole suite with live tests on: all pass except `performance.live` "plans without the module get a clear 403", which fails identically without any import patch.

## Gaps and decisions — read these

- **Still not run on real HR sheets.** Everything is tested on synthetic files.
- **No frontend yet** (part 4). All of this is API-only; try it with the endpoints above.
- **No dedicated `data_import` permission.** Commit uses `candidates:write` + `trackers:write` for the team, and new clients/positions still need `clients:write` / `open_positions:write`. This avoided a seed/permission-model change; say if you want a separate permission.
- **Stale active rows:** imported trackers still "active" with old lineup dates will appear under "Stuck candidates" after 5 days, which is arguably true. A "close stale rows" choice is not built.
- **New clients are created with name only;** new positions with 1 vacancy. Contacts, emails and vacancy counts are for HR to fill in afterwards.
- `fill_empty` fills only email, location and phone on an existing candidate.
- Candidate shared via `candidate_team_access` only: at write time a match in another team is treated as not visible.
- Resumes are not linked to imported candidates yet (planned, part 5).

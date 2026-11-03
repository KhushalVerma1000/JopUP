# Patch: data import, part 1 — the analyser

First of the import patches (plan: upload → analyse → map → preview → import → undo).
This one only **reads and understands** a spreadsheet. It saves nothing and changes no existing behaviour.

## What it does

`POST /api/v1/data-import/analyse` — multipart, field `file` (.xlsx, .xlsm, .csv, .tsv; max 10 MB).
Optional fields: `defaultCountry` (else the org's), `dateOrder` (`dmy`|`mdy`), `statusOverrides` (JSON), `mappingOverrides` (JSON).

Returns, per sheet: what kind of sheet it is (`lineup` | `candidates` | `unknown`), which row is the heading,
every column with the field it was matched to and a confidence (`auto` ≥ 0.8, `review`, or `extra`),
the date order it settled on, a summary (people, trackers, clients, positions, stage counts, unknown status words),
and the first 25 rows already normalised, with their issues.

What it understands:
- Title rows above the heading; blank rows, repeated headings and "Total" rows are dropped.
- ~25 fields by heading synonym **and** by checking the values (a "Contact" column of names is not trusted as a phone; unlabeled phone/email/date/status columns are found from values).
- Dates: Excel dates, serial numbers, `12 Oct 2026`, `12-Oct-26`, `13/10/2026`. Day-first assumed, switched when any value proves otherwise, and flagged when it is only an assumption. A tab named like a date supplies the lineup date for one-tab-per-day files.
- Phones: numbers, floats, `98765 43210 / 91234 56789`, `+971…` (own country). Names: `MR. RAHUL KUMAR SHARMA`. Experience: `5y 8m`.
- Free-text status → stage + tracker status (`Reached`→Turn up, `Not selected`→rejected, `No show`→rejected at Line-up, `Joined`→placed…). Negatives are checked before positives. Unknown words are listed with counts so HR can answer once.
- The same person on several rows (several clients) is **one candidate, several lineups**, not an error. An exact repeat (same person, client, position, date) is a warning.
- A row with a client/date/status but no candidate is kept and flagged, not silently dropped. Unrecognised columns are kept as extra fields.

## Files

New, `backend/src/features/data-import/`: `normalize.js`, `headers.js`, `statusMap.js`, `analyse.js`, `reader.js`,
`data-import.service.js`, `data-import.controller.js`, `data-import.routes.js`.
New test: `backend/test/dataImport.test.js` (25 tests, includes the HTTP layer).
Changed: `backend/src/app.js` (route registered), `backend/package.json` + lockfile (adds `exceljs`, `csv-parse`).

## Apply (PowerShell, from the repo root)

```powershell
Expand-Archive -Path .\jopup-data-import-1.zip -DestinationPath . -Force
cd backend
npm install
npm test
```

Try it (needs a login token):

```powershell
curl.exe -X POST "http://localhost:3000/api/v1/data-import/analyse" -H "Authorization: Bearer <token>" -F "file=@C:\path\to\lineups.xlsx"
```

Result here: 275 passing, 0 failing (19 pre-existing skips) with a dummy `DATABASE_URL`.

## Decisions and gaps — read these

- **Not yet tested on real HR sheets.** Rules and tests come from typical layouts, not from your files. Part 1's real exam is the sample sheets; expect the synonym and status lists to grow after that.
- **No schema yet.** The `import_batch` / `import_row` / `import_profile` tables arrive with the preview step (part 2), once real sheets have shown what needs storing. This avoids a migration we may need to change.
- **Permission:** reuses `candidates:write` and the `candidate_db` module. A dedicated `data_import` permission is added with the commit step; no seed change needed now.
- **Legacy `.xls` is refused** with a message to re-save as .xlsx. Hidden tabs are skipped. Limits: 10 000 rows, 30 sheets, 60 columns.
- **Phone validity** follows libphonenumber like the rest of the app, so some short landline-length numbers count as valid.
- Dates stay date-only (`2026-10-13`); the org timezone is applied when rows are committed.
- Not in this patch: client / position / location matching against existing records, duplicate checks against existing candidates, anything that writes data.

## Next: part 2

Entity matching (clients, hiring locations via aliases, open positions, recruiters), duplicate checks against existing candidates (phone first, ADR-2), the staged dry-run preview and its schema.

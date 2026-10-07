# Patch: automatic KPIs, goals and strategy

Built on GitHub `main` (b64907e). KPIs, goals and strategy key results now measure themselves from the pipeline.
Managers set targets and direction; the numbers fill in. Only things the pipeline can't see stay manual.

## Apply (PowerShell, from the repo root)
```powershell
Expand-Archive -Force .\jopup-auto-metrics.zip .
cd backend
node scripts/register-auto-metrics-migration.js   # registers the migration with your next free number
npm run db:migrate
```
Then add ONE line to `backend/package.json` under `scripts` (next to `provision:owner`):
```json
"rollout:auto-metrics": "node scripts/rollout-auto-metrics.js"
```
Roll existing test data onto the catalogue (dry run first, then apply):
```powershell
npm run rollout:auto-metrics              # prints what it would change
npm run rollout:auto-metrics -- --apply   # does it
```
Fresh demo data already uses the new model: `npm run db:seed:demo -- --reset`.

`server.js` now starts the hourly sync; turn it off with `PERFORMANCE_SCHEDULER=off`.

## How it works
- **Metric catalogue** (`metrics.catalogue.js`): 16 metrics defined once. Placement date = first entry to a final-success stage; owner = `assigned_hr`; calls/activities belong to who logged them.
- **KPIs**: `source` auto/manual. Auto KPIs get one reading per period, rebuilt hourly and on read; a closed period is locked. A person can override with a reason (system value kept beside it) and revert.
- **Goals**: a metric goal has metric, target, start and due date; progress and completion are computed. Counts complete themselves at target; the window freezes after the due date.
- **Strategy**: key results are `metric`, `kpi`, `goal` or `manual`. Status is paced against elapsed time for counts and judged against target for rates. Finished strategies freeze; a retrospective can still be added.
- **Stays manual**: targets, objective wording, KPIs/key results with no data source, reviews, overrides (always with a reason).

## API additions
`GET /performance/metrics` · `POST /performance/sync` · `POST /performance/kpis/:id/recompute` · `DELETE /performance/kpi-entries/:id/override`.
`POST /performance/kpis` accepts just `{ teamId, metricKey, targetValue }`. Goals accept `metricKey/targetValue/startDate`. Strategies accept `startDate/endDate` and typed key results.

## Notes
- Periods like "Q4 2026", "H2 2026", "Oct 2026", "2026" are read automatically; "FY2026" asks for dates (it means different things in different countries).
- Snapshot metrics (stuck candidates, vacancies, fill rate) can't be rebuilt for the past, so they start from when the KPI is created.
- Migration is additive and idempotent. Tests: 33 unit + 19 live (`JOPUP_LIVE_TESTS=1`), all passing.

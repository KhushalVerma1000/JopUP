# Patch: Analytics and Performance (backend first, then pages)

Read `DESIGN-analytics-performance.md` for the reasoning, contracts and trade-offs.

## Backend
| File | Change |
|---|---|
| `src/features/analytics/*` | NEW. `GET /api/v1/analytics/pipeline` (funnel from stage history, win rate, time to place, recruiters, positions to fill, clients) |
| `src/features/performance/performance.math.js` | NEW. Pure rules: KPI health, trend, overdue, dates. Unit tested |
| `src/features/performance/performance.service.js` | REWRITTEN. Team scoping, org-checked lookups, viewer-shaped reviews, one-query KPI board, one reading per period |
| `src/features/performance/performance.{routes,controller,schema}.js` | REWRITTEN. Per-area plan modules, acknowledge and goal-progress routes, `GET /overview`, stricter validation, plain `YYYY-MM-DD` dates |
| `src/utils/teamScope.js` | ADDED `teamsWithPermission`, `canActOnTeam` |
| `src/app.js` | mounts `/api/v1/analytics` |
| `src/seed.ts` | `org_admin` gets `performance_reviews` and `goals` (was 403 on both) |
| `src/seed-demo.ts` | demo data: stage history for every tracker, closed placements and a rejection, KPIs with 6 months of readings, goals (one overdue), reviews, a strategy. Performance data goes to the Pro and Enterprise demo orgs only |
| `test/performance.test.js` | NEW. 26 tests, no database needed |
| `test/performance.live.test.js` | NEW. 9 tests against a seeded database. Skipped unless `JOPUP_LIVE_TESTS=1` |

No database migration. No new dependencies.

## Behaviour changes to know about
- Performance routes now return **404** for rows outside the caller's organisation or teams (before: they worked or leaked).
- `POST /performance/kpi-entries` no longer needs `teamId` (taken from the KPI). It replaces an existing reading for the same period and returns `replaced: true`.
- `PATCH /performance/reviews/:id` can only set `status: "submitted"`. Acknowledging is `POST /performance/reviews/:id/acknowledge`, by the person reviewed.
- `GET /performance/reviews` for non-managers returns only their own submitted reviews, without private notes.
- Reviews now need the `performance_reviews` module and strategies the `strategy_planner` module (both in Pro and Enterprise). Before, everything was gated by `kpi_engine`.
- Review responses use `revieweeName`, goal responses use `assignedToName`, KPI responses include `health`, `latest`, `recent`.

## Frontend
New: `/analytics`, `/performance` (KPIs, Goals, Reviews, Strategy tabs), `components/performance/*`, `components/charts.jsx`, `lib/kpi.js`. Changed: `App.jsx` (routes), `AppLayout.jsx` (sidebar entries; header icons on phones). The pages show what the API returns and calculate nothing themselves.

## Apply
1. Copy the files in (paths above).
2. `npm run db:seed` (permission changes apply with the existing upsert), then sign out and in again so your token carries them.
3. Optional demo data: `npm run db:seed:demo -- --reset`.
4. `npm test` (unit). For the database-backed checks: `JOPUP_LIVE_TESTS=1 node --test test/performance.live.test.js`.

## Verified here
- Unit tests: 26/26 for the new file; full backend suite run, result in the hand-off message.
- Live tests: 9/9 against Postgres 16 with the demo seed (team isolation, review privacy, acknowledge, goal progress, funnel, scoping).
- Frontend: lint 0 errors, production build passes. Not clicked through in a browser.

## Known limits
- The funnel counts a candidate in a stage only if they have a log row for it, so a skipped stage reads a little low.
- Duplicate-reading protection is application-level (see design section 7).
- `analytics` plan module is not required yet; pipeline analytics ride on `pipeline_tracker`.

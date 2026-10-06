# Design: Analytics and Performance API

Status: implemented in this patch. Scope: `backend/src/features/performance`, new `backend/src/features/analytics`, and the two frontend pages that consume them.

## 1. Requirements

**Functional**
- Managers set KPIs per team, record a reading each period, and see health and trend. HR can see the KPIs for their team.
- Managers set goals (team or individual). A person can report progress on their own goal.
- Managers write reviews (draft, then submit). The person reviewed can read it once submitted and acknowledge it. Private notes stay private.
- Managers define strategy (objectives and key results) and see progress.
- Anyone who works pipelines can see conversion, time in stage, recruiter load, positions to fill and placements by client.

**Non-functional**
- Tenant isolation (organisation) and team isolation (inside an organisation) hold on the server, not just in the UI.
- A dashboard load costs a fixed, small number of requests regardless of how many KPIs or candidates there are.
- Same input, same colour: what "on target" means is defined once.
- Stack unchanged: Express 4, Drizzle on Postgres, Zod, JWT carrying `roles[{teamId, roleName, permissions}]`.

## 2. What was wrong before

| Problem | Effect | Fix |
|---|---|---|
| No team scoping on any performance route | A manager or HR user could read or write other teams' KPIs, goals, reviews, strategy | `visibleTeamIds` for reads, `teamsWithPermission` for writes, applied in the service |
| KPI entries had no org or team check | Cross-tenant read/write by KPI id | Every id lookup is `id AND organisation_id`, then team reach; misses are 404 so ids can't be probed |
| `GET /reviews` returned everything to anyone with `read` | HR saw every review and the private notes | Server shapes the response per viewer (section 4.3) |
| Reviewee could not acknowledge | Acknowledge needed `write`, which HR lacks | `POST /reviews/:id/acknowledge`, allowed only for the reviewee |
| Zod allowed `acknowledged` through the edit route and edits after submit | Reviews could be rewritten after the fact | Edit route accepts only `submitted`; submitted reviews return 409 on edit |
| Dates required a full ISO datetime | Date pickers failed validation | Accepts `YYYY-MM-DD` or ISO; stored as `date` |
| N+1: one request per KPI card for its trend | Slow boards | One window-function query returns each KPI's last 8 points |
| Duplicate readings for one period | Skewed trends | One reading per KPI per period; re-recording replaces it |
| Health, overdue and trend computed in the browser | Different clients disagree | Computed once in `performance.math.js` and returned |
| `is_active` stored as text `'true'/'false'` | Boolean writes stored wrongly | Service maps both ways; API speaks booleans |
| Strategy `objectives` was free-form JSON | Malformed OKRs broke the UI | Validated shape |
| All performance routes gated by `kpi_engine` | Reviews and strategy ignored their own plan modules | Each area gated by its own module |
| No analytics endpoint | Browser downloaded every tracker to count them; funnel was "currently at or beyond" | `GET /analytics/pipeline`, SQL aggregates over stage history |

## 3. High-level design

```
 React pages ──────────────►  Express routes
 /analytics    ─ 2 calls ─►   requireAuth → requireModule(x) → requirePermission(entity, action) → validate(zod)
 /performance  ─ 1 per tab ►        │
                                    ▼
                            controller  (team-write check on the body's teamId)
                                    │
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
          performance.service              analytics.service
          (scope + shaping per viewer)     (SQL aggregates, one query per section, run in parallel)
                    │                                │
                    └────────── Postgres ◄───────────┘
                          pure rules: performance.math.js
```

Layers: the **route** decides whether the plan and role may touch this area at all. The **service** decides which rows. A permission key can't say "manager of team A, HR in team B", so team reach is computed from the JWT roles.

## 4. API contracts

All responses are `{ status: 'success', data }`. Errors use the existing `{status:'error', message}` shape.

### 4.1 Performance (`/api/v1/performance`)

| Method and path | Needs | Notes |
|---|---|---|
| `GET /overview` | `kpi:read`, module `kpi_engine` | Per-team scorecard: KPI health counts, goal mix, review queue |
| `GET /kpis?teamId&includeInactive` | `kpi:read` | Each KPI includes `teamName`, `latest`, `recent[8]`, `health{tone,label}`, `changePct`, `improving` |
| `POST /kpis` · `PATCH /kpis/:id` | `kpi:write` | A KPI cannot change teams. `isActive` is a boolean |
| `GET /kpis/:id/entries?limit` | `kpi:read` | Oldest first, ready to plot |
| `POST /kpi-entries` | `kpi:write` | `{kpiId, value, periodDate?, periodLabel?, notes?}`. 201 on new, 200 with `replaced: true` when the period already had a value |
| `GET /reviews?teamId&revieweeId&status` | `performance_reviews:read`, module `performance_reviews` | Managers: their teams, all statuses. Others: only their own, only submitted or acknowledged, no `managerNotes`. Each row has `revieweeName`, `averageScore`, `isMine`, `canEdit`, `canAcknowledge` |
| `POST /reviews` · `PATCH /reviews/:id` | `performance_reviews:write` | Reviewee must be an active member of the team and not the author. One review per person per cycle (409). Only drafts are editable. Submitting needs a score or a summary |
| `POST /reviews/:id/acknowledge` | `performance_reviews:read` + must be the reviewee | Idempotent |
| `GET /goals?teamId&assignedTo&status` | `goals:read`, module `kpi_engine` | Adds `effectiveStatus` (derived overdue), `daysLeft`, `assignedToName`, `isMine` |
| `POST /goals` · `PATCH /goals/:id` | `goals:write` | Assignee must be on the team. `dueDate: null` clears it |
| `PATCH /goals/:id/progress` | `goals:read` + must be the assignee | `{progressPct, complete?}` |
| `GET/POST/PATCH /strategies` | `strategy:*`, module `strategy_planner` | `progressPct` is the mean of key-result progress |

### 4.2 Analytics (`GET /api/v1/analytics/pipeline`)

Needs `trackers:read` and module `pipeline_tracker`. Query: `teamId?`, `days` (1–3650 or `all`, default 90), `stuckAfterDays` (default 5). Scope is organisation ∩ the caller's teams ∩ `teamId`; asking for a team you aren't in is 403.

Returns `summary` (active, onHold, placed, rejected, closed, winRatePct, stuck, avgDaysInCurrentStage, avgDaysToPlace, unassignedActive), `funnel[]` (stageKey, name, reached, conversionFromPrevious, avgDaysInStage), `recruiters[]`, `positions` (openCount, vacancies, filled, fillRatePct, needingAttention[10]) and `clients[]`.

### 4.3 Who sees a review

```
 caller holds performance_reviews:write for the review's team?
   yes → full row, any status (managerNotes included)
   no  → only if revieweeId = caller AND status ≠ draft, with managerNotes removed
```

## 5. Data model and queries

No schema change and no migration. Existing indexes cover the access paths.

- **Funnel** counts `DISTINCT tracker_id` per `stage_key` from `candidate_tracker_stage_log`, which is append-only, so it includes candidates later rejected or placed. Grouping by `stage_key` rolls up teams that use different workflow templates. Trade-off: a candidate who skips a stage doesn't count there, so a step's conversion can read slightly low.
- **Average time in stage** is `exited_at − entered_at`, with `now()` for the open stage.
- **Filled vacancies** are derived by counting `status = 'placed'` per position and capped at `vacancies` (the "derive, don't cache" rule already used by open-positions).
- **KPI trend** uses `row_number() OVER (PARTITION BY kpi_id ORDER BY period_date DESC)`: one query for N KPIs.
- **One reading per period** is enforced in a transaction with `pg_advisory_xact_lock(hashtext(kpi:date))`.

## 6. Scale and reliability

- Cost per analytics call: 8 aggregate queries in parallel, each a scan of one organisation's trackers (or their stage logs), bounded by the period filter. Fine into the hundreds of thousands of trackers per org.
- Cost per KPI board: 3 queries regardless of KPI count.
- Failure modes: a failed section fails the whole call (clear error, retry). The scorecard on the Analytics page is fetched separately so a plan without KPIs doesn't break pipeline analytics.
- Observability: every write goes through `auditWrite`; acknowledge and submit have their own action names.

## 7. Trade-offs

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Where health and overdue are computed | Server, returned in the payload | Client | One source of truth; costs a few bytes per KPI |
| Unique reading per period | Transaction + advisory lock | Unique index | A unique index needs a migration and may fail on existing duplicates. Revisit once data is clean |
| Analytics as live SQL | Live queries | Materialised rollups | Simplest to ship and always fresh. Rollups only when a single org's volume makes p95 painful |
| 404 for rows outside your team | 404 | 403 | Doesn't confirm that an id exists |
| Goal progress by assignee | Separate `/progress` route | Give HR `goals:write` | Keeps edit rights narrow; the person can still report their own work |
| Review visibility | Computed per request | A seeded permission per case | One rule, tested |
| One `analytics` endpoint per dashboard | Single payload | A route per widget | One round trip; split later if widgets need different freshness |

## 8. Revisit as it grows

1. Cache `/analytics/pipeline` for 60 s per (org, team, period) once an org passes ~50k trackers, or add a nightly rollup table.
2. Add a unique index on `(kpi_id, period_date)` once existing duplicates are cleaned up.
3. Per-recruiter drill-down (candidate lists behind each number) and CSV export, which is what the `analytics` plan module is for.
4. Move team-reach logic from the service into a shared query helper if more features need it.
5. Notifications when a review is submitted or a goal goes overdue (the `event_log` hook exists).

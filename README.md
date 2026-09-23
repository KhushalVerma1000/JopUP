# JopUP Beta Testing Kit

This was tested for real: Postgres installed, migrated, seeded, server run, and the
full `jopup-e2e-test.sh` suite executed end to end. Current state: **87/87 e2e
checks pass, 52/52 unit tests pass, against a live database.** Every fix below was
found this way, not by inspection.

## Files

1. **`jopup-final-files.zip`** — the complete, final content of every changed/added
   backend file, in a folder structure that mirrors the repo exactly (e.g.
   `backend/src/app.js`, `backend/src/features/users/users.controller.js`, ...).
   Extract it and copy/overwrite those files straight into your checkout — this
   works regardless of what git state your local copy is in, since it's not a diff.
2. **`jopup-frontend.zip`** — the React + Vite frontend. Extract as a `frontend/`
   folder next to `backend/`. See its own `README.md` inside for setup.
3. **`jopup-e2e-test.sh`** — the automated, segmented test script. No copy-pasting:
   each segment extracts what the next one needs and stashes it in a state file.
4. **`JopUP-Postman-Collection.json`** + **`JopUP-Postman-Environment.json`** — the
   same requests, for manual/exploratory testing in Postman (free tier).
5. **`docker-compose.yml`** + **`Dockerfile`** + **`backend.dockerignore`** — the
   containerized dev setup (Postgres + backend together).

## Apply (Windows / PowerShell)

A git patch turned out to be the wrong delivery format here — it failed to apply
because the local checkout already had some earlier changes from this same
conversation, so the patch's surrounding context no longer matched. Rather than
chase git state, the zip just replaces the files outright:

```powershell
cd "D:\codzen\job project"
Expand-Archive -Path jopup-final-files.zip -DestinationPath . -Force
cd backend
npm install
npm run db:migrate      # includes a new migration — see finding #7 below
npm run db:seed
npm run provision:owner -- --email=you@example.com --password=... --firstName=... --lastName=...
npm test                 # 50/50
npm start
```

`-Force` overwrites existing files at those paths — that's expected and correct
here, since the zip's whole purpose is to be the final version of each file.

## Apply (macOS / Linux)

```bash
cd JopUP
unzip -o jopup-final-files.zip -d .
cd backend
npm install
npm run db:migrate      # includes a new migration — see finding #7 below
npm run db:seed
npm run provision:owner -- --email=you@example.com --password=... --firstName=... --lastName=...
npm test                 # 50/50
npm start
```

Then, in another terminal:
```bash
PLATFORM_OWNER_EMAIL=you@example.com PLATFORM_OWNER_PASSWORD=... ./jopup-e2e-test.sh
```

## What was actually broken (found by running the tests, not reading the code)

**#1 — `requireModule` crashed with a 500 on every single call.** This middleware
gates nearly every feature route (clients, candidates, workflows, performance). It
used `db.query.organisation.findFirst({ with: { plan: true } })` — Drizzle's
relational query API — which throws `Cannot read properties of undefined (reading
'referencedTable')` on this schema. Root cause: **zero `relations()` are declared
anywhere in this codebase**, and this is a known drizzle-orm failure mode for
tables with many inbound foreign keys when relations are auto-inferred from FKs
instead of declared explicitly. `organisation` is referenced by a dozen+ tables.
Fixed with a plain `db.select()` + a second query for `plan` — same pattern
already used successfully elsewhere in the same file.

**#2 — Same root cause, 3 more confirmed call sites:** `organization.service.js`
(`getOrganizationById`, `getOrgModules`), `clients.service.js` (`getClientById`),
`workflow.service.js` (`getTemplateById`). Fixed the same way.

**#3 — Zod `.default()` silently survives `.partial()`.** This is a well-known Zod
gotcha: `.partial()` makes a field *optional*, but an inner `.default()` still
fires when the field is absent — it doesn't just get skipped. Found in two places:
- `plans.schema.js`: `modules: z.array(z.string()).default([])`, reused via
  `.partial()` in `updatePlanSchema`. **Any PATCH to a plan that didn't mention
  `modules` silently wiped it to `[]`** — which is what caused every module-gated
  route to fail even after fix #1, until the corrupted plan data was restored.
- `clients.schema.js`: same pattern with `sharedOrgWide: z.boolean().default(false)`
  in `updateClientSchema`. **Any PATCH to a client omitting `sharedOrgWide` silently
  reset it to `false`** — a team that should see a shared client could silently
  lose access on the next unrelated edit (e.g. someone just updating `notes`).

Both fixed by removing the Zod-level default — the DB columns already have correct
defaults (`plan.modules` defaults to `'[]'::jsonb`, `client.shared_org_wide`
defaults to `false`), so create-time behavior is unaffected.

**#4 — `GET /:templateId/stages` always 400'd.** It was wired to `stageParamsSchema`,
which requires *both* `templateId` and `stageId` — but this route only has
`:templateId`. Added a dedicated `listStagesParamsSchema` and pointed the route at it.

**#5 — `POST /api/v1/performance/kpi-entries` always 500'd.** `kpi_entry.period_date`
is `NOT NULL` with no database default, but `createKpiEntrySchema` marks it
`.optional()`. Fixed by defaulting to today's date in the service layer — this
actually delivers what the schema already promised callers.

**#6 — The `validate` middleware itself had a systemic bug.** It unconditionally
did `req.body = result.data.body` (and the same for `query`/`params`) — even for a
schema that never declared a `body` key at all. That's harmless when the schema is
a route's own terminal validator, but `job-portal.routes.js` uses a **params-only**
schema (`getPortalOrgParamsSchema`) as a `router.use('/:orgSlug', ...)`
pre-middleware ahead of every route in that subtree — so it was **silently wiping
`req.body` to `undefined` for every request under `/:orgSlug/*`**, including
`POST /:orgSlug/apply`, before that route's own validator ever saw the real body.
Fixed at the root: `validate` now only reassigns a key if the schema actually
declared it. This is a no-op for the common case (schemas that declare all three
keys) and fixes the bug wherever else this pattern might exist, not just here.

**#7 — `candidate.created_by` was `NOT NULL` with no way to satisfy it from the
public job-application flow.** The guest/anonymous "apply to a job" endpoint
(`job-portal.service.js`) creates a candidate record with no authenticated staff
user behind it — there's no one to attribute it to. Every other `created_by` column
in the schema is correctly `NOT NULL` (always created by staff); `candidate` is the
one legitimate exception. **This required an actual schema change + migration**
(included: `0004_candidate_created_by_nullable.sql`), matching `candidate.updated_by`,
which was already nullable for the same reason.

**#8 (confirmed, not fixed — a product decision) — Credits `top-up`/`adjust` can
never target a real customer org.** Both operate on `req.tenantId` (the *caller's*
own org), and `topUpSchema` has no `organisationId` field at all. Only
`platform_admin`/`platform_owner` hold the permission to call these, but their own
tenant is the internal `jopup-platform` org — not a billable customer, and it has
no credit account row. As built today, **there is no way to top up any customer
org's credits through this API.** Whether `top-up`/`adjust` should accept a target
org id is a product call, not something I patched.

## Round 2 — public org/team discovery for the frontend (no more raw UUIDs)

The frontend's registration form used to require pasting in raw `organisationId`
and `teamId` UUIDs by hand — a real, flagged rough edge from the first frontend
pass. Fixed with two new **public** (no auth) endpoints:

- `GET /api/v1/organizations/by-slug/:slug` → `{id, name, slug}` only.
- `GET /api/v1/organizations/by-slug/:slug/teams` → `[{id, name}]` only.

Both deliberately expose nothing beyond what's needed for a login/signup screen —
no plan, domain, status, or other org internals. A nonexistent or
suspended/cancelled org's slug 404s the same way a real one would if hidden,
so this can't be used to enumerate tenants.

**Two real bugs found while building this** (same "test it for real" standard as
round 1):
- The global `tenant` middleware (`middlewares/tenant.js`, runs before all
  routing) has its own separate allowlist of public paths — a route having no
  `requireAuth` isn't sufficient on its own. The new routes weren't on that
  allowlist and 401'd until added.
- `getPublicOrgBySlug` initially filtered to `status = 'active'` only — but a
  freshly signed-up org's default status is `'trialing'` (confirmed against the
  actual DB enum: `trialing | active | suspended | cancelled`), so it 404'd on
  every brand-new org, which is exactly the case this needed to work for. Fixed
  to allow both `trialing` and `active`.

Verified against real data (a live org + 2 teams from the e2e suite), plus a
nonexistent-slug case. Full suites re-run clean after: 52/52 unit, 87/87 e2e.

The frontend's `LoginPage`/`RegisterPage` were reworked to match: the org slug
now lives in the URL (`/login/:orgSlug`, `/register/:orgSlug`) instead of a typed
form field, resolved via the new endpoints into a display name; registration's
team field is a real dropdown of team names. See `frontend/README.md` for detail.

## Round 3 — Tailwind + shadcn/ui, and the Employees workbench

The frontend now runs on Tailwind v4 + a shadcn/ui component set
(`Button`/`Input`/`Label`/`Card`/`Badge`/`Table`, plus a plain `<select>` in
place of Radix's heavier `Select`). The `shadcn` CLI needs `ui.shadcn.com`,
which wasn't reachable in this pass — so those components were hand-written
using the same canonical patterns rather than generated. `components.json` is
still correctly configured, so the real CLI will recognize this as an
initialized project if run later from a machine with normal internet access.

The **Employees workbench** is built and working: staff directory with a team
filter, pending-approvals with Approve/Reject, and org_admin status toggling
(suspend/reactivate).

**One real backend gap found and fixed while building it:** the
pending-approvals list never exposed what role/team someone actually
requested — `requestedRoleId`/`requestedTeamId` existed as raw DB columns but
weren't even in the API response, so an approver had no way to see what they
were approving. Fixed by resolving both to `requestedRoleName`/
`requestedTeamName` server-side in `auth.service.js`'s `listPendingApprovals`,
the same "no raw UUIDs surfaced" principle as round 2. Verified against a live
registration + approval-list call. Full unit suite: 52/52 still passing.

## Also flagged, not fixed (out of scope for this pass)

- **~15 other `db.query.*.findFirst()` call sites** across
  candidates/job-postings/applications/invitations/etc. are unverified and carry
  the same latent risk as #1/#2. The permanent fix is declaring explicit
  `relations()` for the schema instead of relying on Drizzle's FK-based
  auto-inference — a real but separate piece of work.
- **Leaked live Supabase credential in `.env.example`** — rotate independently of
  all of the above.
- **`POST/PATCH /api/v1/plans` has no `requireAuth` at all** — anyone can create or
  edit subscription plans today.
- **Duplicate job-portal implementations**: `job-portal/portal.routes.js`
  (job-seeker accounts) is dead code — never mounted in `app.js`. Only
  `job-portal.routes.js` (guest apply) is live. Worth deleting the other.
- **`test/app.test.js`'s `orgAdminAuth(...)` helper ignores its argument** — the
  tenant-scoping test passes different `organisationId` values to it expecting two
  different orgs, but both calls actually authenticate as the same one. Left as-is;
  flagging rather than fixing to keep the test changes in this patch scoped to the
  actual regression (see the note left in `app.test.js`).
- No email provider is wired up — invitation tokens come back raw in the API
  response. Fine for internal testing; the UI should surface the token directly.
- **`updateOrganizationSchema` accepts `status: 'trial'`, but the DB enum only has
  `'trialing'`** — a PATCH attempting `{status: 'trial'}` would fail with a raw
  Postgres enum error (500), not a clean validation error. Found incidentally while
  fixing the item above; not touched since it's unrelated to this pass's scope.

## Round 4 — Clients and Managerial workbenches

Both are built and verified against live data (org settings updated and confirmed
persisted, teams listed, a client created and confirmed in the list, invitations
listed with names resolved).

**Clients workbench** (`/clients`): directory table with a team filter, create
form, inline status changes, share-with-another-team, delete. Actions are gated to
match the backend's actual permissions exactly (checked directly in `seed.ts`
rather than assumed): org_admin and manager hold `clients:write/delete`, only
org_admin holds `clients:share`, hr is read-only.

**Managerial workbench** (`/managerial`): three tabs — Org settings (view for
anyone with access to the page, edit for org_admin only), Teams (create/archive/
delete, org_admin only; anyone can view), and Invitations (org_admin only end to
end; the tab shows a plain "you don't have permission" message for a manager
rather than erroring, consistent with the pending-approvals pattern in Employees).

**One more real backend gap found and fixed, same class as before:**
`invitations.service.js`'s `list()` returned raw `roleId`/`teamId` UUIDs with zero
name resolution — the exact same issue as the pending-approvals list from round 3.
Fixed the same way: resolved to `roleName`/`teamName` server-side. Verified against
live data (see above). Unit suite: 52/52 still passing.

**One real frontend bug caught and fixed before shipping:** `ClientsPage`'s
share-row expansion used a shorthand `<>` fragment inside a `.map()`, which can't
carry a `key` — a genuine React correctness issue even though the linter didn't
flag it. Fixed with an explicit `<Fragment key={...}>`.

## Round 5 — HR workbench: Candidates, Job Postings, and the pipeline Tracker

Built and verified against live data end to end: created a candidate, fetched a
workflow template's stages, created an application, confirmed it appears in the
tracker enriched, advanced it a stage, confirmed the list reflects the new stage.

**The central gap for this round, found and fixed:** `applications.service.js`'s
`getAllApplications` (the list endpoint) returned bare `application` rows — raw
`candidateId`/`jobPostingId` UUIDs, and critically, **no current-stage information
at all**. A pipeline tracker is not functional without knowing which stage each
card belongs in, and the only way to get that was `getById` per application (an
N+1 pattern for a list view). Fixed with a proper batch enrichment
(`_enrichApplications`): one query for all current stage logs
(`exitedAt IS NULL`), one for the stages they reference, one for candidate names,
one for job posting titles — a handful of queries total regardless of list size,
not N+1. Verified live: an existing test application correctly showed
`currentStage: null` (it has no active stage log from earlier test data) — the
enrichment handles that edge case correctly rather than crashing or guessing.

**Frontend permission gating checked directly against `seed.ts`, not assumed:**
hr lacks `job_postings:close` (so the Close button is hidden for hr, shown for
org_admin/manager); candidate/job-posting delete is org_admin only; advance/hold/
block on applications are available to all three roles.

**Deliberately deferred, flagged rather than built:** full workflow *template*
management (creating pipelines/stages) has no dedicated UI yet — the Tracker and
Job Postings tabs consume existing templates via dropdowns, with a clear message
if none exist yet. Template CRUD already works via the API (see Postman
collection); it's more of an org-admin setup task than day-to-day HR work, so it
was left out of this round's scope rather than rushed.

## New routes (the original ask, from earlier in this thread)

`GET /api/v1/auth/me`, the full `/api/v1/users` employee-directory feature,
`GET`/`PATCH /api/v1/organizations/me` self-service, and `POST /api/v1/organizations`
now optionally creates the org's first `org_admin` transactionally (previously a
self-signed-up org had no way to ever get one). All covered by `test/users.test.js`.

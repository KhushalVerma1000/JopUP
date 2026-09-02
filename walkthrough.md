# JopUP Backend — Walkthrough

> This replaces the earlier refactor-only walkthrough. The backend has grown well
> past that initial pass (real Postgres/Drizzle, 16 schema modules, seeding), so
> this doc now covers the full picture plus the staff-auth work delivered in two patches.

## Architecture

Feature-based Express backend: each domain owns its own `routes → controller →
service` stack under `src/features/`. Data access is Drizzle ORM against
Postgres (`src/utils/db.js`); schema lives in `src/schema/` across 16 numbered
modules (platform, identity, clients, candidates, job postings, workflow,
pipeline, performance, credits, events/audit, job portal, vendor, finance,
employee HR, bench, client communications).

```
backend/
├── server.js
├── src/
│   ├── app.js
│   ├── schema/                 # 16 Drizzle schema modules + barrel index.ts
│   ├── seed.ts                 # roles, plans, credit costs
│   ├── middlewares/
│   │   ├── validate.js         # Zod request validation
│   │   ├── errorHandler.js     # centralized error formatting
│   │   ├── tenant.js           # resolves req.tenantId (header or JWT)
│   │   ├── requireAuth.js      # JWT verification + requirePermission()
│   │   └── requireModule.js    # plan-module gating
│   ├── utils/
│   │   ├── db.js                # Drizzle client (Postgres via `pg`)
│   │   ├── errors.js
│   │   ├── audit.js             # auditWrite() — call on every mutation
│   │   └── events.js
│   └── features/
│       ├── auth/                # ← NEW: staff register/login/approve
│       ├── organizations/
│       ├── candidates/
│       ├── teams/
│       ├── clients/
│       ├── plans/
│       ├── workflow/
│       ├── job-postings/
│       ├── applications/
│       ├── performance/
│       ├── credits/
│       └── job-portal/          # job-seeker-facing (separate auth)
└── test/
```

Roles (seeded in `src/seed.ts`): `platform_admin` (scope=platform),
`org_admin` (scope=org), `manager` and `hr` (scope=team). A user gets
capabilities by holding a role in a team via `user_team_role` — org_admin
rows have `team_id = NULL`.

---

## Staff Auth — delivered in two patches

The previous state of this backend had **zero route protection**: every
internal endpoint (organizations, candidates, clients, job-postings, teams,
applications, performance, credits, workflow) was open, gated only by a
client-supplied `x-tenant-id` header anyone could set to anything. `requireAuth`
and `requireModule` existed as middleware but were wired into nothing.

### Patch 1 — staff self-registration + login

**Migration `0003_staff_self_registration.sql`**
- `user_status` enum gains `pending_approval` and `rejected`
- `user` table gains: `requestedTeamId`, `requestedRoleId`, `requestedManagerId`
  (captured at registration) and `approvedBy` / `approvedAt` / `rejectedBy` /
  `rejectedAt` / `rejectionReason` (populated on review)

**New `src/features/auth/`**

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/v1/auth/register` | Public | Staff self-registers against an `organisationId` + `teamId`, requesting the `hr` or `manager` role. Account is created with `status='pending_approval'` — **cannot log in yet**. |
| POST | `/api/v1/auth/login` | Public | `organisationSlug` + `email` + `password`. Issues a JWT **only** for `status='active'` accounts; pending/rejected/suspended accounts get a clear rejection message, not a token. |

Design decisions:
- **`org_admin` / `platform_admin` are invitation-only**, never self-registerable
  — self-registration is capped to `hr`/`manager` (team-scoped roles) in
  `auth.schema.js`'s `SELF_REGISTERABLE_ROLES`. Higher-privilege accounts still
  go through the existing `invitation` table/flow.
- `requestedManagerId` is optional but, if given, is validated server-side as
  an active `org_admin` of the org or an active `manager` of the chosen team
  — you can't name an arbitrary user and have their approval "count".
- Login errors are deliberately generic for unknown org/email ("Invalid
  credentials") to avoid user enumeration, but specific once credentials are
  confirmed correct (e.g. "awaiting manager/admin approval") since at that
  point the person has already proven they own the account.
- Also fixed a bug found along the way: the global `tenant` middleware didn't
  whitelist `/api/v1/auth`, so these public endpoints were incorrectly
  demanding an `x-tenant-id` header.

### Patch 2 — approval workflow + route protection

**Approval endpoints (`src/features/auth/`)**

| Method | Endpoint | Who can call it |
|---|---|---|
| GET | `/api/v1/auth/pending-approvals` | Any authenticated `org_admin` (sees all pending requests in the org) or `manager` (sees only requests for teams they manage). Optional `?teamId=` filter. |
| POST | `/api/v1/auth/pending-approvals/:userId/approve` | The named `requestedManagerId`, any `manager` of the requested team, or any `org_admin` of the org. |
| POST | `/api/v1/auth/pending-approvals/:userId/reject` | Same as approve. Accepts an optional `reason` in the body. |

Approving a request is transactional: it flips `user.status` to `active`
**and** inserts the `user_team_role` row (team + requested role,
`assignedBy` = approver) in one DB transaction — so an approved user is
immediately usable, not left in a half-configured state.

**Route protection.** `requireAuth` is now applied to every internal feature
router. Where the seeded role `permissions` JSON has an unambiguous matching
key/action, `requirePermission(entity, action)` is layered on top:

| Feature | Permission checks applied |
|---|---|
| `candidates` | `candidates:read/write/share` (+ `requireModule('candidate_db')`) |
| `clients` | `clients:read/write/delete/share` (+ `requireModule('client_management')`) |
| `teams` | `teams:write/delete` (list/get open to any authenticated staff) |
| `job-postings` | `job_postings:read/write/publish` (+ `requireModule('job_posting')`) |
| `applications` | `workflow:advance/block/hold` on the stage-transition endpoints (+ `requireModule('pipeline_tracker')`) |
| `performance` | `kpi:read/write`, `performance_reviews:read/write`, `goals:read/write` (+ `requireModule('kpi_engine')`) |
| `credits` | `credit_account:read` on balance/transactions |
| `organizations` | `requireAuth` only (see Known Gaps below) — POST stays public (tenant signup) |
| `workflow` (templates) | `requireAuth` only (see Known Gaps below) |

**Tenant-middleware ordering fix.** `requireAuth` runs at the route level,
*after* the global `tenant` middleware. That meant a request with a valid
`Authorization: Bearer` token but no `x-tenant-id` header was being rejected
by `tenant.js` before `requireAuth` ever got a chance to run. Fixed by having
`tenant.js` defer to `requireAuth` whenever a Bearer token is present, instead
of hard-requiring `x-tenant-id` in that case.

### Known Gaps (found while wiring this, deliberately not papered over)

The seed data (`src/seed.ts`) doesn't cleanly cover every action currently
exposed by the API. Rather than invent permission semantics, these were left
behind `requireAuth` only, with an inline `NOTE:` comment at each site:

- **No role grants `candidates:delete`** — nobody can currently pass a
  `requirePermission` check for that route.
- **No role grants `job_postings:delete`** (org_admin has `archive` instead —
  `remove` may actually want to call archive semantics).
- **`close` on a job posting** has no matching permission action (only
  `publish`/`archive` exist).
- **Applications list/get/create** have no dedicated `applications` permission
  key in the seed at all.
- **Workflow *template* CRUD** (as opposed to advancing an application through
  a workflow) only has `workflow:read/write` on `org_admin` — managers/hr only
  have `workflow:[advance,block,hold,approve]`, so gating template routes on
  `read`/`write` would lock them out of viewing templates entirely.
- **`strategy`** permission only appears on the `manager` role, not `org_admin`
  — gating on it would lock org_admin out.
- **Credits `top-up`/`adjust`** have no permission key anywhere — this reads
  as platform-admin/billing territory, not an org-level action.
- **`organizations` read/write is `platform_admin`-only** in the seed, but
  there's no platform-scoped login yet (staff login only issues org-scoped
  JWTs). Until that exists, any authenticated staff member can read/update
  *any* organisation's record via these routes — a real gap, not a design
  choice.

Each of these needs a product decision (either a seed-data fix or new
permission keys), not a guess baked silently into route wiring.

---

## Verification

```bash
cd backend && npm install
npm test          # 18/18 passing (14 pre-existing/updated + new auth/approval tests)
npm run dev
```

Tests exercise validation and auth/permission wiring without a live DB by
signing test JWTs with the same `JWT_SECRET`; downstream DB calls correctly
500/503 in an environment with no Postgres, which the suite already tolerated
before this change.

---

## Next Steps

1. **Rotate the Supabase credential** — `.env.example` in this repo contains
   what looks like a live connection string with a real password, not a
   placeholder. This should be treated as compromised and rotated regardless
   of any other work here.
2. Resolve the "Known Gaps" above — either fix `seed.ts` permission keys or
   add the missing ones (`candidates:delete`, `job_postings:delete`,
   `applications:*`, a real `workflow` template vs. stage-action split,
   `credit_account:write`).
3. Build platform_admin auth (separate from org-scoped staff login) so
   `organizations` routes can be genuinely restricted rather than open to any
   authenticated staff member.
4. Add an endpoint for org_admins to directly invite a user (bypassing
   self-registration/approval) using the existing `invitation` table, which
   is fully modeled in schema but has no routes yet.
5. Rate-limit `POST /api/v1/auth/login` and `POST /api/v1/auth/register` —
   currently no brute-force protection.
6. Run the full suite against a real dev Postgres instance (`npm run db:seed`
   then `npm test`) to confirm end-to-end behavior beyond validation/auth
   wiring, which is all that could be verified in this sandbox (no DB egress).

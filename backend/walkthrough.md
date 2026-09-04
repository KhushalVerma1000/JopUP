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

### Patch 3 — rate limiting

`express-rate-limit` on the two credential-facing public endpoints:
- `POST /api/v1/auth/login`: 10 attempts / 15 min per IP
- `POST /api/v1/auth/register`: 5 attempts / hour per IP

`app.set('trust proxy', 1)` in production so `req.ip` reflects the real
client behind a load balancer, rather than every request sharing one bucket.

### Patch 4 — permission model fixes (data layer)

`seed.ts` ROLES changes closing most of the gaps found while wiring patch 2:

- `candidates`: added `delete` to `org_admin`.
- `job_postings`: replaced the never-implemented `archive` action with the
  real ones — `close` (matches `job-postings.service.js`'s `closeJobPosting`)
  and `delete`.
- Split the overloaded `workflow` key in two: `workflow` (template CRUD —
  `read` for manager/hr, `read`+`write` for org_admin) and `workflow_actions`
  (`advance`/`block`/`hold`/`approve` on an application's pipeline).
- Added `applications` (`read`/`write`) to all three org-scoped roles — there
  was no permission at all for the base application CRUD routes before.
- Added `strategy` to `org_admin` (previously only `manager` had it).
- Fixed a `credit_accounts` (plural, `platform_admin`) vs. `credit_account`
  (singular, everywhere else) key mismatch that meant `platform_admin` could
  never pass a `credit_account` permission check.

Also fixed the seed script itself: role inserts used `onConflictDoNothing()`,
so re-running `npm run db:seed` against an already-seeded database wouldn't
apply any permission changes. Switched to `onConflictDoUpdate()` keyed on the
unique role `name`.

### Patch 5 — wiring the new permissions into routes

Consumed patch 4's new keys across every route file:
- `candidates` DELETE → `requirePermission('candidates', 'delete')`
- `job-postings` DELETE/`close` → `requirePermission('job_postings', 'delete'/'close')`
- `applications` list/get/create → `requirePermission('applications', 'read'/'write')`;
  stage-transition endpoints moved from `workflow` to `workflow_actions`
- `workflow` (templates) → `requirePermission('workflow', 'read'/'write')`,
  now safe since manager/hr have `read`
- `performance` strategies → `requirePermission('strategy', 'read'/'write')`
- `credits` top-up/adjust → `requirePermission('credit_account', 'write'/'adjust')`
  (only `platform_admin` holds this — confirmed by test, see below)
- `organizations` list/get/update/modules → `requirePermission('organisations', 'read'/'write')`
  (only `platform_admin` holds this)

Also fixed a real bug found in the process: `requirePermission` was throwing
`401 Unauthorized` on a failed permission check. That's wrong — the caller
*is* authenticated, they just don't have this permission — so it now throws
`403 Forbidden` instead. `requireAuth` (missing/invalid token entirely) still
correctly returns `401`.

**On `organizations`/`credit_account` and platform_admin:** these routes are
now genuinely restricted to `platform_admin`, without needing a separate
platform-scoped login flow — `requirePermission` is role-agnostic; it just
reads whatever roles are embedded in the caller's JWT. What's still missing
is a way to *provision* the first `platform_admin` user: there's no
self-registration or invite path to that role (intentionally — see patch 1),
so today it has to be assigned out-of-band via a direct `user_team_role`
insert (`team_id = NULL`, `role_id` = the `platform_admin` role). A proper
provisioning story (CLI script, or a one-time bootstrap endpoint) is worth
adding before this goes further.

### Remaining Known Gaps

- **KPI entries, applications `history`/`stages actions`, workflow `strategy`
  for hr** — a few sub-resources still rely on `requireAuth` + module gating
  only, without a dedicated permission check, because the seed data doesn't
  define one and inventing one felt riskier than leaving it as auth-only for
  now (e.g. `hr` intentionally has no `strategy` key at all — that's by
  design, not a gap).

### Patch 6 & 7 — platform admin tiering

Two roles now sit above `org_admin`: **`platform_owner`** (the single "main
admin," provisioned once via `scripts/provision-owner.ts`, never over HTTP)
and **`platform_admin`** (sub-admins the owner adds/removes). Only
`platform_owner` holds the `platform_admins` permission key, so sub-admins
get a clean `403` if they try to manage each other.

```bash
cd backend
npm run provision:owner -- --email=owner@jopup.io --password=... --firstName=Jane --lastName=Doe
```

This finds-or-creates a dedicated internal organisation (`jopup-platform`)
to hang the owner's user row off of — `user.organisationId` is `NOT NULL`
by design (see `02-identity.ts`: "one user record per person per org"), so
platform staff still need *an* org, just not a tenant-facing one. Refuses to
run twice unless `--force` is passed.

Once the owner exists and logs in (`POST /api/v1/auth/login` with
`organisationSlug: "jopup-platform"`), they manage sub-admins via:

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/v1/platform-admins` | List everyone holding a platform-scope role |
| POST | `/api/v1/platform-admins` | Create a `platform_admin` (always active immediately — owner creating the account is the vetting; can never mint another `platform_owner`) |
| DELETE | `/api/v1/platform-admins/:userId` | Revokes the role assignment + suspends the account. Can't remove yourself; can't remove a `platform_owner` via this route at all |

### Patch 8 — org-level invitations

The `invitation` table existed in schema from the very start of this work
with zero routes — this is what closes that. It's also the **only** path to
the `org_admin` role, since self-registration (patch 1) deliberately caps
out at `hr`/`manager`.

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| POST | `/api/v1/invitations` | `org_admin` only (`users:invite` in seed.ts) | `roleName` ∈ `{org_admin, manager, hr}`. `org_admin` invites must omit `teamId`; `manager`/`hr` invites require it. |
| GET | `/api/v1/invitations` | `org_admin` only | Optional `?status=` filter |
| POST | `/api/v1/invitations/:id/revoke` | `org_admin` only | Only works on `pending` invitations |
| POST | `/api/v1/invitations/accept` | Public | Redeems the token, creates the user **directly active** (no approval step — the inviting `org_admin` already vetted them), and returns a login JWT immediately so the invitee doesn't need a separate `/auth/login` call |

**Known limitation, stated plainly:** there's no email delivery integration
anywhere in this codebase. `POST /api/v1/invitations` returns the raw token
in the response body — whoever calls it is responsible for getting it to
the invitee out-of-band until an email provider is wired in. Not pretending
otherwise.

### Next: repo cleanup

`backend/node_modules/` is tracked in git (`.gitignore` was added after it
was already committed). Not a code patch — a one-time git operation:

```bash
git rm -r --cached backend/node_modules
git commit -m "chore: stop tracking node_modules (already gitignored)"
```



---

## Verification

```bash
cd backend && npm install
npm test          # 37/37 passing
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
2. **Clean up tracked `node_modules`** — see above.
3. **Wire an actual email provider** for invitations — right now the token
   comes back in the API response instead of an email.
4. Run the full suite against a real dev Postgres instance (`npm run db:seed`
   then `npm test`) to confirm end-to-end behavior beyond validation/auth/
   permission wiring, which is all that could be verified in this sandbox
   (no DB egress). In particular: run `provision:owner` for real, log in as
   the owner, create a sub-admin, and walk through a full invitation
   create → accept cycle.

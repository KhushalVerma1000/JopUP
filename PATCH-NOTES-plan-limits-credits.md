# Patch: plan limits, credit spending, trial lock

Backend, plus a brand rename in user-facing strings. One migration (`0008_usage_counter`), no new env vars.

## What changed

| Area | Change |
|------|--------|
| `utils/entitlements.js` (new) | Limit maths, trial state, write-block rules, usage counts, 10 s org/plan cache |
| `middlewares/requireLimit.js` (new) | 403 `PLAN_LIMIT` when a create would pass the plan cap. Batch-aware: a batch that does not fit is rejected whole, with `remaining` in the response |
| `middlewares/writeGuard.js` (new) | Expired trial or suspended/cancelled workspace becomes read-only: writes get 402 `TRIAL_EXPIRED` / `ORG_INACTIVE`, reads still work. Fails open on DB errors |
| `utils/credits.js` (rewritten) | `spendCredits` (atomic `UPDATE ... WHERE balance >= cost`, `qty`, free if no price row or plan has credits off) and `refundCredits` (also lowers `lifetime_spent`). Old `checkAndDeductCredits` kept as a wrapper. No more `db.query.*` |
| `resume-parser` bulk-create | Charges `candidate_db.bulk_import` per row up front (402 if short), refunds rows that were not created |
| Routes | `requireLimit` on candidates, bulk-create, clients, teams, job postings |
| `GET /api/v1/billing/usage` (new) | Plan, trial countdown, usage vs each limit, credit balance, read-only flag |
| Tests | `test/entitlements.test.js` (14 tests) |

## Free trial: 3 months, resume parsing free but capped
- Every plan's trial is now **90 days** (seed, signup fallback, and the migration updates existing plan rows).
- Resume parsing costs **no credits**. During a trial it is capped at **500 per month**, so a 90-day trial allows **1,500**.
- "Month" = a 30-day window counted from the org's creation date, so 90 days is exactly three windows.
- A whole upload that does not fit is rejected with 403 `PARSE_QUOTA` (limit, used, remaining, requested, resetsAt). Files that fail to parse are handed back to the allowance.
- After the trial, the cap is `resume_parses_per_month` on the plan (not set = unlimited). Set it per plan when paid pricing is decided.
- New table `usage_counter` (org, key, period_start, count) with an atomic capped upsert; reusable for other allowances.
- `credit_cost` row `candidate_db.resume_parse` is deactivated (migration) and removed from the seed.
- `GET /api/v1/billing/usage` now includes `resumeParses` (limit, used, remaining, windowStart, resetsAt).

## Rename
User-facing "JopUP" is now "HireTracker": app header, auth screen, page title, invite page, invitation email subject/body,
default From name, daily tracker sender fallback, workspace-suspended message, server banner, READMEs, `.env.example`.
Deliberately unchanged (changing them would break data or sessions): the `jopup-platform` org slug, the `jopup_token` and
`jopup.trackerMailIds` browser storage keys, DB/docker names, `@jopup.*` seed emails, script file names, old patch notes.

## Enforced limits
`max_candidates`, `max_clients`, `max_teams`, `max_job_postings` (closed/archived do not count).

## Not enforced yet
- `max_hrs_per_team` and `max_storage_mb` (no storage yet).
- Candidates created by tracker quick-add and the public job portal bypass `max_candidates`.
- Monthly credit refill, trial-ending reminders, payment/upgrade flow.

## Behaviour defaults (change in one place each)
- Trial uses the plan's own limits; credits granted once at signup (100 on Starter).
- Expired trial = read-only, derived from `trial_ends_at` (no scheduler, no new enum value).
- Bulk import costs 1 credit per row (the `credit_cost` row); resume parsing is free (see above).
- Platform routes, auth, plans, portal, billing and credits are exempt from the guard.

## Verified
- Full suite: 249 tests, 230 pass, 19 skipped, 0 fail.
- Live run against Postgres (migrations + seed): limits block at the cap, bulk charged and refunded
  (duplicates), 10 parallel spends on a 2-credit balance -> exactly 2 succeed, expired trial -> 402
  on writes and 200 on reads, upgrading to `active` unlocks writes.
- Quota, live: 90-day trial, 0/500 shown, credits untouched by parsing, 2 files over 1 left rejected whole, last 1 fits then
  blocked at 500, failed files handed back, 10 parallel uploads with 2 left -> exactly 2 succeed, a new 30-day window resets the count.

## Migration order
This is `0008_usage_counter`. The OAuth foundation in IMPLEMENTATION-email-send.md planned `0008_mail_oauth`; renumber that one to `0009`.

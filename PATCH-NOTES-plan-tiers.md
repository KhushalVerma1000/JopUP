# Patch: plan tiers, Pro preview, Enterprise by request

## What changes for people
- **Signup has no plan picker.** Everyone starts on Starter (30 days, or 90 for selected companies, unchanged). A plan sent in the request is ignored by the server.
- **Pro preview.** For the first 14 days from signup, Pro modules (KPIs, goals, reviews, strategy, job portal) are on. After day 14 they lock: Performance tabs show "Pro", with an upgrade card. Starter features never lock.
- **Small trial credits.** New workspaces start with 50 credits, not the plan's 100.
- **Enterprise is request-only.** `/enterprise-trial` form (public) emails sales and saves the request. Platform > Trials & requests > Approve switches that workspace onto Enterprise for 7-90 days (default 30) and adds 200 credits.
- **Pro upgrade.** `/upgrade` records interest (no payment yet); mark it contacted in the same list.

## Tuning without a deploy (plan row, `limits` JSON)
`trial_preview_days` (14), `trial_preview_plan` ("pro"), `trial_credits` (50 Starter, 200 Enterprise). Set `trial_preview_days` to 0 to turn the preview off.

## Files
Backend: migration `0011_plan_tiers.sql` (+ journal), `utils/entitlements.js` (previewState, resolveModules), `middlewares/requireModule.js` (now MODULE_LOCKED / MODULE_NOT_IN_PLAN codes), `features/trial-requests/*` (public form), `features/platform/platform.requests.service.js` + routes, signup/billing/org services, `tenant.js` + `writeGuard.js` (form is public), seed, schema.
Frontend: `RequestPlanPage`, `PlanBanner`, `PlanLock`, `usePlan`, Signup, Performance, Dashboard, PlatformTrials, AppLayout, App.

## Deploy
1. Apply the zip, run `npm run db:migrate` (0011 only changes plan rows and adds a table; existing workspaces keep their plan and credits).
2. Set `TRIAL_REQUEST_TO` (sales inbox) and make sure `RESEND_API_KEY` is set on Render, otherwise requests are saved but not emailed.
3. **Migration order:** 0011 has journal `when` 1793250000000. When the mail-OAuth migration is added as 0010, give it a `when` between 1793200000000 and 1793250000000, or drizzle skips it.

## Checked
269 backend tests, 0 failures (19 new). Migration run over old plan rows and on a fresh DB with seed. Real-Postgres run: signup (even asking for enterprise) -> Starter, 50 credits, Pro modules open; aged 20 days -> KPI API returns 403 MODULE_LOCKED, analytics stays open; form saved (duplicate and honeypot dropped); approve -> Enterprise, credits 250, 30 days; second approve -> 409. Frontend builds.

## Known gaps
- AI screening, SMS and the `analytics` module exist only in plan data, not as features. They are hidden from the signup comparison. Enterprise today = unlimited limits + more credits; build those before selling them.
- Existing trial workspaces keep what they have (including any already on Pro/Enterprise).
- Module changes (overrides, plan edits) can take up to 10 s to show, due to the shared cache.
- Frontend: only the Performance page and banner use the lock; other Pro-only screens show the plain API error until wired.

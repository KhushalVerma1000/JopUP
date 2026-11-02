# Patch: 30-day trial, 90-day trial for selected companies, new signup page

One migration (`0009_trial_tiers`), no new env vars, no new permissions.

## Rule
| Who | Trial |
|-----|-------|
| Every self-serve signup | **30 days** |
| A company a platform admin selected | **90 days** |

Length is decided on the server only. The signup request cannot ask for it and `plan.trial_days` no longer drives it.
Existing workspaces keep the `trial_ends_at` they already have; nobody loses days. Those past 31 days from signup are marked `extended`.

## Two ways to select a company (platform_owner / platform_admin)
1. **Before they sign up**: Platform > 90-day trials. Add an exact email (`hr@acme.com`) or a company domain (`acme.com`).
   The first signup that matches gets 90 days. An exact email beats a domain. One signup uses up a row (claimed atomically, so two
   parallel signups cannot both win). Public mail domains (gmail.com etc.) cannot be added as a domain; add the exact email.
2. **After they sign up**: Organisation page > "Grant 90-day trial" (90 days from signup, or "Restart 90 days from today").
   "Back to 30-day trial" reverts it; if 30 days from signup has passed the workspace turns read-only at once (confirm dialog says so).

## Backend
| File | Change |
|------|--------|
| `utils/trial.js` (new) | Constants, `normalizeSelection`, `matchKeys`, `trialFor`, `extendedEnd`, `standardEnd` |
| `schema/02-identity.ts` | `organisation.trial_tier` (`standard`/`extended`), `trial_extended_by`, `trial_extended_at` |
| `schema/22-trial-selection.ts` (new) | `trial_selection` table |
| `auth.service.js` | Signup looks up a selection, claims it inside the transaction, sets tier and end date; response adds `trialTier`, `trialDays` |
| `platform.*` | `POST/DELETE /platform/organizations/:id/extended-trial`, `GET/POST/DELETE /platform/trial-selections`. Writes need `organisations:write`; list/detail now return `trialTier` |
| `seed.ts` | Plans `trialDays` 90 to 30 |
| `0009_trial_tiers.sql` | Columns, table, backfill, plan `trial_days = 30` |
| `test/trial.test.js` (new) | 5 tests, no DB needed |

Changing a trial clears the entitlement cache and updates the subscription row, so the read-only guard reacts straight away.
Claimed selections cannot be deleted (they are the record of who got 90 days). Grants and reverts are audit-logged.

## Frontend
- **Signup** is now two short steps (account, then workspace) with a progress bar and a side panel (30 days, no card, data kept if trial ends) that stacks under the form on phones.
  Inline validation on blur, show/hide password with a live checklist, Back keeps what was typed, country guessed from the browser time zone,
  plan collapsed to the default (Starter) with "Compare plans", focus moves to the first error, 44px tap targets, browser time zone sent.
  The page never mentions 90 days and never reveals whether an email or domain is selected (that would leak the list).
- **Platform > 90-day trials** page; **Organisation** page trial controls and "Trial length" row; **Dashboard** banner says "90-day free trial" for selected companies.

## Heads-up
- Resume-parse trial cap stays 500 per 30 days, so a 30-day trial allows 500 and a 90-day trial 1,500.
- `0009` is hand-written and has no drizzle snapshot. Run `npm run db:generate` once afterwards; it should report no changes. If it proposes the same columns, delete that generated file and keep `0009`.
- The mail OAuth plan's `0008_mail_oauth` is now **`0010`** (0008 usage counter, 0009 this patch).
- Not built: trial-ending reminder emails, and a self-serve "request a longer trial" form.

## Verify
```
cd backend; npm run db:migrate; npm run db:seed; npm test
```
Manual: sign up as a fresh email, dashboard shows ~30 days. Add that email's domain on the Trials page, sign up with a second address on it, expect 90 days and the row moves to "Signed up". Platform admin grants / reverts on an org page.

## UI guidelines applied (signup, 90-day trials page, auth shell)
- Submit stays enabled until the request starts, then disables with a spinner and keeps its label; spinner honours reduced motion.
- Inline errors are polite live regions next to the field; first invalid field is focused on submit; fields have `name`, `autocomplete`, correct `type`/`inputmode`, no spellcheck on email, placeholders end with an example and `…`.
- Plan picker is a real radio group: arrow keys move selection, one tab stop.
- Step is in the URL (`?step=2`), so browser Back/Forward move between steps; typed details trigger a leave-page warning.
- Autofocus and auto-moving focus only on fine-pointer (desktop) devices.
- Password checklist uses icon + hidden text, not colour alone; numbers use `tabular-nums`; curly quotes, `…`, non-breaking hyphen in "30-day"; `text-balance` on headings.
- Auth shell gains "Skip to content", a `<main>` landmark and `translate="no"` on the brand; `<title>` follows the step.
- Global `touch-action: manipulation` on interactive elements. Inputs were already 16px and 44px on mobile.
- Not changed: Card titles are still `<div>`s (the page has one `<h1>`); a full pass on other screens is separate work.

# Release v3 — approved HR workbench + daily tracker

Superset of the earlier patches (accept-invite, HR workbench v1/v2). Apply over them.

## 1. Apply (PowerShell, repo root)
```powershell
Expand-Archive -Path .\jopup-v3-release.zip -DestinationPath . -Force

# Leftover pre-consolidation migrations (not in the journal; they break `drizzle-kit generate`)
Remove-Item .\backend\drizzle\migrations\0000_sleepy_northstar.sql -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\0001_confused_peter_parker.sql -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\0002_slippery_starbolt.sql -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\0003_staff_self_registration.sql -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\0004_candidate_created_by_nullable.sql -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\meta\0003_snapshot.json -ErrorAction SilentlyContinue
Remove-Item .\backend\drizzle\migrations\meta\0004_snapshot.json -ErrorAction SilentlyContinue
Remove-Item .\frontend\src\pages\HrClassicPage.jsx -ErrorAction SilentlyContinue
```
Note `meta\0001_snapshot.json` and `meta\0002_snapshot.json` are overwritten by this zip
(new content, same names) — do not delete those two.

## 2. Production checklist (nothing here is done for you — I can't deploy from the chat)
1. **Back up the database.** Migration 0001 demotes pre-existing duplicate default workflows / live tags.
2. Environment: `NODE_ENV=production`, `APP_URL` (the server now refuses to boot without a real one),
   a long random `JWT_SECRET`, `RESEND_API_KEY`, and `EMAIL_FROM` on a **verified** sending domain.
   Without the key mail goes to the console provider and nothing is delivered.
3. Set `organisation.timezone` for every org (default is UTC). Daily tracker send times use it.
4. Deploy; startup runs `db:migrate` (0001, 0002) and `db:seed` (adds `daily_trackers` permissions).
5. **Everyone must log in again** — permissions are read from the JWT.
6. Run `docker compose exec backend bash jopup-hr-integrity-test.sh` on a staging copy with demo data.
7. Rotate the database credential that used to be in `.env.example`, if you haven't.
8. Keep `DAILY_TRACKER_SCHEDULER` on in exactly the instances you want sending (several is safe — see below).

## 3. Daily tracker

**What it is.** For each client (and one "internal hires" group) in a team, a daily snapshot of the live
pipeline: everyone in play plus anyone who joined / was rejected that day, each marked NEW or UPDATED
since local midnight. It is stored as a module-16 `tracker` row (frozen — later pipeline changes never
alter a tracker that has been sent), rendered into an `email_message`, and sent. Recipients are saved
on the message as the audit record.

**Wording.** Stage "Turn up" is written "Reached" in the tracker, the email and the copied text
(keyed on stageKey `turnup`; the database, API and on-screen labels still say Turn up).

**Who gets it.** `to`/`cc` addresses typed on the schedule, plus (if "include client contacts" is on)
the client's active SPOCs flagged `receives_trackers_by_default` (To) and its default-cc internal contacts (Cc).
An address on To is never also on Cc. **There are no API routes for SPOCs yet** — until they exist, type
addresses on the schedule.

**Schedule.** Per team + client: send time (local), days (default Mon–Sat), timezone (default: the org's),
skip-if-empty, enabled. Disabled = manual "Send now" only.

**When it sends.** A tick runs every minute. A schedule is due when today (local) is a send day and the local
clock has reached the send time. It catches up the same day if the server was down. At most one scheduled send
per schedule per day, even with several app servers (database unique index); a failed attempt retries on later
ticks, max 3. Runs stuck "running" > 10 min (database clock) are failed and retried.

**Permissions** (`daily_trackers`): org_admin & manager = read, write, send · hr = read, send.
HR can preview, copy and "Send now"; changing recipients and times is a manager decision. Change in `seed.ts`.
Team scoping applies everywhere (an HR only sees their own teams).

| Endpoint | Permission |
|---|---|
| `GET /api/v1/daily-trackers/overview?teamId=&date=` | read |
| `GET/POST /schedules`, `PATCH/DELETE /schedules/:id` | read / write |
| `POST /schedules/:id/send` (send today's now) | send |
| `GET /schedules/:id/runs` | read |

**Known limits**
- At-least-once, not exactly-once: if the process dies after the provider accepts the mail but before we record it,
  a retry sends again. Closing this needs provider idempotency keys.
- Gated on `pipeline_tracker`, not `client_communication` (that module isn't in any plan yet) — add it when it is.
- The daily-tracker screen is **not in the real frontend yet** — it's in the prototype for your sign-off.
- The "Reached" status chip beside a Turn-up stage reads "Stage: Reached / Status: Reached"; your call on the chips.

## 4. What was verified
| Check | Result |
|---|---|
| Backend suite | 93 / 93 |
| Scheduler scenarios with a fake clock (weekday, too-early, 5 simultaneous ticks → 1 email, retry cap, skip-empty, disabled, stuck run) | 10 / 10 |
| Live API: permissions, validation, duplicate schedule 409, cross-team 404, send-now, recorded tracker/message/recipients | pass |
| Snapshot frozen after send (hash unchanged after pipeline moved) | pass |
| Turn up → Reached in tracker + copy text | pass |
| Bug found by the scheduler test and fixed: stale-run reaper used the app clock → a run still in progress could be freed and a second email sent. Now uses the database clock. | fixed |
| **Not done** | real email delivery (console provider only), real browser/phone pass |

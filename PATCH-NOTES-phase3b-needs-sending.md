# Phase 3b: "Needs sending" list on the Email Tracker tab

Requires phase 3 (jopup-phase3-email-tab.zip) applied first.

The tab now opens with a **Needs sending** list: every Lineup and Interview schedule mail due from today
to 14 days ahead, one row per client, hiring location and day, marked **Not sent**, **Sent** or
**N new since sent** (someone was added after the mail went out, so a follow-up is due). One tap opens
that exact mail in the picker. Mark as Sent refreshes the list.

- `GET /api/v1/mail/pending` (trackers:read, team-scoped like the rest of mail)
- Sent state comes from the sent log (`client_mail_log`, last 14 days), matched on mail type, client and location. A lineup being sent does not mark the interview schedule as sent.
- Mails logged before phase 3 have no type and do not count as sent here.
- No migration.

Tests: 2 more in `backend/test/mail.types.test.js`. Backend suite: 0 failures. Frontend builds.

Apply (PowerShell, repo root): `Expand-Archive jopup-phase3b-needs-sending.zip -DestinationPath . -Force`

# Phase 3d: from setting dates to sending the mail, in one step

Requires phases 3, 3b and 3c.

In the HR workbench, after "Set dates" is applied for a lineup or interview date, the sheet now offers
**Email this lineup** / **Email this schedule** next to Done. On desktop it opens the Email Tracker tab
(`/email-tracker?from=hr&type=lineup&date=YYYY-MM-DD`) with exactly those candidates, one mail per client
(and per hiring location where configured), using the Lineup or Interview schedule columns and titled with the day
HR just set instead of today. On a phone it opens the existing bottom sheet as before.

Checked live against Postgres: two clients' candidates sent together come back as separate mails per client/location,
each titled "Lineup — <client> · <location>, <that day>".

No backend change, no migration. Frontend builds.

Apply (PowerShell, repo root): `Expand-Archive jopup-phase3d-workbench-link.zip -DestinationPath . -Force`

# Phase 3c: honest counts on day-based mails

Requires phases 3 and 3b.

Found while running the whole flow against a real Postgres (migrations, seed data, the new endpoints): for Lineup and
Interview schedule, the client and location chips counted candidates who had no date yet, so a chip could say "3"
while the mail held 1. Now every count at every step counts only candidates who will be in the mail. Candidates
without the date are reported separately ("N without a lineup date are not listed"), and if nobody has a date the
screen says so and points to the HR workbench instead of showing an empty list.

Verified live: migration 0006 applies; types, options, compose, pending, mark-sent and already-sent all work on real
data; a mail naming one client with another client's candidate is refused with a clear message.

Apply (PowerShell, repo root): `Expand-Archive jopup-phase3c-counts.zip -DestinationPath . -Force`

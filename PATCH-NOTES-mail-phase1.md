# Patch: HR mail, Phase 1 (copy-only) + WhatsApp + lineup-date filter

Applies on top of GitHub main daff31e. Full files, extract with -Force.

## New
- backend/src/services/email/templates/lineup.js      lineup mail + interview reminder (text, HTML, WhatsApp text)
- backend/src/features/mail/ (schema, service, controller, routes)   POST /api/v1/mail/compose
- backend/test/mail.test.js                            7 tests, no DB needed
- frontend/src/lib/whatsapp.js, lineupDay.js
- frontend/src/components/hr/LineupDateSheet.jsx, MailComposeSheet.jsx

## Changed
- backend/src/app.js                                   registers /api/v1/mail
- backend/src/features/trackers/trackers.service.js    tracker rows now carry candidatePhoneE164
- frontend/src/pages/HrPage.jsx                        WhatsApp icon (pipeline + candidates), lineup-date chip,
                                                       lineup-day filter, "Email lineup", "Remind"

## Behaviour
- Lineup day filter: Any day / Lineup today / Lineup tomorrow / Pick a date (HR's local day). Stage chips, counts and
  the position filter all work on the filtered list.
- "Email lineup (n)" mails exactly the candidates on screen. One mail per client (a mail never mixes two clients),
  grouped by position, sorted by time. Turn up is written "Reached" elsewhere; the lineup mail has no stage column.
- Nothing is sent. HR edits the subject/body and copies. Send comes with the provider; at that point email_message
  (needs a sender identity) starts being written.
- WhatsApp uses the stored E.164 number. A bare local number with no country code shows no icon rather than guessing.
- No new permission key: compose rides on trackers:read (HR already has it); sending will get its own key.
- No migration.

## Not done / open
- Compose (the DB-backed part) was not run against a live database here; template, schema, helper and route-auth
  tests pass, and the frontend builds. Please run one lineup mail against demo data.
- No real-browser/phone pass.
- Lineup date is set per candidate from the card; there is no bulk "set lineup date" yet.
